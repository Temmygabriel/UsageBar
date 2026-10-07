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

Last updated: **2026-10-07** (five gates passed — a real channel was opened, its
watermark advanced by real cumulative vouchers, it was sealed and paid out with
every balance read back from raw chain state, the canonical run
`canonical-usagebar-devnet-001` completed all twelve steps in one pass with its
artifacts committed and independently re-verified, and the **deployed
application** was driven end to end over HTTPS against Devnet — which found and
fixed a real bug in the close path).

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

## UsageBar — all three gates are proven

Money can go in, the meter can move, and the money comes back out to the right
people. That is the product's entire promise, executed on devnet end to end.

### Gate 1 — open a channel and read it back

| Claim | Status |
|---|---|
| UsageBar can open a channel on Devnet | **PROVEN** — channel `7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo`, opened at slot `507695832` by transaction `2Uoz4SE93ct5v3RrXQnzFhy8Dn4bwi8FBcf817Vm3SjNm1Umi2q9jzxLF95SdEsCC8r2KsKHDYKSo8JaNuDLgoh` |
| UsageBar can read a channel back from chain | **PROVEN** — 256 bytes decoded, matching `Channel::LEN`; discriminator `1`, version `1`, bump `254`, status `0` (Open), all party fields correct |
| Opening a channel actually moves the deposit | **PROVEN** — payer ATA `1000000` → `999950` TEST; channel ATA `0` → `50` TEST. A successful transaction is not proof that anything worked; tokens changing accounts is. |
| The readback is independent of our own tooling | **PROVEN** — re-verified by a raw `getAccountInfo` RPC call from the local machine, which does not execute any of our code |
| The channel PDA derivation matches the program's | **PROVEN** — the program re-derives the address from the seeds and rejects a mismatch (error 2000); it accepted ours |

### Gate 2 — advance the settled watermark with a signed voucher

| Claim | Status |
|---|---|
| UsageBar can produce a cumulative voucher the program accepts | **PROVEN** — the operator signed 50-byte vouchers for `12400000` then `18900000` atomic units, and the program accepted both |
| The watermark advances monotonically across vouchers | **PROVEN** — `settled` went `0` → `12400000` (tx `3fBMYtCJKejFgKapjXzfQP7u51o1BeKGp3fBoZw6G4iK2uUoB9XpvBH57mPLKSR5idmasALHLKtfjPNgLoGJ5J3W`) → `18900000` (tx `3wesVbuGwEA9ETkAUUG1L1We6GSCVhb2ojimHRv7Bh468ryDJrTtLtHVQnRmYc62E7KJyKSwnSwsJCoKnyNn4uNG`), each read back from chain after its own transaction |
| The Ed25519 precompile adjacency requirement is real, and satisfied | **PROVEN** — `settle` carries no voucher in its data; the program loads instruction `current-1` from the Instructions sysvar. Our transactions place the precompile immediately before `settle`, and were accepted. |
| The voucher is bound to this channel and to no other | **PROVEN** — the `channel_id` bytes inside the signed payload decode to exactly `7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo`; the program rejects a mismatch with error 232 |
| The Gate 2 readback is independent of our own tooling | **PROVEN** — raw `getAccountInfo` from the local machine, with `settled` read by hand at byte offset 20, returned `18900000` |

### Gate 3 — seal the channel and pay everyone out

The full close, in two instructions. Run against the same channel Gate 2 left
open, via transaction `51FcroWv457JrF9aARRxGqzUp8j8Azohtr1KD6q76bxeRjNDVzFPM4YsoSa2fESnHMDPyw4dULvt746stNdaX81A`.

| Claim | Status |
|---|---|
| UsageBar can call `settleAndSeal` on Devnet | **PROVEN** — sealed at a final watermark of `21500000` atomic units (21.5 TEST), tx `3WjdkDYv9UCazfz9EQyZ7mPTnkdbU2vFVpseCyFRAYqnKJUcTfgHYUizvhayKKpPL5MR3qqGLp32xrhxESHJfZ8p`. `settleAndSeal` is not `settle`: it carries discriminator 4 and requires the **payee's** signature. The status byte was read back from chain as `1` (Sealed). |
| UsageBar can call `distribute` on Devnet | **PROVEN** — tx `51FcroWv457JrF9aARRxGqzUp8j8Azohtr1KD6q76bxeRjNDVzFPM4YsoSa2fESnHMDPyw4dULvt746stNdaX81A`, confirmed |
| The provider is paid exactly the metered amount | **PROVEN** — payee ATA went from nonexistent to `21.5 TEST`, which is the settled watermark over the payout watermark |
| The customer gets the unused remainder back | **PROVEN** — payer ATA `999950` → `999978.5 TEST`, i.e. **+28.5 TEST**, exactly `deposit − settled` (`50 − 21.5`) |
| The escrow is drained to zero | **PROVEN** — channel ATA `50 TEST` → gone; the account no longer exists |
| A fully-closed channel is deallocated and its rent returned | **PROVEN** — the 256-byte channel account no longer exists after `distribute`. This requires `slot > open_slot + 1500`; the channel was old enough, so the PDA was reaped. |
| The plan reveal hashes to the commitment made at `open` | **PROVEN** — the 4-byte empty-plan preimage hashes to `df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119`, byte-identical to the `distribution_hash` the channel had carried since it was opened. This independently confirms the preimage's wire layout. |
| The devnet program's real treasury owner is known | **PROVEN** — `4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap`, recovered by finding those bytes in the deployed ProgramData ELF at offset 61435. It is also the program's upgrade authority. |

### Gate 4 — the canonical run, and a verifier that disagrees with it

`canonical-usagebar-devnet-001`, run 2026-10-07 in one uninterrupted pass. The
twelve artifacts are committed under
[`../evidence/canonical-run/`](../evidence/canonical-run/).

| Claim | Status |
|---|---|
| The canonical run completes all twelve steps in one pass | **PROVEN** — channel `4LtkUAsruLTTi9xzwy6Zd67U8uz8d8sX72gyYsKjPz4S`, opened at slot `508262903`, deposit `50000000` |
| Money goes in, and the account says so | **PROVEN** — payer ATA `999978.5` → `999928.5` TEST, escrow ATA `0` → `50` TEST, both read back after `open` confirmed |
| The meter advances on a real clock rather than a typed number | **PROVEN** — five vouchers at cumulative `1.25 / 2.5 / 3.75 / 5 / 6.25` TEST, each produced after a measured interval of 5000-5002 ms, with `realElapsedMs` recorded in each artifact |
| The voucher is bound to the channel and to the authorized signer | **PROVEN** — the payload's `channel_id` bytes decode to the channel address, and the signing key re-derives to the channel's `authorized_signer`; a mismatch is errors 232 and 237 |
| The escrow can be sealed without billing unmetered time | **PROVEN** — `settleAndSeal` sent with `hasVoucher: false`, freezing the watermark the last metered voucher had already recorded, rather than attaching a voucher that would have to exceed it |
| The provider is paid exactly the metered amount | **PROVEN** — provider's token account holds `6250000` atomic units on chain, equal to the final watermark |
| The customer gets the exact remainder back | **PROVEN** — `43750000` atomic units, exactly `deposit − settled`; deposit splits as `6250000 + 43750000 + 0` |
| The escrow is emptied | **PROVEN** — the channel's token account is closed on chain, not merely zeroed |
| The plan reveal matches the commitment made at `open` | **PROVEN** — the 4-byte empty-plan preimage hashes to `df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119`, and byte 56 of the on-chain channel account holds that same value |
| Every transaction the run recorded is on chain | **PROVEN** — all eight signatures (open, five vouchers, seal, distribute) re-queried by the verifier and confirmed |
| The channel address in the artifacts is not merely trusted | **PROVEN** — the verifier re-derives the PDA from the seven seeds recorded beside it and gets the same address |
| The verifier passes against real evidence | **PROVEN** — `verify-canonical` run 37548733898, green, every check `ok`, no notes |
| The verifier can fail | **OBSERVED** — it failed twice before it passed, once on a `getTransaction` return shape assumed to be `{ value }` and once on its own secret detector flagging all eighteen transaction signatures. Both are recorded below rather than quietly fixed. |

**The honest note on Gate 4.** Unlike Gate 3, this channel was **not reaped**.
It was opened seconds before it closed, and reclamation requires
`slot > open_slot + 1500`; the account therefore survives at status `3`
(Distributed) with the escrow drained. Gate 3's channel was old enough and was
reaped. Both outcomes are the program behaving correctly, and which one you get
is a property of how long the channel lived — so the artifacts record the case
that happened rather than asserting the tidier one.

### Gate 5 — the deployed application, driven over HTTPS

`https://usagebar.vercel.app`, deployment `dpl_9dsXjP7zrJ5PZUGyNZvDmbBVnXHa`
at commit `81ef6f3`, probed by [`../tools/probe-deployed-app.mjs`](../tools/probe-deployed-app.mjs).
**71/71 checks passed**, and the run is committed as
[`../evidence/deployed-app-probe.json`](../evidence/deployed-app-probe.json).

Gates 1-4 drove the program through the tooling. This one drives the thing a
judge actually touches: the deployment's own HTTP API, over the public internet,
using no code from this repository on the client side except the probe itself.
Nothing is taken on the deployment's word — every balance and every account
value is re-read from a Devnet RPC endpoint this repository does not control,
over raw JSON-RPC rather than the application's own client.

| Claim | Status |
|---|---|
| The application deploys to Vercel and reaches devnet RPC | **PROVEN** — the deployed serverless functions read chain state and land transactions |
| The deployment holds working server-side keys | **PROVEN** — it signed and submitted two faucet transfers that both reached `finalized` |
| The faucet moves real money | **PROVEN** — a fresh wallet went `0 → 50000000` lamports and gained a token account holding `100000000` atomic units, read back from chain |
| The deployment derives a channel address and returns an unsigned transaction | **PROVEN** — channel `BFFqXPygJsBkGWQoGGowR4qgAtuSuRYnAsegp5oeT1Vt`, in a version-0 message with one required signature |
| The transaction it builds is one a wallet can actually sign and land | **PROVEN** — signed by the probe and accepted by the cluster as tx `NqVoKGt3ymR4EviCE5VSfPpoEUAKBymgKKRfmvkATibjuxpS5u83LSBqdqnF6HbRGxZJp66onHDTjSLk9EqvnX8` |
| The customer's deposit leaves their wallet for escrow | **PROVEN** — the customer's balance went `100000000 → 50000000` while the escrow account held `50000000`; the channel on chain is 256 bytes, discriminator `1`, status `0`, with the customer recorded as payer |
| The deployed meter advances a real on-chain watermark | **PROVEN** — `settled` went `0 → 1250000 → 2500000`, each read back from the channel's byte 20 as well as from the API |
| The deployment closes a tab and pays out | **PROVEN** — seal tx `2qKDtQPMKWj7nYG1K66bf82LXSfdn9Ysw1kA4ZjMPfV3gaAoz9wY4P5htKxoEMVw9DjZYVAfAweXwZ2LWQKqC3RM`, distribute tx `5fLEXCyemBHEv7DxTXWR2ZXUDo4PxD1euREW9ekrGRQNQtB61cRDD9DNJbGHS9gUvnYidvawnCpSJyC7f1WVCref` |
| The payout figures it reports are what actually moved | **PROVEN** — the provider's token account really grew by `2500000` and the customer's really rose by `47500000`, both read from chain rather than from the response |
| The session costs the customer exactly what the meter recorded | **PROVEN** — net cost `2500000`, no rounding, no remainder lost |
| The escrow is emptied | **PROVEN** — the channel's token account no longer exists |
| The deployed decoder reads a channel it did not create | **PROVEN** — asked about the canonical run's channel `4LtkUA…`, it returned 256 bytes, deposit `50000000`, watermark `6250000`, status `3 Distributed`, and the remainder `43750000` |
| Malformed requests are refused before anything is signed | **PROVEN** — bad address, missing address and unknown action are each a 400; an address holding a non-channel account is a 422 |

**The bug this found.** On its first run, against the deployment as it stood,
`POST /api/session { close }` returned **502** with `custom program error: 0xea`
— which is 234, `voucherWatermarkNotMonotonic`. The close path built the seal
from `channel.settled`, the amount already on chain, and attached a voucher for
it. A voucher must *strictly* advance the watermark, so that transaction could
never succeed: the customer would have watched the meter climb, pressed Close,
and been shown a 502 at the exact moment the product is supposed to pay out.
Fixed in `58f8392` by sealing with `hasVoucher: false`, which freezes the
watermark at the last metered reading — the path the canonical run already used.

Every earlier gate passed while this bug was live, because every earlier gate
drove the *tooling*, and the tooling sealed correctly. Only a probe of the
deployed application could have caught it, which is the argument for having
written one.

**One thing Gate 5 does not prove.** The probe signs the `open` transaction
itself. That stands in for a wallet's *cryptography* — the format, the slot, the
signature — and never for its consent screen. No human has approved a
transaction in a browser.

### Still not proven

| Claim | Status |
|---|---|
| The unused remainder is recoverable via `withdrawPayer` (discriminator 8) | UNVERIFIED — the SEALED `distribute` path already refunds the payer directly, which is what Gate 3 proves. `withdrawPayer` is the *pull* path and is only needed before a full close. Not exercised. |
| `requestClose` / `seal` (the timeout path, discriminators 5 and 6) | UNVERIFIED — the cooperative `settleAndSeal` path was used instead, so the payer-protection timeout is untested, in the tooling and in the application alike |
| `topUp` (discriminator 3) | UNVERIFIED |
| A distribution plan with actual recipients | UNVERIFIED — every run so far used an empty plan, including through the application. The `recipient(32) || bps(u16)` layout is unit-tested but has never been executed on chain. |
| The wallet handshake has been exercised by a human in a browser | UNVERIFIED — the largest remaining gap. Gate 5 stands in for a wallet's cryptography, not for Phantom's consent screen, and the one path CI structurally cannot cover is the one that has never been run. |

## Two things the verifier got wrong first

Recorded because a verifier that has never failed is a verifier nobody has
reason to trust, and both of these are more interesting than the fix.

**It assumed `getTransaction` returns `{ value }`.** It does not — it returns
the transaction itself, or `null`. `getAccountInfo` *does* use the envelope, and
carrying that assumption across made every chain check read `undefined` and then
throw. The lesson is narrow: two RPC methods from the same client, two different
return shapes, and nothing in the code said which was which.

**Its secret detector flagged all eighteen transaction signatures.** The rule
was "a base58 string of 86-90 characters is a 64-byte secret key". But a Solana
transaction *signature* is also 64 bytes and also base58. The two are the same
shape, and no inspection of a string alone separates them. A check built that
way fails every honest run and can only be quieted by deleting it — which is
worse than never having written it.

It now runs a **positive** test instead: the artifact text is compared against
the actual secret values, which are in the environment while the verifier runs,
and which cannot produce a false positive. A shape test remains for the
JSON-array encoding of a key, because a 64-element array of bytes *is*
distinguishable — nothing honest in these artifacts has that shape. What is not
checked is whether a bare base58 blob looks like a key. It cannot be known, so
it is not guessed at.

---

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
