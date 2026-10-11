# UsageBar — Audit Report

**Build spec Section 0A deliverable.**
**Date:** 2026-10-05 · **Status:** historical initial-audit report; no application code executed at the time.

This was the mandatory first task before implementation. It is now a historical
snapshot, not a statement of the current build status. The application has since
been implemented and deployed; use `USAGEBAR_BUILD_SPEC.md` and
[`CLAIM_STATUS.md`](CLAIM_STATUS.md) for the current product and verified evidence.
The original research below remains useful as a record of the protocol decisions
and how the initial risk review was done.

Companion documents:
- [`PROTOCOL_DISCOVERY.md`](PROTOCOL_DISCOVERY.md) — the raw verified facts
- [`PROTOCOL_DECISION.md`](PROTOCOL_DECISION.md) — the provisional path choice
- [`CLAIM_STATUS.md`](CLAIM_STATUS.md) — proven vs unproven
- [`COST_MATRIX.md`](COST_MATRIX.md) — the $0 gate

---

## Executive summary

**The largest projected risk in the specification turned out to be false.**

Build spec Report 5 anticipated that the Payment Channels program might not be
deployed on Devnet, which would have blocked the entire project. It **is**
deployed, it is executable, and it is actively used — verified by direct RPC
query, twice, on 2026-10-05.

Four things the specification does not know, in order of importance:

1. **Settlement requires an Ed25519 precompile instruction placed immediately
   before `settle`.** This appears nowhere in the spec and is the most likely
   cause of a confusing first failure.
2. **The voucher signer is a first-class channel parameter (`authorized_signer`),
   not a "two modes" choice.** This natively supports the smooth UX the spec
   wanted, and resolves its open question in Section 8.
3. **The official TypeScript client is not published on npm** and must be
   generated — and it pins `@solana/kit ^6.1.0` while the current release is
   `8.4.0`.
4. **The demo ceiling of 50.00 cannot be funded from the USDC faucet**, which
   dispenses 20 per 2 hours.

Plus one governance problem: **Sections 0B and 108 contradict each other** —
one says stop after this report, the other says begin implementing. This report
follows 0A/0B. No code was written.

---

## Report 1 — Understanding

**What is UsageBar?** A payment tab for services that charge by usage. Like a
bar tab: authorize once, let usage accumulate, settle once at the end.

**Who is it for?** A customer using a service whose final price depends on
measured usage.

**What problem does it solve?** Today there are two bad options — a separate
on-chain transaction per usage event, or post-hoc billing from a party you must
trust. UsageBar provides a third: a hard on-chain ceiling, off-chain cumulative
usage, one settlement, and recovery of the unused remainder.

**The camera-rental demo.** A simulated equipment rental. 50.00 test units
authorized, usage climbs through 2.40 → 4.80 → 7.20 → 9.80 → 12.40, the tab is
closed, 12.40 is settled and 37.60 remains. The camera usage is simulated; the
payment mechanism is real.

**The core journey.** Connect wallet → authorize a ceiling → usage accumulates
through signed updates → Close & Settle → real settlement, real remainder, real
transaction links.

**Difference from a normal billing database.** A database records usage but
cannot cap exposure or hold funds. Here the chain escrows the ceiling: the
provider cannot take more than authorized, and the customer cannot be charged
more than used.

**Role of Payment Channels.** It supplies the escrowed ceiling, cumulative
off-chain authorization, one on-chain settlement, and recovery of unused escrow.

---

## Report 2 — Product flow vs protocol state

| Product state | What must actually happen | Chain reality |
|---|---|---|
| `READY` | No channel. Only action is `OPEN TAB`. | Nothing on chain. |
| `OPENING` | Wallet prompts; user signs the deposit transaction. **No success claim.** | Transaction submitted, unconfirmed. |
| `FUNDED` | Deposit verified by **reading the channel account back from chain**. Show channel address and opening transaction. | Channel exists, status `Open`, tokens escrowed. |
| `ACTIVE` | Meter advances; cumulative vouchers signed. UI shows the latest **accepted** amount. | Channel still `Open`. Vouchers are off-chain — no transaction per update. |
| `FINALIZING` | Final voucher finalized; `settle_and_seal` and `distribute` submitted. | `Open → Sealed → Distributed`. |
| `SETTLED` | **Only after reading final chain state.** Show settled, returned, and signatures. | Verified from chain. |

**PRODUCT STATE ≠ PROTOCOL STATE.** Product words are the six above. Protocol
words are `Open (0)`, `Sealed (1)`, `Closing (2)`, `Distributed (3)`. The
specification's Section 13 is accurate; all displayed final states must derive
from the real protocol state, never from application memory.

---

## Report 3 — Protocol discovery

Full structured detail with `FACT / SOURCE / URL / VERIFIED DATE / NETWORK /
VERSION / CONFIDENCE / IMPACT` is in [`PROTOCOL_DISCOVERY.md`](PROTOCOL_DISCOVERY.md).
Summary of the load-bearing facts:

| Fact | Confidence |
|---|---|
| Program ID `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX` | high |
| Deployed and executable on **mainnet-beta** | high |
| Deployed and executable on **devnet**, and actively used | high |
| 9 public instructions, matching the spec's list exactly | high |
| Channel PDA seeds `["channel", payer, payee, mint, authorized_signer, salt, open_slot]` | high |
| Voucher = 50-byte cumulative Ed25519 message, `magic 0x56 0x01` | high |
| Settlement needs an Ed25519 precompile immediately before `settle` | high |
| Signer is `authorized_signer`, set at `open`, need not be payer or payee | high |
| Lifecycle `Open=0, Sealed=1, Closing=2, Distributed=3` | high |
| SPL Token and allow-listed Token-2022 both supported | high |
| TS client exists, **not on npm**, generated by Codama, pins `@solana/kit ^6.1.0` | high |
| x402 `upto` settles at most once — unsuitable for this product | high |
| MPP = Machine Payments Protocol; session is IETF draft `draft-solana-session-00` | high |
| Devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals, classic SPL Token | high |

`UNKNOWN` items are listed at the end of `PROTOCOL_DISCOVERY.md` rather than
guessed.

---

## Report 4 — Direct client vs MPP session

| | **Path A — direct client** | **Path B — MPP session** |
|---|---|---|
| What it does | Calls the program's 9 instructions directly | An HTTP session protocol layer on top of the same program |
| Added dependencies | Codama (to generate the client) | `@solana/pay-kit` 0.13.0, `@solana/mpp` 0.7.0, `mppx` |
| Devnet | **Program verified live on devnet** | No devnet path documented; hosted sandbox RPC; one helper explicitly dev-only |
| Easiest to prove | Yes — fewer layers to debug | No |
| Easiest to explain to judges | Yes | Harder |
| Safest for a solo build | Yes | Draft spec + 0.x SDK |

**PROVISIONAL recommendation: Path A.** The spec's own rule is "fewest moving
parts that passes the first smoke test." Path B is built on the *same on-chain
program*, so nothing protocol-level is lost by omitting it.

**Answering the spec's Section 8 directly:** server/operator signing **is**
supported natively. The channel has a single `authorized_signer`, chosen at
`open`. The spec's framing of "two conceptual voucher modes" is imprecise —
there is one mechanism, and the choice is simply who holds the key. No custom
authorization system is needed, and none should be built.

Not final until the smoke test runs.

---

## Report 5 — Devnet gate

Required sequence:

```
devnet wallet → real channel → real open → real cumulative signed usage
  → real settle_and_seal → real distribute → real final state
  → Explorer-verifiable proof
```

| Potential blocker | Status |
|---|---|
| Missing devnet deployment | **CLEARED** — verified executable, twice, by direct RPC |
| Missing TypeScript client | **Real friction** — not on npm; must be generated |
| Ed25519 precompile wiring | **Unverified in our hands** — likely first failure point |
| Devnet treasury placeholder (`0xBEEF` sentinel in source) | **Genuine risk** — `distribute` may fail; must be tested |
| Test asset | **Genuine issue** — faucet gives 20, ceiling is 50 |
| Wallet capability | Clearable — any Wallet Standard wallet on devnet |
| RPC limits | Adequate for a demo; shared egress IPs could 429 |
| Vercel incompatibility | Must be tested; Hobby allows 300s, which is sufficient |
| Hidden paid service | **None found** |
| Human / whitelist access | **None required** |

No mock substitutes are proposed anywhere in this document.

---

## Report 6 — Asset

**What the protocol accepts:** any classic SPL Token mint, or a Token-2022 mint
limited to an allow-list of extensions. The least risky choice is a vanilla SPL
Token mint with no extensions.

**How decimals matter:** decimals are fixed at mint creation and cannot be
changed. They determine the atomic-unit arithmetic. The specification's example
`50_00` implies 2 decimals, but 6 is correct for a stablecoin-like asset —
verified for the devnet USDC mint.

**The blocker:** Circle's faucet dispenses **20 USDC per 2 hours per
asset+network**, and the demo ceiling is **50.00**. One claim cannot fund the
channel.

**Options:** (A) create a purpose-built devnet SPL mint — free, instant,
unlimited, labelled honestly as e.g. `50.00 TEST`; (B) use real devnet USDC and
claim three times over ~4 hours; (C) lower the ceiling — not permitted.

**Recommendation: (A).** Awaiting the project owner's decision. The mint address
must be verified on-chain and recorded in `ASSET_PROVENANCE.md`.

---

## Report 7 — Security

**Already specified by the spec:** ceiling enforcement, monotonic vouchers, no
fake balance, no blind retry, network binding, asset binding, refresh safety,
idempotent close.

**Clarified or added by real protocol discovery:**

| Concern | Reality |
|---|---|
| Voucher replay | **Solved by design** — `open_slot` is a PDA seed, so channel addresses are unique per incarnation; stale vouchers fail `VoucherChannelMismatch`. Plus optional `expires_at`. |
| Wrong signer | Enforced on-chain via `authorized_signer` + Ed25519 precompile |
| Duplicate settlement | Rejected — non-advancing amounts are refused; the state machine forbids repeats |
| Distribution malleability | Protected by `distributionHash` (SHA-256 of the recipient preimage), fixed at settle and enforced at distribute |
| Operator key compromise | Bounded: it can only move funds along the configured distribution, up to the deposit. It cannot redirect to an arbitrary address. Must still live server-side only. |
| `MissingEd25519Verification` | Operational rather than a security hole, but the most likely way to ship something broken |

**Still to implement:** precompile instruction ordering, chain-readback gating
before displaying `SETTLED`, retry-after-timeout state inspection, and
idempotency on the close action.

---

## Report 8 — Zero budget

Full table in [`COST_MATRIX.md`](COST_MATRIX.md).

```
ZERO-COST CORE PATH: PASS
```

Ten mandatory dependencies, all with a verified free path. No paid service
required, no whitelist, no human approval. Two optional free RPC fallbacks
exist (Helius, FluxRPC) if the public endpoint throttles — with Helius's devnet
support on the free tier marked `UNVERIFIED`.

Rejected as mandatory dependencies: QuickNode (a 1-month trial, not a
perpetual free tier) and Chainstack's faucet (requires a mainnet SOL balance).

---

## Report 9 — Hardware and build environment

Measured on the development machine, 2026-10-05:

```
Node          v24.14.0
npm           11.9.0
git           2.53.0
gh            2.100.0   (installed, not on PATH)
solana CLI    not installed
rust          not installed
RAM           7.9 GB total — 0.6 GB free
Disk          9.7 GB free
CPU           4 logical cores
Devnet RPC    reachable, solana-core 4.4.0-beta.0
```

**The binding constraint is memory**, not CPU. With 0.6 GB free, a local
Next.js dev server alongside a browser and a wallet extension will thrash, and
9.7 GB of disk is tight for `node_modules` plus a Next.js build cache.

| Runs locally | Runs in GitHub Actions |
|---|---|
| Editing | `npm install` |
| Browser + wallet extension | Typecheck, unit tests |
| Lightweight RPC/curl checks | Codama client generation |
| Reading chain state | Build |
| | Playwright E2E, verifier runs |

Rust, the Solana CLI, and Anchor are **not** installed and are **not needed** —
the program is already deployed and is reached over RPC. No hardware upgrade is
required or requested.

---

## Report 10 — Specification audit

**PROBLEM 1 — Sections 0B and 108 contradict each other**
`SEVERITY:` High
`WHY:` 0B says stop after the report and wait for the human; 108 says "you may
now begin implementation." An agent following 108 would skip the gate.
`REQUIRED FIX:` State that 0A/0B govern. This audit treated them as governing
and wrote no code.

**PROBLEM 2 — Section 8 misdescribes the signing model**
`SEVERITY:` Medium
`WHY:` It describes "two conceptual voucher modes." In reality there is one
mechanism — the channel's `authorized_signer`, set at `open`. The "two modes"
framing could send an implementer looking for a delegation API that does not exist.
`REQUIRED FIX:` Reword to "the channel has a single `authorized_signer`; choose
payer-held or server-held."

**PROBLEM 3 — The Ed25519 precompile requirement is never mentioned**
`SEVERITY:` High
`WHY:` Settlement fails with error 230 unless a canonical Ed25519 precompile
instruction is placed immediately before `settle`. Undocumented here, it costs a day.
`REQUIRED FIX:` Add to Sections 21 and 90.

**PROBLEM 4 — Section 14's `50_00` implies 2 decimals**
`SEVERITY:` Low
`WHY:` The verified asset has 6. The section warns against assuming, then its
own example assumes.
`REQUIRED FIX:` Use 6-decimal atomic values, or make the example decimals-agnostic.

**PROBLEM 5 — The client is assumed to be installable**
`SEVERITY:` Medium
`WHY:` Section 32 implies an "official generated client" that can be installed.
It is not on npm and must be generated with Codama.
`REQUIRED FIX:` Document the generation step and run it in CI.

**PROBLEM 6 — No acceptance criterion for the devnet distribute question**
`SEVERITY:` Medium
`WHY:` The source tree still carries a placeholder `TREASURY_OWNER` with a
`TODO` and a build-time assert. Whether devnet `distribute` succeeds is unknown.
`REQUIRED FIX:` Make "devnet distribute succeeds" an explicit Phase 5 gate.

**PROBLEM 7 — The deadline is not budgeted**
`SEVERITY:` **High**
`WHY:` Submissions close **12 October 2026**; today is 5 October — seven days.
The spec describes a ten-phase build with adversarial testing and nine separate
documentation artifacts.
`REQUIRED FIX:` Compress to the minimum proven path (Report 14) and merge the
documentation set. Nine docs is a real cost at this timescale.

**What the specification gets right, and deserves credit for:** the anti-fake
rules, the source-of-truth ordering, the nine-instruction list (verified
correct), the protocol lifecycle (verified correct), and the warning against
x402 `upto` (verified correct).

---

## Report 11 — Scope audit

**IN:** one service (camera rental) · one tab · one customer · one provider ·
one 50-unit ceiling · cumulative signed usage · one final settlement · unused
remainder · real proof.

**OUT (confirmed absent, and must stay absent):** AI, marketplace, multi-chain,
DeFi, token launch, camera marketplace, physical hardware, oracle network,
custom payment-channel contract.

**Scope-creep traps identified:**

- Section 75's roadmap (EV charging, compute, APIs) — document, build none.
- `top_up` and `request_close` exist on-chain and are **not needed** for the MVP.
- Section 29's verifier is effectively a second program; keep it to "read
  evidence, query chain, print PASS/FAIL."
- The nine documentation artifacts should be merged to three or four.

---

## Report 12 — UI and design understanding

The direction is understood.

```
PRODUCT WORLD:       The Open Tab
PRIMARY OBJECT:      Usage Tab
SIGNATURE ACTION:    Close & Settle
SIGNATURE MECHANISM: Authorized → Used → Returned
```

**The locked reference (Image 2)** is a warm cream editorial page with the feel
of a paper receipt: large serif proposition on the left, the Usage Tab on the
right as a physical document with `USAGE TAB` at its head and `CAMERA RENTAL` as
the service identity, three clearly separated amounts, a usage meter that reads
as a fill level rather than a chart, one orange action, and green reserved for
genuinely verified states.

**First viewport:** proposition · Usage Tab · authorized/used/remaining · state ·
primary action. Nothing else — no architecture diagram, no feature grid, no
invented metrics.

**Composition hierarchy:** product proposition → Usage Tab → the three amounts →
usage meter → current state → primary action.

**Visual tone:** physical, precise, calm, tactile. A document you would trust
with money.

**Role of the Usage Tab:** it *is* the product. Not a card in a grid.

**Role of the meter:** the central explanatory graphic. It must communicate
`AUTHORIZED → USED → REMAINING` without resembling an analytics chart.

**Typography:** distinct serif display (Fraunces) · IBM Plex Sans for interface
· IBM Plex Mono for on-chain and proof data. All three are freely licensed;
provenance to be recorded in `ASSET_PROVENANCE.md`, and no font files committed
without clear licensing.

**Colour:** cream `#F6F5F0` · ink `#171816` · rules `#D8D7D0` · action orange
`#D97532` · success `#28634A`. No gradients, no purple/blue.

**Responsive intent:** the same visual world at phone width — reordered, never a
shrunk desktop dashboard.

**Anti-AI UI rules:** no glassmorphism, neon, bento grids, floating coins,
invented activity, or generic Web3 sidebars. Identity comes from the Usage Tab,
the meter, the authorized/used/returned relationship, and the Close & Settle
transition.

**Why it must not look like a generic Web3 dashboard:** the product's claim is
boring, trustworthy accounting. Speculative visual language undermines exactly
the trust the product is asking for.

**Anti-AI test:** remove the logo and the word "UsageBar" — a judge should still
identify a payment tab, a usage meter, an authorized/used/returned relationship,
and a close-and-settle action.

**Honest risk noted:** the reference image shows "37 signed usage updates." A
real run has five. The count must be rendered from real data; hardcoding a
larger number would be fabricating a metric.

---

## Report 13 — Evidence

The finished project must produce: the canonical run
`canonical-usagebar-devnet-001`, real transaction signatures for open, settle
and distribute; the channel address; voucher progression; final state readback;
the unused remainder; a verifier that queries the chain and fails loudly; claim
statuses; limitations; and Explorer links.

**Current claim status** (full table in [`CLAIM_STATUS.md`](CLAIM_STATUS.md)):

```
Payment Channels program exists on mainnet:          PROVEN
Payment Channels program exists on devnet:           PROVEN
Devnet program is actively used:                     PROVEN
Program ID CHNLx...:                                 PROVEN
Instruction set (9 public):                          PROVEN
Voucher format / cumulative / Ed25519 precompile:    PROVEN
authorized_signer supports operator signing:         PROVEN
TS client is NOT on npm:                             PROVEN
devnet USDC mint + 6 decimals:                       PROVEN

UsageBar can open a channel on devnet:               UNVERIFIED
UsageBar can advance cumulative vouchers:            UNVERIFIED
UsageBar can settle_and_seal:                        UNVERIFIED
devnet distribute succeeds (treasury placeholder):   UNVERIFIED
Unused remainder actually returned:                  UNVERIFIED
Mainnet production deployment:                       UNVERIFIED
Commercial adoption:                                 UNVERIFIED
```

`OBSERVED` and `INFERRED` are currently unused — every row is either directly
proven or untested. That is the honest position, and it is deliberate.

---

## Report 14 — Build order

The spec's ordering is correct: protocol gate before UI. Compressed for seven days:

**Days 1–2 — Protocol gate (no UI)**
1. Generate the Codama client in GitHub Actions; commit the output
2. Wallet + devnet SOL
3. **Smoke test: real `open` on devnet, channel read back from chain ← the gate**
4. Voucher spike: sign a cumulative voucher, submit with the Ed25519 precompile, verify
5. Settlement spike: `settle_and_seal` → `distribute` → read final state
   → *If step 5 fails on the devnet treasury configuration, that is a BLOCKER:
   stop and report rather than substituting a mock.*

**Days 3–4 — Application**
6. State machine, protocol adapter, session page

**Days 5–6 — Visual**
7. Design system, Usage Tab, meter, transitions, mobile

**Day 7 — Evidence and submission**
8. Canonical run, verifier, screenshots, README, video, submission

**Adversarial tests (spec Section 23) reduced to four for the deadline:** above
ceiling, non-monotonic, wrong signer, double-click close — run in CI, not by hand.

---

## Report 15 — User actions

Only actions that genuinely require the project owner.

**1. Authorise pushing to the repository.**
`WHAT I MUST DO:` Confirm the target.
`WHY:` Pushing is public and hard to undo.
`EXACT STEPS:` `Temmygabriel/UsageBar` already exists, is public, and was
empty. Confirm it is the correct target.
`WHAT I SHOULD SEND BACK:` "yes, push".

**2. Install a Solana wallet and switch it to Devnet.**
`WHAT I MUST DO:` Install Phantom (free browser extension).
`WHY:` Only the owner can sign transactions.
`EXACT STEPS:` Install → create a **new** wallet → write the recovery phrase on
paper → Settings → Developer Settings → Testnet Mode → Devnet.
`WHAT I SHOULD SEND BACK:` The **public** devnet address only. Never the
recovery phrase, never a private key, to anyone, for any reason.

**3. Obtain free devnet SOL.**
`WHAT I MUST DO:` Visit `faucet.solana.com`, paste the address, request 1 SOL.
`WHY:` Transaction fees and rent.
`WHAT I SHOULD SEND BACK:` "done", or the error text.
`NOTE:` The `solana airdrop` CLI no longer works — the RPC faucet is closed.

**4. Decide the demo asset.** *(requires judgement)*
`WHAT I MUST DO:` Choose how the 50 test units are obtained.
`WHY:` Circle's faucet dispenses only 20 per 2 hours against a 50 ceiling.
`EXACT STEPS:` Choose **(A)** a purpose-created devnet test mint, labelled
honestly; or **(B)** real devnet USDC, claimed three times over ~4 hours.
`WHAT I SHOULD SEND BACK:` "A" or "B". Recommendation: **A**.

**5. Create a free Vercel account.**
`WHAT I MUST DO:` Sign up at `vercel.com` with GitHub.
`WHY:` Free hosting for the live demo link the submission requires.
`WHAT I SHOULD SEND BACK:` "done".

**6. Accept the compressed timeline.**
`WHAT I MUST DO:` Confirm the seven-day plan in Report 14, or ask for further cuts.
`WHY:` Submissions close 12 October 2026 — seven days from today.

**Not required:** installing Rust, the Solana CLI, or Anchor. No heavy local
builds. No paid service. No mainnet funds.

---

## Final verdict

```
READY FOR PROTOCOL DISCOVERY
```

Discovery is substantially complete. No hard blocker remains: the devnet
deployment exists and is active, the instruction set and voucher format are
confirmed, and the cost path is $0.

**The next real gate is a single experiment:** open one channel on devnet and
read it back from chain. Everything downstream depends on it. Until that has
been observed, no claim about UsageBar working may be made — including on the
website.

**Not** `READY FOR FULL BUILD`. The live protocol flow has not been proven.
