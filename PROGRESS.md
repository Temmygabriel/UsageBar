# UsageBar — Progress Log

**Last updated:** 2026-10-07
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

The application now drives that same lifecycle from a browser. A visitor
connects their own wallet, the app stocks it with Devnet funds, they sign the
deposit themselves, the meter advances on signed vouchers, and they close —
getting the unused remainder back. The customer's key never leaves their
wallet.

Not yet deployed. Not yet run end to end from a browser by a human.

**CI is green** — typecheck, 94 tests across 4 files, and a production build.
That is the whole pipeline, and it is the only compiler available here.

---

## Documents — written 2026-10-05 to 2026-10-07

The build spec asks for artefacts, not only code. Written so far:

| Document | What it holds |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | what runs where, which key signs what, and where the trust boundaries actually fall |
| [`docs/SECURITY.md`](docs/SECURITY.md) | trust model, signer model, ceiling protection, voucher validation, replay and retry safety, and the limitations of the faucet |
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | what the product does not do — nine limits, each marked deliberate or unfinished |
| [`docs/CLAIM_STATUS.md`](docs/CLAIM_STATUS.md) | every claim with its evidence, in four permitted statuses |

The one deliberate gap is **`docs/UX_TEST.md`**, which the build spec defines as
the record of a first-viewport test with a stranger. It cannot be written
honestly until someone who is not us looks at the interface, and manufacturing
positive answers is explicitly forbidden. It stays empty until a real person has
seen it.

---

## The chain adapter — built 2026-10-05

The interface is no longer describing a product; it is operating one.

```
lib/server/env.ts          configuration and secret handling
lib/server/chain.ts        every chain operation, in one place
lib/server/http.ts         request shapes; bigints cross as strings
lib/server/rate-limit.ts   the faucet's (honest) limits
lib/wallet.ts              the browser's wallet bridge
lib/use-session.ts         the state machine, driven by chain reads
lib/client-api.ts          typed access to the API
app/api/faucet/route.ts    one click, funded
app/api/session/route.ts   open · usage · close · read
app/api/wallet/route.ts    what a wallet holds, so we can guide the next step
```

### Who holds which key

A payment channel has three keys and they are not interchangeable, so the split
between browser and server is forced by the protocol rather than chosen:

| Key | Holds it | Why |
|---|---|---|
| payer | **the visitor's wallet** | The product's whole point. The deposit leaves their wallet under their own signature. |
| payee | server | `settleAndSeal` is a cooperative close and requires the payee's signature. |
| authorized_signer | server | Signs usage vouchers **off chain**. This is what makes metering cheap. |

The last two are one key here — the provider signs the meter and receives the
money. The protocol keeps the roles separate; a real provider would too.

**The customer does not sign the close, and does not need to.** Their protection
is structural rather than a second signature: a voucher can never exceed the
deposit (error 235), and everything unbilled returns to their token account
automatically during `distribute`. That is why `distribute` is permissionless —
closing late, or not closing at all, does not cost the customer the remainder.

### The server builds, the wallet signs

`open` is built server-side and returned **unsigned**, with the customer as fee
payer and holder of both required signatures. The browser hands the bytes to the
wallet, which shows the customer exactly what they are approving: a deposit into
an escrow account derived from their own key.

This means one implementation of the PDA seeds, the argument encoding and the
account metas exists, it is server-side, and it is the one under test. The
browser carries no Solana library at all.

### The wallet handshake tries two paths

Wallet Standard (`solana:signAndSendTransaction`, raw bytes) is tried first,
then the legacy `request` form with a base58 message. Which one exists depends
on the visitor's wallet and its version.

**This is the one part of the system CI cannot cover** — it needs a real browser
with a real extension. Two paths is a deliberate hedge against the failure being
a demo that does not work in front of an audience.

### What moved, and what was deliberately duplicated

`encodeOpenArgs`, `channelSeeds`, the System and SPL transfer encoders and the
token-account reader now live in `tools/lib/protocol.mjs` beside every other
byte layout the program pins, and `devnet-open-channel.mjs` imports them instead
of keeping its own copies. A layout that exists twice will disagree with itself
eventually.

Two copies remain, and the reason is a real constraint rather than convenience:
`base58Encode` is duplicated into `lib/base58.ts` because `protocol.mjs` carries
a `node:crypto` import that must not enter a browser bundle.
`tests/protocol-bytes.test.js` asserts the two produce identical output **and**
round-trip through the tooling's decoder, so encoding agreement alone cannot be
satisfied by two identically wrong implementations.

### The first push of the adapter did not typecheck

Worth recording, because it is a property of this project rather than a slip:
the development machine cannot run `tsc`, so **CI is the only compiler here** and
a new module's first push is effectively its first compile. Four classes of real
error came back, all of them in `lib/server/chain.ts`:

| Error | Cause | Fix |
|---|---|---|
| `Property 'settled' does not exist` … (×21) | `ReturnType<typeof decodeChannel>` — the decoder is JavaScript, and TypeScript types a JS function from the object literal it *starts* with, so the derived type carried the four header bytes and nothing else | `DecodedChannel` is written out in full |
| `'string' is not assignable to 'Base64EncodedWireTransaction'` | `sendTransaction` takes kit's *branded* base64 type, not a plain string | `sendAndConfirm` takes the branded type; callers pass `getBase64EncodedWireTransaction(tx)` |
| `implicitly has type 'any[]'` (×3) | `const x = []` with no annotation | annotated as `Instruction[]` |
| `ReadonlyUint8Array` is missing `set`, `fill`, … (×5) | `getTransactionEncoder()` returns a readonly view; `sendAndConfirm` wanted writable bytes | removed by the branded-base64 change above |

The first row is the instructive one. It is not a typo — it is TypeScript
declining to see fields that a `.mjs` file assigns *after* the literal. The
derived type looked entirely reasonable and was wrong about every field the
money arithmetic is made of, which is precisely the kind of quiet wrongness this
project audits for, so the fix is an explicit interface rather than a cast.

Fixing it also removed a `as unknown as Record<string, unknown>` in
`app/api/session/route.ts` that had only been there to work around the broken
type. Removing it was the point: a double cast that exists to satisfy a wrong
type is a place where a real mistake can hide.

### Rounds two and three, and the one that got through

Three pushes were needed, and the interesting part is the shape of what the
later rounds caught — each fix exposed the next layer rather than the same layer
again.

| Round | Error | Cause | Fix |
|---|---|---|---|
| 2 | `chain.ts` ×3: `'string' is not assignable to 'Address'` | the `.mjs` builders return plain strings; kit's `Address` is a *branded* string, so `string` will not do | one `instructionFrom()` bridge, rather than a cast at each of the six call sites |
| 2 | `chain.ts(761,68): 'signer' does not exist in type 'AccountMeta<string>'` | annotating the array as `(Instruction & InstructionWithSigners)[]` broke contextual typing for the inline `accounts` literal, so it was checked against `Instruction` — which types accounts as `AccountMeta[]`, and `AccountMeta` has no `signer` | build the accounts into a typed `const sealAccounts: SignerAccounts` first, which expresses "this meta carries a signer" without a cast |
| 2 | `session/route.ts(166,30): Expected 3 arguments, but got 2` | **our own regression.** While moving validation so that a bad request reports 400 instead of 502, the `seconds` argument was dropped from `commitUsage` — the meter would have billed zero seconds on every tick | restored |
| 3 | `SIGNER is not defined` (×4, incl. one test failing as *"threw, but not the error we wanted"*) | a test fixture declared inside one `describe` block and asserted on by three others | hoisted to module scope |
| 3 | `token account is 65 bytes, too short to carry an amount` | the "reads from the right place inside a larger buffer" test sliced `subarray(100, 165)` — 65 bytes — so it tripped the length guard and never reached the offset read it exists to check | carves a full 165-byte window, with an assertion on the slice length so a future shortening fails on *length*, not on the guard |
| 4 | `protocol-bytes.test.js`: `Parse failure — Expected ',' or ')' but found ':'`, reported as **`(0 test)`** | a `: number` annotation on a function parameter. The file is `.js`, and rolldown parses `.js` with the JS parser, not the TypeScript one | annotation removed; the file now says in its header that "plain JavaScript" is load-bearing |

The round-2 `TS2554` is the one worth keeping. It is not a typing problem at
all: a real behavioural bug, in money arithmetic, introduced by a refactor that
was itself a correctness improvement. It was caught only because the whole
pipeline runs on every push. A local `tsc` would have caught it too — which is
the argument for having one, and the reason the development machine's 0.6 GB of
free RAM is a real cost rather than an inconvenience.

The round-4 failure is the opposite kind and the more dangerous one. It is not an
assertion that failed — it is a **suite that never ran**, reported as `(0 test)`
while the run as a whole said `83 passed`. Every check in that file had been
silently checking nothing, including the two that exist to keep the duplicated
base58 encoder and the transaction-offset arithmetic honest. Fixing the syntax
then exposed a second problem underneath it: the fixture compiled a message with
no signer, so it produced zero signature slots while the test asserted against
`1 + 64 × count`. It could never have passed, and a version that "passed" would
have proved nothing — with no signatures the offset is 1, which a slicer that
hardcoded 1 would also get right. The fixture now signs with a generated
keypair, and the suite checks the offset three ways, including one case that must
land 64 bytes early.

**Green as of 2026-10-06: typecheck, 94 tests across 4 files, and a production
build — all passing.** `docs/ARCHITECTURE.md`, `docs/SECURITY.md` and
`docs/LIMITATIONS.md` were written alongside it.

### The meter cannot flatter itself

- It follows the **confirmed** watermark only, read back from chain after each
  transaction. There is no interpolation between reads, and no client-side
  estimate of what the bill "should" be by now.
- A failed tick **stops the loop** and says why. Continuing to tick against a
  chain we cannot reach would leave a stale number on screen looking current.
- A failed close returns to **ACTIVE, never SETTLED**. The channel is still open
  and still holds the money, and claiming otherwise is the exact failure this
  project exists to avoid.
- An unconfigured deployment answers **503 with the reason**, so the interface
  can say what is missing instead of failing generically — or, far worse,
  inventing a number.

---

## The interface — shell built 2026-10-05

The visual layer now exists under `app/`, built to the locked visual reference
in build spec Section 0C: warm cream canvas, serif proposition headline, the
Usage Tab as a document/receipt object, an orange primary action and a
restrained green verified state.

```
app/globals.css                  design tokens + primitives
app/layout.tsx                   fonts (Fraunces, IBM Plex Sans/Mono)
app/page.tsx                     the landing composition
app/page.module.css
app/components/UsageTab.tsx      the Usage Tab
app/components/UsageTab.module.css
lib/session.ts                   the product state machine
lib/amounts.ts                   exact integer money arithmetic
tests/session.test.ts            the arithmetic and display rules
```

**Deliberately built with zero new dependencies**, so it typechecks, tests and
builds in CI straight away. Adding `@solana/kit` would change
`package-lock.json`, and `npm ci` fails when the manifest and lockfile disagree
— the same trap the Devnet workflow already documents.

**Two things the interface refuses to do**, both required by the spec:

1. **It invents no protocol data.** Section 0C forbids copying the reference
   image's example amounts, transaction data and update counts into real
   behaviour, so the tab starts with a *proposed* ceiling that is visibly
   labelled as not on chain. `ValueProvenance` in `lib/session.ts` exists to
   keep that distinction structural rather than a matter of care.
2. **It claims no result it has not read back.** Section 12: "No final result
   is shown until chain state is read back." The connect/open/close controls
   are therefore wired to say they are not connected yet, rather than to move
   the state machine and look finished.

The one part that is fully real is the footer: four Devnet transaction
signatures, each from an actual run of this repository's tooling, each linking
to the explorer. That is deliberate — it is the honest version of a trust
section, and the judge can check it instead of believing it.

### Interface arithmetic is tested, not assumed

`tests/session.test.ts` pins the rules that would otherwise bite quietly:

- **Display never rounds money away.** Section 0C's reference shows two decimal
  places, but the verified mint has six. A remainder of `37.600001` rendered as
  `37.60` would make the tab's own numbers fail to reconcile — the interface
  would look right while being wrong. `formatForDisplay` shows the full value
  whenever two places would hide a real digit, and the test round-trips through
  `parseAmount` to prove nothing is lost.
- **The meter cannot be drawn out of range.** `meterFraction` clamps to [0, 1];
  without it, a settled amount above the deposit would render a bar at 200%
  width, i.e. a wrong ratio that still looks plausible.
- **An impossible reading is shown as wrong.** Settled above the deposit is
  rejected by the program (error 235), so `describeMeter` returns
  `INCONSISTENT` and the meter is drawn in the warning colour rather than as a
  normal bar.

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

Five days remain, and the application has not been started.

---

## Next steps

1. **Deploy to Vercel.** The account exists and the repository is already linked
   to it; what is needed is a Vercel token so the deploy can be driven the same
   way the GitHub work is. The deployment also needs `DEVNET_PAYER_KEYPAIR` and
   `DEVNET_OPERATOR_KEYPAIR` set as environment variables, which is the whole
   reason the token is worth having — it is the same handover as the GitHub one.
2. **Run the demo from a real browser.** Connect, faucet, open, meter, close.
   This is the one path CI cannot cover: it needs a real extension and a real
   wallet, and the wallet handshake is written with two signing paths precisely
   because that is the part most likely to differ between visitors.
3. Exercise `withdrawPayer` and a distribution plan with real recipients, both
   still UNVERIFIED, but neither blocks the application.

## Deliberately not done yet

- **No Vercel deployment.** Blocked on the token, not on the work.
- **No mainnet anything.** Devnet only, and the interface says so in the header.
- **No claim of a browser run.** Until a human has connected a real wallet to a
  deployed build and closed a real tab, the honest status of the wallet
  handshake is "written and reviewed, never exercised".
- **No `docs/UX_TEST.md`.** It records a first-viewport test with a stranger, and
  the spec forbids manufacturing answers. It needs a real person who is not us.

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
