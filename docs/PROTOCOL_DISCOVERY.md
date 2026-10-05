# Protocol Discovery

**Build spec Section 58.** Every fact below was fetched live on **2026-10-05**.
Nothing here is from memory. Where a fact could not be verified it is marked
`UNKNOWN` rather than filled with a plausible value.

The narrative version of this research, including the reasoning and the
corrections it forced, is in [`AUDIT_REPORT.md`](AUDIT_REPORT.md).

---

## 1. Program

```
FACT:          The canonical Payment Channels program ID is
               CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX
SOURCE:        `declare_id!` in source; Codama IDL; repo README; direct RPC read
URL:           https://github.com/solana-foundation/payment-channels
               .../program/payment_channels/src/lib.rs
               .../program/payment_channels/idl/payment_channels.json
VERIFIED DATE: 2026-10-05
NETWORK:       mainnet-beta and devnet (same address)
VERSION/COMMIT: program crate v0.1.0; last commit to main 3ffa4d67 (2026-08-07)
CONFIDENCE:    high
IMPACT:        This is the address the application must use. It was NOT guessed.
```

```
FACT:          The program is deployed and executable on BOTH devnet and mainnet-beta.
SOURCE:        Direct JSON-RPC getAccountInfo, run by us
URL:           https://api.devnet.solana.com , https://api.mainnet-beta.solana.com
VERIFIED DATE: 2026-10-05
NETWORK:       devnet + mainnet-beta
CONFIDENCE:    high
IMPACT:        CRITICAL. The build spec's Report 5 anticipated that a devnet
               deployment might not exist. It does. This was the single largest
               projected blocker and it is cleared.
EVIDENCE:      both returned executable: true, owner BPFLoaderUpgradeab1e...
               devnet  last-deploy slot 480232051, upgrade authority 4zTeC5mV...
               mainnet last-deploy slot 431447053, upgrade authority DXtFpbPj...
```

```
FACT:          The devnet deployment is actively used — recent transactions
               against it are finalized with err: null.
SOURCE:        Direct JSON-RPC getSignaturesForAddress, run by us
VERIFIED DATE: 2026-10-05
NETWORK:       devnet
CONFIDENCE:    high
IMPACT:        A deployed-but-dead program would be a different risk profile.
               This one is live and being exercised.
```

```
FACT:          Repository solana-foundation/payment-channels, MIT, created
               2026-04-14, pushed 2026-09-16. No GitHub releases exist.
               Cantina audit referenced (July 2026).
SOURCE:        GitHub REST API
CONFIDENCE:    high
IMPACT:        No tagged release to pin to. Pin by commit instead.
```

## 2. Instructions

```
FACT:          9 public instructions plus one internal:
               open(14 accounts), settle(2), topUp(6), settleAndSeal(3),
               requestClose(2), seal(1), distribute(11 + recipient tail),
               withdrawPayer(6), reclaim(2), emitEvent(internal, disc 228)
SOURCE:        Codama IDL + docs/003-program-instructions.md
URL:           .../program/payment_channels/idl/payment_channels.json
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        The instruction list in build spec Section 13 is accurate.
               Naming differs by context: IDL/camelCase `settleAndSeal`,
               Rust/docs snake_case `settle_and_seal`.
```

## 3. Channel address

```
FACT:          Channel PDA seeds are exactly:
               ["channel", payer, payee, mint, authorized_signer,
                salt (u64 LE), open_slot (u64 LE)]
               Channel account is 256 bytes.
SOURCE:        docs/001-payment-channel-state-machine.md ; IDL account layout
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        open_slot is a PDA seed, so a channel address is unique per
               incarnation. A voucher for a previous incarnation cannot be
               replayed against a new one (VoucherChannelMismatch).
```

## 4. Voucher format

```
FACT:          A voucher is a 50-byte message:
                 magic [0x56, 0x01]                    2 bytes
                 channel_id                           32 bytes (channel PDA)
                 cumulative_amount                    u64 little-endian
                 expires_at                           i64 little-endian (0 = never)
               Amounts are CUMULATIVE ceilings, not per-event deltas.
SOURCE:        docs/001-payment-channel-state-machine.md ; docs/002-http-protocol.md
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        Matches the product model exactly. This is why the product works.
```

```
FACT:          The signer is the channel's `authorized_signer` — a parameter
               chosen at `open`. It need not be the payer or the payee.
SOURCE:        `open` account list; channel account layout (IDL)
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        This is the mechanism that permits the service operator to sign
               usage updates server-side without the customer approving every
               update. It is a first-class channel parameter, NOT a custom
               authorization layer. It resolves build spec Section 8.
```

```
FACT:          Vouchers are verified with the Ed25519 precompile, not by an
               on-chain signature check inside instruction data. A canonical
               single-signature Ed25519 precompile instruction must be placed
               IMMEDIATELY BEFORE `settle` in the same transaction. `settle`
               itself carries no voucher in its instruction data; the program
               reads the verified message via the Instructions sysvar.
               Missing/incorrect -> MissingEd25519Verification (error 230).
SOURCE:        docs/003-program-instructions.md ; README
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        NOT mentioned anywhere in the build spec. This is the most
               likely cause of a confusing first settlement failure.
```

## 5. State machine

```
FACT:          Statuses: Open=0, Sealed=1, Closing=2, Distributed=3.
               Transitions:
                 [*]        -> OPEN        via open
                 OPEN       -> OPEN        via settle / topUp / distribute
                 OPEN       -> SEALED      via settleAndSeal
                 OPEN       -> CLOSING     via requestClose
                 CLOSING    -> SEALED      via settleAndSeal (before deadline) or seal (after)
                 SEALED     -> SEALED      via withdrawPayer
                 SEALED     -> DISTRIBUTED via distribute
                 DISTRIBUTED-> [*]         via reclaim (permissionless, past window)
SOURCE:        docs/001-payment-channel-state-machine.md
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        Build spec Section 13 is accurate. The product state machine
               compresses these; every displayed final state must be derived
               from the real one.
```

```
FACT:          OPEN_SLOT_WINDOW = 1_500 slots (~10 min at 400ms/slot).
               Distribution commitment is a SHA-256 hash of the recipient preimage.
SOURCE:        docs/001-payment-channel-state-machine.md ; src/constants.rs
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        A demo run must complete the relevant steps inside the window.
```

## 6. Tokens

```
FACT:          Both classic SPL Token and Token-2022 are supported.
               Token-2022 is restricted to an extension allow-list:
               ImmutableOwner, MetadataPointer, TokenMetadata, GroupPointer,
               TokenGroup, GroupMemberPointer, TokenGroupMember.
               Anything else -> UnsupportedTokenExtension.
SOURCE:        src/lib.rs ; src/instructions/helpers/token.rs ; Cargo.toml
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        A vanilla SPL Token mint (no extensions) is the least risky
               asset choice.
```

```
FACT:          Devnet USDC mint is 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU,
               6 decimals, classic SPL Token. Circle's faucet dispenses
               20 USDC per 2 hours, no account required.
SOURCE:        Circle developer docs; devnet RPC getAccountInfo (jsonParsed)
URL:           https://developers.circle.com/stablecoins/usdc-contract-addresses
               https://faucet.circle.com
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        20 per 2 hours cannot fund a 50.00 ceiling in one claim.
               See PROTOCOL_DECISION.md for the asset decision.
```

```
FACT:          Classic SPL Token program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
               Token-2022 program:         TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
SOURCE:        declare_id! in the official token program sources; devnet RPC
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
```

## 7. Client

```
FACT:          An official generated TypeScript client exists at
               clients/typescript — package name `@payment-channels/client`,
               version 0.1.0, generated with Codama from the committed IDL.
               It is NOT published on npm (registry returns 404).
               It depends on @solana/kit ^6.1.0 and @solana/program-client-core ^6.1.0.
               It does NOT depend on legacy @solana/web3.js.
SOURCE:        clients/typescript/package.json ; registry.npmjs.org
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        The client must be generated, not installed. Build spec Section 32
               assumes an installable "official generated client"; that assumption
               is wrong and the discovery doc corrects it.
```

```
FACT:          Current @solana/kit latest is 8.4.0 (published 2026-09-28).
               The Payment Channels client pins ^6.1.0.
SOURCE:        npm registry
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        A version conflict to resolve in Phase 1 — either build the
               client against kit 8, or isolate the client's kit 6 dependency.
               Not yet resolved. UNVERIFIED which approach works.
```

## 8. Frontend stack

```
FACT:          Current official Solana guidance: use @solana/kit with
               @solana/kit-plugin-wallet for Wallet Standard discovery.
               @solana/wallet-adapter-* and @solana/web3.js v1 are described
               as legacy for new work.
SOURCE:        https://solana.com/docs/frontend ; https://solana.com/docs/frontend/nextjs-solana
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        Build spec Section 17 says "do not assume Phantom is mandatory" —
               correct. Wallet Standard discovery is the path.
```

## 9. Hosting

```
FACT:          Vercel Hobby maximum function duration is 300s (default and max).
SOURCE:        https://vercel.com/docs/functions/limitations
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        The common "Hobby is 10s" belief is outdated. 300s is enough for
               a settlement call, though blocking on confirmation is still a
               timeout risk worth designing around.
```

```
FACT:          GitHub Actions standard runners are free with no minute cap on
               public repositories. Per-job limit 6 hours.
SOURCE:        https://docs.github.com/en/billing/concepts/product-billing/github-actions
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        Confirms the whole heavy build can live in the cloud, which is
               required given the 8 GB / 0.6 GB-free development machine.
```

```
FACT:          Public devnet RPC https://api.devnet.solana.com is live.
               Limits: 100 requests / 10s per IP; 40 req / 10s per IP for a
               single RPC. Not intended for production.
SOURCE:        https://solana.com/docs/references/clusters ; live getHealth check
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        Vercel serverless egress IPs are shared, so 429s are possible.
               A free Helius key is the documented fallback.
```

## 10. Related protocols

```
FACT:          x402 SVM `upto` settles AT MOST ONCE per authorization.
               Multi-settlement streaming and long-lived reused channels are
               explicitly out of scope, deferred to `batch-settlement`.
SOURCE:        x402 specs/schemes/upto/scheme_upto_svm.md
URL:           https://github.com/x402-foundation/x402
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        Confirms build spec Section 6. Do not use `upto` for this product.
```

```
FACT:          MPP = Machine Payments Protocol (not Model Context Protocol).
               The session intent is IETF draft draft-solana-session-00,
               published 2026-10-01, expires 2027-04-04.
               SDKs: @solana/pay-kit 0.13.0, @solana/mpp 0.7.0.
               MPP session is built ON the same Payment Channels program.
SOURCE:        https://solana.com/docs/payments/agentic-payments/mpp
               https://paymentauth.org/draft-solana-session-00
VERIFIED DATE: 2026-10-05
CONFIDENCE:    high
IMPACT:        A draft spec with a 0.x SDK. Same on-chain settlement layer as
               the direct path, so choosing the direct path loses nothing.
```

---

## UNKNOWN — not resolved

```
UNKNOWN:       What bytecode/version is actually live on devnet and mainnet,
               and whether either matches the audited commit.
WHAT MUST BE VERIFIED: compare deployed program hash against a build of the
               pinned commit.
WHERE TO VERIFY IT:    solana program dump on both clusters (requires Solana CLI,
               so: GitHub Actions).
BLOCKS:        Nothing immediately. Low risk.

UNKNOWN:       Whether devnet `distribute` succeeds, given that the source tree
               still carries a placeholder TREASURY_OWNER (0xBEEF sentinel with
               a TODO and a build-time assert under --features devnet).
WHAT MUST BE VERIFIED: an actual distribute call on devnet.
WHERE TO VERIFY IT:    the Phase 5 settlement smoke test.
BLOCKS:        Phase 5. This is a genuine risk, not a formality.

UNKNOWN:       How to reconcile @solana/kit 8.4.0 with the client's ^6.1.0 pin.
WHAT MUST BE VERIFIED: a build of the generated client.
WHERE TO VERIFY IT:    GitHub Actions.
BLOCKS:        Phase 3.

UNKNOWN:       Whether Vercel's shared egress IPs avoid 429 from the public
               devnet RPC in practice.
WHERE TO VERIFY IT:    a deployed smoke test.
BLOCKS:        Phase 10 deployment.
```
