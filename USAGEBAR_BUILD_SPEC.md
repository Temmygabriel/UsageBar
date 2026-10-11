# USAGEBAR BUILD SPEC
## Colosseum Crypto World's Fair — Evidence-First Full Build Contract

**Version:** 1.1  
**Date:** 5 October 2026  
**Product:** UsageBar  
**Primary ecosystem:** Solana  
**Core protocol:** Solana Payment Channels  
**Build constraint:** $0 core path  
**Developer machine constraint:** Windows, 8 GB RAM  
**Primary engineering model:** real-first, evidence-first, phase-gated  
**Current implementation status:** Not started / protocol viability gate required
**Visual reference:** Visual Reference Image 2 is locked as the primary art-direction target (see Section 0C).
**Audit-first mode:** DeepSeek/Claude Code must perform the Section 0A report before any implementation work.

---

# 0A. MANDATORY FIRST TASK — READ THIS PROMPT FIRST

## IMPORTANT OPERATING MODE

You are the coding agent for my Colosseum Crypto World's Fair hackathon project.

This file is `USAGEBAR_BUILD_SPEC.md`.

**DO NOT START CODING YET.**

Your first job is to **READ AND AUDIT THE ENTIRE SPECIFICATION**, then give me a report.

Do not:
- install packages;
- create application code;
- initialize the project;
- deploy anything;
- create or use Mainnet funds;
- create wallets unless the report later explicitly requires it;
- invent Solana protocol details;
- invent Devnet addresses;
- invent token mints;
- invent program IDs;
- invent SDK APIs;
- silently simplify requirements;
- silently change the product;
- skip the protocol discovery requirements.

Read the entire `USAGEBAR_BUILD_SPEC.md`. Do not stop after the first sections.

The specification is deliberately detailed. Treat it as the authoritative product/build contract unless you identify an actual contradiction or technically impossible requirement.

**YOUR JOB NOW IS REPORT ONLY.**

---

## REPORT 1 — UNDERSTANDING

Explain in simple terms:

1. What is UsageBar?
2. Who is it for?
3. What exact problem is it solving?
4. What is the Groq contract-review demo?
5. What is the one core user journey?
6. What makes the product different from a normal billing database?
7. What role does Solana Payment Channels play?

---

## REPORT 2 — PRODUCT FLOW

Write the exact expected flow:

`READY → OPENING → FUNDED → ACTIVE → FINALIZING → SETTLED`

Explain what must actually happen at every state.

Clearly distinguish:

**PRODUCT STATE**

from

**ACTUAL SOLANA / PAYMENT CHANNEL STATE**.

---

## REPORT 3 — PROTOCOL DISCOVERY

Before implementation, identify every technical fact that must be verified from current official sources.

At minimum investigate:

- current official Solana Payment Channels repository;
- current canonical program ID for the selected network;
- whether a Devnet deployment currently exists;
- current TypeScript client;
- package/version/commit;
- exact open instruction;
- exact settle/settle_and_seal instruction;
- distribute/refund/recovery behavior;
- channel PDA derivation;
- required accounts;
- voucher format;
- cumulative amount rules;
- expiry rules;
- signer rules;
- token program compatibility;
- Devnet asset requirements;
- token decimals;
- wallet integration;
- current MPP session implementation;
- relationship between MPP session and Payment Channels;
- Vercel implications.

**IMPORTANT:** Do not answer any of the above from memory.

For every critical fact give:

`FACT:`
`SOURCE:`
`URL:`
`NETWORK:`
`VERSION/COMMIT IF RELEVANT:`
`CONFIDENCE:`
`WHY IT MATTERS:`

---

## REPORT 4 — DIRECT PAYMENT CHANNELS VS MPP SESSION

Compare:

A. Direct Payment Channels client

B. MPP session implementation

Determine which appears to be the simplest and safest path for UsageBar.

Remember:

UsageBar is a repeated usage session.

**Do NOT use x402 `upto` as the core UsageBar architecture merely because it is related.**

Explain:

- what each approach actually does;
- what additional dependencies it adds;
- what its Devnet requirements are;
- which is easier to prove;
- which is easier to explain to judges;
- which is safer for a solo hackathon build.

Give a **PROVISIONAL** recommendation only.

Do not call anything final until the actual environment is tested.

---

## REPORT 5 — DEVNET GATE

Explain exactly what must be proven before full application development.

Expected conceptual flow:

`Devnet wallet → real Payment Channel → real channel open → real cumulative signed usage → real settlement → real distribution/refund/recovery → real final state → Explorer-verifiable proof`

Identify every dependency that can block this.

Especially:

- missing Devnet deployment;
- missing test asset;
- incompatible token program;
- missing wallet capability;
- missing client support;
- signer requirements;
- RPC limits;
- Vercel incompatibility;
- hidden paid service;
- required human/whitelist access.

Do not suggest fake/mock substitutes.

---

## REPORT 6 — ASSET

Determine what must be verified before selecting the demo asset.

Do NOT choose a random USDC-looking mint.

Do NOT invent a token address.

Explain:

- what type of asset the protocol accepts;
- how its decimals matter;
- how the payer obtains test balance;
- whether the asset can actually be used by the current Devnet deployment.

---

## REPORT 7 — SECURITY

Audit the specification for security risks.

At minimum review:

- payer authority;
- provider signer;
- voucher signer;
- client/server boundary;
- private key storage;
- maximum ceiling;
- cumulative voucher monotonicity;
- replay;
- wrong signer;
- wrong channel;
- wrong asset;
- wrong recipient;
- duplicate settlement;
- double click;
- retry after network timeout;
- stale application state;
- network mismatch;
- secret exposure;
- fake proof;
- fake balance.

Tell me which protections are already specified and which still need implementation.

---

## REPORT 8 — ZERO-BUDGET

Audit every mandatory dependency.

For each one:

`DEPENDENCY:`
`PURPOSE:`
`CURRENT COST:`
`FREE PATH:`
`ACCOUNT REQUIRED:`
`SECRET REQUIRED:`
`RISK:`
`VERIFICATION NEEDED:`

The core path must remain **$0**.

Do not quietly introduce paid services.

---

## REPORT 9 — HARDWARE / BUILD ENVIRONMENT

The developer machine is Windows with 8 GB RAM.

Identify:

- what can run locally;
- what should run in GitHub Actions;
- what may be too heavy;
- what should not be repeatedly installed/run locally.

Do not require hardware upgrades.

---

## REPORT 10 — SPECIFICATION AUDIT

Find:

- contradictions;
- ambiguous technical requirements;
- unnecessary complexity;
- missing acceptance criteria;
- requirements that could cause an AI coding agent to guess;
- anything that could make the product fake its blockchain behavior;
- anything inconsistent with the stated MVP.

Do not rewrite the whole specification.

Identify only actual problems.

For each problem:

`PROBLEM:`
`SEVERITY:`
`WHY:`
`REQUIRED FIX:`

---

## REPORT 11 — SCOPE AUDIT

Confirm what is IN the MVP.

Confirm what is OUT.

Identify any part of the specification that could cause scope creep.

The MVP must remain:

- one service;
- one payment tab;
- one customer;
- one provider;
- one ceiling;
- cumulative signed usage;
- one final settlement;
- unused remainder;
- real proof.

Do not add:

- AI;
- marketplace;
- multi-chain;
- DeFi;
- token launch;
- camera marketplace;
- physical hardware;
- oracle network;
- custom payment-channel protocol.

---

## REPORT 12 — UI/DESIGN UNDERSTANDING

Do not implement UI yet.

Explain whether you understand the visual direction:

`PRODUCT WORLD: The Open Tab`

`PRIMARY OBJECT: Usage Tab`

`SIGNATURE ACTION: Close & Settle`

`SIGNATURE MECHANISM: Authorized → Used → Returned`

Also explain your understanding of the **locked Visual Reference Image 2** described in the specification.

Explain:

- what must be visible in the first viewport;
- the composition hierarchy;
- the visual tone;
- the role of the Usage Tab;
- the role of the usage meter;
- typography hierarchy;
- color/accent behavior;
- responsive intent;
- anti-AI UI rules;
- why the product should NOT look like a generic Web3 dashboard.

---

## REPORT 13 — EVIDENCE

Explain the evidence that the finished project must eventually produce.

Include:

- canonical run;
- transaction signatures;
- channel proof;
- voucher proof;
- final settlement proof;
- unused remainder proof;
- verifier;
- claim status;
- limitations;
- Explorer links.

Clearly distinguish:

`PROVEN`
`OBSERVED`
`INFERRED`
`UNVERIFIED`

---

## REPORT 14 — BUILD ORDER

Produce the exact recommended implementation order.

It must start with:

1. protocol discovery;
2. protocol decision;
3. Devnet environment verification;
4. asset verification;
5. wallet/network verification;
6. real channel smoke test;
7. voucher test;
8. settlement/distribution/refund test;
9. adversarial tests;
10. full application;
11. UI implementation;
12. evidence;
13. final deployment;
14. final audit.

Do not move UI before the protocol gate.

---

## REPORT 15 — USER ACTIONS

List only actions that genuinely require me.

For every action:

`WHAT I MUST DO:`
`WHY:`
`EXACT STEPS:`
`WHAT I SHOULD SEND BACK TO YOU:`

Do not tell me to do something merely because it is convenient for you.

---

## FINAL VERDICT

Give exactly one:

`READY FOR PROTOCOL DISCOVERY`

or

`BLOCKED`

Do NOT say:

`READY FOR FULL BUILD`

because we have not yet proven the live protocol flow.

---

## VERY IMPORTANT

No guessing.

No coding.

No package installation.

No deployment.

No fake transactions.

No fake balances.

No fake signatures.

No fake Devnet success.

If a required fact is unknown, say:

`UNKNOWN:`
`WHAT MUST BE VERIFIED:`
`WHERE TO VERIFY IT:`

Then stop at that boundary.

Your final response must be the complete audit report only.

---

# 0B. AFTER THE REPORT — DO NOT PROCEED AUTOMATICALLY

The audit report is a gate. After returning the report, STOP.

Wait for the human to explicitly tell you to begin implementation.

Do not interpret `READY FOR PROTOCOL DISCOVERY` as permission to write code.


# 0C. LOCKED VISUAL REFERENCE — IMAGE 2 IS THE TARGET

**This section is part of the build contract.**

The visual direction is anchored to **Visual Reference Image 2**: the UsageBar landing-page concept generated during product design. The reference shows a warm editorial payment-product interface with the Usage Tab as the dominant product object.

**Important:** the image is a visual reference, NOT a pixel-perfect wireframe. The implementation must preserve its visual identity and composition while adapting it to real application states, accessibility, responsive behavior, and actual blockchain data.

## LOCKED VISUAL TARGET

The finished implementation should feel like the same product family as Image 2.

### First viewport composition

The intended desktop composition is:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ UsageBar        small utility/navigation              Connect Wallet │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  small product label                ┌─────────────────────────────┐  │
│                                     │       USAGE TAB             │  │
│  PAY FOR WHAT                       │                             │  │
│  YOU ACTUALLY                       │   CONTRACT REVIEW           │  │
│  USE.                               │                             │  │
│                                     │   AUTHORIZED     $50.00     │  │
│  Open one payment tab.              │   USED            $12.40    │  │
│  Let usage build the bill.          │   REMAINING       $37.60    │  │
│  Settle once at the end.            │                             │  │
│                                     │   usage meter               │  │
│  Open Tab | Use Service |           │                             │
│  Close & Settle                     │   37 signed usage updates   │  │
│                                     │                             │  │
│                                     │   [ CLOSE & SETTLE ]         │  │
│                                     └─────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

The exact dimensions may change for responsive design, but the **hierarchy must not**:

1. product proposition;
2. Usage Tab;
3. authorized/used/remaining;
4. usage meter;
5. current state;
6. primary action.

### Visual character

Preserve the characteristics of Image 2:

- warm cream/off-white editorial background;
- charcoal/near-black text;
- serif display headline;
- clean sans-serif interface text;
- monospace treatment for technical/data values;
- restrained thin rules and borders;
- limited rounding rather than oversized pill/card geometry;
- strong whitespace;
- orange as the main action/active accent;
- green for verified/success states;
- physical receipt/tab feeling;
- calm, premium, precise appearance;
- minimal navigation;
- no decorative crypto imagery.

### Primary object: the Usage Tab

The Usage Tab should visually behave like the product itself, not like a generic UI Card.

It should have:

- a document/receipt-like silhouette;
- strong top label `USAGE TAB`;
- service identity `CONTRACT REVIEW`;
- clearly separated amounts;
- usage meter;
- session status;
- usage update count when real data exists;
- dominant `CLOSE & SETTLE` action;
- final settlement area when the session is complete.

A notch, clipped corner, receipt edge, or similarly restrained physical-document cue is acceptable when it improves the effect. Do not turn it into a decorative skeuomorphic gimmick.

### Hero image / photography

Image 2 contains a physical camera/rental visual to make the use case immediately understandable. For the final implementation, this must not become stock-photo clutter.

Priority:

**real product object > decorative photography.**

The Usage Tab remains the dominant visual.

A camera image/illustration may be used if it is properly sourced or original and has clear provenance. If no suitable asset is needed, the product can use a restrained camera icon instead.

### Usage meter

The meter is a central product graphic.

It must communicate:

`AUTHORIZED → USED → REMAINING`

The meter must not look like a generic analytics chart.

### Settlement result

The completed state should visually echo Image 2:

```text
FINAL SETTLEMENT

AUTHORIZED        50.00
SETTLED/USED      12.40
RETURNED/UNUSED   37.60

✓ SETTLED
```

Only display `RETURNED` when the real protocol state proves the remainder was returned/recoverable according to the selected implementation.

### Brand and navigation

Image 2 uses a very restrained brand header.

Keep:

- UsageBar wordmark/name;
- a small amount of navigation;
- wallet control when appropriate;
- network/test-funds indicator where helpful.

Do not create a 10-item navigation bar.

### Typography target

Reference hierarchy:

- large distinctive serif for the main proposition;
- IBM Plex Sans or a close free equivalent for UI text;
- IBM Plex Mono for onchain/proof data.

The implementation must verify font availability/licensing. Do not commit proprietary font files.

### Color target

Reference direction:

- warm cream background;
- near-black ink;
- warm gray rules;
- vivid restrained orange action accent;
- green success state.

No gradients are required.

No purple/blue AI gradient is allowed.

### Responsive rule

Do NOT make a desktop screenshot and then simply shrink it.

On mobile:

1. proposition;
2. Usage Tab;
3. authorized/used/remaining;
4. meter;
5. state;
6. primary action;
7. proof.

The same visual world must survive.

### Visual reference priority

When implementation decisions conflict, use this priority:

1. real product/protocol/evidence truth;
2. accessibility and responsive usability;
3. UsageBar product design system;
4. Visual Reference Image 2;
5. individual agent taste.

Do not sacrifice real product behavior merely to imitate the image.

## IMAGE-2 ACCEPTANCE TEST

Put the implemented landing page beside Visual Reference Image 2.

Ask:

> Does this immediately feel like the same UsageBar product, visual world, and composition?

Do not ask whether every pixel matches.

The following must match the reference at the level of design language:

- editorial cream canvas;
- strong serif headline;
- Usage Tab as hero object;
- camera/service use case;
- Authorized / Used / Remaining hierarchy;
- central usage meter;
- orange primary action;
- restrained green verified state;
- calm document/receipt aesthetic;
- minimal navigation;
- absence of generic Web3 ornament.

If the answer is no, revise the visual implementation.

## IMPORTANT CONTENT RULE

Image 2 is a design reference only.

Do not copy its example wallet address, transaction data, test count, or other invented visual data into production behavior.

All financial/protocol values in the real application must come from verified application/chain state.


# 0. READ THIS FIRST

You are the coding agent responsible for building **UsageBar**.

UsageBar is a human-facing product built around Solana Payment Channels.

The product idea is simple:

> **Pay for what you actually use.**

A customer opens one usage-payment tab with a maximum spending ceiling. The service records cumulative usage through signed vouchers. At the end of the session, the actual amount used is settled and the unused remainder is returned/recoverable.

The implemented demo use case is:

> **Groq-powered contract review**

A customer authorizes a selectable maximum of 5, 10, 25, or 50 TEST, starts the service, and submits sample or public contract text. Each successful Groq review returns a structured analysis and adds one provider-signed cumulative voucher off-chain. The demo price is 1.00 TEST per successful review; it is a demonstration rule, not Groq's actual token cost. A failed or invalid AI response must not increase the used amount. On close, the latest voucher is submitted once, the channel is settled, and the unused deposit is returned.

Example:

- Maximum authorized: 10.00 TEST
- Three successful reviews: 3.00 TEST used
- Unused remainder returned: 7.00 TEST

TEST is a worthless Devnet token. This is a document-understanding demonstration, not legal advice. Only submit sample or public, non-confidential text because the content is sent to Groq.

These amounts are **test/devnet values, not real Mainnet funds**.

The project must use the real Solana Payment Channels mechanism in the real selected test environment. The application must never fake:

- transactions;
- signatures;
- vouchers;
- balances;
- channel state;
- settlement;
- refunds;
- explorer links;
- protocol confirmations.

The current official Solana Payment Channels repository documents an onchain channel that escrows a deposit, accepts cumulative offchain Ed25519 vouchers, and supports `open`, `settle`, `settle_and_seal`, `distribute`, `withdraw_payer`, `request_close`, `seal`, and `reclaim`. It lists the Mainnet program ID and links its current state-machine, instruction, HTTP, and generated-client documentation. Re-check the current repository at implementation time before using any identifier or interface.

The current Solana developer resource catalog also lists Payment Channels as a payment resource and identifies `@solana/kit` as the current TypeScript path for new applications. Re-check all current versions and package interfaces before installation.

---

# 1. NON-NEGOTIABLE BUILD RULES

## 1.1 No guessing

Never invent:

- Solana program IDs;
- Devnet program IDs;
- token mint addresses;
- token decimals;
- wallet addresses;
- PDA derivation details;
- instruction accounts;
- instruction data layouts;
- protocol methods;
- SDK package names;
- SDK function signatures;
- RPC behavior;
- commitment assumptions;
- settlement semantics;
- MPP/x402 behavior;
- environment variables;
- hosted sandbox URLs;
- sponsorship claims.

If a required fact is not verified from current documentation, source code, or a real environment inspection:

**STOP AND REPORT THE BLOCKER.**

Do not silently choose a plausible value.

---

## 1.2 Real-first

The protocol implementation must be real.

The UI may have deterministic demo scaffolding for the physical-service simulation, but every financial/protocol result shown as a blockchain result must be real.

Allowed:

- simulated camera usage;
- deterministic usage increments;
- demo service title;
- demo customer name;
- generated usage timestamps;
- a test session with fixed amounts.

Not allowed:

- simulated Solana transactions;
- simulated channel addresses presented as real;
- fake signatures;
- hard-coded "confirmed" states;
- fake balances presented as chain state;
- a local database pretending to be the payment-channel ledger;
- fake Explorer buttons.

---

## 1.3 Devnet only during development

Do not use real Mainnet money during development or testing.

Preferred network:

**Solana Devnet**

Preferred initial public RPC:

`https://api.devnet.solana.com`

This RPC is for development/testing and is rate-limited. If it is insufficient, use a verified free RPC listed in the current Colosseum resources or official Solana resources.

Every environment value must identify:

- network;
- RPC;
- asset;
- program ID;
- date verified.

---

## 1.4 $0 core path

The core build must remain free.

Allowed:

- Solana Devnet;
- Devnet test SOL;
- verified Devnet test token;
- GitHub;
- GitHub Actions;
- Vercel free tier if adequate;
- official open-source Solana Payment Channels code;
- official open-source TypeScript clients;
- free/public RPC while within limits.

Do not make a paid service a mandatory dependency.

Optional paid/sponsored infrastructure may be considered only if:

1. it is currently available to this project;
2. cost is verified;
3. it is not required for the MVP;
4. the free path remains intact.

---

## 1.5 8 GB PC rule

The developer machine has 8 GB RAM.

Do not design a workflow that repeatedly requires heavy local builds.

Use GitHub Actions for:

- dependency installation when practical;
- lint;
- typecheck;
- unit tests;
- integration tests;
- E2E;
- security checks;
- reproducible protocol tests.

Use the local machine mainly for:

- editing;
- browser work;
- wallet interaction;
- lightweight scripts;
- targeted debugging.

If local protocol execution is unstable because of RAM/toolchain requirements, run the canonical reproducible test in GitHub Actions using the same documented environment and record that fact.

---

# 2. CURRENT EVENT CONTEXT

## 2.1 Competition

**Colosseum Crypto World's Fair**

Current official event page:

https://colosseum.com/worldsfair

The current official page states:

- online competition;
- submissions due October 12, 2026;
- $840,000 in prizes;
- $2.5 million in seed funding opportunity;
- general competition across ecosystems;
- dedicated ecosystem tracks.

Current official developer resources:

https://colosseum.com/worldsfair/resources

Current resource catalog includes:

- Solana;
- JavaScript/TypeScript clients;
- development setup;
- wallets/onboarding;
- RPC providers;
- payments;
- Payment Channels;
- ship/deployment resources.

Do not assume the current submission form requirements remain unchanged. Re-open the official submission portal before final submission.

---

### Implementation amendment — 11 October 2026

This amendment supersedes earlier camera-rental/timer passages in this document where they conflict with the current implementation.

- Service: Groq contract review using the OpenAI-compatible Chat Completions API and default model ID openai/gpt-oss-20b.
- Unit: one successful valid AI review = 1.00 TEST under an explicitly illustrative demo price.
- Cap: the customer chooses 5, 10, 25, or 50 TEST before the wallet signs the channel-open transaction.
- Lifecycle: connect wallet → obtain Devnet test funds if needed → authorize cap → explicitly start service → submit a contract-review request → receive structured Groq output → sign and retain the cumulative voucher off-chain → close → submit latest voucher with settle-and-seal → distribute provider payment and refund.
- Failed or malformed AI responses must not advance the client-visible used amount or return a voucher.
- The live Vercel runtime requires GROQ_API_KEY. A GitHub Actions secret is not automatically available to a Vercel server function.
- Do not send confidential documents. This is not legal advice. The TEST price is not a representation of Groq's token cost.
- The usage amount remains explicitly off-chain until the close transaction is verified. Per-request voucher signatures must never be linked or labeled as Solana transaction signatures.

# 3. PRODUCT LOCK

## 3.1 Name

**UsageBar**

## 3.2 One-line proposition

> **Pay for what you actually use.**

## 3.3 Product category

**Usage-based payment tab**

## 3.4 Primary customer

A customer using a service whose final price depends on measured usage.

## 3.5 Initial demo vertical

**Metered AI / API service**

## 3.6 Initial demo product

**Groq Contract Review**

A real Groq chat-completion request analyzes sample contract text and returns structured fields. This is a document-understanding demonstration, not legal advice or a substitute for a lawyer. The API key stays server-side; the live Vercel runtime must define GROQ_API_KEY. The customer selects a TEST cap and pays one TEST for each successful review under the demo's own pricing rule.

## 3.7 Core problem

Repeated small payments or post-service billing can be awkward when usage changes over time.

UsageBar creates a familiar "open a tab, use the service, close the tab" experience while using an onchain payment-channel ceiling and cumulative signed usage updates.

---

# 4. PRODUCT THESIS

## 4.1 Human explanation

UsageBar works like opening a tab.

You authorize a maximum amount once.

The service is consumed.

The amount used increases.

When the session ends, the final amount is settled.

Anything unused remains available to return to the payer.

---

## 4.2 Technical explanation

The product composes with Solana Payment Channels.

The current official Payment Channels design uses:

- an onchain escrowed spending ceiling;
- cumulative offchain Ed25519 vouchers;
- onchain settlement;
- distribution to the recipient;
- recovery/refund of unused escrow after closure.

Official reference:

https://github.com/solana-foundation/payment-channels

Do not copy protocol behavior from memory. Read the current repository and linked docs before coding.

---

# 5. SPONSOR / TECHNOLOGY WEDGE

## 5.1 Why Solana Payment Channels?

Without Payment Channels, a naive implementation could be:

```text
service usage
→ database record
→ later normal Solana payment
```

With Payment Channels:

```text
onchain ceiling
→ cumulative signed usage
→ one final settlement
→ unused amount recovery
```

The protocol therefore changes the payment model itself.

This is the sponsor wedge.

Do not market this as:

> "We built a payment app on Solana."

Say:

> **"We use Solana Payment Channels to turn a familiar payment tab into a capped, cumulative, onchain-settled usage session."**

---

## 5.2 Counterfactual test

Remove Payment Channels.

Can the product still exist?

**Yes.**

Therefore the product is not allowed to claim that Payment Channels invented the product category.

Instead, explain what disappears without the protocol:

- onchain spending ceiling;
- protocol-level cumulative authorization;
- channel-based settlement;
- offchain voucher progression;
- direct recovery of unused escrow from the channel.

If the exact implementation does not provide one of these, update the claim honestly.

---

# 6. IMPORTANT PROTOCOL DISTINCTION

## 6.1 Do not use x402 `upto` as the core UsageBar model

The current x402 SVM `upto` scheme is documented for a **single metered call**.

UsageBar is a **repeated usage session**.

The current payment-channel repository and related x402 documentation identify:

- `x402 upto` = one metered request;
- MPP `session` / repeated-session flow = many cumulative usage vouchers settled later;
- the underlying Payment Channels program = shared onchain settlement mechanism.

Therefore:

**Primary target:** Payment Channels session behavior / MPP session semantics.

**Do not implement the core product as x402 `upto`.**

Official references to re-check:

- https://github.com/solana-foundation/payment-channels
- https://github.com/x402-foundation/x402
- https://github.com/solana-foundation/solana-com
- https://github.com/solana-foundation/pay-kit

---

# 7. IMPLEMENTATION-CHOICE GATE

Before coding the application, compare two implementation paths.

## Path A — Direct Payment Channels client

Use the official generated TypeScript client directly.

Advantages:

- protocol is visible;
- fewer HTTP-protocol abstractions;
- easiest to explain in a hackathon technical section;
- fewer moving parts.

## Path B — Official MPP session implementation

Use MPP session only if the current official implementation provides the cleanest reliable Devnet path and materially reduces our own protocol code.

Advantages:

- session semantics already modeled;
- official HTTP/payment session machinery;
- cumulative vouchers and session closure are already represented.

Disadvantages:

- potentially more protocol layers than the product actually needs;
- more moving pieces;
- harder to debug if the session layer introduces unrelated behavior.

## Decision rule

Select the path that passes the first real Devnet smoke test with the fewest moving parts.

Do not choose based on fashion.

Record the decision in:

`docs/PROTOCOL_DECISION.md`

---

# 8. VOUCHER-SIGNING DECISION

The current SVM batch-settlement/session specification supports two conceptual voucher modes:

### Client signer

The payer controls the voucher signer.

### Server/operator signer

The client grants an operator an explicit, constrained ability to sign cumulative usage vouchers.

For a smooth human-facing UsageBar UX, do not force the user to manually approve every usage update.

First test whether the current official session/client implementation supports an explicit one-time delegation/operator-signing flow suitable for the demo.

If yes:

- use the official mechanism;
- cap the authorized amount;
- clearly display that the service operator can sign usage vouchers up to the channel ceiling;
- keep the operator key server-side;
- document the exact trust boundary.

If not:

- use client-signed vouchers;
- make the usage model a small number of signed usage milestones;
- do not fake invisible signatures.

Do not create a custom authorization system.

---

# 9. ACTORS

## 9.1 Payer

Customer wallet.

Responsibilities:

- authorize channel funding;
- own the deposit;
- receive unused remainder.

## 9.2 Provider

Service provider.

Responsibilities:

- provide the simulated service;
- record usage;
- produce/participate in valid cumulative voucher progression according to selected protocol mode;
- receive final settlement.

## 9.3 Blockchain program

Solana Payment Channels.

Responsibilities:

- escrow;
- enforce channel rules;
- validate voucher;
- settle;
- distribute;
- refund/recovery according to actual protocol state.

---

# 10. TRUST MODEL

The service event is a real successful Groq API review; the payment mechanism is real on Solana Devnet. The chain does not independently prove that the model ran or that an answer is legally correct.

> **The metered service is real; demo pricing and provider attestation are not trustless.**

The product claim is:

- a successful AI response is one service event;
- the provider signs a cumulative voucher after a valid response;
- the voucher stays off-chain during usage;
- the Payment Channels program enforces the spending ceiling;
- close submits the latest voucher, then distribution pays the provider and returns unused escrow.

The product is **not** claiming:

- on-chain proof of model inference or output quality;
- legal advice or professional legal review;
- a TEST price derived from Groq token costs;
- unlimited free-tier API capacity;
- production guarantees against provider fraud.

---

# 11. USER JOURNEY

## 11.1 Entry

User lands on UsageBar.

Sees:

> Pay for what you actually use.

and:

> Groq Contract Review

with a $50 test ceiling.

## 11.2 Open

User connects wallet.

User authorizes the spending ceiling.

App verifies the real channel exists.

State becomes:

`FUNDED`

## 11.3 Start usage

User selects Start contract review.

State becomes:

`ACTIVE`

## 11.4 Usage changes

The user pastes sample contract text (or uses the supplied sample) and selects Run AI review. Groq returns a structured analysis. If the response is valid and the cap permits another review, the provider signs a new cumulative Ed25519 voucher off-chain. Each successful review adds 1.00 TEST; failed requests do not advance the displayed bill. The UI shows the summary, parties, dates, monetary terms, clauses, potential risks and missing details.

Previous proof-of-concept timer examples below are historical protocol test data, not claims about the new live service.

Historical usage figures:

```text
2.40
4.80
7.20
9.80
12.40
```

The app shows the latest accepted cumulative amount.

## 11.5 Close

User selects:

`CLOSE & SETTLE`

The application moves to:

`FINALIZING`

## 11.6 Settlement

Protocol performs the verified final settlement.

## 11.7 Final result

App shows:

```text
Actual usage   12.40
Returned       37.60
Status         SETTLED
```

## 11.8 Proof

The app shows real transaction signatures and Explorer links.

---

# 12. PRODUCT STATE MACHINE

Primary application state:

```text
READY
  ↓
OPENING
  ↓
FUNDED
  ↓
ACTIVE
  ↓
FINALIZING
  ↓
SETTLED
```

## READY

No active channel.

Allowed action:

`OPEN TAB`

## OPENING

Wallet transaction is being requested or submitted.

No success claim yet.

## FUNDED

The channel exists and the deposit has been verified onchain.

Required proof:

- channel address;
- opening transaction;
- chain readback.

## ACTIVE

The channel remains usable and cumulative usage can progress.

## FINALIZING

The last usage voucher is being finalized and the channel is being settled/sealed according to the selected protocol flow.

No final result is shown until chain state is read back.

## SETTLED

Final settlement state is verified.

The application must be able to show:

- final cumulative usage;
- provider payment/distribution;
- unused remainder returned/recoverable;
- transaction proof.

---

# 13. PROTOCOL STATE MAPPING

Do not confuse product state with protocol state.

Current official Payment Channels documentation identifies a lifecycle including:

```text
Open
  ↓
Sealed / Closing
  ↓
Distributed
  ↓
Reclaim
```

with operations including:

- open;
- settle;
- settle_and_seal;
- top_up;
- request_close;
- seal;
- distribute;
- withdraw_payer;
- reclaim.

The application may compress these into the simpler product state machine.

But all displayed final states must be derived from actual protocol state.

---

# 14. FINANCIAL MODEL

Never use floating-point values for settlement.

Use integer atomic units internally.

Conceptual example:

```text
authorized atomic units = 50_00
final usage atomic units = 12_40
unused = 37_60
```

The exact decimals depend on the verified asset.

Do not assume 2 decimals until the actual token mint is verified.

## Required reconciliation

```text
authorized = settled + unused
```

For the example:

```text
50.00 = 12.40 + 37.60
```

This is a product example, not a hard-coded protocol assumption.

---

# 15. CHANNEL CONFIGURATION DISCOVERY

The implementation must discover and document the actual channel parameters required by the current protocol.

At minimum investigate:

- payer;
- authorized signer;
- payee;
- final recipient;
- mint;
- token program;
- deposit amount;
- channel salt;
- open slot;
- withdrawal/grace period;
- PDA derivation;
- distribution hash;
- any required fee-payer/rent-payer role;
- any operator delegation role if server-signing mode is used.

Do not hard-code these until verified.

---

# 16. ASSET DISCOVERY

The core requires one real Devnet asset compatible with the selected Payment Channels implementation.

Requirements:

- actual Devnet mint;
- verified token program;
- verified decimals;
- actual test balance;
- compatible with the current selected implementation;
- no paid purchase required.

Preferred conceptual UX:

```text
$50.00
```

But the token should only be labeled "USD", "USDC", or similar if the actual asset is that asset and that label is truthful.

Do not create a fake stablecoin and call it USDC.

If only a non-dollar test token is available:

- use an honest generic label;
- e.g. `50 TEST`;
- preserve product behavior;
- do not fake fiat equivalence.

---

# 17. WALLET

Use the current Solana Wallet Standard-compatible frontend path recommended by current official resources.

Do not assume Phantom is mandatory.

The current Colosseum resource catalog lists wallet/onboarding resources and identifies Wallet Standard / Kit as the current frontend direction.

The user should be able to:

- connect;
- inspect selected network;
- sign the channel deposit;
- understand when a wallet signature is required.

Do not ask for:

- seed phrase;
- private key;
- secret recovery phrase.

Never store user private keys.

---

# 18. SERVER-SIDE KEYS

If server/operator voucher signing is selected:

- use a dedicated low-value Devnet operator key;
- store the private key only in server environment variables;
- never expose it to the client;
- never commit it;
- never use a real Mainnet wallet;
- document its exact role;
- ensure it cannot redirect funds beyond protocol-defined authority.

If direct client-signed vouchers are selected:

- no provider private key is needed for voucher signing.

---

# 19. API DESIGN

Keep the API small.

Possible conceptual routes:

```text
GET  /api/config
POST /api/channel/open
POST /api/usage
POST /api/session/close
GET  /api/session/:id
GET  /api/proof/:id
```

Exact routes may differ.

Do not build a generic enterprise API.

## `/api/channel/open`

Should return real transaction-building or transaction-state information according to the chosen wallet flow.

## `/api/usage`

Must never claim onchain settlement.

It records or processes the cumulative usage update according to the chosen protocol.

## `/api/session/close`

Must:

1. verify current application state;
2. obtain the latest accepted cumulative usage;
3. build/submit the real settlement path;
4. wait for the required confirmation;
5. read final protocol state;
6. only then return `SETTLED`.

## `/api/proof`

Returns only verified evidence.

---

# 20. IDEMPOTENCY / RETRY

Settlement is financially sensitive.

Never use:

```text
submit settlement
if timeout:
submit again
```

Instead:

```text
submit
  ↓
uncertain response?
  ↓
query actual chain state
  ↓
already settled?
    yes → return verified result
    no  → determine whether retry is safe
```

Before every settlement retry, inspect the actual protocol state.

A double-click must not create an unintended duplicate effect.

A browser refresh must not restart the session blindly.

---

# 21. SIGNED VOUCHER RULES

Every cumulative voucher must satisfy:

```text
current_amount > previous_amount
current_amount <= authorized_ceiling
```

The exact strict/non-strict comparison must follow the actual protocol rules.

Test:

- valid cumulative increase;
- equal-value voucher if protocol permits or rejects it;
- lower value;
- above ceiling;
- wrong signer;
- wrong channel ID;
- stale/invalid expiry where applicable;
- malformed signature.

Do not assume the application is the final authority.

The onchain program is the protocol authority.

---

# 22. SECURITY INVARIANTS

## INV-01 — Ceiling

Final claimed/settled amount cannot exceed the authorized deposit.

## INV-02 — Monotonic voucher

A newer cumulative voucher cannot reduce the accepted cumulative amount.

## INV-03 — Correct signer

Only the protocol-authorized voucher signer can advance the voucher state.

## INV-04 — Correct channel

A voucher for another channel cannot be applied.

## INV-05 — Correct asset

A channel cannot settle using a different mint/token program than its configured asset.

## INV-06 — Correct recipient

Settlement distribution must match the channel's configured distribution.

## INV-07 — Final proof

The UI cannot show `SETTLED` before verified chain state.

## INV-08 — Return reconciliation

Where the channel is sealed and distributed, the payer's unused remainder is correctly accounted for according to actual protocol semantics.

## INV-09 — No fake balance

A locally calculated "remaining" value is not represented as an actual refund until chain state confirms it.

## INV-10 — No blind retry

Settlement retries must inspect state first.

## INV-11 — No client authority escalation

Client-controlled input must never supply an unrestricted signer, payer authority, payee, or server private key.

## INV-12 — Network binding

The app must not silently send transactions to a different network than the one shown to the user.

## INV-13 — Asset binding

The app must verify the actual mint and token program used by the channel.

---

# 23. SECURITY ADVERSARIAL TEST MATRIX

| Test | Expected |
|---|---|
| voucher above ceiling | rejected |
| voucher below previous watermark | rejected |
| wrong signer | rejected |
| wrong channel ID | rejected |
| malformed voucher | rejected |
| wrong mint | rejected |
| wrong recipient distribution | rejected |
| duplicate settlement | no unintended double payout |
| settlement after sealed state | protocol-defined rejection/behavior |
| client attempts different payer | rejected by app/protocol |
| fake proof request | cannot produce verified proof |
| refresh after settlement | reads actual state |
| network timeout | state-aware recovery |
| double-click close | idempotent/safe |

---

# 24. CANONICAL DEMO NUMBERS

The demo scenario is:

```text
Service:
Groq Contract Review

Maximum:
50.00 test units

Usage:
2.40
4.80
7.20
9.80
12.40

Final:
12.40

Unused:
37.60
```

Do not assume the UI's `$` symbol if the actual test token is not a dollar-denominated asset.

The easiest truthful UX is:

- if verified stablecoin test asset: `$50.00`;
- otherwise: `50.00 TEST`.

---

# 25. CANONICAL RUN

The final reproducible run should be named:

`canonical-usagebar-devnet-001`

Expected conceptual sequence:

```text
1. Connect payer wallet
2. Confirm Devnet
3. Acquire test SOL if needed
4. Verify test asset
5. Open channel
6. Read channel back
7. Confirm channel is Open
8. Start session
9. Produce usage voucher 1
10. Verify voucher
11. Produce voucher 2
12. Verify voucher
13. Produce voucher 3
14. Verify voucher
15. Produce voucher 4
16. Verify voucher
17. Produce voucher 5
18. Verify voucher
19. Close session
20. Settle/seal using actual protocol
21. Verify final state
22. Distribute if required
23. Verify provider result
24. Verify payer unused remainder
25. Record all transaction signatures
26. Generate final proof
```

The exact number of vouchers can be reduced if required to preserve reliability. Do not create fake voucher events merely to hit five.

---

# 26. EVIDENCE STRUCTURE

Use:

```text
evidence/
  canonical-run/
    01-environment.json
    02-channel-open.json
    03-voucher-01.json
    04-voucher-02.json
    05-voucher-03.json
    06-voucher-04.json
    07-voucher-05.json
    08-close.json
    09-settlement.json
    10-distribution.json
    11-final-state.json
    12-verification.json
```

If a protocol step does not exist in the selected implementation, do not fabricate a file for it.

---

# 27. EVIDENCE CONTENT

Every evidence artifact should include where relevant:

- network;
- verified date;
- program ID;
- asset mint;
- token program;
- payer public key;
- provider public key if relevant;
- channel address;
- transaction signature;
- block/slot if available;
- observed protocol state;
- expected state;
- verification method;
- Explorer link;
- claim status.

Never include:

- private keys;
- seed phrases;
- secrets;
- access tokens;
- API credentials.

---

# 28. CLAIM STATUS

Create:

`docs/CLAIM_STATUS.md`

Use only:

```text
PROVEN
OBSERVED
INFERRED
UNVERIFIED
```

Example:

```text
Payment Channels program exists:
PROVEN

UsageBar can open a channel on Devnet:
UNVERIFIED

UsageBar can settle a cumulative voucher:
UNVERIFIED

UsageBar can recover unused funds:
UNVERIFIED

Mainnet production deployment:
UNVERIFIED

Commercial adoption:
UNVERIFIED
```

Update these after real tests.

---

# 29. VERIFIER

Create:

`tools/verify-canonical-run.ts`

Purpose:

Read evidence.

Verify:

- network matches expected network;
- program matches verified program;
- asset matches verified asset;
- transaction signatures are syntactically valid;
- transactions exist on the selected cluster;
- required transactions succeeded;
- protocol state matches expected final state;
- amounts reconcile;
- no fake proof values exist.

The verifier should fail loudly.

Example:

```text
CANONICAL RUN VERIFICATION

Network: PASS
Program: PASS
Asset: PASS
Channel open: PASS
Voucher progression: PASS
Settlement: PASS
Distribution: PASS
Unused remainder: PASS
Final state: PASS

RESULT: PASS
```

Do not make the verifier trust the evidence JSON alone.

Where practical, it should query Solana.

---

# 30. OBSERVABILITY

The app should maintain a small session timeline:

```text
10:14:01  channel requested
10:14:04  channel confirmed
10:15:11  usage voucher accepted: 2.40
10:15:30  usage voucher accepted: 4.80
10:16:12  usage voucher accepted: 7.20
10:17:05  usage voucher accepted: 9.80
10:18:41  usage voucher accepted: 12.40
10:19:10  closing
10:19:13  settlement confirmed
10:19:15  final state read
```

These timestamps may be application observations.

They must not be confused with blockchain timestamps unless read from the chain.

---

# 31. LOCAL DEVELOPMENT

Initial local setup:

```text
usagebar/
```

Use a current maintained Next.js TypeScript starter.

Do not start by adding every dependency.

First create:

```text
package.json
tsconfig.json
next.config.*
app/
lib/
tests/
docs/
evidence/
tools/
.github/
```

Then add only the dependencies required by the verified protocol path.

---

# 32. RECOMMENDED CLIENT STACK

Default direction:

- TypeScript;
- Next.js;
- React;
- `@solana/kit` or the currently recommended official TypeScript client;
- Wallet Standard-compatible wallet integration;
- official generated Payment Channels TypeScript client;
- Playwright for E2E;
- Vitest or the smallest suitable test runner for unit tests.

Do not install old `@solana/web3.js` just because a random tutorial uses it.

If an official Payment Channels generated client still depends on a legacy package:

- isolate the legacy dependency;
- document why it exists;
- avoid spreading legacy APIs throughout the application.

---

# 33. DEPENDENCY POLICY

Every dependency must pass:

1. Is it required?
2. Is it maintained?
3. Is it free?
4. Is it compatible with current Node/Next.js?
5. Is it compatible with the current Solana client path?
6. Can it run in Vercel if required?
7. Does it expose secrets or require a paid service?
8. Does it create an unnecessary architecture layer?

If the answer is no to requirement/maintenance/free, do not add it.

---

# 34. UI DESIGN LOCK

## Product world

**The Open Tab**

## Why

People already understand the tab metaphor.

## Visual adjectives

- physical;
- precise;
- calm;
- tactile.

## Primary visual object

**Usage Tab**

## Signature interaction

`CLOSE & SETTLE`

## Signature mechanism

`AUTHORIZED → USED → RETURNED`

---

# 35. DESIGN TOKENS

## Canvas

Warm off-white.

Concept target:

`#F6F5F0`

## Ink

Near-black.

Concept target:

`#171816`

## Secondary text

Concept target:

`#696A64`

## Border

Concept target:

`#D8D7D0`

## Active accent

Signal orange.

Concept target:

`#D97532`

## Success

Deep green.

Concept target:

`#28634A`

## Warning

Warm amber.

Concept target:

`#B7791F`

## Error

Deep red.

Concept target:

`#A43D3D`

These are starting design tokens, not protocol facts.

---

# 36. TYPOGRAPHY

Display:

**Fraunces**

Interface:

**IBM Plex Sans**

Data:

**IBM Plex Mono**

If a font cannot be safely used in the deployment environment, choose a close free replacement and record the substitution.

No font file should be committed unless licensing/provenance is clear.

---

# 37. FIRST VIEWPORT CONTRACT

The first viewport must visibly contain:

1. product proposition;
2. Usage Tab;
3. authorized amount;
4. current used amount;
5. current state;
6. primary action.

The first viewport must not lead with:

- architecture;
- blockchain jargon;
- feature grids;
- fake metrics;
- team bio;
- generic Web3 artwork;
- tokenomics;
- AI claims.

---

# 38. LANDING PAGE

## Hero

Headline:

> **Pay for what you actually use.**

Subcopy:

> Open one payment tab. Let usage build the bill. Settle once at the end.

Primary CTA:

`OPEN A TAB`

Secondary small technical note:

`Built with Solana Payment Channels`

Hero visual:

Actual Usage Tab component.

---

# 39. USAGE TAB

Concept:

```text
GROQ CONTRACT REVIEW

CAP (AUTHORIZED)        10.00 TEST
USED (OFF-CHAIN)         2.00 TEST
CAP LEFT (NOT REFUNDED)  8.00 TEST

███────────────────────

2 successful AI reviews

ACTIVE

[ RUN AI REVIEW · 1.00 TEST ]
[ CLOSE & SETTLE ]
```

Do not hard-code `37` unless 37 actual updates occurred.

---

# 40. USAGE TRAIL

Use cumulative amounts.

Example:

```text
USAGE TRAIL

09:14     2.40
09:27     4.80
09:43     7.20
10:03     9.80
10:31    12.40
```

Mark the update as:

- signed;
- accepted;
- observed;

according to actual evidence.

---

# 41. SETTLEMENT TRANSITION

When the user clicks:

`CLOSE & SETTLE`

show:

```text
CLOSING TAB

Final usage
12.40

Verifying final voucher...
Sealing payment channel...
Settling...
```

Do not show all three lines as successful unless each step actually happens.

The system can display a currently executing step.

---

# 42. FINAL RECEIPT

```text
TAB CLOSED

ACTUAL USAGE              12.40
RETURNED                  37.60

✓ SETTLED

SETTLEMENT PROOF

OPEN       <signature>
SETTLE     <signature>
DISTRIBUTE <signature>

[ VIEW ON EXPLORER ]
```

Only show transactions that actually exist.

---

# 43. PROOF SCREEN

The proof screen should explain:

### What was authorized?

50.00

### What was consumed?

12.40

### What was returned?

37.60

### What happened onchain?

Real signatures.

### Where can I verify?

Explorer.

Technical details may be collapsible.

---

# 44. ERROR UX

Never use only:

> Something went wrong.

Use:

> **Settlement was not confirmed.**

Then:

- current verified state;
- exact known problem;
- safe retry action;
- proof link if a partial transaction actually exists.

---

# 45. LOADING UX

No fake progress bar.

The UI may show:

> Waiting for wallet signature...

> Waiting for confirmation...

> Reading channel state...

Each message must correspond to a real operation.

---

# 46. EMPTY STATE

```text
NO ACTIVE TAB

Open a usage tab to begin.

[ OPEN TAB ]
```

No fake historical metrics.

---

# 47. ANTI-AI UI RULES

Do not use:

- purple/blue AI gradients;
- glassmorphism;
- neon glow;
- giant bento grids;
- floating 3D coins;
- fake crypto illustrations;
- giant rounded-card walls;
- random charts;
- fake transaction activity;
- generic "Web3 dashboard" sidebars;
- excessive pills;
- generic AI copy.

The visual identity must come from:

- Usage Tab;
- usage meter;
- authorized/used/returned relationship;
- Close & Settle transition.

---

# 48. MOBILE

On mobile, keep visible:

- headline;
- service;
- authorized;
- used;
- remaining;
- state;
- usage meter;
- Close & Settle;
- final proof.

Do not shrink a desktop dashboard until it becomes unusable.

---

# 49. ACCESSIBILITY

Required:

- keyboard navigation;
- visible focus states;
- sufficient contrast;
- semantic button labels;
- status announcements for important asynchronous state changes;
- reduced-motion support;
- accessible amount formatting.

Do not use color alone to communicate:

- active;
- error;
- settled;
- warning.

---

# 50. DEMO STATE MACHINE IN UI

The UI should make the state transitions obvious:

```text
READY
↓
OPENING
↓
FUNDED
↓
ACTIVE
↓
FINALIZING
↓
SETTLED
```

The current state should always be understandable without opening developer tools.

---

# 51. TEST PLAN

## 51.1 Unit tests

Test:

- amount arithmetic;
- unit conversion;
- voucher monotonicity;
- ceiling enforcement;
- state transitions;
- proof formatting;
- reconciliation.

## 51.2 Protocol integration tests

Test real Devnet where appropriate:

- open;
- voucher;
- settlement;
- distribution;
- refund/recovery.

## 51.3 Adversarial tests

Test the matrix in Section 23.

## 51.4 E2E

One real canonical Devnet run.

## 51.5 UI tests

Test:

- wallet not connected;
- opening;
- funded;
- active;
- closing;
- settled;
- failure;
- refresh;
- retry.

---

# 52. TEST PYRAMID

Priority:

```text
unit
  ↓
protocol integration
  ↓
adversarial
  ↓
E2E
```

Do not repeatedly run expensive full E2E tests while unit logic is still broken.

---

# 53. E2E EXPECTED RESULT

A full run should be able to prove:

```text
Wallet connected
→ channel opened
→ channel verified
→ cumulative usage advanced
→ session closed
→ final amount settled
→ unused amount recovered
→ final state read
→ proof displayed
```

---

# 54. GITHUB ACTIONS

Create workflows for:

## CI

- install;
- lint;
- typecheck;
- unit tests;
- build.

## Protocol

- targeted integration tests where environment permits.

## E2E

- only when credentials/environment are securely configured.

## Security

- secret scanning;
- dependency audit if practical;
- no private files.

Do not put private keys directly into workflow YAML.

Use GitHub encrypted secrets only when necessary.

---

# 55. PUBLIC REPOSITORY SAFETY

Never commit:

`.env`

`.env.local`

wallet keypairs

seed phrases

private keys

RPC credentials

personal notes

browser profiles

credential caches

temporary local dumps

machine-specific paths

Screenshots containing secrets

---

# 56. LOCAL / PUBLIC FILE BOUNDARY

Public:

```text
app/
components/
lib/
tests/
tools/
docs/
README.md
.github/
```

Local-only:

```text
.env.local
local-wallet/
private-keys/
debug dumps/
machine notes/
```

Use `.gitignore`.

Before every public push:

```text
git status
git diff
git diff --cached
```

Then inspect.

---

# 57. COST MATRIX

Create:

`docs/COST_MATRIX.md`

Columns:

- dependency;
- purpose;
- plan;
- current cost;
- quota;
- account requirement;
- credential requirement;
- expiry/credit risk;
- verified date;
- official source;
- mandatory/optional.

Gate:

```text
ZERO-COST CORE PATH: PASS
```

Only after all mandatory dependencies have a verified free path.

---

# 58. PROTOCOL DISCOVERY ARTIFACT

Create:

`docs/PROTOCOL_DISCOVERY.md`

For every protocol fact:

```text
FACT:
SOURCE:
URL:
VERIFIED DATE:
NETWORK:
VERSION/COMMIT:
CONFIDENCE:
IMPACT:
```

Do not copy large amounts of external source text into the repository.

Summarize the relevant technical fact.

---

# 59. PROTOCOL DECISION ARTIFACT

Create:

`docs/PROTOCOL_DECISION.md`

Required sections:

```text
Chosen path
Why chosen
Alternatives considered
Why alternatives were rejected
Network
Program
Asset
Signer model
Wallet model
Settlement model
Known limitations
```

---

# 60. ARCHITECTURE ARTIFACT

Create:

`docs/ARCHITECTURE.md`

Minimum diagram:

```text
Browser
  ↓
UsageBar Next.js
  ↓
Solana client / protocol adapter
  ↓
Payment Channels
  ↓
Solana Devnet
```

If a server signer exists:

```text
Browser
  ↓
Next.js API
  ↓
provider signing boundary
  ↓
Payment Channels
```

Clearly explain that the provider private key never reaches the browser.

---

# 61. SECURITY ARTIFACT

Create:

`docs/SECURITY.md`

Include:

- trust model;
- signer model;
- wallet model;
- ceiling protection;
- voucher validation;
- replay protection;
- retry safety;
- key storage;
- network binding;
- asset binding;
- known limitations.

---

# 62. LIMITATIONS ARTIFACT

Create:

`docs/LIMITATIONS.md`

Likely limitations:

- simulated physical usage;
- Devnet/test asset;
- public RPC limits;
- hackathon-scale environment;
- no production payment custody;
- no real merchant integration;
- no real camera telemetry;
- provider/operator trust assumptions if server-signed vouchers are used.

Only list limitations that actually remain.

---

# 63. ASSET PROVENANCE

Create:

`docs/ASSET_PROVENANCE.md`

Track:

- fonts;
- icons;
- images;
- logos;
- screenshots;
- source;
- license/permission;
- whether asset is generated;
- whether asset is original.

Prefer no external image assets unless they materially improve the product.

---

# 64. FIRST-VIEWPORT TEST

Before final UI freeze:

Ask a stranger:

1. What is this?
2. What is the customer paying for?
3. What does the 50.00 represent?
4. What does "used" mean?
5. What happens when I close the tab?

Pass target:

- product recognized within about 5 seconds;
- core flow understood within about 30 seconds.

Record test results in:

`docs/UX_TEST.md`

Do not manufacture positive answers.

---

# 65. ANTI-AI TEST

Remove:

- logo;
- product name.

Can a judge still identify:

- payment tab;
- usage meter;
- authorized/used/returned;
- Close & Settle behavior?

If no:

**REDESIGN.**

---

# 66. VISUAL QUALITY GATE

Score each criterion 0–2:

| Criterion | Target |
|---|---:|
| Product clarity | 2 |
| Product-specific identity | 2 |
| Technical mechanism visible | 2 |
| Information hierarchy | 2 |
| Typography | 2 |
| Spacing/density | 2 |
| Signature interaction | 2 |
| State coverage | 2 |
| Motion | 1–2 |
| Mobile | 2 |
| Technical honesty | 2 |
| Judge proof | 2 |

Target:

**20/24 minimum**

A zero in:

- product clarity;
- visual identity;
- technical mechanism;
- technical honesty

is a redesign trigger.

---

# 67. DEMO SCRIPT

## 0–5 sec

Show product.

Say:

> "UsageBar is a payment tab for services you pay by usage."

## 5–15 sec

Open a $50 test tab.

Say:

> "The customer authorizes a maximum once."

## 15–30 sec

Show usage increasing.

Say:

> "Usage accumulates through signed updates instead of becoming a separate onchain payment every time."

## 30–45 sec

Close.

Show final settlement.

## 45–53 sec

Show:

```text
12.40 settled
37.60 returned
```

## 53–60 sec

Show real proof.

Say:

> "The final settlement is verifiable on Solana."

Then stop.

---

# 68. THREE-MINUTE PITCH STRUCTURE

Colosseum's current official site says the submission is treated as a pitch to the venture fund/investors/accelerator and asks for product and business context.

Use:

## 0:00–0:20 — Hook

> Pay for what you actually use.

## 0:20–0:45 — Problem

Usage-based services are awkward when every tiny event is separately settled or when the final bill is opaque.

## 0:45–1:15 — Product

Show UsageBar.

## 1:15–2:00 — Live demo

Open → use → close → settle.

## 2:00–2:20 — Why Solana

Explain Payment Channels.

## 2:20–2:40 — Business

Potential initial customers:

- equipment rental;
- time-based services;
- metered services;
- compute/data services.

Do not claim validated market demand unless evidence is collected.

## 2:40–3:00 — Proof + close

Show real transactions.

Close:

> One tab. Many usage updates. One final settlement.

---

# 69. SUBMISSION COPY

## One-line

> UsageBar is a usage-based payment tab that lets customers authorize a spending ceiling once, pay only for actual cumulative usage, and recover the unused remainder.

## Short description

> UsageBar brings the familiar idea of opening a service tab to crypto-native payments. A customer selects a TEST spending cap once, then uses a Groq-powered contract-review service. Each successful AI review costs 1.00 TEST under the demo pricing rule and adds a cumulative Ed25519 voucher off-chain. When the customer closes the tab, UsageBar submits the latest voucher, settles the channel, pays the used amount, and returns the unused balance. The API key stays server-side; this is a document-understanding demo, not legal advice. The mechanism is powered by Solana Payment Channels rather than a custom payment-channel contract.

Only call the remainder "returned" if the actual protocol run proves it.

---

# 70. NOVELTY STATEMENT

Use:

> We are not claiming to invent payment tabs or usage billing. The product innovation is applying Solana's Payment Channels primitive to a simple human-facing usage session: one capped authorization, cumulative signed usage, and one final onchain settlement instead of a separate payment for each usage event.

This is deliberately honest.

---

# 71. WHY SOLANA STATEMENT

> UsageBar is built around Solana Payment Channels because the protocol provides the core behavior we need: an onchain spending ceiling, cumulative signed usage vouchers, onchain settlement, and recovery of unused escrow according to channel state.

Cite/link the official Payment Channels repository in the README.

---

# 72. WHY NOT A DATABASE?

Answer:

> A database can record usage, but it does not itself provide the payment-channel settlement semantics. UsageBar uses the channel to establish the onchain spending boundary and final settlement, while usage updates can progress without a blockchain transfer for every individual event.

Do not claim stronger properties than the verified protocol actually provides.

---

# 73. WHY NOT PAY AFTER?

Answer:

> A postpaid database invoice can work for simple businesses. UsageBar is targeting services where the customer wants a defined maximum exposure while actual usage is still being measured.

---

# 74. KNOWN COMPETITION LANGUAGE

Do not say:

> "No competitors."

Do not say:

> "World's first."

Instead:

> "The category of metered billing and payment tabs already exists. UsageBar focuses on a specific crypto-native implementation using Solana Payment Channels."

Current CWF already contains other payment-oriented products, so category-level novelty claims are unsafe.

---

# 75. PRODUCT EXTENSION ROADMAP

Only after MVP proof.

Possible future users:

- equipment rental;
- EV charging;
- shared workspaces;
- specialist machines;
- usage-priced data;
- compute;
- APIs;
- other metered digital services.

Do not implement these now.

---

# 76. DO NOT BUILD

Do not build:

- AI agents;
- token launch;
- exchange;
- DeFi;
- lending;
- NFT system;
- loyalty token;
- marketplace;
- camera marketplace;
- physical hardware;
- oracle network;
- custom payment-channel smart contract;
- multi-chain bridge;
- analytics dashboard;
- social features;
- enterprise admin suite;
- generic billing platform;
- subscription engine;
- multi-currency accounting;
- fiat onramp.

The MVP is one usage session.

---

# 77. PAGE/SURFACE SCOPE

Minimum product surfaces:

## 1. Landing

Product explanation + live Usage Tab.

## 2. Session

Actual live usage session.

## 3. Settlement

Closing/final result.

## 4. Proof

Verified transaction evidence.

No more major surfaces until the core flow is proven.

---

# 78. COMPONENTS

Use product-specific names.

Required conceptual components:

- `UsageTab`
- `UsageMeter`
- `SpendingCeiling`
- `UsageTrail`
- `SessionStatus`
- `CloseTabAction`
- `SettlementReceipt`
- `ReturnAmount`
- `ProofReference`
- `NetworkBadge`
- `WalletControl`

Avoid visible generic names such as:

- `Card`
- `StatCard`
- `InfoCard`
- `DashboardCard`
- `Web3Card`

---

# 79. DATA MODEL

Conceptual session object:

```ts
type UsageSession = {
  id: string
  network: string
  payer: string
  provider: string
  channelId?: string
  assetMint: string
  assetDecimals: number
  authorizedAtomicAmount: bigint
  acceptedCumulativeAtomicAmount: bigint
  state:
    | "READY"
    | "OPENING"
    | "FUNDED"
    | "ACTIVE"
    | "FINALIZING"
    | "SETTLED"
    | "ERROR"
  openedAt?: string
  updatedAt?: string
  finalSettlementSignature?: string
}
```

Use the actual repository/client types wherever possible.

Do not create a local shadow ledger that becomes the source of truth.

---

# 80. SOURCE OF TRUTH

Priority:

1. verified Solana chain state / verified transaction;
2. official Solana Payment Channels implementation;
3. official Solana documentation;
4. project product specification;
5. application memory/state;
6. UI assumptions.

Never let a lower source override a higher source.

---

# 81. DATABASE POLICY

Do not add a database unless it is genuinely required.

For the MVP, the chain and in-memory/session state should be sufficient where possible.

If the chosen session implementation requires persistent server-side session storage for replay protection or settlement watermarking:

- use the smallest acceptable solution;
- document why;
- verify Vercel compatibility;
- keep the chain as the financial source of truth.

Do not build Postgres merely because a SaaS tutorial uses it.

---

# 82. VERCEL

Vercel is a deployment target for the application, not the protocol ledger.

Verify:

- Node/runtime support;
- server request duration;
- outbound RPC access;
- environment variables;
- private key handling;
- transaction confirmation timing;
- retries;
- no persistent connection assumptions.

Before declaring production app behavior, test:

```text
Browser
→ Vercel
→ Solana
→ real transaction
→ readback
→ browser result
```

---

# 83. VERCEL SAFETY

Never expose:

- private keys;
- server signer secret;
- private RPC credentials.

Never create:

```text
NEXT_PUBLIC_PRIVATE_KEY
```

or anything equivalent.

All public client environment values must be non-secret.

---

# 84. GITHUB BRANCH STRATEGY

Use one main branch plus short feature branches if helpful.

Suggested commits:

```text
chore: scaffold UsageBar
docs: record protocol discovery
feat: add verified wallet connection
feat: add real channel open flow
feat: add cumulative usage flow
feat: add settlement flow
feat: add proof surface
feat: add UsageBar visual system
test: add protocol adversarial coverage
docs: add canonical run
chore: final security audit
```

Keep commits coherent.

---

# 85. IMPLEMENTATION PHASES

## Phase 0 — Repo hygiene

Output:

- clean Next.js TypeScript app;
- README skeleton;
- `.gitignore`;
- CI skeleton;
- docs structure.

Gate:

- no secrets;
- install works;
- typecheck works.

## Phase 1 — Protocol discovery

Output:

- `PROTOCOL_DISCOVERY.md`;
- `PROTOCOL_DECISION.md`;
- exact current client/version choice;
- exact network/program/asset plan.

Gate:

- every critical protocol fact verified.

## Phase 2 — Wallet + network

Output:

- Wallet Standard connection;
- Devnet network indicator;
- test SOL balance check.

Gate:

- real wallet connected.

## Phase 3 — Payment Channel smoke test

Output:

- minimal CLI/script;
- real open transaction;
- channel readback.

Gate:

- real channel exists on Devnet.

## Phase 4 — Voucher spike

Output:

- one valid cumulative voucher;
- verification;
- second cumulative voucher.

Gate:

- real voucher progression works.

## Phase 5 — Settlement spike

Output:

- real close/settle;
- final channel state;
- distribution/refund/recovery proof.

Gate:

- real money-flow behavior on Devnet.

## Phase 6 — Security/adversarial

Output:

- adversarial tests;
- retry safety;
- protocol boundary tests.

Gate:

- no critical unresolved exploit in MVP path.

## Phase 7 — Core application

Output:

- real session page;
- real state machine;
- real protocol adapter.

Gate:

- complete E2E flow works.

## Phase 8 — Visual implementation

Output:

- UsageBar design system;
- landing;
- Usage Tab;
- state transitions;
- mobile.

Gate:

- visual score ≥20/24.

## Phase 9 — Evidence package

Output:

- canonical run;
- verifier;
- screenshots;
- claim status;
- limitations;
- cost matrix.

Gate:

- independent verification passes.

## Phase 10 — Demo/submission

Output:

- demo video;
- final README;
- submission copy;
- final link;
- final audit.

Gate:

- no NO-GO item remains.

---

# 86. PHASE GATE POLICY

A phase is `PASS` only when its behavior is proven.

Allowed status:

`PASS`

`BLOCKED`

`FAILED`

If blocked:

- stop;
- explain blocker;
- show exact missing fact;
- give the user the exact action required;
- do not continue by inventing a substitute.

---

# 87. BLOCKER REPORT FORMAT

Use:

```text
PHASE:
STATUS: BLOCKED

BLOCKER:
<one sentence>

WHAT IS UNKNOWN:
<exact fact>

WHY IT MATTERS:
<one sentence>

SOURCE CHECKED:
<URL/file/repository>

WHAT I NEED FROM THE USER:
<exact action, only if necessary>

SAFE NEXT STEP:
<what can continue without guessing>
```

Do not produce a long wall of technical excuses.

---

# 88. PHASE REPORT FORMAT

At the end of every phase:

```text
PHASE:
STATUS:
COMMIT:
FILES CHANGED:
DEPENDENCIES:
TESTS:
LIVE EVIDENCE:
PROTOCOL FACTS:
SECURITY FINDINGS:
KNOWN LIMITATIONS:
BLOCKERS:
NEXT PHASE:
```

---

# 89. CURRENT FIRST TASK

The first task after reading this file is **NOT** to design the website.

Do this:

## Task A

Inspect current official Payment Channels repository.

## Task B

Inspect the current official generated TypeScript client.

## Task C

Inspect current session/MPP documentation.

## Task D

Verify the current Devnet deployment.

## Task E

Verify one usable Devnet token.

## Task F

Write the protocol decision.

## Task G

Build the smallest real open-channel smoke test.

Do not proceed to the polished app until the smoke test passes.

---

# 90. TECHNICAL DISCOVERY QUESTIONS

The coding agent must answer all of these before Phase 3 closes:

### Protocol

- What is the current canonical Payment Channels program ID for our selected network?
- Is the program actually deployed on Devnet now?
- What current package exposes the TypeScript client?
- What current commit/version is used?
- What exact instruction performs open?
- What exact instruction performs settlement?
- What exact instruction performs sealed distribution/refund?
- What exact state read proves the channel is open?
- What exact state read proves final settlement?
- How is the channel PDA derived?
- What accounts are required?

### Voucher

- Who signs in our selected implementation?
- What is signed?
- Is the amount cumulative?
- Is there expiry?
- What proves the voucher belongs to the channel?
- How is the signature verified?

### Asset

- Which Devnet mint works?
- What is its token program?
- What are its decimals?
- How do we obtain test balance?

### Wallet

- What current Wallet Standard integration is recommended?
- Can the payer sign the open transaction?
- Does the app require further user signatures during the session?

### Server

- Does the provider need a signer?
- If yes, what exact authority does it have?
- What must be stored server-side?
- Is an explicit operator delegation required?

### Settlement

- What exact operation closes the session?
- What exact operation pays the provider?
- What exact operation returns unused funds?
- What chain state proves each effect?

### Hosting

- Can Vercel reach the required RPC?
- How long does the confirmation take?
- Does server-side signing work in the chosen runtime?

Every answer needs evidence.

---

# 91. PROTOCOL READINESS SCORECARD

Score:

| Area | PASS condition |
|---|---|
| Program | verified |
| Devnet | verified |
| Client | verified |
| Asset | verified |
| Wallet | verified |
| Open | real tx |
| Voucher | real signature |
| Settlement | real tx |
| Distribution | real result |
| Refund/recovery | real result |
| Explorer proof | real |
| Cost | free |
| Vercel path | verified |

If any core row fails:

**PHASE 3 BLOCKED**

---

# 92. NO MAINNET SWITCH

Do not switch to Mainnet to "make the demo more real."

The demo should be real on Devnet.

Mainnet creates unnecessary financial risk and is not required to prove the hackathon mechanism.

If a later submission explicitly requires Mainnet:

- stop;
- verify requirements;
- create a separate risk review;
- never assume.

---

# 93. DEMO MONEY LANGUAGE

Because the funds are testnet funds, the app should make the environment clear without ruining the product.

Suggested small label:

`SOLANA DEVNET · TEST FUNDS`

Do not put a giant "FAKE" banner across the UI.

Do not pretend the value has real economic value.

---

# 94. PRODUCT MARKET LANGUAGE

Potential expansion areas:

### Equipment rental

Charge according to hours or usage.

### Workspace/session

Pay according to time used.

### Compute

Pay according to usage units.

### Data/API

Pay according to requests or data consumed.

### Machine access

Pay according to machine time.

These are product hypotheses, not validated markets.

Do not claim customer traction without evidence.

---

# 95. BUSINESS MODEL — MVP ONLY

Do not implement complex monetization.

Conceptual business model:

- provider chooses usage pricing;
- provider pays or absorbs network costs as designed;
- UsageBar can later charge a small platform fee.

Do not add platform-fee logic to MVP unless it is useful to demonstrate the sponsor mechanism.

---

# 96. LEGAL / PRODUCT HONESTY

UsageBar should not be presented as:

- regulated payment infrastructure;
- consumer credit;
- escrow service for regulated assets;
- bank;
- payment processor;
- production billing platform.

It is:

> a hackathon prototype demonstrating a usage-based payment session using Solana Payment Channels.

---

# 97. CURRENT COMPETITION POSITIONING

Current CWF includes many payment-oriented projects and other human-friendly Solana products.

Therefore:

Do not claim category ownership.

Our differentiation is the combination:

```text
familiar service tab
+
usage-based billing
+
Payment Channels
+
visible cumulative vouchers
+
one settlement
+
unused remainder
+
verifiable proof
```

---

# 98. README FINAL STRUCTURE

```text
# UsageBar

Pay for what you actually use.

## 30-second explanation

## Live Demo

## Demo Video

## Verified Devnet Run

## What is novel

## Why Solana Payment Channels

## How it works

## Usage Session Lifecycle

## Architecture

## Security

## Tests

## Evidence

## Known Limitations

## Reproduction

## Protocol References

## License
```

Proof should be near the top.

---

# 99. FINAL SCREENSHOT SET

Take no more than needed.

Recommended:

1. landing + Usage Tab;
2. active session;
3. final settlement;
4. proof screen;
5. mobile final state.

Every screenshot must be from the real current application.

No hand-edited numbers.

---

# 100. FINAL VIDEO RULE

Keep the final video focused.

The strongest 60-second cut:

```text
PRODUCT
→
OPEN
→
USAGE
→
CLOSE
→
SETTLEMENT
→
PROOF
```

If a longer pitch is required, use the three-minute structure.

---

# 101. FINAL JUDGE QUESTIONS

The product must answer:

### What is it?

A payment tab for usage-based services.

### Why does it matter?

It gives the user a spending ceiling while the final payment reflects actual cumulative use.

### What is technically different?

Usage is authorized incrementally through the Payment Channels mechanism rather than each usage event becoming a separate onchain payment.

### Why Solana?

Payment Channels.

### Does it work?

Show the real Devnet run.

### Can I verify it?

Show the Explorer and verifier.

---

# 102. FINAL SUBMISSION CHECKLIST

## Product

- [ ] product one-liner
- [ ] demo use case
- [ ] core flow
- [ ] state machine

## Technical

- [ ] verified program
- [ ] verified asset
- [ ] wallet
- [ ] real channel
- [ ] real voucher
- [ ] real settlement
- [ ] real distribution/refund
- [ ] final readback

## Security

- [ ] ceiling test
- [ ] signer test
- [ ] replay test
- [ ] retry test
- [ ] asset binding
- [ ] network binding
- [ ] secret scan

## UX

- [ ] 5-second test
- [ ] 30-second test
- [ ] first viewport
- [ ] mobile
- [ ] error/loading/empty
- [ ] signature interaction

## Visual

- [ ] visual gate ≥20/24
- [ ] no generic Web3 dashboard
- [ ] mechanism visible
- [ ] product-specific components
- [ ] asset provenance

## Proof

- [ ] canonical run
- [ ] verifier
- [ ] signatures
- [ ] Explorer links
- [ ] claim statuses
- [ ] limitations

## Submission

- [ ] live URL
- [ ] GitHub
- [ ] screenshots
- [ ] video
- [ ] description
- [ ] technical explanation
- [ ] team information
- [ ] selected ecosystem/tools
- [ ] final review

---

# 103. HARD NO-GO CONDITIONS

Do not submit if:

- core settlement is simulated;
- refund/recovery is only a local calculation;
- fake transaction hashes exist;
- fake Explorer links exist;
- protocol facts are guessed;
- a secret is committed;
- UI says SETTLED without chain verification;
- the project requires a paid service that has not been verified;
- the sponsor integration is only decorative;
- the current selected protocol path cannot be reproduced;
- an unresolved critical security issue remains.

---

# 104. PHASE-11 SUCCESS CRITERION

The first major success looks like this:

```text
SOLANA DEVNET

PAYER WALLET
    ↓
REAL PAYMENT CHANNEL
    ↓
50.00 TEST UNITS AUTHORIZED
    ↓
2.40
4.80
7.20
9.80
12.40
    ↓
REAL FINAL SETTLEMENT
    ↓
12.40 TO PROVIDER
    ↓
37.60 UNUSED
    ↓
REAL CHAIN STATE / PROOF
```

No frontend polish is required for this milestone.

---

# 105. FINAL BUILD PRINCIPLE

The project's most important implementation principle is:

> **The protocol is the source of truth.**

The UI should explain the protocol.

The UI must not replace the protocol.

A nice animation is not proof.

A success toast is not proof.

A screenshot is not proof.

A database row is not proof.

A real chain state and independently verifiable transaction are proof.

---

# 106. FINAL DESIGN PRINCIPLE

The most important design principle is:

> **The product mechanism determines the visual language.**

For UsageBar:

```text
payment tab
+
usage meter
+
authorized / used / returned
+
close
+
settle
+
proof
```

That is the identity.

---

# 107. FINAL STRATEGIC PRINCIPLE

Do not optimize for:

> "How many features can we cram in?"

Optimize for:

> **How clearly can a judge see the product, the mechanism, the state transition, and the proof?**

---

# 108. FINAL CODING-AGENT COMMAND

You may now begin implementation.

Before writing application UI code:

1. inspect all official current protocol sources;
2. verify the exact current Payment Channels client;
3. verify Devnet deployment;
4. verify asset;
5. write `docs/PROTOCOL_DISCOVERY.md`;
6. write `docs/PROTOCOL_DECISION.md`;
7. run the minimal real open-channel smoke test;
8. stop if blocked;
9. continue only after the real protocol gate passes.

Then implement one complete real UsageBar path.

Do not build extra features until the complete path is proven.

At every phase:

```text
PHASE:
STATUS:
COMMIT:
FILES CHANGED:
DEPENDENCIES:
TESTS:
LIVE EVIDENCE:
PROTOCOL FACTS:
SECURITY FINDINGS:
KNOWN LIMITATIONS:
BLOCKERS:
NEXT PHASE:
```

A phase is PASS only when behavior is proven.

Never replace an unknown with a guess.

Never replace a protocol action with a mock and call it real.

Never expose or commit secrets.

Never use Mainnet funds for development.

Never let UI state become the financial source of truth.

Build the smallest real thing first.

