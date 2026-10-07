# Evidence

This directory holds the canonical run `canonical-usagebar-devnet-001` — the
artifacts that prove UsageBar works on Solana Devnet with real transactions.

Build spec Section 26 defines the layout:

```
evidence/canonical-run/
  01-environment.json
  02-channel-open.json
  03-voucher-01.json
  ...
  08-close.json
  09-settlement.json
  10-distribution.json
  11-final-state.json
  12-verification.json
```

**Rules:**

- No file here may contain a private key, seed phrase, access token, or any
  other secret.
- No file here may be hand-edited. Values come from chain reads or from
  application observations, and each file must say which it is.
- If a protocol step does not exist in the chosen implementation, no file is
  fabricated for it. Section 26 says so explicitly, and it matters: an invented
  evidence file is worse than a missing one.
- Timestamps that are application observations must not be presented as
  blockchain timestamps.

## Status

**Populated on 2026-10-07.** `canonical-usagebar-devnet-001` completed all
twelve steps in one uninterrupted pass on Devnet, and the artifacts below were
written by the run itself — `tools/devnet-canonical-run.mjs`, via the Devnet
workflow's `canonical-run` task.

| | |
|---|---|
| Channel | `4LtkUAsruLTTi9xzwy6Zd67U8uz8d8sX72gyYsKjPz4S` |
| Opened at slot | `508262903` |
| Deposit | `50000000` atomic units (50 TEST) |
| Metered | `6250000` across five vouchers, each after a measured 5-second interval |
| Returned to the customer | `43750000`, exactly `deposit − settled` |
| Provider received | `6250000`, read back from its token account |
| Escrow after | closed and empty |

Every value was read back from chain after the transaction that was supposed to
change it, and balances were read before and after — so these record money
changing accounts rather than transactions succeeding.

**Re-checked independently.** `tools/verify-canonical-run.ts` (build spec
Section 29) re-runs against these files whenever the `verify-canonical` task is
dispatched. It does not trust them: it re-derives the channel address from the
seven recorded PDA seeds, re-queries all eight transaction signatures, re-reads
the token accounts, and compares the revealed distribution plan against the
commitment read from byte 56 of the channel account. It sends no transaction and
needs no keypair.

**One thing these artifacts do not show.** Unlike Gate 3's channel, this one was
**not reaped** — reclamation needs `slot > open_slot + 1500`, and it was opened
seconds before it closed. The channel survives at status `3` (Distributed) with
the escrow drained. Both are the program behaving correctly; which one you get
depends on how long the channel lived.

### The narrower gates that came before

Not a substitute for the canonical run, and the distinction is the reason this
file exists rather than being folded into the progress log: a passing test suite
proves an encoder is consistent with itself, and a canonical run proves the
chain agreed.

| Gate | Where it is recorded |
|---|---|
| Program and instruction discriminators verified against the deployed IDL | [`../docs/CLAIM_STATUS.md`](../docs/CLAIM_STATUS.md) |
| Wire-format encoding verified, byte for byte, by the test suite | [`../tests/`](../tests/), 94 tests |
| A channel opened, metered, settled and closed by the scripts under `tools/` | [`../docs/CLAIM_STATUS.md`](../docs/CLAIM_STATUS.md), Gates 1-3 |
