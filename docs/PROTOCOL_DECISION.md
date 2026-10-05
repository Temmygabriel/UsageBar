# Protocol Decision

**Build spec Section 59.** Status: **PROVISIONAL. NOT FINAL.**

Build spec Section 7 states the decision rule: *"Select the path that passes the
first real Devnet smoke test with the fewest moving parts. Do not choose based on
fashion."* No smoke test has been run yet, so this document records the intended
path and the reasoning, and must be revisited the moment real evidence exists.

---

## Chosen path

**Path A — the official Payment Channels TypeScript client, used directly.**

No MPP session layer, no x402 layer. The application calls the nine program
instructions itself.

## Why chosen

1. **Fewest moving parts.** Path B adds an HTTP session protocol, additional
   packages, and a draft specification between the product and the on-chain
   program that actually holds the money.
2. **The dependency is shared, so nothing is lost.** MPP session is *built on
   the same Payment Channels program*. Choosing Path A does not mean giving up
   different protocol behaviour — it means removing a layer.
3. **MPP session is a draft.** `draft-solana-session-00` was published
   2026-10-01 and expires 2027-04-04. The SDK is 0.x (`@solana/pay-kit` 0.13.0).
   Building a deadline-bound demo on a draft is an unnecessary risk.
4. **It is easier to explain.** "We call `open`, produce signed cumulative
   vouchers, then call `settle_and_seal` and `distribute`" is a sentence a judge
   can check against the Explorer.

## Alternatives considered

**Path B — MPP session** (`@solana/pay-kit` + `@solana/mpp`)

Rejected for this build — see above. Not rejected as a technology. If the
protocol matures and a devnet path is documented, it would be a reasonable
future choice.

**x402 `upto`**

Rejected outright, and this rejection is **verified, not assumed**. The current
x402 SVM `upto` specification states that it settles *at most once per
authorization* and explicitly places multi-settlement streaming and long-lived
reused channels out of scope. UsageBar is a repeated usage session, so `upto`
models the wrong thing. Build spec Section 6 is correct on this point.

**x402 `batch-settlement`**

Not rejected on the merits — it is the x402-native answer for repeated
settlement, and it uses the same program. Not chosen because Path A removes a
protocol layer while achieving the same result for a single-service MVP.

## Network

**Solana Devnet.** Program deployment independently verified present and
executable on 2026-10-05. Mainnet is not used at any point during development
(build spec Section 92).

## Program

```
CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX
```

Verified by `declare_id!`, the Codama IDL, the README, and a direct RPC read.

## Asset

**PROVISIONAL — requires a decision that is not mine to make.**

The blocker: Circle's devnet USDC faucet dispenses **20 USDC per 2 hours**, but
the demo ceiling is **50.00**. One claim cannot fund the channel.

| Option | For | Against |
|---|---|---|
| **A. A purpose-created devnet SPL mint** | Instant, unlimited, free (~0.0011 refundable SOL), full control of decimals | Not a "real" stablecoin; must be labelled honestly, e.g. `50.00 TEST` |
| **B. Circle devnet USDC** | Maximum realism | Needs 3 claims over ~4 hours; fails if a fresh run is needed on stage |
| C. Lower the ceiling | — | Not permitted; the spec fixes 50.00 |

**Recommendation: Option A**, labelled honestly per build spec Sections 16 and 24.
Awaiting the project owner's decision.

Either way the mint address must be verified on-chain and recorded in
`docs/ASSET_PROVENANCE.md` — never copied from a blog post.

## Signer model

**Server-side operator signing via the channel's `authorized_signer`.**

This is a first-class protocol parameter set at `open`, not a custom
authorization system. It is what makes the intended UX possible: the customer
signs once to fund the channel, and the service signs each cumulative usage
update without a wallet prompt.

Consequences that must be honoured:

- the operator key grants authority **only** up to the channel deposit;
- distribution recipients are fixed by `distributionHash` at settle time, so
  the operator cannot redirect funds to an address of its choosing;
- the operator private key lives only in server environment variables, is never
  sent to the browser, and is never committed (build spec Sections 18, 83);
- the UI must state plainly that the operator can sign usage up to the ceiling.

**Not yet implemented or tested.**

## Wallet model

Wallet Standard discovery. No wallet is hard-coded, and Phantom is not required.
The current official path is `@solana/kit` with `@solana/kit-plugin-wallet`.
`@solana/wallet-adapter-*` is legacy for new work.

## Settlement model

```
open            -> channel escrows the ceiling
settle          -> advances the settled watermark (Ed25519 precompile before it)
settle_and_seal -> OPEN -> SEALED
distribute      -> SEALED -> DISTRIBUTED; pays payee + recipients, frees remainder
withdraw_payer  -> payer recovery path from SEALED
reclaim         -> permissionless cleanup past the window
```

The application compresses these into `READY → OPENING → FUNDED → ACTIVE →
FINALIZING → SETTLED`, but every displayed final value must be read back from
chain before it is shown.

## Known limitations

- **Unproven end to end.** Nothing in this document has been executed.
- The devnet `distribute` path may fail because the source tree still carries a
  placeholder `TREASURY_OWNER`. This is an open risk, not a formality.
- The official client is not on npm and must be generated; its `@solana/kit ^6.1.0`
  pin conflicts with the current `@solana/kit` 8.4.0.
- The service meter is simulated. The payment mechanism is real. The project
  does not claim trustless physical metering.
- Devnet test funds only; no real economic value.
- Public RPC rate limits apply.
- This is a hackathon prototype, not production payment infrastructure.

## Revisit trigger

This decision becomes final — or is reversed — when the Phase 3 smoke test
either opens a real channel on devnet and reads it back, or fails to. Until
then, treat every claim above as intent, not fact.
