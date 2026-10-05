# UsageBar — Progress Log

**Last updated:** 2026-10-05
**Submission deadline:** 2026-10-12
**Repo:** <https://github.com/Temmygabriel/UsageBar>
**Build spec:** `USAGEBAR_BUILD_SPEC.md`

> This file is the running log. It is updated as work happens, not at the end.
> The authoritative record of what is *proven* is
> [`docs/CLAIM_STATUS.md`](docs/CLAIM_STATUS.md). If the two ever disagree,
> CLAIM_STATUS wins and this file is wrong.

---

## Where we are right now

**All three gates are passed. The protocol works end to end on devnet.**

A real payment channel was opened (money in), its settled watermark was advanced
by cumulative vouchers the operator signed off-chain (the meter moves), and it
was sealed and paid out (money back out to the right people, escrow emptied to
zero, channel account reaped).

That last step is the product's entire promise, and it is no longer a plan.

Not yet started: the application itself — there is no UI and no live usage
meter. That is the next and largest piece of work.

---

## The third gate: seal the channel and pay out — PASSED 2026-10-05

Run against the same channel the first two gates left open.

```
payer    ATA :  999950   → 999978.5 TEST   (+28.5)
channel  ATA :      50   →        —        (-50, escrow emptied)
payee    ATA :       —   →    21.5 TEST    (+21.5)
treasury ATA :       —   →       0 TEST    (unchanged)
channel account: DEALLOCATED — the PDA no longer exists
```

`21.5 + 28.5 = 50`, exactly the deposit. The provider was paid the metered
amount, the customer got the unused remainder back, and no tokens were stranded.

| | |
|---|---|
| `settleAndSeal` tx | `3WjdkDYv9UCazfz9EQyZ7mPTnkdbU2vFVpseCyFRAYqnKJUcTfgHYUizvhayKKpPL5MR3qqGLp32xrhxESHJfZ8p` |
| `distribute` tx | `51FcroWv457JrF9aARRxGqzUp8j8Azohtr1KD6q76bxeRjNDVzFPM4YsoSa2fESnHMDPyw4dULvt746stNdaX81A` |
| Final watermark | 21.5 TEST (`21500000` atomic units) |

This gate needed three attempts. Each failure is recorded in the table below;
the treasury one is the interesting one, because the first two attempts were
built on a hypothesis that turned out to be wrong.

Reproduce with: **Actions → Devnet → Run workflow → `close`**.

---

## The gate: open one real channel — PASSED 2026-10-05

| | |
|---|---|
| Channel | `7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo` |
| Transaction | `2Uoz4SE93ct5v3RrXQnzFhy8Dn4bwi8FBcf817Vm3SjNm1Umi2q9jzxLF95SdEsCC8r2KsKHDYKSo8JaNuDLgoh` |
| Opened at slot | `507695832` |
| Deposit | 50 TEST |
| Grace period | 60 seconds |

Read back from chain: 256 bytes, discriminator `1`, version `1`, bump `254`,
status `0` (Open), every party field matching, `settled` and `payoutWatermark`
both zero.

**The strongest evidence is that the tokens moved:**

```
payer   ATA : 1000000 → 999950 TEST
channel ATA :       0 →     50 TEST
```

A successful transaction is not proof that anything worked. Money leaving one
account and arriving in another is.

Verified two independent ways: by our CI job, and by a raw `getAccountInfo`
RPC call from the local machine that does not use our own code at all.

Reproduce with: **Actions → Devnet → Run workflow → `open-channel`**.

---

## The second gate: advance the watermark with a signed voucher — PASSED 2026-10-05

Opening a channel moves money *in*. This moves the **meter** — which is the
actual product. A usage tab is: authorize once, meter usage off-chain by signing
cumulative vouchers, settle on chain at the end.

| Step | Voucher amount | Transaction |
|---|---|---|
| 1 | 12.4 TEST | `3fBMYtCJKejFgKapjXzfQP7u51o1BeKGp3fBoZw6G4iK2uUoB9XpvBH57mPLKSR5idmasALHLKtfjPNgLoGJ5J3W` |
| 2 | 18.9 TEST | `3wesVbuGwEA9ETkAUUG1L1We6GSCVhb2ojimHRv7Bh468ryDJrTtLtHVQnRmYc62E7KJyKSwnSwsJCoKnyNn4uNG` |

`settled` on the channel went `0` → `12400000` → `18900000` atomic units, each
value read back from chain after its own transaction. 31.1 TEST of the 50 TEST
deposit remains, and that remainder is what a close would return to the payer.

**The voucher is not passed to `settle`.** `settle`'s entire instruction data is
a single discriminator byte, and its only accounts are the channel and the
Instructions sysvar. The program loads instruction `current - 1` from that
sysvar and parses it as an Ed25519 precompile payload — whose signed message
*is* the 50-byte voucher. So the two instructions must be adjacent and in that
order. Get it wrong and the result is error 230,
`missingEd25519Verification`. **This requirement appears nowhere in the build
spec**, and it is the most likely way to ship something that fails during a
demo.

Two further details are easy to get wrong, and both are now pinned in code and
tested:

- The precompile payload is exactly **162 bytes**, and the field order is
  counter-intuitive: **pubkey at offset 16, signature at 48, message at 112**.
  The precompile itself reads via the offsets and would accept either
  arrangement, but the program's parser pins those three values exactly and
  rejects everything else with error 231.
- The discriminator for `emitEvent` is **228**, so the instruction
  discriminators are not an enum in declaration order. They are looked up from
  the IDL, never inferred.

Verified independently, exactly as with the first gate: a raw `getAccountInfo`
call from the local machine, with `settled` read by hand at byte offset 20,
returned `18900000`. The `channel_id` bytes inside the signed payload decode to
exactly the channel address.

Reproduce with: **Actions → Devnet → Run workflow → `settle`**.

---

## Milestones

### 2026-10-05 — Protocol audit, before any code

The build spec (Section 0A) requires a 15-report audit *before* implementation.
Completed, and recorded in `docs/AUDIT_REPORT.md`, `docs/PROTOCOL_DISCOVERY.md`
and `docs/CLAIM_STATUS.md`. The audit cleared the spec's single largest
projected blocker by confirming the program is genuinely deployed and in use on
devnet.

### 2026-10-05 — Phase 0 scaffolding

Next.js app skeleton, a protocol-independent money-arithmetic module with 24
passing tests, and a CI job running typecheck, test and build. All heavy work
runs in GitHub Actions; the local machine cannot do it.

### 2026-10-05 — Devnet identity and test token

Generated devnet keypairs, funded them from the official faucet, and created a
purpose-built `TEST` mint. Full detail and chain evidence in
[`docs/ASSET_PROVENANCE.md`](docs/ASSET_PROVENANCE.md).

### 2026-10-05 — Protocol interface established

Read the program's own IDL and source rather than relying on documentation.
This corrected the build spec in several places and is recorded in
`docs/CLAIM_STATUS.md` under "Protocol — instruction-level facts".

### 2026-10-05 — The gate passed

One real channel opened on devnet and read back. Three attempts were needed;
the failures and their causes are logged below.

### 2026-10-05 — The second gate passed

The watermark advanced through two cumulative vouchers signed by the operator.
Before spending a single transaction, the voucher encoding was checked locally
against a re-implementation of the program's own parser guards — the encoder,
the 162-byte precompile layout, and the signing contract. That check is now a
committed test (`tests/voucher-encoding.test.js`, 10 cases) and runs on every
push, so drift fails in CI rather than mid-demo.

---

## Failures so far, and what they cost

Recorded because the causes are easy to hit again.

| Attempt | Failure | Cause |
|---|---|---|
| 1 | `Expected base58-encoded address string... Actual length: 15` | A signer *object* was passed where a raw instruction account needs a plain address. The codec stringified it to `"[object Object]"` — 15 characters. |
| 2 | `custom program error: 0xc9` | `0xc9` = 201 = `gracePeriodMustBeNonZero`. The grace period was passed as `0`. |
| 3 | passed | — |
| 4 | `Expected base58-encoded address string... Actual length: 0` | A GitHub Actions workflow exports a **cleared optional input as `NAME=""`** — defined-but-empty, so `??` kept the empty string and `address("")` threw. Fixed at the root with an `envOr()` helper that treats blank as absent, now used for every env read. No transaction had been sent. |
| 5 | `custom program error: 0x961` | `0x961` = 2401 = `TreasuryAccountMismatch`. The treasury owner was guessed wrong. Refuted the placeholder hypothesis — see *Known risks*. No token moved; `distribute` validates the ATA before transferring. |
| 6 | `custom program error: 0x962` | `0x962` = 2402 = `InvalidTreasuryTokenAccount`. Progress: the owner address now passes (2401 is gone), but the treasury's *token account* does not exist. Neither does the payee's. `distribute` requires both. Fixed by prepending idempotent ATA creation. Again no token moved. |

---

## Known risks

### The treasury owner — RESOLVED

**Finding:** the deployed devnet program's treasury owner is
`4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap`, which is also the program's
upgrade authority.

**How it was settled.** An earlier hypothesis said the live program carried the
0xBEEF placeholder, on the reasoning that a build-time assert rejects that
sentinel for `devnet` builds, so the published source looked uncompilable for
devnet — implying the deployed binary had fallen through to the
localnet/default block. Running `distribute` **refuted this**: it failed with
`custom program error: 0x961` = **2401 `TreasuryAccountMismatch`**, before any
token moved.

Searching the deployed ProgramData ELF for each candidate's raw 32 bytes found
the answer directly:

| Candidate | Source | In the deployed ELF? |
|---|---|---|
| `0xBEEF` sentinel | localnet / default block | **absent** |
| `Cs2zdfUNonRdRGsiZUQQLdTxzxVvJZmgiX2mpLYKuEqP` | `mainnet-beta` block | **absent** |
| `4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap` | `devnet` block on branch `build/devnet-deployment` | **present, ELF byte offset 61435** |

The real value exists only on `build/devnet-deployment`, a branch that is
neither on `main` nor tagged — which is why reading `constants.rs` at `v1.0.0`
or `main` showed the sentinel and misled the first reading.

**Why this matters beyond the address:** it is the upgrade authority, so there
is no separate treasury key to manage, and residual dust is recoverable rather
than burned.

### Time

Seven days remain, and the application has not been started.

---

## Next steps

1. **Build the interface.** This is now the critical path — seven days remain
   and nothing user-facing exists yet.
2. Exercise `withdrawPayer` and a distribution plan with real recipients, both
   still UNVERIFIED, but neither blocks the application.

## Deliberately not done yet

- No UI. The spec gated it behind a real channel, and that gate is now passed.
- No Vercel deployment.
- No mainnet anything.

---

## How to reproduce any of this

Heavy work does not run locally — the development machine has about 0.6 GB of
free RAM and `npm install` hangs on it. Everything runs in GitHub Actions.

| Task | How |
|---|---|
| Typecheck, test, build | Automatic on push to `main` |
| Create the test token | Actions → **Devnet** → `test-token` |
| Open a channel | Actions → **Devnet** → `open-channel` |
| Settle with a voucher | Actions → **Devnet** → `settle` |
| Seal and pay out | Actions → **Devnet** → `close` |

The Devnet workflow is manual-trigger only, because it reads private keys from
repository secrets.

The voucher encoding is checked without a network or a key:
`node --test` is not needed — the checks live in `tests/voucher-encoding.test.js`
and run under `npm test`, which CI does on every push. They need no
dependencies beyond `node:crypto`.
