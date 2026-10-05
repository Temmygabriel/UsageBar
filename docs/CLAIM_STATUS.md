# Claim Status

**Build spec Section 28.**

Only four statuses are permitted. Nothing here may be upgraded without evidence
that can be independently checked.

```
PROVEN     — verified directly, by us, from an authoritative source or chain state
OBSERVED   — seen in a real environment, but not exhaustively verified
INFERRED   — follows from proven facts, but not directly demonstrated
UNVERIFIED — not tested. This is the default. It is not a soft "probably fine".
```

Last updated: **2026-10-05** (initial audit — no application code executed yet).

---

## Protocol — PROVEN

Verified by direct RPC query and by reading the current official sources on
2026-10-05. Raw detail in [`PROTOCOL_DISCOVERY.md`](PROTOCOL_DISCOVERY.md).

| Claim | Status |
|---|---|
| The Payment Channels repository exists and is current | PROVEN |
| Program ID is `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX` | PROVEN |
| The program is deployed and executable on **mainnet-beta** | PROVEN |
| The program is deployed and executable on **devnet** | PROVEN |
| The devnet deployment is actively used (successful finalized transactions) | PROVEN |
| The instruction set is the 9 public instructions documented in the spec | PROVEN |
| The voucher is a 50-byte cumulative Ed25519 message | PROVEN |
| Settlement requires an Ed25519 precompile instruction before `settle` | PROVEN |
| The voucher signer is a channel parameter (`authorized_signer`) | PROVEN |
| Channel PDA seeds are `["channel", payer, payee, mint, authorized_signer, salt, open_slot]` | PROVEN |
| Both classic SPL Token and Token-2022 are supported | PROVEN |
| The official TypeScript client is **not** published on npm | PROVEN |
| The official TypeScript client depends on `@solana/kit ^6.1.0` | PROVEN |
| The current `@solana/kit` release is `8.4.0` (a version conflict to resolve) | PROVEN |
| x402 `upto` settles at most once and is unsuitable for this product | PROVEN |
| MPP session is defined in an IETF draft with a 0.x SDK | PROVEN |
| Devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals, classic SPL Token | PROVEN |

## UsageBar — UNVERIFIED

**None of the following has been attempted.** This is the honest position.

| Claim | Status |
|---|---|
| UsageBar can open a channel on Devnet | UNVERIFIED |
| UsageBar can read a channel back from chain | UNVERIFIED |
| UsageBar can produce a cumulative voucher that the program accepts | UNVERIFIED |
| UsageBar can call `settle_and_seal` on Devnet | UNVERIFIED |
| UsageBar can call `distribute` on Devnet | UNVERIFIED |
| The unused remainder is actually recoverable by the payer | UNVERIFIED |
| The devnet deployment accepts `distribute` given the placeholder treasury config in source | UNVERIFIED |
| The canonical run `canonical-usagebar-devnet-001` completes | UNVERIFIED |
| The verifier passes against real evidence | UNVERIFIED |
| The application deploys to Vercel and reaches devnet RPC | UNVERIFIED |

## Production and business — UNVERIFIED

| Claim | Status |
|---|---|
| Mainnet production deployment | UNVERIFIED |
| Any real merchant integration | UNVERIFIED |
| Real camera telemetry or trustworthy metering | UNVERIFIED — and not claimed |
| Commercial adoption or validated market demand | UNVERIFIED |
| Regulatory suitability as a payment service | UNVERIFIED |

---

## Rules for updating this file

1. A row moves to `PROVEN` only with a transaction signature, an Explorer link,
   or a reproducible command whose output is committed as evidence.
2. A UI screenshot is not evidence.
3. A passing local unit test is not evidence of on-chain behaviour.
4. If a claim was proven and later found wrong, it moves back down and the
   correction is recorded. No silent edits.
