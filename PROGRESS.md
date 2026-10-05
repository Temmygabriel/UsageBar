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

**Two gates are passed.** A real payment channel is open on devnet and read back
from chain, and its settled watermark has been advanced twice by cumulative
vouchers that the operator signed off-chain. Those were the two things
everything else waited behind.

Not yet started: the application itself. There is no UI, no live usage meter,
and no close-and-distribute. Those come next.

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

---

## Known risks

### The treasury owner — unresolved, blocks `distribute`

The program source contains a build-time assert that **rejects the `0xBEEF`
treasury sentinel**, and the `devnet` configuration block sets exactly that
sentinel. So the published source cannot be compiled for devnet at all, which
means the live devnet program was built some other way and very likely carries
the placeholder.

`distribute` pays rounding residuals to `ATA(TREASURY_OWNER, mint, ...)`. If the
placeholder is in force, that address is derivable and its token account can be
created — so `distribute` may still work — but anything sent there is
permanently unspendable.

**This is a hypothesis, not a finding.** It is settled by running `distribute`
against devnet. Detail in [`docs/ASSET_PROVENANCE.md`](docs/ASSET_PROVENANCE.md).

### Time

Seven days remain, and the application has not been started.

---

## Next steps

1. Run `settleAndSeal` (discriminator 4). This is a different instruction from
   the `settle` just proven, and it additionally requires the **payee's**
   signature.
2. Run `distribute`, and find out what the treasury situation really is.
3. Confirm the unused remainder actually reaches the payer. `distribute` has a
   `payerTokenAccount` among its writable accounts and `withdrawPayer`
   (discriminator 8) is the pull path, but neither has been executed.
4. Build the interface.

## Deliberately not done yet

- No UI. The spec gates it behind a real channel, and until today there wasn't
  one.
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

The Devnet workflow is manual-trigger only, because it reads private keys from
repository secrets.

The voucher encoding is checked without a network or a key:
`node --test` is not needed — the checks live in `tests/voucher-encoding.test.js`
and run under `npm test`, which CI does on every push. They need no
dependencies beyond `node:crypto`.
