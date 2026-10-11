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

Last updated: **2026-10-11** (the six protocol/deployment evidence gates below remain valid, including the canonical run and the 71-check deployed-app probe. Since the previous update, the Wallet Standard app-ready registration handshake was corrected and tested, a post-settlement **Authorize another tab** action was added, and the app now attempts safe silent reconnection to the previously selected wallet. GitHub Actions run [38101010531](https://github.com/Temmygabriel/UsageBar/actions/runs/38101010531) passed typecheck, automated tests, build, and responsive viewport checks. **Human browser-wallet behavior remains UNVERIFIED.** Vercel reports `Deployment rate limited — retry in 24 hours` for the latest main commit, so the latest repeated-session/reconnect UI patch is not confirmed live on the production alias as of this update.)

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

### Gate 6 — the four paths the product does not use

`tools/devnet-extended-paths.mjs`, run 2026-10-09, **0 failed checks**, two
independent scenarios both complete. Nine artifacts committed under
[`../evidence/extended-paths/`](../evidence/extended-paths/).

This gate closes the four rows that Gate 5 left `UNVERIFIED`. It proves the
*program* handles them. It does not prove the *application* uses them — the
script drives the program directly with keypairs this repository holds, and the
app calls none of these instructions. Every artifact says so in its own
`doesNotProve` field.

**Scenario A** — channel `DsHVQRkN9vcKAQqpR5YVVzz2AT5mzS8XNEK5ocUW9hq4`,
opened with a non-empty distribution plan, deposit `50000000`, metered `3333330`
at a rate of `333333` per tick.

| Claim | Status |
|---|---|
| `topUp` (discriminator 3) moves the deposit without disturbing the plan | **PROVEN** — deposit `50000000 → 60000000`, escrow ATA `0 → 60000000`, both read back after the transaction; `distribution_hash` byte-identical before and after, so a top-up cannot be used to swap the split after the fact |
| `open` accepts a plan with actual recipients | **PROVEN** — `open` committed SHA-256 `6ce22fab…f66596`, and `distribute`'s revealed preimage hashed to the same value. This is the first time the `recipient(32) ‖ bps(u16)` wire layout has been executed on chain rather than only unit-tested. |
| The recipient split **floors** each share rather than rounding | **PROVEN** — alpha received `499999`, which is `floor(3333330 × 1500 / 10000)` = `floor(499999.5)`. Rounding would have paid `500000`. |
| The payee is paid its own basis-point share, not "whatever is left" | **PROVEN** — payee received `2666664` = `floor(3333330 × 8000 / 10000)` = `floor(2666664.0)`, computed from the channel's own fields rather than from the amounts the script asked for |
| Residual flooring dust is swept to the treasury | **PROVEN** — treasury received `1` atomic unit, and the payout accounts sum to `deposit − 0`: `56666670 + 2666664 + 499999 + 166666 + 1 = 60000000` exactly |
| The payer's refund is `deposit − settled`, not `deposit − sum(shares)` | **PROVEN** — `60000000 − 3333330 = 56666670`, received exactly |
| The channel ends `Distributed`, read back rather than assumed | **PROVEN** — status byte 3 reads `3` after the distribution, both in the artifact and in an independent raw `getAccountInfo` |

The rate was chosen to make the rounding rule observable. At the application's
`250000` every product of the split divides exactly, all five remainders are
zero, and the run would have proved nothing about rounding in either direction.

**Scenario B** — channel `2bYU3Tgogs5WbvdErtVFeL12d1YeMaWx6Lw7rRGqT39S`, grace
period `10` seconds, metered `1250000`.

| Claim | Status |
|---|---|
| `requestClose` (discriminator 5) moves the channel to Closing | **PROVEN** — status `0 → 2`, with `closure_started_at` stamped |
| The grace period is enforced, and `seal` before it fails | **PROVEN** — `seal` sent 2.3s into a 10s grace period was rejected, and the status read back from chain stayed `2` rather than advancing |
| The guard that refused it is the clock, not a malformed instruction | **PROVEN** — the *identical* instruction succeeded once the period elapsed, with the watermark unchanged at `1250000` across both attempts. The clock is the only variable. |
| `seal` is not gated on the payee's or the signer's cooperation | **PROVEN** — its account list is exactly one account, the channel, with no signer of any kind, so nothing in the program consults a signature before sealing. The fee was paid by this repository's payer keypair, which is a property of Solana rather than of this program: any keypair can pay it. |
| `withdrawPayer` (discriminator 8) refunds the unspent deposit | **PROVEN** — payer ATA `+48750000` = `deposit − settled`, read back from chain, with `payer_withdrawn_at` stamped `1791518378` and the escrow falling by the same amount |
| The refund is a one-time gate, not a double-dip | **PROVEN** — the subsequent `distribute` paid the payer **`0`**, while the payee still received its `1250000` from the same call |

**Read back from raw chain state, outside this repository's code.** Both
channels still exist on Devnet, and a plain `getAccountInfo` at
`commitment: finalized` — no keypair, no code from `tools/` — returns 256 bytes
owned by the program with status byte 3 (`Distributed`) for both. Two of those
bytes contradict what a reasonable reader would assume:

| Claim | Status |
|---|---|
| `seal` clears `closure_started_at` | **PROVEN** — the stamp `requestClose` wrote (`1791518362`) reads `0` once the channel is Sealed, both in the artifact and in an independent read afterwards. The grace clock is not left ticking on a channel whose grace period no longer applies. |
| A sealed `distribute` does not advance `payout_watermark` | **PROVEN** — it reads `0` after a distribution that paid every recipient. The channel is terminal, so there is no later payout for a watermark to gate. This is the opposite of the natural expectation and is taken from the chain rather than reasoned about. |

**A defect this gate found, and where it was caught.** The first committed
versions of `03-split-distributed.json` and `09-timeout-distributed.json`
reported channel fields decoded from snapshots taken *before* their
transaction — `03` filed a pre-`distribute` channel under the bare name
`channel` (status `1 Sealed`, in a file about a distribution that had already
run), and `09` filed `payerWithdrawnAt` from before `withdrawPayer` had set it,
saying `0` where the chain says `1791518378`.

Both values were real reads of the wrong moment under names claiming a different
one. That is harder to catch than a fabricated number, because nothing is
internally inconsistent. It surfaced only by reading the channel from raw RPC
and comparing — which is the argument for doing that on every gate rather than
trusting the artifact's own account of itself. Both artifacts now carry
`channelBefore` and `channelAfter` as separate fields, and both scenarios assert
that the post-transaction read says `Distributed`.

**The named error.** The refusal carries `custom program error: 0x899`, which is
`2201`, `SealGracePeriodNotElapsed` — read out of
`program/payment_channels/src/errors.rs`, under `// ix seal`. That citation is
corroboration and is treated as such. What proves the claim is the shape of the
run: the same bytes succeed once the clock moves. A name this repository typed
into a lookup table is not a chain observation.

**A correction this gate forced.** The first version of `CHANNEL_ERRORS` named
`261`, `262` and `264` from memory. Reading the source showed three were wrong:
`261` is `InvalidSplitConfig`, not a share error; `263` is `DuplicateRecipient`,
not `262`; `264` is `DistributionAmountOverflow`, not a count error. `260`,
`262` and `264` all carry the *identical* upstream message
(`num_recipients outside [0, 32]`), so the choice between them for a
count violation is inference from the name rather than a traced fact, and the
source comment says so rather than implying otherwise.

### Still not proven

| Claim | Status |
|---|---|
| The wallet handshake has been exercised by a human in a browser | UNVERIFIED — the largest remaining gap, and the one path CI structurally cannot cover. Gate 5 stands in for a wallet's cryptography, not for Phantom's consent screen. |
| The four extended-path instructions are reachable from the application | UNVERIFIED — and deliberately so. Gate 6 drove the *program*, not the product. The app opens every channel with an empty plan and imports none of `topUp`, `requestClose`, `seal`, `withdrawPayer`, or a non-empty distribution plan. A judge cannot reach them by clicking anything. |
| The `seal` grace guard's error code is what the program names it | OBSERVED — the name is transcribed from `errors.rs` and matches the hex the cluster returned, which is strong corroboration but is a coincidence of two sources rather than a proof that the program intended that name for that guard |
| The split holds for more than two recipients, or for shares summing to over 10000 bps | UNVERIFIED — both recipients-plus-payee plans sum to exactly 10000 bps and two recipients is the smallest interesting case; the overflow guards (errors 261, 264) are unit-tested but have never been provoked on chain |

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
