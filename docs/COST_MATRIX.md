# Cost Matrix

**Build spec Section 57.** Every mandatory dependency must have a verified free
path.

Verified: **2026-10-05**.

| Dependency | Purpose | Plan | Current cost | Quota / limit | Account required | Secret required | Expiry / credit risk | Official source | Mandatory? |
|---|---|---|---|---|---|---|---|---|---|
| Solana Devnet | Target network | Public cluster | $0 | Rate limited | No | No | None | https://solana.com/docs/references/clusters | **Mandatory** |
| `api.devnet.solana.com` | RPC | Public | $0 | 100 req/10s per IP; 40 req/10s per single RPC | No | No | Public endpoints "not intended for production"; may be throttled | https://solana.com/docs/references/clusters | **Mandatory** |
| Payment Channels program | On-chain protocol | Open source, MIT | $0 | n/a | No | No | None | https://github.com/solana-foundation/payment-channels | **Mandatory** |
| `@payment-channels/client` | TypeScript client | Generated locally with Codama | $0 | n/a | No | No | **Not on npm** — must be generated | `clients/typescript/package.json` in the repo above | **Mandatory** |
| `@solana/kit` | Solana SDK | npm, open source | $0 | n/a | No | No | Client pins `^6.1.0`; latest is `8.4.0` — conflict unresolved | https://registry.npmjs.org/@solana/kit | **Mandatory** |
| Devnet SOL | Fees + rent | Official faucet | $0 | "Maximum of 2 requests every 8 hours" | Optional GitHub sign-in raises the cap | No | Faucet could change limits | https://faucet.solana.com | **Mandatory** |
| Devnet test token | Demo asset | Own mint, **or** Circle faucet | $0 | Own mint: none. Circle: 20 USDC / 2h per asset+network | No | No | Circle faucet could change; 20/2h cannot fund a 50.00 ceiling in one claim | https://faucet.circle.com | **Mandatory** |
| GitHub (public repo) | Source + CI | Free | $0 | Unlimited public repos | Yes | No | None | https://github.com | **Mandatory** |
| GitHub Actions | CI / heavy builds | Standard runners, public repo | $0 | **Free, no minute cap** on public repos; 6h per job | Yes | No | Larger runners are charged — do not use them | https://docs.github.com/en/billing/concepts/product-billing/github-actions | **Mandatory** |
| Vercel | Hosting the demo | Hobby | $0 | Max function duration 300s; 2 GB / 1 vCPU; 4.5 MB body | Yes | No | Hobby limits could change; no SLA | https://vercel.com/docs/functions/limitations | **Mandatory** |
| Wallet (Wallet Standard) | Signing | Browser extension | $0 | n/a | No | No | None | https://solana.com/docs/frontend | **Mandatory** |
| Vitest | Unit tests | MIT | $0 | n/a | No | No | None | npm | Optional |
| Playwright | E2E tests | Apache-2.0 | $0 | Browser download is slow in CI | No | No | None | https://playwright.dev/docs/ci-intro | Optional |
| Helius RPC | RPC fallback if 429s occur | Free tier | $0 | 1M credits/month; 10 req/s | Yes | Yes (API key) | Free tier terms could change; **devnet support on the free tier is UNVERIFIED** | https://www.helius.dev/pricing | **Optional fallback** |
| FluxRPC | RPC fallback | Free tier | $0 | 10 GB/month | Yes | Yes | Terms could change | https://fluxrpc.com/free | Optional fallback |

## Explicitly NOT used

| Service | Why not |
|---|---|
| Any paid RPC tier | Not needed; the free path is intact |
| QuickNode | "Free" tier is a **1-month trial**, not perpetual — rejected as a mandatory dependency |
| Chainstack faucet | Requires a mainnet SOL balance — not permissionless, rejected |
| Circle Developer Console faucet | Only funds Circle Programmable Wallets — does not fit |
| Any database / hosted Postgres | Not required for the MVP; the chain is the financial source of truth |
| Any sponsored or whitelisted infrastructure | None required; no human approval needed anywhere on the core path |

## Gate

```
ZERO-COST CORE PATH: PASS
```

Every mandatory dependency has a verified free path. No paid service is
required. Two optional free RPC fallbacks exist if the public endpoint
throttles.

**Caveats that keep this honest:**

- The Helius free tier's **devnet** support is `UNVERIFIED`. It is listed as a
  fallback, not a dependency.
- Vercel Hobby limits and faucet quotas are outside our control and could
  change. Re-verify before final submission.
- "Free" here means no money. It does not mean no risk — Vercel's shared egress
  IPs could still attract 429s from the public RPC.
