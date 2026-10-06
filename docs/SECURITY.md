# Security

**Build spec Section 61.**
Last updated: 2026-10-05.

This document describes the trust model of the deployed system as it is, not as
it would ideally be. Where a protection is structural it says so and names the
program error that enforces it. Where a protection is *weak* — the faucet's rate
limiter is the clear case — it says that too, because a security document that
only lists strengths is a marketing document.

Throughout: **PROVEN** means verified against chain state with a transaction
signature; **UNVERIFIED** means written and reviewed but never exercised. The
authoritative list is [`CLAIM_STATUS.md`](CLAIM_STATUS.md).

---

## Trust model

There are four parties, and the design assumes the worst of two of them.

| Party | Trusted to | **Not** trusted to |
|---|---|---|
| **The customer** | hold their own key | report honest usage — the server computes the amount and clamps it |
| **The provider (us)** | meter honestly | take more than the ceiling — the program refuses (error 235) |
| **The Solana program** | enforce every rule above | — |
| **Devnet RPC** | return current state | be available, or be fast; both are handled as failure, never as success |

The load-bearing assumption is the third row. The customer does not have to trust
the provider, and the provider does not have to trust the customer, because the
program settles the disagreement: a voucher above the deposit is rejected, and
everything unbilled returns to the customer automatically. That is what makes a
tab safe to open with a stranger.

**The customer's key never leaves their wallet.** There is no path in this
codebase by which a browser sends us a private key or a seed phrase, and we would
not accept one.

---

## Signer model

A payment channel has three protocol keys. They are not interchangeable.

| Key | Held by | Signs | Can it move money alone? |
|---|---|---|---|
| `payer` | the visitor's wallet extension | `open` | **No.** It can deposit into an escrow whose address is derived from its own key. Withdrawing is `distribute`/`withdrawPayer`, which only ever pays it or the payee. |
| `payee` | server env (`DEVNET_OPERATOR_KEYPAIR`) | `settleAndSeal`, `distribute` | **No.** It can seal and pay out, but only up to the metered watermark, and only under the plan committed at `open`. |
| `authorized_signer` | server env (`DEVNET_OPERATOR_KEYPAIR`) | usage vouchers, **off chain** | **No.** A voucher is a claim, not a transfer; it only has an effect if a `settle` transaction is also sent. |

There is also a fourth key that is **not** a channel role: `DEVNET_PAYER_KEYPAIR`
funds the demo and pays fees for server-submitted transactions. It is never a
channel participant. Naming it "payer" collides with the protocol's `payer` role,
which is the customer — see [`ARCHITECTURE.md`](ARCHITECTURE.md#one-naming-collision-stated-rather-than-hidden).

### The provider key is two roles in one

`payee` and `authorized_signer` are the same keypair here. The protocol keeps
them separate and a real provider would too — the signer that meters and the
account that gets paid are different trust positions. They are merged for the
demo because it removes a moving part without weakening any property being
demonstrated. **UNVERIFIED**: the separated arrangement has not been exercised.

### With one server key, one compromise is total

If `DEVNET_OPERATOR_KEYPAIR` leaked, an attacker could sign arbitrary vouchers
and seal channels. They still could not exceed any channel's deposit, and they
still could not pay themselves more than the plan allows — but they could bill
every open tab to its full ceiling. On Devnet, with a test token, the cost is
zero. On mainnet it would be the reason to separate the two roles and hold the
`payee` key in something that is not an environment variable.

### Key storage

| Where | What |
|---|---|
| GitHub Actions | `DEVNET_PAYER_KEYPAIR`, `DEVNET_OPERATOR_KEYPAIR` as **repository secrets**, read only by the `workflow_dispatch`-only Devnet workflow |
| Vercel | the same two, as server-side environment variables |
| This repository | **nothing.** `local-wallet/` is gitignored and verified invisible to `git` |
| The browser | **nothing of ours.** Only the customer's own key, inside their extension |

Three rules the codebase holds to:

1. No `NEXT_PUBLIC_`-prefixed secret exists, and none may be added. Next.js
   inlines `NEXT_PUBLIC_*` into the client bundle; a key with that prefix would
   be published to every visitor.
2. Any workflow that reads a secret is `workflow_dispatch`-only, so a pull
   request cannot exfiltrate one.
3. No secret is ever logged or returned in a response. The only key-derived
   value that crosses to the browser is `payeeAddress`, which is public
   information already sitting in the channel account on chain.

**PROVEN**: no private key is committed, and `local-wallet/` is invisible to git.

---

## Wallet model

The browser carries **no Solana library at all**. `lib/wallet.ts` is a bridge to
the wallet extension, and everything else is our own typed API calls.

`open` is built server-side and returned **unsigned**, with the customer as fee
payer and holder of the only required signature. The wallet extension shows the
customer what they are approving — a deposit into an escrow derived from their
own key — and signs locally. We never see the signature until it is already on
the wire, and we cannot produce it.

The handshake tries **Wallet Standard** (`solana:signAndSendTransaction`, raw
bytes) first, then the legacy `request` form with a base58 message. Two paths is
a deliberate hedge: which one exists depends on the visitor's wallet and its
version, and the failure mode of the wrong choice is a demo that does not work in
front of an audience. **UNVERIFIED** — this is the one part of the system CI
cannot cover and no human has yet exercised it in a browser.

---

## Ceiling protection

The ceiling is the deposit, and it is enforced in four places, three of which
are not ours:

1. **The customer chooses it.** The deposit is what leaves their wallet, under
   their own signature. Before that signature, nothing has been spent.
2. **We clamp.** `commitUsage` computes `min(settled + rate * seconds, deposit)`
   and never bills past the deposit.
3. **The program rejects it.** A voucher above the deposit fails with error 235
   `voucherOverDeposit`. Even if our clamping had a bug, the charge cannot land.
   **PROVEN** — this guard is in the deployed program's parser.
4. **The remainder returns automatically.** `distribute` pays `deposit − settled`
   back to the customer. **PROVEN** — Gate 3 observed payer ATA `999950` →
   `999978.5 TEST`, exactly `+28.5 = 50 − 21.5`.

Point 4 is what makes the ceiling a real ceiling rather than a limit on our
honesty: the unused money is not held at our discretion.

---

## Voucher validation

A voucher is a **50-byte Ed25519 message**, not a transaction:

```
magic             2 bytes   [0x56, 0x01]
channel_id       32 bytes
cumulative_amount 8 bytes   u64 LE
expires_at        8 bytes   i64 LE   (0 = never)
```

It reaches the program in an unusual way. `settle`'s entire instruction data is
its discriminator byte `[2]` — the voucher is not passed as an argument at all.
The program loads instruction `current − 1` from the Instructions sysvar and
parses it as an Ed25519 precompile payload, whose signed message *is* the 50
bytes above. **The two instructions must therefore be adjacent and in that
order.** Get it wrong and the result is error 230,
`missingEd25519Verification` — a failure mode that appears nowhere in the build
spec and is now pinned by a test.

The precompile payload is exactly **162 bytes**, with the counter-intuitive field
order **pubkey@16, signature@48, message@112** — the precompile itself reads via
the offsets and would accept either arrangement, but the program's parser pins
those three values and rejects everything else with error 231. **PROVEN**, and
unit-tested in `tests/voucher-encoding.test.js`.

What the program checks:

| Check | Error if it fails |
|---|---|
| The magic is `56 01` | 238 `voucherBadMagic` |
| `channel_id` is this channel | 232 `voucherChannelMismatch` |
| `expires_at` has not passed | 233 `voucherExpired` |
| The amount strictly advances the watermark | 234 `voucherWatermarkNotMonotonic` |
| The amount is at most the deposit | 235 `voucherOverDeposit` |
| The precompile's pubkey is `authorized_signer` | 237 `voucherSignerMismatch` |
| A precompile exists at `current − 1` at all | 230, 231 |

We also check the last one **before sending**: `commitUsage` compares the derived
operator address against the channel's `authorized_signer` and refuses with a
sentence naming the cause, because "error 237" does not tell a reader that the
channel was opened against a different provider key.

Vouchers are issued with `expires_at = 0`, i.e. never. That is a deliberate
choice for a demo where the tab may sit idle; it means an old voucher stays valid
until a higher one supersedes it, which is harmless precisely because vouchers
are cumulative.

---

## Replay protection

**There is no nonce.** Replay is prevented by arithmetic, which is stronger than
a bookkeeping table that can drift out of sync:

- **Same voucher re-submitted.** It sets the watermark to a value the channel
  already has. Error 234 refuses any non-increasing update. The transaction
  fails; nothing changes.
- **Voucher from another channel.** It carries a different `channel_id` and dies
  at error 232. **PROVEN** — the `channel_id` bytes inside a signed voucher were
  decoded and found to be exactly the channel's address.
- **Voucher replayed after a close.** The channel is sealed or gone.

The property that makes this work is that vouchers are **cumulative, never
deltas**. A dropped, duplicated or reordered update is harmless: the chain keeps
the highest watermark it has seen. That is also what makes it safe to drive from
a timer, which is exactly how the meter runs.

---

## Retry safety

Every operation is idempotent under retry, which matters because a serverless
function can be retried by the platform without telling anyone.

| Operation | Retried result |
|---|---|
| `usage` | The target is computed from the **current** on-chain watermark, so a retry after success finds `target ≤ settled` and returns `advanced: false` with a reason. No double charge. |
| `usage`, two in flight | Both read the same watermark; the higher cumulative value wins and the lower one is rejected by error 234. No double charge. |
| `open` | `salt` is `Date.now()` and `openSlot` is the current slot, so a retry lands on a **different** channel PDA. The customer's wallet shows a second approval, and they can decline it. |
| `close` | `settleAndSeal` on a sealed channel is not a valid transition, and `distribute` on a distributed channel has no account to act on. A retried close fails rather than paying twice. |
| `faucet` | Rate limited per caller and per wallet. Duplicates are the ordinary case here and are what the limiter is actually for. |

The `usage` path also **reads back and verifies**: after the transaction
confirms, it re-reads the channel and refuses to report success unless
`settled === target` exactly. If the meter and the chain ever disagree, it throws
rather than showing a number.

---

## Network binding

**Devnet only.** There is no mainnet code path, no mainnet default, and no
mainnet funds. The default `DEVNET_RPC_URL` is the public Devnet endpoint, and
the interface states the cluster in the header.

The consequences of getting this wrong are bounded: the test token exists only on
Devnet, cannot be bridged, and has no market. `DEVNET_PAYER_KEYPAIR` holds Devnet
SOL only.

The environment variables are named `DEVNET_*` rather than `SOLANA_*`
deliberately — the name is the last line of defence against a copy-paste that
points a deployment at mainnet.

---

## Asset binding

The mint is a **classic SPL Token** mint created for this project, not
Token-2022 and not USDC. **PROVEN**: mint, decimals, supply and authorities were
read back from chain; see [`ASSET_PROVENANCE.md`](ASSET_PROVENANCE.md).

The mint is one of the **seven PDA seeds**, so a channel is bound to its asset
cryptographically: a tab cannot silently change which token it settles in, and a
voucher from a channel in one mint cannot be used in another.

The token program is passed explicitly as an account rather than assumed, so a
Token-2022 mint would be a visible configuration change rather than an implicit
one.

---

## The faucet is not a security boundary, and does not pretend to be

`/api/faucet` hands out Devnet SOL and test tokens with **no authentication**. It
is rate limited in memory: two wallets per caller per hour, two top-ups per
wallet per twelve hours.

`lib/server/rate-limit.ts` states plainly why this is not a boundary. On a
serverless platform every instance has its own memory and instances are created
and destroyed freely, so a determined caller can outrun the limiter by hitting a
cold instance, and the counters reset on every deploy. It stops only the
accidents that actually happen: a double-clicked button, a page that retries on
load, a reviewer refreshing.

That is acceptable here and would not be on mainnet. What makes it acceptable is
that the faucet holds nothing of value, and its exhaustion costs a two-minute
trip to the public Devnet faucet. **The real protection is that there is nothing
worth stealing.**

---

## Input handling

- **Addresses** are shape-checked (`/^[1-9A-HJ-NP-Za-km-z]{32,44}$/`) to turn the
  common failure — a wallet passing `undefined` — into a sentence that names the
  problem. The shape check is for the message, not the security: the authority is
  kit's `address()`, which decodes and length-checks properly, and every address
  reaches it before use.
- **Money never crosses the wire as a float.** Every bigint is a decimal string,
  parsed back at the edge. JavaScript numbers lose precision above 2^53, and a
  silently rounded token amount is exactly the class of wrong this project exists
  to avoid.
- **The client's reported elapsed time is not trusted for anything that matters.**
  It can only cause the customer to be billed more of what they already
  authorized, and it is clamped to the deposit. It cannot bill someone else:
  the channel address is the key to every operation.
- **A malformed request is a 400, not a 502.** Validation runs before
  configuration is loaded, so a bad request on an unconfigured deployment reports
  the bad request rather than a misleading server error.

---

## Known limitations

Stated here rather than buried, because a reader deciding whether to trust this
should not have to find them.

1. **The wallet handshake has never been exercised by a human.** It is written for
   two wallet APIs and reviewed, but no browser run has happened. This is the
   largest unverified surface in the system. **UNVERIFIED**
2. **One server key holds two protocol roles.** See above.
3. **The faucet's rate limiter is best-effort** and resets on deploy.
4. **There is no authentication on any endpoint.** Anyone who can reach the
   deployment can fund a Devnet wallet, open a tab with their own money, and
   close it. There is nothing to authenticate — but the absence should be
   explicit rather than discovered.
5. **`withdrawPayer`, `requestClose`/`seal`, and `topUp` are UNVERIFIED.** The
   cooperative close path is the one that was executed. The payer-protection
   timeout is therefore untested, and the claim "the customer is protected
   structurally" rests on the `distribute` refund, which **is** proven.
6. **A distribution plan with real recipients is UNVERIFIED.** Every run so far
   used the empty plan. The `recipient(32) || bps(u16)` layout is unit-tested but
   has never executed on chain.
7. **Nothing here has been through a security review.** The three gates prove
   that the happy path works on Devnet. They are not a penetration test.

---

## Related documents

| | |
|---|---|
| [`LIMITATIONS.md`](LIMITATIONS.md) | what the product does not do, stated as product limits |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | the trust boundaries in diagram form |
| [`CLAIM_STATUS.md`](CLAIM_STATUS.md) | every claim, with its evidence |
