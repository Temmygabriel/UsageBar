# UsageBar

**Pay for what you actually use.**

A usage-based payment tab built on [Solana Payment Channels](https://github.com/solana-foundation/payment-channels).

[![CI](https://github.com/Temmygabriel/UsageBar/actions/workflows/ci.yml/badge.svg)](https://github.com/Temmygabriel/UsageBar/actions/workflows/ci.yml)

**Live on Devnet: <https://usagebar.vercel.app>**

---

## What is proven, right now

Not a plan. Every figure below was read back from Solana Devnet after the
transaction that was supposed to change it, and the artifacts are committed.

| | |
|---|---|
| The app, open through close, over HTTPS | **71 of 71 checks passed** — [evidence](evidence/deployed-app-probe.json) |
| A channel opened with real money | [tx `4oVZ4t…U54YCH`](https://explorer.solana.com/tx/4oVZ4tFQx75jmBNgAKrxPzDyMps6wCshhQcmy42vPg3Q6kemW95K7jxeXBq47E3Fy25bgKKwEj3iWsQKVbU54YCH?cluster=devnet) |
| The meter advanced on signed vouchers | five vouchers, cumulative `1.25 → 6.25` TEST, [artifacts](evidence/canonical-run/) |
| Sealed and paid out | [tx `2y3Sut…S7Ggvj`](https://explorer.solana.com/tx/2y3SutVFC9L4ggQjDkj6KFZXETM3cUgB6rgwxbQcEAeTFZwDNCkQXyAPSAdue1gvmb9R7StTNzFGVakb8BS7Ggvj?cluster=devnet) |
| The provider was paid, the customer refunded | [tx `5vbXmk…vePeQ5`](https://explorer.solana.com/tx/5vbXmk8d4bMQUHpvXWzZ993N8CsEvvLXkRnK4cHVYUiKA59X7Po4ru5Jy1hn82D587ZDZTX8eLyfrwxS8AvePeQ5?cluster=devnet) |

The last line is the product's whole promise: **50 TEST in, 6.25 TEST metered,
43.75 TEST back to the customer, escrow drained to zero.** Money moved, in the
right amounts, to the right accounts — not transactions that merely succeeded.

Claim by claim, including what is *not* proven:
[`docs/CLAIM_STATUS.md`](docs/CLAIM_STATUS.md).

---

## 30-second explanation

**UsageBar is a payment layer for services whose final cost depends on how much you use them.** Instead of approving a separate blockchain payment for every second, API call, or delivered unit, a customer approves a spending cap once. Usage is recorded as signed updates, then one final settlement pays for what was used and returns the unused balance.

Example: approve a 50 TEST cap; if the session uses 6.25 TEST, the provider receives 6.25 TEST and 43.75 TEST returns to the customer. The 50 TEST is a ceiling, not the amount automatically charged.

**Who might use this pattern?** Providers of metered AI/API access, compute jobs, data downloads or time-based rentals—especially where many small usage events would make one on-chain payment per event slow or cumbersome.

**What this demo actually does:** it simulates a camera-rental timer and meters time. It is not connected to a real camera, rental company, AI API or compute service. The payment-channel settlement is real on Solana Devnet; the TEST tokens have no real-world value. UsageBar demonstrates the payment mechanism, not a live commercial service.

## Live Demo

**<https://usagebar.vercel.app>**

Choose Phantom, Solflare, or OKX Wallet and set it to Devnet. The app can
stock the selected wallet with free test SOL and TEST tokens if it is empty,
so there is nothing to acquire first. You sign the deposit yourself — your key
never leaves your wallet — watch the meter advance, and close, getting the
unused remainder back. A human browser walkthrough is still required to verify
the selected wallet's extension-specific connection and signing behavior.

Nothing on that site has any value. It is Devnet.

## Demo Video

Not recorded yet. This is honestly the last packaging item outstanding.

## Verified Devnet Run

The canonical run `canonical-usagebar-devnet-001` completed all twelve steps in
one uninterrupted pass with an evidence artifact for each. Committed under
[`evidence/canonical-run/`](evidence/canonical-run/), and re-checked
independently by [`tools/verify-canonical-run.ts`](tools/verify-canonical-run.ts),
which re-derives the channel address from its recorded PDA seeds, re-queries all
eight transaction signatures, and compares the plan reveal against the
commitment the channel has carried since it opened.

| | |
|---|---|
| Channel | [`4LtkUA…Pz4S`](https://explorer.solana.com/address/4LtkUAsruLTTi9xzwy6Zd67U8uz8d8sX72gyYsKjPz4S?cluster=devnet) |
| Deposit | `50000000` atomic units (50 TEST) |
| Metered | `6250000` over five vouchers, each after a real measured 5-second interval |
| Provider received | `6250000`, read from its own token account |
| Customer refunded | `43750000`, exactly `deposit − settled` |
| Escrow after | closed and empty |

**One thing these artifacts do not show.** Unlike an earlier channel, this one
was not reaped: reclamation needs `slot > open_slot + 1500`, and it was opened
seconds before it closed. It survives at status `3` (Distributed) with the
escrow drained. Both outcomes are the program behaving correctly, and which one
you get depends on how long the channel lived.

## What is novel

Not much, and we will not claim otherwise.

Payment tabs and usage-based billing already exist. Solana Payment Channels
already exists. The product contribution is the composition: applying a capped,
cumulative, on-chain-settled channel to a simple human-facing usage session, so
that a service can meter usage many times but settle value once.

The honest framing is in [`docs/AUDIT_REPORT.md`](docs/AUDIT_REPORT.md).

## Why Solana Payment Channels

Because the protocol supplies the four things this product actually needs:

| Need | Payment Channels provides |
|---|---|
| A hard spending limit | An escrowed deposit on-chain |
| Many usage updates, one settlement | Cumulative off-chain signed vouchers |
| Final payment | On-chain settlement and distribution |
| Getting the unused part back | Recovery of remaining escrow |

## How it works

```
onchain ceiling
      ↓
cumulative signed usage   (off-chain, no transaction per update)
      ↓
one final settlement
      ↓
unused amount recovered
```

The customer signs exactly one transaction — the deposit. Every usage update
after that is a signature over 50 bytes that costs nothing and touches no chain.
Only the final settlement is a transaction again, and it pays the provider and
refunds the customer in the same breath.

## Usage Session Lifecycle

Product states:

```
READY → OPENING → FUNDED → ACTIVE → FINALIZING → SETTLED
```

These are **product** words. The protocol's own states are `Open`, `Closing`,
`Sealed`, `Distributed`. The mapping between the two is documented in
[`docs/PROTOCOL_DISCOVERY.md`](docs/PROTOCOL_DISCOVERY.md).

## Architecture

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the trust boundary, why the
server builds the transaction and the wallet signs it, and why the customer's
key never reaches a server.

## Security

[`docs/SECURITY.md`](docs/SECURITY.md) — threat model, signer model and
invariants, including what an attacker who controls the service still cannot do.

**The service meter is simulated. The payment mechanism is real.** The project
does not claim trustless physical metering, IoT telemetry, or fraud-proof usage
measurement. See [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).

## Tests

```bash
npm run test        # 110 tests across 4 files
npm run typecheck
```

The wire format is tested byte for byte against a re-implementation of the
program's own parser guards, so a drift from the protocol fails here rather than
mid-demo.

The strongest test is not in that suite. It is
[`tools/probe-deployed-app.mjs`](tools/probe-deployed-app.mjs), which drives the
**live deployment** over HTTPS and then checks every number it reports against a
Devnet RPC endpoint this repository does not control. It found a real bug the
unit tests could not have: the close path was attaching a voucher for the
watermark already on chain, which the program rejects, so pressing Close
returned a 502 for any tab that had metered anything. Four earlier verification
gates had passed while that bug was live, because all four drove the tooling
rather than the product.

```bash
node tools/probe-deployed-app.mjs          # needs nothing installed
```

## Evidence

[`evidence/`](evidence/) holds three kinds of proof, and the distinction matters:

- [`evidence/canonical-run/`](evidence/canonical-run/) — twelve artifacts
  proving the **protocol** works along the path this product uses, produced by
  the tooling.
- [`evidence/extended-paths/`](evidence/extended-paths/) — nine artifacts
  proving the **protocol** works along the four paths this product does not
  use: `topUp`, a distribution plan with real recipients, and the
  `requestClose` → `seal` → `withdrawPayer` timeout escape hatch. Also tooling.
- [`evidence/deployed-app-probe.json`](evidence/deployed-app-probe.json) —
  proving the **deployed application** works, produced over HTTP.

## Known Limitations

- **Simulated service usage.** The meter is not trustworthy and does not claim to be.
- **Devnet test funds only.** No real economic value.
- **The browser wallet handshake has not been exercised by a human.** The
  deployment probe signs and lands a real `open` transaction against the live
  server, but it signs it itself — it stands in for a wallet's cryptography,
  never for Phantom's consent screen.
- **Every protocol instruction is now exercised on Devnet, but not by the
  application.** The four paths the canonical run never touched were driven
  directly by [`tools/devnet-extended-paths.mjs`](tools/devnet-extended-paths.mjs)
  — see [`evidence/extended-paths/`](evidence/extended-paths/). A proven
  instruction is not an integrated one: the app still opens channels with an
  empty plan and calls none of them. The distinction is drawn in
  [`docs/CLAIM_STATUS.md`](docs/CLAIM_STATUS.md).
- The `seal` grace guard's refusal rests on the shape of the run — the identical
  instruction succeeds once the clock advances — rather than on the error name,
  which is transcribed from the program's source and is corroboration only.
- **The evidence has been wrong once.** The first committed extended-paths
  artifacts reported channel state read *before* their own transaction, under
  names claiming otherwise. Nothing was fabricated — they were true reads of
  the wrong moment — and they were caught by re-reading both channels over raw
  `getAccountInfo` rather than by trusting the artifacts. The fix and the
  reasoning are recorded in [`evidence/README.md`](evidence/README.md) rather
  than quietly amended.
- Hackathon-scale prototype, not production infrastructure.
- Not a bank, payment processor, escrow service, or billing platform.

## Reproduction

Nothing here needs to be taken on trust.

| Task | How |
|---|---|
| Typecheck, test, build | Automatic on every push |
| Re-check the evidence against the chain | Actions → **Devnet** → `verify-canonical` (sends no transaction, needs no keypair) |
| Re-run the canonical run | Actions → **Devnet** → `canonical-run` |
| Re-run the extended-paths run | Actions → **Devnet** → `extended-paths` (opens two real channels on Devnet) |
| Probe the live deployment | Actions → **Probe deployment** (needs no secret), or `node tools/probe-deployed-app.mjs` |

Heavy work runs in GitHub Actions, because the development machine has about
0.6 GB of free RAM. The deployment probe is the exception: it needs no
dependencies at all, only Node's own `crypto`.

## Protocol References

- [Solana Payment Channels](https://github.com/solana-foundation/payment-channels) — the on-chain program
- [Solana payment channels concept](https://solana.com/payment-channels)
- [Solana agentic payments docs](https://solana.com/docs/payments/agentic-payments)
- [x402](https://github.com/x402-foundation/x402) — related, **not** the scheme used here

## License

MIT
