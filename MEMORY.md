# UsageBar — Working Memory

**Last updated:** 2026-10-05

> Durable facts, decisions and gotchas, so that work can resume without
> re-deriving them. For *what is proven*, see
> [`docs/CLAIM_STATUS.md`](docs/CLAIM_STATUS.md). For *what has happened*, see
> [`PROGRESS.md`](PROGRESS.md).
>
> **This file contains no secrets and must never contain any.** Addresses below
> are public. Private keys live only in `local-wallet/` (gitignored) and in
> GitHub encrypted secrets.

---

## Project

**UsageBar** — a usage-based payment tab on Solana Payment Channels, for the
Colosseum Crypto World's Fair. Due **2026-10-12**.

The governing rule from `USAGEBAR_BUILD_SPEC.md`: **the protocol is the source of
truth.** Never present a financial value as real until it has been read back
from chain. No simulated transactions, no invented program IDs, no `SETTLED`
state before an on-chain readback.

Note: spec Section 108 ("you may now begin implementation") contradicts Section
0B. **0A and 0B govern.**

---

## Public addresses

| What | Address |
|---|---|
| Payment Channels program | `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX` |
| Devnet test token (`TEST`, 6 dp) | `6Jpyq8iUszZdZd2z3G9is1nfJh7ZwqbekW9cH2w58hmL` |
| Payer | `8XGW8giZJUvDMZPrFP3vufBn3zwc7GHgmHCH28e9HUQQ` |
| Payee | `8spx4F7VCCHdCoGux1FuLhx4z3ebAUvJxnhNBB7rjqcc` |
| Operator (`authorized_signer`) | `39pNZY2aqhCMaKXeychLHXDNvZ6CTWLPzWAHDPrDzP5T` |
| Open channel (first, salt 1) | `7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo` |
| Treasury owner (devnet) | `4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap` (also the upgrade authority) |

Classic SPL Token (`Tokenkeg...`), chosen over Token-2022 deliberately: the
program restricts Token-2022 to an extension allow-list, and a plain mint
cannot trip it.

### Channel #1 state — moves as we settle

`salt 1`, `openSlot 507695832`, `bump 254`, deposit 50 TEST, grace period 60s.

As of 2026-10-05: **status SEALED (1), settled 21.5 TEST, payoutWatermark 0**.
`settleAndSeal` landed successfully, so **28.5 TEST of unused deposit is owed
back to the payer** and 21.5 TEST to the payee. Both move on `distribute`. This
is a *live, mutable* value — re-read it from chain rather than trusting this
line.

`settled` sits at **byte offset 20** of the 256-byte account (u64 LE), which is
the quickest way to check by hand. `status` is byte offset 3.

### Three distinct keys, easily confused

| Key | Who holds it | Role |
|---|---|---|
| Payer | The **customer**, in their own browser wallet | Funds the tab. Never held by us in the real app. |
| Operator | The **server** | Signs usage vouchers. This is the `authorized_signer`. |
| Payee | The **provider** | Receives settlement. |

The `devnet-*` keypairs exist only to drive automated tests. They are not the
product's user-facing wallet.

---

## Secrets

Local files, all gitignored under `local-wallet/`:

```
local-wallet/devnet-smoke-payer.json      + .base58.txt
local-wallet/devnet-test-mint.json        + .base58.txt
local-wallet/devnet-operator.json         + .base58.txt
local-wallet/devnet-payee.json            + .base58.txt
```

GitHub Actions secrets (names only — values are never retrievable):

```
DEVNET_PAYER_KEYPAIR
DEVNET_TEST_MINT_KEYPAIR
DEVNET_OPERATOR_KEYPAIR
DEVNET_PAYEE_KEYPAIR
```

Set with `gh secret set`, piping the file in, so values never pass through a
chat or a web form.

---

## Hard rules

1. **Never commit a private key, seed phrase, or `.env`.** `.gitignore` covers
   `local-wallet/`, `private-keys/`, `*.keypair.json`, `id.json`, `*.pem`.
2. **Never create `NEXT_PUBLIC_PRIVATE_KEY`** or anything equivalent — anything
   `NEXT_PUBLIC_` is shipped to the browser.
3. **Never ask the user for a seed phrase or private key.** If it seems
   necessary, the design is wrong.
4. **Workflows that read secrets are `workflow_dispatch` only.** If such a job
   also ran on `pull_request`, anyone able to push a branch could edit the
   workflow on that branch and exfiltrate the key.
5. **No mainnet funds during development.**

---

## Environment gotchas

- **`gh` is installed but not on `PATH`.** Full path:
  `C:\Users\USER\AppData\Local\gh-install\bin\gh.exe`. Authenticated as
  `Temmygabriel` with `gist`, `read:org`, `repo`, `workflow` scopes.
  Don't conclude it's missing because `gh --version` fails.
- **The local machine cannot build.** ~0.6 GB free RAM; `npm install` hangs.
  All heavy work goes to GitHub Actions.
- **PowerShell 5.1 + `2>&1` corrupts `ConvertFrom-Json`** — it wraps native
  stderr in ErrorRecords. Omit `2>&1` when piping `gh api` into PS cmdlets.
- **`/tmp` is not `/tmp` for Node on Windows.** Pipe JSON through stdin instead
  of writing to `/tmp` and reading it from Node.
- **Solana packages install with `--no-save --no-package-lock`** in the devnet
  workflow, so `package-lock.json` is untouched. The main CI runs `npm ci`,
  which fails if the lockfile and `package.json` disagree.

---

## Protocol facts that are easy to get wrong

All established from the program's own IDL and source, not from documentation.
Detail in `docs/CLAIM_STATUS.md`.

- **Vouchers must arrive via the Ed25519 precompile.** `settle`'s only accounts
  are `channel` and `instructionsSysvar` — there is nowhere to put a voucher in
  the instruction data. **This requirement is absent from the build spec.**
  Missing it → error 230.
- **Voucher** is a 50-byte cumulative message: magic `[0x56, 0x01]`, channel id
  (32), `cumulative_amount` (u64 LE), `expires_at` (i64 LE, 0 = never).
  Cumulative is what makes a usage tab work.
- **Channel PDA seeds** are
  `[b"channel", payer, payee, mint, authorized_signer, salt(u64 LE), open_slot(u64 LE), bump]`.
  `CHANNEL_SEED` is literally the bytes `b"channel"`.
- **The channel's token account is owned by the channel PDA** —
  `ATA(channel, mint, token_program)`, error 51. Not the payer's.
- **`payer` and `payee` must differ** (error 2001).
- **`authorized_signer` must be a valid Ed25519 public key** (error 2002), not
  arbitrary 32 bytes.
- **`gracePeriod` must be non-zero** (error 201) and is in **seconds**.
  It is the payer's protection window: `requestClose` sets `closureStartedAt`
  and moves OPEN → CLOSING, after which the payee has that long to submit a
  final voucher before `seal` becomes permissionless. `settleAndSeal` seals
  *mid-grace*, so the normal path never waits.
- **`open_slot` is a PDA seed and must land within 1,500 slots** (error 2003).
  Missing the window changes the channel address and forces a re-sign.
- **A channel cannot fully close until `slot > open_slot + 1500`** (error 2414).
- **`distribute` needs a treasury account** — `ATA(TREASURY_OWNER, mint, token_program)`,
  error 2401 (`TreasuryAccountMismatch`) when the *owner* is wrong and 2402
  (`InvalidTreasuryTokenAccount`) when the owner is right but the *account*
  does not exist. **The ATAs must exist before `distribute` runs**; the payee's
  is validated too (2404/2405). Create them idempotently first — anyone may
  create `ATA(owner, mint, token_program)`, the account belongs to that owner,
  and the only cost is rent. `tools/lib/protocol.mjs` has the builder.
  Distinguishing 2401 from 2402 is the fastest way to tell "wrong owner" from
  "owner right, account missing".
- **A channel is exactly 256 bytes**, matching `Channel::LEN`.
- **`open` discriminator is `1`**; instruction data is
  `[1] + salt(u64) + deposit(u64) + gracePeriod(u32) + openSlot(u64) + count(u32) + entries{recipient:pubkey, bps:u16}`.
- **`recipients` may be empty** (0–32 allowed, error 260). If present, each
  `bps` must be non-zero and the total at most 10,000 (error 261).

### Settlement mechanics — the part that bites

- **`settle`'s instruction data is one byte**: its discriminator (`2`). Its only
  accounts are `channel` (writable) and the Instructions sysvar. The voucher is
  **not** an argument.
- **The voucher rides in the Ed25519 precompile at instruction `current - 1`.**
  The program loads that instruction from the sysvar and parses it. The two must
  be **adjacent and in that order**; anything in between gives error 230,
  `missingEd25519Verification`.
- **There is no message-equality check.** Error 236 `voucherMessageMismatch` is
  marked *Reserved*. The signed message *is* the voucher — there is no second
  copy to reconcile.
- **The precompile payload is exactly 162 bytes**, and the field order is
  counter-intuitive:

  ```
  0    num_signatures u8  = 1        16..48   public key   (32)
  1    padding        u8  = 0        48..112  signature    (64)
  2..16  seven u16 LE offsets        112..162 message      (50)
        (3 offsets + three 0xFFFF instruction indices)
  ```

  `signature_offset = 48`, `public_key_offset = 16`, `message_data_offset = 112`,
  `message_data_size = 50`, and all three `*_instruction_index` fields `0xFFFF`.
  Note **pubkey comes before signature** — the reverse of the usual assumption.
  The precompile itself would accept either arrangement because it reads via the
  offsets, but the program's parser pins these three values exactly and rejects
  everything else with error 231.
- **Discriminators are not an enum in declaration order.** `open` 1, `settle` 2,
  `topUp` 3, `settleAndSeal` 4, `requestClose` 5, `seal` 6, `distribute` 7,
  `withdrawPayer` 8, `reclaim` 9, but **`emitEvent` is 228**. Look them up in the
  IDL; never infer.
- **`settleAndSeal` requires the payee's signature** and takes a one-byte
  `hasVoucher` option tag. Non-zero applies the preceding precompile voucher
  first, under the same rules as `settle`.
- **Voucher guards, and the error each produces:** magic (238), channel id (232),
  expiry (233), `cumulative > settled` strictly (234), `cumulative <= deposit`
  (235), signer == `authorized_signer` (237).
- **The payout split is deltas against `payout_watermark`, not `settled`.**
  `distribute` computes each share as
  `floor(settled * bps / 10_000) - floor(payout_watermark * bps / 10_000)`, and
  with no recipients the payee takes the whole remainder (`payee_bps` =
  10,000). So the payee receives `settled - payout_watermark` and, on SEALED,
  the payer is refunded `deposit - settled`. **Asserting the payee gets
  `settled - <watermark at the start of the run>` is the easy mistake** — using
  the channel's `settled` field as the subtrahend is wrong whenever the seal
  and the payout happen in different runs, because the seal has already moved
  `settled`.
- `Ed25519SigVerify111111111111111111111111111` is the precompile;
  `Sysvar1nstructions1111111111111111111111111` is the Instructions sysvar.

### Where the encoders live

`tools/lib/protocol.mjs` is the single source for the voucher payload, the
precompile payload, the channel decoder and the discriminators, with the byte
layouts documented in comments. `tools/devnet-open-channel.mjs` predates it and
still carries its own copies of the secret-decoding and channel-decoding code —
a known duplication, left alone deliberately because that script is the proven
Gate 1 reproduction path. Migrate it only with a way to re-verify.

---

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Asset | **Own devnet test mint** | Circle's devnet USDC faucet gives 20 per 2 hours, which cannot fund a 50-unit ceiling in one claim, and the balance drifts between runs. |
| Client | **Build instructions from the IDL ourselves** | The official TS client pins `@solana/kit ^6.1.0`; current is `8.4.0`. It is also not published on npm. |
| Token program | **Classic SPL Token** | Token-2022 is restricted to an extension allow-list. |
| Token-2022 | Not used | — |

---

## Resolved: the treasury owner

**The deployed devnet program's treasury owner is
`4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap`** — the same key that holds the
program's upgrade authority.

Established by **binary forensics, not inference**. `constants.rs` picks a
per-cluster owner through mutually-exclusive Cargo features; the `devnet` block
on branch `build/devnet-deployment` pins that address. Decoding it and
searching the deployed ProgramData ELF (`CghQXkmw2F6p1exMETiZdNeUx9QGraWsNZ4eom1Cuiw1`,
66,240-byte ELF) finds those exact 32 bytes **at ELF byte offset 61435**. The
0xBEEF sentinel and the mainnet owner `Cs2zdfUNonRdRGsiZUQQLdTxzxVvJZmgiX2mpLYKuEqP`
are both **absent**.

History worth remembering, because the reasoning error is instructive:
`constants.rs` carries a build-time assert that *rejects* the 0xBEEF sentinel
for any `devnet` build, with a `// TODO: real devnet owner` beside the sentinel
in every block. From the `v1.0.0` tag and `main`, the devnet block genuinely
does still hold the sentinel — so it looked as though the published source could
not compile for devnet at all, and the live program must have fallen through to
the placeholder. That was **wrong**, and a `distribute` attempt refuted it with
error **2401 `TreasuryAccountMismatch`**. The real value lives only on the
`build/devnet-deployment` branch, which is not on `main` and not tagged.

The lesson: three candidate values existed across refs and only one was right.
Read the deployed bytes rather than reasoning about which branch "should" have
shipped.

---

## Useful facts

- `@solana-program/token` 0.17.0 depends on `@solana/kit ^8.3.0` — compatible
  with 8.4.0. The `@solana-program/*` clients work at kit 8.
- `@solana/program-client-core` has an 8.4.0 release, so generating our own
  payment-channels client at kit 8 is viable if we ever want one.
- The program repo ships its IDL at
  `program/payment_channels/idl/payment_channels.json` (Codama root node,
  `standard: codama`, v1.6.0) plus a `codama.js` config.
- Raw instruction accounts take **plain addresses, not signer objects**. Passing
  a signer object makes the codec stringify it to `"[object Object]"` (15
  characters) and fail with a confusing base58 length error.
- `distributionHash` for an empty recipient list came out as
  `df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119`. It is
  non-zero even with no recipients, and `distribute` validates against it.
- Faucet: <https://faucet.solana.com> (the `solana airdrop` CLI no longer works).
