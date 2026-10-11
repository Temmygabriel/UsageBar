# UsageBar — Project Brief

**Live demo:** <https://usagebar.vercel.app>

**Source:** <https://github.com/Temmygabriel/UsageBar>

**Network:** Solana Devnet; project-specific TEST token with no real-world value.

## Summary

UsageBar is a capped payment tab for metered services. A customer authorizes a maximum amount once. Successful service usage is represented by cumulative, provider-signed vouchers off-chain. When the tab closes, Solana Payment Channels settles the metered amount and returns the unused deposit.

The current demonstration service is a Groq-powered contract reviewer. The user selects a cap of 5, 10, 25, or 50 TEST. Each successful review is priced at 1.00 TEST under a demo rule. This price is not Groq's actual inference cost or validated commercial pricing.

## Why Payment Channels?

A database can record usage, but does not itself enforce an on-chain spending ceiling or settle funds according to the final metered amount. UsageBar uses Solana Payment Channels to combine:

- An on-chain escrowed spending cap.
- Cumulative off-chain signed usage updates.
- On-chain settlement and distribution.
- Return of the unused balance.

The customer signs the channel-opening transaction with their own wallet. The service does not receive the customer's private key. Individual reviews and vouchers do not require separate on-chain transactions, although opening and closing/distributing the channel do.

## User flow

1. **Authorize:** connect a supported wallet on Devnet, choose a cap, and sign the open/deposit transaction.
2. **Review:** submit sample or public, non-confidential contract text. The server calls Groq and, after a valid response, returns a provider-signed cumulative usage voucher.
3. **Close:** submit the latest usage voucher and close the channel through the Payment Channels flow.
4. **Distribute:** pay the measured amount to the provider and return the unused deposit to the customer.

Contract text is sent to Groq's API. The service is a hackathon prototype, not legal advice. Use sample or public documents only.

## Evidence

All evidence below is committed in this repository. The canonical protocol run predates the Groq service integration; it proves the channel/payment path, not that Groq was called in that run.

- **Canonical run:** 50.00 TEST deposited, 6.25 TEST metered via five cumulative vouchers, 6.25 TEST paid to the provider, and 43.75 TEST returned to the customer. See [the canonical artifacts](../evidence/canonical-run/) and [settlement record](../evidence/canonical-run/09-settlement.json).
- **Historical deployed-app probe:** 71/71 HTTP/API checks passed on the recorded deployment/build. See [probe evidence](../evidence/deployed-app-probe.json). The probe signs its own transaction and therefore does not prove the behavior of a human wallet extension.
- **Additional protocol paths:** [extended-path artifacts](../evidence/extended-paths/) cover paths that are not all integrated into the clickable application flow.

The detailed status ledger is [Claim Status](CLAIM_STATUS.md), with additional context in [Limitations](LIMITATIONS.md) and the [evidence guide](../evidence/README.md).

## Technology

- Solana Devnet and the deployed Solana Payment Channels program.
- Next.js, React, and TypeScript.
- Wallet Standard with wallet-specific fallback support.
- Groq API for structured contract review.
- Upstash Redis for the latest cumulative voucher state in serverless hosting.
- Vercel deployment configuration and GitHub Actions for checks and Devnet tooling.

## What is not claimed

- No mainnet deployment or real monetary value.
- No customer adoption, market validation, production merchant integration, or proven commercial pricing.
- The blockchain verifies the voucher signature and channel accounting; it does not independently prove that the model ran or that an AI review is legally correct.
- Automated tests and the HTTP/API probe are not a human browser-wallet walkthrough. A complete wallet-extension journey, including signing, review, settlement, repeated use, and reconnection, remains unverified.
- The latest repeated-session and wallet-reconnect source passed GitHub CI, but the last recorded Vercel deployment attempt was rate-limited. Do not assume the production alias serves the latest source until a successful deployment is confirmed. The Render fallback is configuration only unless it has been separately deployed and verified.

## Reproduction

```bash
npm run typecheck
npm run test
node tools/probe-deployed-app.mjs
```

The probe checks a deployed HTTP/API flow and reads chain state; it is not a wallet-extension test. Devnet workflows that create channels or send transactions should be read carefully before running.

See [Architecture](ARCHITECTURE.md), [Security](SECURITY.md), and [Protocol Discovery](PROTOCOL_DISCOVERY.md) for deeper technical detail.
