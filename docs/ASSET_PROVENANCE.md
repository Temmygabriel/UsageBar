# Asset Provenance — the UsageBar devnet test token

**Decision: Option A — a purpose-built devnet mint we control.**

Recorded 2026-10-05. Every value below was read back from the chain, not taken
from our own script's claim about what it did.

---

## Why we did not use devnet USDC

Devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) is a real token
with a real faucet, which makes it tempting. It was rejected for two concrete,
reproducible reasons:

1. **The faucet cannot fund the demo.** Circle's devnet faucet issues **20 units
   per 2 hours**. The demo's stated ceiling is **50 units**. A single claim
   cannot fund a single run of the demo, let alone a repeated one.
2. **The balance is not ours.** Anyone can spend a devnet USDC balance at any
   time, and the amount a test starts with depends on how many times it has run
   before. A test whose inputs drift is not a test.

A mint we control makes the run reproducible: same starting balance, same
numbers, every time.

**This token is not USDC.** It is never presented as USDC, never priced, and
never described as having value. It is labelled `TEST` in the UI and in this
repository.

---

## The token

| Property | Value | How it was established |
|---|---|---|
| Mint address | `6Jpyq8iUszZdZd2z3G9is1nfJh7ZwqbekW9cH2w58hmL` | Chain readback |
| Token program | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Chain readback (`owner` field) |
| Token standard | **Classic SPL Token** (not Token-2022) | Derived from the owner program |
| Decimals | `6` | Chain readback (`parsed.info.decimals`) |
| Total supply | `1000000000000` atomic = **1,000,000.000000 TEST** | Chain readback (`parsed.info.supply`) |
| Mint authority | `8XGW8giZJUvDMZPrFP3vufBn3zwc7GHgmHCH28e9HUQQ` (the devnet test payer) | Chain readback |
| Freeze authority | `null` | Chain readback |
| Initialised | `true` | Chain readback |

Classic SPL Token was chosen over Token-2022 deliberately: Token-2022 support in
the payment-channels program is restricted to an extension allow-list, and a
plain mint cannot trip that restriction.

### Creating transaction

```
3obYkSjawCXw1qni6Hf487XxBcoLTnqCbPoMGtXmnLHSaxGweo3pyGRGoT38xbT8VqHVjLHsWNvn7F8s7xHJn2mJ
```

- Explorer (mint): <https://explorer.solana.com/address/6Jpyq8iUszZdZd2z3G9is1nfJh7ZwqbekW9cH2w58hmL?cluster=devnet>
- Explorer (tx): <https://explorer.solana.com/tx/3obYkSjawCXw1qni6Hf487XxBcoLTnqCbPoMGtXmnLHSaxGweo3pyGRGoT38xbT8VqHVjLHsWNvn7F8s7xHJn2mJ?cluster=devnet>

This single transaction created the mint account, initialised it, created the
payer's associated token account, and minted the full supply.

### Raw chain readback

```
mint address  : 6Jpyq8iUszZdZd2z3G9is1nfJh7ZwqbekW9cH2w58hmL
owner program : TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
lamports      : 1066800
parsed data   : {
  "decimals": 6,
  "freezeAuthority": null,
  "isInitialized": true,
  "mintAuthority": "8XGW8giZJUvDMZPrFP3vufBn3zwc7GHgmHCH28e9HUQQ",
  "supply": "1000000000000"
}
payer balance of TEST: {"amount":"1000000000000","decimals":6,"uiAmount":1000000,"uiAmountString":"1000000"}
```

---

## Reproducing this

```
node tools/devnet-bootstrap.mjs
```

The script is **idempotent**: it checks whether the mint already exists and, if
it does, reports that and changes nothing. Re-running it can never create a
second mint. It also finishes by reading the mint back from the chain, so a
silent failure cannot be mistaken for success.

In CI it runs through `.github/workflows/devnet-bootstrap.yml`, which is
`workflow_dispatch` only — see the comment at the top of that file for why.

### Where the keys are

| Key | Location | Notes |
|---|---|---|
| `devnet-smoke-payer` | `local-wallet/devnet-smoke-payer.json` (gitignored) | Funded via faucet. Also in GitHub secret `DEVNET_PAYER_KEYPAIR`. |
| `devnet-test-mint` | `local-wallet/devnet-test-mint.json` (gitignored) | Also in GitHub secret `DEVNET_TEST_MINT_KEYPAIR`. |

Both are **devnet-only** keys that hold nothing of value. Neither is committed.
Neither is ever printed by any script.

The mint keypair is required because an SPL mint's address must be a keypair at
creation time. After creation the mint has **no authority over itself** — the
mint authority is the payer — so the mint keypair is inert from then on.

---

## Known limitation: the treasury owner

This is a real, currently-unresolved risk, recorded here because it will matter
when we reach `distribute`.

The program has a compile-time gate:

```rust
#[cfg(any(feature = "devnet", feature = "testnet", feature = "mainnet-beta"))]
const _: () = assert!(
    !matches!(cluster::TREASURY_OWNER, TREASURY_OWNER_SENTINEL),
    "TREASURY_OWNER is still the 0xBEEF placeholder; ...",
);
```

The `devnet` cluster block in the source sets `TREASURY_OWNER` to exactly that
sentinel, with a `// TODO: real devnet owner` comment. So **the source as it
stands cannot be compiled with `--features devnet`.**

The live devnet deployment must therefore have been built either without that
feature (in which case it carries the `0xBEEF` placeholder) or from a modified
source we cannot see.

`distribute` requires a `treasuryTokenAccount` validated as
`ATA(TREASURY_OWNER, mint, token_program)`. If the deployed program does hold
the placeholder, that address is derivable and its token account can be created
by anyone — so `distribute` may still work — but any residual paid to it is
permanently unspendable, because no one holds that private key.

**This is not yet tested. It is a hypothesis, not a finding.** It is resolved by
running `distribute` against devnet, which is planned for the settlement phase.
Until then the relevant `CLAIM_STATUS.md` row stays `UNVERIFIED`.


---

## UsageBar UI branding assets — 2026-10-10

| Asset | Source | Status |
|---|---|---|
| UsageBar brand mark in header | Original inline SVG authored for this repository | Original project asset; no external source |
| Browser favicon | `app/icon.svg`, original SVG using the same bar/meter motif | Original project asset; no external source |
| Camera icon inside Usage Tab | Inline SVG authored for this repository | Original project asset; decorative only |
| Camera scene behind landing hero | `public/camera-scene.webp` | Existing compressed concept crop; **fails visual acceptance** because of visible mosaic/compression artifacts and insufficient source resolution. High-resolution photographic replacement remains outstanding. |
| Fonts | Fraunces, IBM Plex Sans, IBM Plex Mono via `next/font` | Existing font setup retained |

## Landing hero camera scene

- File: `public/camera-scene.webp`
- Source: the camera/tabletop/brand-card scene in the original generated UsageBar concept image supplied with the design references.
- Current delivered size: **660 × 252 pixels**, matching the landing-page hero crop.
- Replacement: generated from the supplied photographic reference and center-cropped/resized to **660 × 252 pixels** in WebP format (**8,424 bytes**). The repository asset has been replaced on `fix/ui-branding-accessibility`; final Vercel visual verification is pending.
- Visual target: black mirrorless camera on warm oak, restrained cream card, subtle foliage at left, and natural daylight. No screenshot UI, fabricated text, watermark, or neon treatment.
- Purpose: an atmospheric background layer beneath the landing-page proposition and three-step explanation. The live Usage Tab remains a separate foreground component.
- Honesty: the scene is illustrative concept artwork, not a real rental listing or connected camera. Camera usage is simulated; Solana Devnet payment-channel behavior is separately real and must continue to be shown only from verified application/chain state.
- External requests: none. The scene is served locally from the repository.
