# Architecture

**Build spec Section 60.**
Last updated: 2026-10-05.

UsageBar is a Next.js application that drives a real Solana payment channel on
Devnet. This document describes what runs where, which key signs what, and where
the trust boundaries actually fall — as opposed to where they would fall if the
diagram were drawn to look reassuring.

---

## The system, top to bottom

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│                                                                  │
│    app/page.tsx · app/components/UsageTab.tsx                    │
│    lib/use-session.ts     the state machine, driven by reads     │
│    lib/wallet.ts          Wallet Standard bridge — NO Solana lib │
│    lib/client-api.ts      typed calls to our own API             │
│                                                                  │
│    holds: the customer's key, inside their wallet extension      │
│    holds: no private key of ours, no Solana SDK, no RPC          │
└───────────────────────────┬──────────────────────────────────────┘
                            │  HTTPS, same origin, JSON
                            │  bigints cross as strings
┌───────────────────────────▼──────────────────────────────────────┐
│  UsageBar — Next.js route handlers (Node runtime)                │
│                                                                  │
│    app/api/session/route.ts   open · usage · close · read        │
│    app/api/faucet/route.ts    one click, funded                  │
│    app/api/wallet/route.ts    what a wallet holds                │
│    lib/server/http.ts         request shapes; 400 vs 502         │
│    lib/server/rate-limit.ts   the faucet's (honest) limits       │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│  Protocol adapter — lib/server/chain.ts                          │
│                                                                  │
│    PDA seeds · instruction encoding · account metas · decoding   │
│    lib/server/env.ts   configuration and secret loading          │
│                                                                  │
│    holds: DEVNET_PAYER_KEYPAIR    (funder, fee payer)            │
│    holds: DEVNET_OPERATOR_KEYPAIR (payee + authorized_signer)    │
└───────────────────────────┬──────────────────────────────────────┘
                            │  JSON-RPC over HTTPS
┌───────────────────────────▼──────────────────────────────────────┐
│  Payment Channels program                                        │
│  CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX                   │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│  Solana Devnet                                                   │
└──────────────────────────────────────────────────────────────────┘
```

The second diagram the spec asks for — the one for when a server signer exists —
is not a variant of this. It is this. There **is** a server signer, so the
provider signing boundary is a real thing in the running system, and it is the
next section.

---

## The provider signing boundary

```
Browser
  │  1. POST { action: "open", address }        ── the customer's public key
  ▼
Next.js API
  │  2. builds the `open` transaction, unsigned
  │     · derives the channel PDA from (payer, payee, mint, signer, salt, slot)
  │     · the customer is the fee payer
  │  3. returns base64 wire bytes
  ▼
Browser  ──  4. wallet extension signs and sends the deposit transaction
Browser  ──  5. POST { action: "usage", channel, contractText }
  ▼
Next.js API
  │  6. reads the channel and latest durable meter state from Upstash Redis
  │  7. calls Groq and validates the structured contract-review response
  │  8. only after a valid response, signs the next cumulative 50-byte
  │     voucher with DEVNET_OPERATOR_KEYPAIR (off chain)
  │  9. atomically stores the cumulative amount, voucher signature,
  │     and successful-review count in Upstash Redis
  ▼
Browser receives the review and updated usage state; no chain transaction
is sent for an individual review.

At close, the API submits the latest voucher's Ed25519 verification
instruction with settleAndSeal. After confirmation it verifies the on-chain
watermark, then distributes the funds: the provider receives the final
metered amount and the customer receives the unused balance.
```

**The provider private key never reaches the browser.** Three things enforce
that, and only the third is a guarantee:

1. `lib/server/env.ts` is imported by route handlers only. No client module
   imports it.
2. The keys are not `NEXT_PUBLIC_`-prefixed, so Next.js will not inline them
   into a client bundle even by accident.
3. `DEVNET_OPERATOR_KEYPAIR` is a **server-side environment variable**. It is
   never in the repository, never in a response body, and never in a URL. The
   only thing derived from it that crosses the boundary is `payeeAddress`, which
   is public information that already sits in the channel account on chain.

A reader who wants to check claim 1 rather than trust it can grep the client
graph: `lib/wallet.ts`, `lib/use-session.ts`, `lib/client-api.ts`, `lib/session.ts`
and everything under `app/components/` import no server module, and the browser
bundle contains no `@solana/kit`.

---

## Who holds which key

A payment channel has three keys. They are not interchangeable, so this split is
forced by the protocol rather than chosen for convenience.

| Key | Held by | Signs | Why it must be there |
|---|---|---|---|
| `payer` | **the visitor's wallet** | `open` | The deposit leaves their wallet. This is the product. |
| `payee` | server (`DEVNET_OPERATOR_KEYPAIR`) | `settleAndSeal`, `distribute` | `settleAndSeal` is a cooperative close and requires the payee's signature. |
| `authorized_signer` | server (`DEVNET_OPERATOR_KEYPAIR`) | usage vouchers, **off chain** | This is what makes metering cheap: a meter tick is a signature, not a transaction. |

The last two are one keypair here — the provider signs the meter and receives the
money. The protocol keeps the roles separate and a real provider would too; for
a demo, one key doing both jobs removes a moving part without weakening anything
that is being demonstrated.

`DEVNET_PAYER_KEYPAIR` is a fourth key that is *not* a channel role: it is the
funder. It pays transaction fees for server-submitted transactions and stocks
the faucet. Naming it "payer" is a collision with the protocol's `payer` role,
which is the customer — see the note at the end.

### The customer does not sign the close

`closeChannel` runs without the customer being present, and that is safe by
construction rather than by trust:

- A voucher can never exceed the deposit. The program rejects it (error 235
  `voucherOverDeposit`), so the provider cannot bill more than was authorized.
- Everything unbilled returns to the customer's token account automatically
  during `distribute`.
- `distribute` is **permissionless**. The provider closing late, or not closing
  at all, does not cost the customer the remainder — anyone can trigger the
  payout.

So the ceiling is a real ceiling, not a promise. A malicious provider's worst
case is charging the customer for the full ceiling they already authorized.

---

## The three flows

### Open

`buildOpenTransaction` derives the channel PDA from the **customer's own**
address and returns an unsigned transaction with the customer as fee payer and
holder of the only required signature. The wallet extension shows the customer
what they are approving: a deposit into an escrow account derived from their key.

Returning unsigned bytes rather than signing server-side is what keeps **one**
implementation of the PDA seeds, the argument encoding and the account metas —
server-side, and the one under test. A browser-side builder would be a second
implementation of the money encoding, and two implementations of a byte layout
disagree eventually. The browser therefore carries no Solana library at all.

`openSlot` is read from the chain rather than assumed, because the PDA includes
it: a stale slot derives an address the program will not find.

### Meter (usage)

The billable unit is one successful AI contract review, priced at **1.00 TEST**
for this demo. The browser submits contract text to the UsageBar API; the server
sends it to Groq, validates the structured response, and only then advances
usage. A failed request or invalid model response must not add a billable unit.

For each successful review, the server reads the latest durable meter record
from Upstash Redis, verifies the prior voucher state, signs the next cumulative
voucher with `DEVNET_OPERATOR_KEYPAIR`, and atomically compare-and-sets the
new cumulative amount, signature, and review count. This update is **off chain**:
there is no Solana transaction, chain fee, or wallet prompt for each review.
Redis is required because Vercel route handlers are stateless; in-memory state
would be lost or diverge across invocations.

The UI's `used` amount is the cumulative successful-review total. It is not
the escrow deposit, and it must never be presented as an on-chain settled amount
before close. A cumulative voucher cannot exceed the customer's escrowed cap.

At close, the server submits the latest voucher's Ed25519 verification
instruction alongside `settleAndSeal`. After that transaction confirms, it
checks the on-chain watermark and then distributes the funds. The provider
receives the final metered amount and the customer receives the unused balance.
The interface may display **SETTLED** only after the close/settlement path has
actually succeeded; on failure, it must not claim the channel is settled.

### Close

`settleAndSeal` (cooperative, payee-signed, final watermark) followed by
`distribute` (payee + payer refund + treasury, permissionless). The channel
account is deallocated and its rent returned once the channel is old enough.

If close fails, the interface returns to **ACTIVE, never SETTLED**. The channel
is still open and still holds the money; claiming otherwise is precisely the
failure this project exists to avoid.

---

## Where the protocol's own rules do the work

These are the places the system is safe because the *program* enforces something,
not because our code is careful. They are listed together because they are the
strongest claims in the design and the least dependent on us.

| Rule | Enforced by | Our exposure if we got it wrong |
|---|---|---|
| Vouchers are cumulative and monotonic | error 234 `voucherWatermarkNotMonotonic` | a stale voucher is rejected, not silently re-applied |
| A voucher cannot exceed the deposit | error 235 `voucherOverDeposit` | the ceiling holds even if our clamping has a bug |
| A voucher is bound to one channel | error 232 `voucherChannelMismatch` | a voucher cannot be replayed into another channel |
| Vouchers expire if they say so | error 233 `voucherExpired` | our vouchers are issued with `expires_at = 0` (never) |
| Settlement needs a real signature | error 230 `missingEd25519Verification` | the operator cannot be impersonated |
| The plan must match its commitment | error 2407 `InvalidDistributionHash` | a provider cannot quietly change who gets paid |
| The channel address is re-derived | error 2000 | a wrong PDA fails loudly instead of touching the wrong account |

**Replay, concretely.** A voucher is 50 bytes: magic, `channel_id`,
`cumulative_amount`, `expires_at`. Replaying it is not rejected by a nonce — it
is rejected by arithmetic. The same voucher re-submitted sets the watermark to a
value it already has, and error 234 refuses a non-increasing update. A voucher
from a *different* channel carries a different `channel_id` and dies at 232. So
replay protection is a property of the cumulative design rather than a
bookkeeping table that could drift.

---

## What is deliberately duplicated, and why

`encodeOpenArgs`, `channelSeeds`, the System and SPL transfer encoders and the
token-account reader live in `tools/lib/protocol.mjs`, beside every other byte
layout the program pins. `devnet-open-channel.mjs` imports them rather than
keeping its own copies: a layout that exists twice will disagree with itself.

Two copies remain, for a real constraint rather than convenience:

- `base58Encode` is duplicated into `lib/base58.ts`, because `protocol.mjs`
  imports `node:crypto` and that must not enter a browser bundle.
  `tests/protocol-bytes.test.js` asserts the two produce identical output **and**
  round-trip through the tooling's decoder — so agreement cannot be satisfied by
  two identically wrong implementations.

---

## Configuration

Protocol defaults below are for Devnet, but the deployed product also requires
its AI provider and durable meter store. If Upstash is not configured, opening a
new usage tab must be blocked before asking the wallet to deposit. If Groq is
not configured, the review service is unavailable and must not issue a voucher.

| Variable | Required | Default | What it is |
|---|---|---|---|
| `DEVNET_PAYER_KEYPAIR` | **yes** | — | funder and fee payer; also stocks the faucet |
| `DEVNET_OPERATOR_KEYPAIR` | **yes** | — | payee **and** authorized_signer |
| `DEVNET_RPC_URL` | no | `https://api.devnet.solana.com` | RPC endpoint |
| `TEST_MINT` | no | the verified test mint | the asset |
| `TREASURY_OWNER` | no | the program's real devnet treasury | recovered from the deployed ELF |
| `USAGEBAR_CEILING` | no | `50000000` (50 TEST) | the authorized ceiling |
| Review price | fixed in application | `1.00 TEST` per successful review | demo pricing rule; not Groq's actual token cost |
| `USAGEBAR_GRACE_PERIOD` | no | `60` | seconds; `0` is rejected by the program (error 201) |

Keypairs are JSON arrays of 64 bytes, as `solana-keygen` writes them.

---

## Network and asset binding

The application is **Devnet only**, and says so in the header. There is no
mainnet code path, no mainnet default and no mainnet funds.

The asset is a classic SPL Token mint created for this project, not Token-2022
and not USDC. `docs/ASSET_PROVENANCE.md` records how it was created and
`docs/CLAIM_STATUS.md` records how its mint, decimals, supply and authorities
were verified. The mint is bound into the channel PDA seeds, so a tab cannot
silently change asset.

---

## One naming collision, stated rather than hidden

There are two things called "payer" in this system and they are different:

- **the protocol's `payer`** — the customer, who owns the deposit;
- **`DEVNET_PAYER_KEYPAIR`** — our funder, which pays fees and stocks the faucet.

The collision is in the environment variable's name, not in the code, and the
funder is never a channel participant. It is recorded here because a reader
tracing who pays for what will hit it, and a document that quietly skips it is
worse than one that names it.

---

## Related documents

| | |
|---|---|
| [`CLAIM_STATUS.md`](CLAIM_STATUS.md) | what is proven, observed, inferred, and unverified |
| [`SECURITY.md`](SECURITY.md) | trust model, signer model, replay and retry safety |
| [`LIMITATIONS.md`](LIMITATIONS.md) | what this does not do |
| [`PROTOCOL_DISCOVERY.md`](PROTOCOL_DISCOVERY.md) | the instruction-level facts, from the program's own IDL |
| [`ASSET_PROVENANCE.md`](ASSET_PROVENANCE.md) | the test mint's origin and verification |
| [`../PROGRESS.md`](../PROGRESS.md) | the running build log |
