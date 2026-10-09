# Evidence

Three kinds of proof live here:

- **`canonical-run/`** — the twelve artifacts of `canonical-usagebar-devnet-001`,
  which prove the *protocol* works on Solana Devnet through the tooling, along
  the path this product actually uses.
- **`extended-paths/`** — nine artifacts proving the *protocol* works along the
  four paths the product does **not** use. Also tooling, and filed separately for
  that reason: a proven instruction is not an integrated one.
- **`deployed-app-probe.json`** — one artifact proving the *deployed
  application* works, driven over HTTPS against the same network.

The tooling artifacts are not weaker evidence than the probe — they are evidence
about a different subject. The program is the same program in both. What the
probe adds is the product: the HTTP API, the browser's transaction, the buttons a
judge presses.

Build spec Section 26 defines the canonical layout:

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

## The canonical run

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

## The extended-paths run

**Populated on 2026-10-09** (23:03 UTC). `tools/devnet-extended-paths.mjs`, via the Devnet
workflow's `extended-paths` task. Every protocol instruction this repository
claims to have exercised now has a chain receipt behind it.

The two scenarios are independent by construction — one failing does not stop
the other, and the process exits non-zero if any check anywhere failed. The
summary artifact records `failedChecks: []`, which is a check that looked for
failures rather than the absence of a field.

**It ran four times, and the amounts did not move.** The channel addresses
differ every run, because the open slot is a PDA seed and the slot is whatever
the cluster is on. Every *amount* is identical across all four: alpha `499999`,
beta `166666`, payee `2666664`, payer `56666670`, treasury `1`; and `1250000`
metered, `48750000` refunded, `0` paid to the payer a second time. The
committed artifacts are the fourth run. This is the property that makes the
floor-versus-round claim worth anything — a rounding rule that produced a
different answer each time would not be a rule.

Wall-clock figures are the exception and are meant to be: `elapsedMs` differs by
run (`1427`, `2265`), because it measures how long the runner took to build and
send a transaction, not anything the program decided. A reader comparing
artifacts should expect the addresses and the timings to change and everything
else not to.

### Scenario A — `topUp`, and a plan with real recipients

| | |
|---|---|
| Channel | `DsHVQRkN9vcKAQqpR5YVVzz2AT5mzS8XNEK5ocUW9hq4` |
| Opened with | recipients at 1500 and 500 bps, deposit `50000000` |
| Deposit after `topUp` | `60000000`, with the escrow following and the plan hash unchanged |
| Rate | `333333` atomic units per tick, deliberately not the app's `250000` |
| Metered | `3333330` |

`distribute` then paid:

| Account | Received | Why |
|---|---|---|
| alpha | `499999` | `floor(3333330 × 1500 / 10000)` = `floor(499999.5)` |
| beta | `166666` | `floor(3333330 × 500 / 10000)` = `floor(166666.5)` |
| payee | `2666664` | the implicit `10000 − 2000` bps |
| payer | `56666670` | `deposit − settled` |
| treasury | `1` | the flooring dust |

Three separate facts are in that table, and one number could not carry all of
them: the split **floors** rather than rounds, the payee is paid **its own
basis-point share** rather than handed whatever is left over, and the residual
dust is **swept to the treasury** rather than stranded in a closed account.

The rate is why any of it is visible. At the app's `250000` every product
divides exactly, all five remainders are zero, and the run would have proved
nothing about rounding. `333333` was chosen to make the rule observable.

### Scenario B — the timeout escape hatch

| | |
|---|---|
| Channel | `2bYU3Tgogs5WbvdErtVFeL12d1YeMaWx6Lw7rRGqT39S` |
| Grace period | `10` seconds |
| Metered | `1250000` |
| Refunded by `withdrawPayer` | `48750000` |
| Paid to the payee by the later `distribute` | `1250000` |
| Paid to the payer by that same `distribute` | `0` |

`requestClose` moved the channel to Closing and stamped `closure_started_at`.
`seal` sent 2.3 seconds into a 10-second grace period was **refused**, with the
status staying at `2` — and the identical instruction **succeeded** after the
period elapsed, with the watermark unchanged across it. That pair is the proof:
the only variable between the two attempts is the clock.

The refusal carries `custom program error: 0x899 (2201, SealGracePeriodNotElapsed)`.
The name is read out of the program's `errors.rs`; the proof is the shape of the
run, not the string.

The final `distribute` paying the payer `0` is the gate holding rather than a
second refund — `withdrawPayer` had already set `payer_withdrawn_at`, which
[`08-timeout-payer-refund.json`](extended-paths/08-timeout-payer-refund.json)
records as the stamp it is (`1791587025`).

### Read back from raw chain state, by hand

Both channel addresses above still exist on Devnet. Reading their bytes with a
plain `getAccountInfo` — no code from this repository, no keypair, at
`commitment: finalized` — returns:

| | split channel | timeout channel |
|---|---|---|
| Length / owner | 256 bytes, the program | 256 bytes, the program |
| Status byte 3 | `3` Distributed | `3` Distributed |
| Deposit, byte 12 | `60000000` | `50000000` |
| Settled, byte 20 | `3333330` | `1250000` |
| Payout watermark, byte 28 | `0` | `0` |
| `closure_started_at`, byte 36 | `0` | `0` |
| `payer_withdrawn_at`, byte 44 | `0` | `1791587025` |

Two things in that table are worth more than the rest of it.

**`payout_watermark` is 0 after a successful distribution.** The obvious
expectation is that paying out sets it to `settled`. It does not, on the sealed
path — the channel is terminal, there is no second payout for a watermark to
gate, and the program does not write one. Taken from the chain rather than
assumed.

**`closure_started_at` is 0 after `seal`.** The stamp `requestClose` wrote
(`1791518362`) is gone once the channel is Sealed. `seal` clears the grace
clock it was gating on, rather than leaving a stale timestamp on a channel whose
grace period no longer applies.

### A defect this check found

The first committed version of these two artifacts reported
`decoded(sealed.channel)` under the bare name `channel` — the snapshot taken
**before** `distribute` ran, in a file whose entire subject is a distribution
that had already moved every token. It read `status: 1 (Sealed)`,
`payoutWatermark: 0`, in a channel that was in fact `3 (Distributed)`.

`09-timeout-distributed.json` had the same shape: it reported
`payerWithdrawnAt` from the pre-`withdrawPayer` snapshot, so it said `0` where
the chain says `1791518378`.

Neither value was fabricated — both were real reads. They were real reads of the
wrong moment, filed under names that claimed a different one, which is harder to
catch than an invented number because there is nothing internally inconsistent
to notice. Both artifacts now report `channelBefore` and `channelAfter`
separately, and both runs assert that the post-transaction read says
`Distributed`. That assertion is what would have caught it.

### What these artifacts do not show

Each one says so in its own `doesNotProve` field, and it matters more here than
anywhere else in this directory: the script drives the program directly with
keypairs the repository holds. The application calls **none** of these four
instructions, and opens every channel with an empty plan. A proven instruction
is not an integrated one.

## The deployed application

**`deployed-app-probe.json`, written 2026-10-07.** Produced by
`tools/probe-deployed-app.mjs` against `https://usagebar.vercel.app`, deployment
`dpl_9dsXjP7zrJ5PZUGyNZvDmbBVnXHa` at commit `81ef6f3`. **71 of 71 checks
passed.**

Where the canonical run exercises the program, this exercises the product: the
deployment's HTTP API, over the public internet, with the client side doing
nothing but signing one transaction. Every number it accepts is then re-read
from a Devnet RPC endpoint this repository does not control.

| | |
|---|---|
| Channel | `BFFqXPygJsBkGWQoGGowR4qgAtuSuRYnAsegp5oeT1Vt` |
| Opened at slot | `508529003` |
| Deposit | `50000000` atomic units, taken from the customer's wallet |
| Metered | `2500000` over two rounds, each read back from the channel's byte 20 |
| Provider received | `2500000`, read back from its own token account |
| Customer's net cost | `2500000` — exactly what the meter recorded |
| Escrow after | closed and empty |

**What this artifact is really for.** Its first run against the deployment
returned a 502 on close — `custom program error: 0xea`, which is error 234,
`voucherWatermarkNotMonotonic`. Every gate before it passed while that bug was
live, because every earlier gate drove the *tooling* and the tooling sealed
correctly. Only a probe of the deployed application could have found it.

**What it does not show.** The probe signs `open` itself, standing in for a
wallet's cryptography but never for its consent screen. No human has approved a
transaction in a browser, and that remains the largest unverified surface.

### The narrower gates that came before

Not a substitute for either run above, and the distinction is the reason this
file exists rather than being folded into the progress log: a passing test suite
proves an encoder is consistent with itself, and a run against the chain proves
the chain agreed.

| Gate | Where it is recorded |
|---|---|
| Program and instruction discriminators verified against the deployed IDL | [`../docs/CLAIM_STATUS.md`](../docs/CLAIM_STATUS.md) |
| Wire-format encoding verified, byte for byte, by the test suite | [`../tests/`](../tests/), 110 tests |
| A channel opened, metered, settled and closed by the scripts under `tools/` | [`../docs/CLAIM_STATUS.md`](../docs/CLAIM_STATUS.md), Gates 1-3 |
| The deployed application, open through close, over HTTPS | [`../docs/CLAIM_STATUS.md`](../docs/CLAIM_STATUS.md), Gate 5 |
