# UsageBar

**Pay for what you actually use.**

A usage-based payment tab built on [Solana Payment Channels](https://github.com/solana-foundation/payment-channels).

[![CI](https://github.com/Temmygabriel/UsageBar/actions/workflows/ci.yml/badge.svg)](https://github.com/Temmygabriel/UsageBar/actions/workflows/ci.yml)

---

## Status: Phase 0 — protocol gate not yet passed

**Read this before anything else.**

This repository is at the scaffold stage. **No payment channel has been opened
yet.** Nothing on the running site displays a blockchain result, because there
is no blockchain result to display yet.

The project is built under a rule that governs everything else: **the protocol
is the source of truth, and nothing may be faked.** No simulated transactions,
no invented program IDs, no placeholder token addresses presented as real, no
`SETTLED` state before chain state has been read back.

See [`docs/CLAIM_STATUS.md`](docs/CLAIM_STATUS.md) for exactly what is proven
and what is not.

---

## 30-second explanation

Opening a tab at a bar is easy: you hand over a card once, drinks get added as
you go, and you settle once at the end. UsageBar applies that to services that
charge by usage.

A customer authorizes a maximum amount once. Usage accumulates through signed
updates that cost no transaction each. When the session ends, the real amount
is settled on-chain and the unused remainder stays recoverable by the payer.

The demo service is **camera rental**. It is a demonstration environment, not a
marketplace.

---

## Live Demo

Not deployed yet. A live URL will be added once the Devnet gate passes.

## Demo Video

Not recorded yet.

## Verified Devnet Run

**Not yet performed.** The canonical run `canonical-usagebar-devnet-001` has
not been executed. When it is, its evidence will be committed under
[`evidence/canonical-run/`](evidence/) and independently checked by
`tools/verify-canonical-run.ts`.

*This section intentionally says nothing until it can say something true.*

---

## What is novel

Not much, and we will not claim otherwise.

Payment tabs and usage-based billing already exist. Solana Payment Channels
already exists. The product contribution is the composition: applying a
capped, cumulative, onchain-settled channel to a simple human-facing usage
session, so that a service can meter usage many times but settle value once.

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

## Usage Session Lifecycle

Product states:

```
READY → OPENING → FUNDED → ACTIVE → FINALIZING → SETTLED
```

These are **product** words. The protocol's own states are `Open`, `Closing`,
`Sealed`, `Distributed`. The mapping between the two is documented in
[`docs/PROTOCOL_DISCOVERY.md`](docs/PROTOCOL_DISCOVERY.md).

## Architecture

To be written in [`docs/ARCHITECTURE.md`](docs/) once the protocol path is
chosen and tested.

## Security

Trust model, signer model, and the invariants are specified in the build spec
and summarised in [`docs/AUDIT_REPORT.md`](docs/AUDIT_REPORT.md) (Report 7).
A full `docs/SECURITY.md` follows the protocol gate.

**The service meter is simulated. The payment mechanism is real.** The project
does not claim trustless physical metering, IoT telemetry, or fraud-proof
usage measurement.

## Tests

```bash
npm run test        # unit tests (amount arithmetic, ceiling, monotonicity)
npm run typecheck
```

Everything heavier — install, build, and later the protocol integration and
end-to-end runs — executes in GitHub Actions, because the development machine
has 8 GB RAM.

## Evidence

Not yet produced. See `evidence/`.

## Known Limitations

- Simulated service usage; the meter is not trustworthy and does not claim to be.
- Devnet test funds only. No real economic value.
- Public RPC rate limits.
- Hackathon-scale prototype, not production infrastructure.
- Not a bank, payment processor, escrow service, or billing platform.

## Reproduction

To be written once the canonical run exists. There is nothing to reproduce yet.

## Protocol References

- [Solana Payment Channels](https://github.com/solana-foundation/payment-channels) — the on-chain program
- [Solana payment channels concept](https://solana.com/payment-channels)
- [Solana agentic payments docs](https://solana.com/docs/payments/agentic-payments)
- [x402](https://github.com/x402-foundation/x402) — related, **not** the scheme used here

## License

MIT
