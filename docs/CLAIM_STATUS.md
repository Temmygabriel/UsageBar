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

Last updated: **2026-10-05** (the protocol gate passed — a real channel is open
on devnet and was read back from chain, verified independently).

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

## Protocol — instruction-level facts — PROVEN

Established 2026-10-05 by reading
`program/payment_channels/idl/payment_channels.json` (a Codama root node,
`standard: codama`, version 1.6.0) and the program source directly. These are
**not** from documentation, and several correct or sharpen the build spec.

| Claim | Status |
|---|---|
| `CHANNEL_SEED` is literally the byte string `b"channel"` | PROVEN |
| Channel PDA seeds are `[b"channel", payer, payee, mint, authorized_signer, salt(u64 LE), open_slot(u64 LE), bump]` | PROVEN |
| `open` takes 14 accounts: `payer`, `rentPayer`, `payee`, `mint`, `authorizedSigner`, `channel`, `payerTokenAccount`, `channelTokenAccount`, `tokenProgram`, `systemProgram`, `rent`, `associatedTokenProgram`, `eventAuthority`, `selfProgram` | PROVEN |
| `payer` and `rentPayer` are the only signers on `open` | PROVEN |
| `openArgs` = `{ salt: u64, deposit: u64, gracePeriod: u32, openSlot: u64, recipients: distributionEntry[] }` | PROVEN |
| `distributionEntry` = `{ recipient: pubkey, bps: u16 }`, denominator 10,000 | PROVEN |
| `channelTokenAccount` must be exactly `ATA(channel, mint, token_program)` (program error 51) | PROVEN |
| `payerTokenAccount` must be exactly `ATA(payer, token_program, mint)` (program error 57) | PROVEN |
| The channel PDA must match the derived address exactly (program error 50) | PROVEN |
| The **`settle` instruction carries no voucher argument** — its only accounts are `channel` and `instructionsSysvar` | PROVEN |
| Settlement therefore *must* pass the voucher via the instructions sysvar, i.e. the Ed25519 precompile in the same transaction | PROVEN |
| `distribute` requires a `treasuryTokenAccount`, validated as `ATA(TREASURY_OWNER, mint, token_program)` | PROVEN |
| `OPEN_SLOT_WINDOW` is 1,500 slots and is consensus-critical in the *decreasing* direction only | PROVEN |
| The `open` transaction must land within the window of its client-chosen `openSlot`, which is a PDA seed — missing it changes the channel address | PROVEN |
| The program has 65 documented error codes; 50–58 cover channel and token-account mismatches | PROVEN |
| The deployed program emits `opened` and `payoutRedirected` events via an `eventAuthority` PDA | PROVEN |

## UsageBar infrastructure — PROVEN

Verified 2026-10-05 by chain readback. Detail in
[`ASSET_PROVENANCE.md`](ASSET_PROVENANCE.md).

| Claim | Status |
|---|---|
| A devnet test mint we control exists at `6Jpyq8iUszZdZd2z3G9is1nfJh7ZwqbekW9cH2w58hmL` | PROVEN |
| It is a **classic SPL Token** mint, not Token-2022 | PROVEN |
| It has 6 decimals | PROVEN |
| Its supply of 1,000,000.000000 TEST is held by the devnet test payer | PROVEN |
| Its mint authority is the devnet test payer, and its freeze authority is unset | PROVEN |
| A devnet keypair can sign and land a transaction on devnet from this repository | PROVEN |
| GitHub Actions can sign and send a devnet transaction using a repository secret | PROVEN |
| No private key is committed; `local-wallet/` is gitignored and verified invisible to git | PROVEN |

## UsageBar — the gate is proven

Opening a channel now works. Everything below it does not yet, and stays listed
so the gap remains visible.

| Claim | Status |
|---|---|
| UsageBar can open a channel on Devnet | **PROVEN** — channel `7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo`, opened at slot `507695832` by transaction `2Uoz4SE93ct5v3RrXQnzFhy8Dn4bwi8FBcf817Vm3SjNm1Umi2q9jzxLF95SdEsCC8r2KsKHDYKSo8JaNuDLgoh` |
| UsageBar can read a channel back from chain | **PROVEN** — 256 bytes decoded, matching `Channel::LEN`; discriminator `1`, version `1`, bump `254`, status `0` (Open), all party fields correct, `settled` and `payoutWatermark` zero |
| Opening a channel actually moves the deposit | **PROVEN** — payer ATA `1000000` → `999950` TEST; channel ATA `0` → `50` TEST. A successful transaction is not proof that anything worked; tokens changing accounts is. |
| The readback is independent of our own tooling | **PROVEN** — re-verified by a raw `getAccountInfo` RPC call from the local machine, which does not execute any of our code |
| The channel PDA derivation matches the program's | **PROVEN** — the program re-derives the address from the seeds and rejects a mismatch (error 2000); it accepted ours |
| UsageBar can produce a cumulative voucher that the program accepts | UNVERIFIED |
| UsageBar can call `settle_and_seal` on Devnet | UNVERIFIED |
| UsageBar can call `distribute` on Devnet | UNVERIFIED |
| The unused remainder is actually recoverable by the payer | UNVERIFIED |
| The devnet deployment accepts `distribute` despite the placeholder treasury owner | UNVERIFIED — the source cannot compile with `--features devnet` at all (build-time assert rejects the `0xBEEF` sentinel), so the live program was built differently and very likely carries that placeholder. Untested. Detail in [`ASSET_PROVENANCE.md`](ASSET_PROVENANCE.md). |
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
