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

Classic SPL Token (`Tokenkeg...`), chosen over Token-2022 deliberately: the
program restricts Token-2022 to an extension allow-list, and a plain mint
cannot trip it.

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
  error 2401. See the treasury risk below.
- **A channel is exactly 256 bytes**, matching `Channel::LEN`.
- **`open` discriminator is `1`**; instruction data is
  `[1] + salt(u64) + deposit(u64) + gracePeriod(u32) + openSlot(u64) + count(u32) + entries{recipient:pubkey, bps:u16}`.
- **`recipients` may be empty** (0–32 allowed, error 260). If present, each
  `bps` must be non-zero and the total at most 10,000 (error 261).

---

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Asset | **Own devnet test mint** | Circle's devnet USDC faucet gives 20 per 2 hours, which cannot fund a 50-unit ceiling in one claim, and the balance drifts between runs. |
| Client | **Build instructions from the IDL ourselves** | The official TS client pins `@solana/kit ^6.1.0`; current is `8.4.0`. It is also not published on npm. |
| Token program | **Classic SPL Token** | Token-2022 is restricted to an extension allow-list. |
| Token-2022 | Not used | — |

---

## Unresolved risk: the treasury owner

A build-time assert rejects the `0xBEEF` treasury sentinel, and the `devnet`
config block sets exactly that sentinel. **The published source therefore cannot
compile for devnet at all**, meaning the live devnet program was built some
other way and very likely carries the placeholder.

If so, `distribute` can still pay into `ATA(TREASURY_OWNER, mint, ...)` — anyone
may create that account — but the residual is unspendable forever, because no
one holds the key.

**Hypothesis, not finding.** Settled by running `distribute` against devnet.

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
