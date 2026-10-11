# UsageBar

**Pay for what you actually use.**

UsageBar is a usage-based payment tab built on [Solana Payment Channels](https://github.com/solana-foundation/payment-channels). A customer authorizes a spending cap once, usage accumulates through provider-signed vouchers off-chain, and the channel settles on-chain when the session closes. The provider receives the used amount; the customer recovers the unused remainder.

[![CI](https://github.com/Temmygabriel/UsageBar/actions/workflows/ci.yml/badge.svg)](https://github.com/Temmygabriel/UsageBar/actions/workflows/ci.yml)

**Live demo:** <https://usagebar.vercel.app> · **Network:** Solana Devnet · **Asset:** project-specific TEST token with no real-world value.

## The product

The current demo applies payment-channel metering to a Groq-powered contract-review service:

1. **Authorize a cap.** The customer selects 5, 10, 25, or 50 TEST and signs the on-chain channel-opening transaction. The cap is a maximum exposure, not an automatic charge.
2. **Use the service.** A successful contract review is priced at 1.00 TEST under the demo's fixed pricing rule. The provider signs a cumulative Ed25519 usage voucher off-chain; the application does not send a blockchain transaction for every review.
3. **Settle once.** When the customer closes the tab, UsageBar submits the latest metered amount to the Payment Channels program and distributes the funds.
4. **Return the remainder.** The provider receives the used amount and the customer receives the unused deposit back, according to the channel's configured distribution.

The 1.00 TEST review price is illustrative. It is not Groq's actual inference cost or validated market pricing. The service sends submitted contract text to Groq; use only the supplied sample or public, non-confidential text. AI output is not legal advice.

## Protocol evidence

The repository includes committed artifacts and reproducible verification tooling. Keep the following evidence runs distinct: the canonical protocol run predates the Groq service integration, while the deployed-app probe exercises an earlier deployment over HTTPS.

| Evidence | Result |
|---|---|
| Canonical Devnet run | 50.00 TEST deposited, 6.25 TEST metered across five signed vouchers, 6.25 TEST paid to the provider and 43.75 TEST returned to the customer. See [canonical artifacts](evidence/canonical-run/) and [settlement record](evidence/canonical-run/09-settlement.json). |
| Open transaction | [View on Solana Explorer](https://explorer.solana.com/tx/4oVZ4tFQx75jmBNgAKrxPzDyMps6wCshhQcmy42vPg3Q6kemW95K7jxeXBq47E3Fy25bgKKwEj3iWsQKVbU54YCH?cluster=devnet) |
| Settlement transaction | [View on Solana Explorer](https://explorer.solana.com/tx/2y3SutVFC9L4ggQjDkj6KFZXETM3cUgB6rgwxbQcEAeTFZwDNCkQXyAPSAdue1gvmb9R7StTNzFGVakb8BS7Ggvj?cluster=devnet) |
| Distribution and refund | [View on Solana Explorer](https://explorer.solana.com/tx/5vbXmk8d4bMQUHpvXWzZ993N8CsEvvLXkRnK4cHVYUiKA59X7Po4ru5Jy1hn82D587ZDZTX8eLyfrwxS8AvePeQ5?cluster=devnet) |
| Historical deployed-app HTTP/API probe | 71/71 checks passed for the deployment/build recorded in [probe evidence](evidence/deployed-app-probe.json). This is not proof of a human wallet-extension walkthrough and does not verify the latest source is deployed. |

**Deployment caveat:** The latest repeated-session and wallet-reconnect source passed GitHub CI, but the last recorded Vercel deployment attempt was rate-limited. The latest source is not confirmed on the production alias until a deployment and live verification succeed. A Render configuration exists in the repository; it is not a live fallback unless separately deployed and verified.

For claim-by-claim evidence and status, see [Claim Status](docs/CLAIM_STATUS.md), [Limitations](docs/LIMITATIONS.md), and the [evidence guide](evidence/README.md).

## Architecture

- **On-chain:** Solana Payment Channels enforces the channel deposit and cumulative settlement rules.
- **Off-chain:** the service signs cumulative Ed25519 vouchers after successful review responses.
- **Wallet:** the customer signs channel-opening transactions from a supported wallet; the service does not receive the customer's private key.
- **Service:** Next.js server routes call Groq and persist the latest voucher state in Upstash Redis.
- **Hosting:** Vercel production deployment (runtime configuration and current deployed source must be verified separately).

Payment Channels still requires on-chain transactions to open and close/distribute a channel. The improvement is that each individual metered review does not require its own blockchain transaction.

## Limitations and trust boundaries

- **Devnet only.** The protocol transactions and TEST token are for testing and have no real-world monetary value.
- **Human wallet flow not verified.** Automated tests and an HTTP/API probe do not establish that a person completed the wallet consent, signing, review, close, repeated-session, and reconnect journey in a browser with a real wallet extension.
- **Provider-attested metering.** The provider signs vouchers after successful service responses. The chain verifies voucher signatures and amounts; it does not independently prove that Groq ran or that the AI response is correct.
- **No commercial validation.** No customer adoption, validated pricing, production merchant integration, or legal accuracy is claimed.
- **Prototype security and availability.** Server-side keys and free-tier service limits apply; this is not production billing infrastructure.

See [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), [Claim Status](docs/CLAIM_STATUS.md), and [Limitations](docs/LIMITATIONS.md) for details.

## Run checks

Use Node.js/npm compatible with the lockfile. The usual lightweight checks are:

```bash
npm run typecheck
npm run test
```

The repository's CI also runs the production build and responsive checks. A separate HTTP/API probe can verify a deployed build:

```bash
node tools/probe-deployed-app.mjs
```

For evidence reproduction workflows, use the repository's GitHub Actions workflows and read the warnings first: some workflows send real transactions on Solana Devnet.

## Repository guide

- `app/`, `lib/` — application and protocol integration.
- `tests/` — automated tests.
- `tools/` — Devnet scripts, verifiers, and deployment probes.
- `evidence/` — committed protocol and deployment evidence.
- `docs/` — architecture, security, claim status, and limitations.
- `docs/development/` — internal build specification and unfinished test plan.

## License

MIT.
