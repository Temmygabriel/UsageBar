# Submission

Colosseum Crypto World's Fair. Live at **<https://usagebar.vercel.app>** ·
Source at **<https://github.com/Temmygabriel/UsageBar>**.

Every claim below is backed by a committed artifact under [`../evidence/`](../evidence/)
or a row in [`CLAIM_STATUS.md`](CLAIM_STATUS.md). Where something is not proven,
it says so rather than being left out — the limitations section is as much a
part of this document as the rest.

---

## One-line

> UsageBar is a usage-based payment tab that lets customers authorize a spending
> ceiling once, pay only for actual cumulative usage, and recover the unused
> remainder.

## Short description

> UsageBar brings the familiar idea of opening a service tab to crypto-native
> payments. A customer authorizes a maximum amount once, usage accumulates
> through signed vouchers, and the final amount is settled when the session
> closes.
>
> The current product demo is a Groq-powered contract-review service. The customer chooses a maximum of 5, 10, 25, or 50 TEST. Each successful review costs 1.00 TEST under the demo pricing rule and adds a provider-signed cumulative voucher off-chain. On close, the latest voucher is submitted and the channel is settled; the used amount is paid to the provider and the unused amount is returned. The older committed canonical run proves the protocol payout path (50.00 deposited, 6.25 metered, 43.75 returned), but it predates this AI-service integration and is not evidence that Groq was called.

Those three numbers are not illustrative. They are
[`evidence/canonical-run/09-settlement.json`](../evidence/canonical-run/09-settlement.json):
provider `6250000`, customer `43750000`, deposit `50000000`, and the escrow
account closed rather than zeroed.

## What is novel

> We are not claiming to invent payment tabs or usage billing. The product
> innovation is applying Solana's Payment Channels primitive to a simple
> human-facing usage session: one capped authorization, cumulative signed usage,
> and one final onchain settlement instead of a separate payment for each usage
> event.

## Why Solana Payment Channels

> UsageBar is built around Solana Payment Channels because the protocol provides
> the core behavior we need: an onchain spending ceiling, cumulative signed
> usage vouchers, onchain settlement, and recovery of unused escrow according to
> channel state.

The ceiling is enforced by the program, not by our server. The program's own
error enum carries `235 VoucherOverDeposit` for a voucher above the deposit and
`234 VoucherWatermarkNotMonotonic` for one that does not strictly advance the
watermark — and the second of those is not theoretical here: it is the error the
deployed app returned on its first probe, as a **502 on Close**, before the bug
behind it was found and fixed. Neither check is ours to forget.

## Why not a database?

> A database can record usage, but it does not itself provide the
> payment-channel settlement semantics. UsageBar uses the channel to establish
> the onchain spending boundary and final settlement, while usage updates can
> progress without a blockchain transfer for every individual event.

## Why not pay after?

> A postpaid database invoice can work for simple businesses. UsageBar is
> targeting services where the customer wants a defined maximum exposure while
> actual usage is still being measured.

---

## How it works

1. **Open.** The customer connects a supported wallet on Devnet, chooses a cap, and signs the channel-open transaction. The deposit moves into the channel escrow; UsageBar never receives the customer's private key.
2. **Review.** The customer starts the service and submits sample contract text. The server calls Groq's OpenAI-compatible API. Only after a valid structured response does the client receive the next provider-signed cumulative 50-byte Ed25519 voucher. The voucher is off-chain; there is no Solana transaction per AI request. Each successful review costs 1.00 TEST under the demo's explicit pricing rule.
3. **Close.** UsageBar submits the latest cumulative voucher with the cooperative settle-and-seal instruction, then sends a distribution transaction. The provider receives the used amount and the customer's unused deposit is returned.

The customer can always leave without the provider's cooperation:
`requestClose` starts a grace clock and `seal` is callable by anyone once it
elapses. `withdrawPayer` refunds the unspent deposit directly. Both paths are
exercised on Devnet in
[`../evidence/extended-paths/`](../evidence/extended-paths/).

## Technologies

| | |
|---|---|
| Chain | Solana Devnet (test funds only — no real economic value) |
| Protocol | [Solana Payment Channels](https://github.com/solana-foundation/payment-channels), program `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX` |
| Client | Next.js 16, React 19, TypeScript, `@solana/kit` 8.4 |
| Wallet selection | Phantom, Solflare, and OKX Wallet; uses Wallet Standard where available and brand-specific injected-provider fallback |
| Hosting | Vercel (serverless API routes hold the Payment Channels signer and Groq API key server-side) |
| CI | GitHub Actions — typecheck, 110 tests across 4 files, production build on every push |
| Tooling | Six devnet scripts under [`../tools/`](../tools/), plus a chain verifier and a deployment probe |

We build the instructions directly from the program's own IDL rather than
through its published TypeScript client, which is not on npm and pins
`@solana/kit ^6.1.0` against a current release of 8.4.0.

## What is proven, and how

`docs/CLAIM_STATUS.md` carries the full table with a transaction signature or a
reproducible command behind every row. In summary:

- **The protocol works.** A canonical run completed twelve steps in one
  uninterrupted pass, and every value in its artifacts was re-read from chain
  afterwards. A separate verifier re-derives the channel address from its seven
  recorded PDA seeds, re-queries all eight transaction signatures, and compares
  the revealed distribution plan against the commitment read from the channel
  account. It can be re-run by anyone at any time without a keypair.
- **Every instruction is exercised**, including the four the product does not
  use — `topUp`, a distribution plan with real recipients, and the
  `requestClose` → `seal` → `withdrawPayer` timeout path.
- **The deployed application works.** A probe drove `usagebar.vercel.app` over
  HTTPS — open, meter, close, pay out — and re-read every figure from a Devnet
  RPC endpoint this repository does not control. 71 of 71 checks passed.

## What is not proven

Stated plainly, because a submission that lists only its successes is not
evidence:

- **The wallet chooser and connection-cancellation state have automated
  browser checks, but no human has completed the full wallet handshake yet.**
  The deployment probe signs the `open` transaction itself. That stands in for
  wallet cryptography — the format, the slot, the signature — and never for an
  extension's real consent screen. Before submission, test connect, Devnet
  signing, open, usage and close in a real browser with the selected wallet.
  This is the largest remaining gap and the one CI structurally cannot cover.
- **The application does not use the four extended paths.** They are proven
  against the program, driven directly by tooling. A judge cannot reach them by
  clicking anything. A proven instruction is not an integrated one.
- **Provider-attested metering.** The meter counts successful Groq contract-review calls, not seconds. The provider signs the voucher, and the chain does not independently prove the model ran or that the answer is correct.
- **Demo-only pricing.** 1 TEST per successful review is illustrative, not Groq's actual token cost or validated commercial pricing.
- **AI and privacy.** The output is not legal advice. Use sample/public documents only because contract text is sent to Groq's API.
- **Runtime secret.** Vercel must have GROQ_API_KEY configured in its own environment variables; GitHub Actions secrets are not automatically injected into Vercel runtime functions.
- **Off-chain state is browser-persisted.** The latest voucher signature and cumulative amount are stored locally to support refresh recovery. This is a hackathon prototype, not production billing infrastructure.
- **Devnet only.** Test funds, no real economic value.

## Team

> **TODO — this section is the one thing here that cannot be written from the
> repository.** See [Team information](#team-information) below.

---

## Team information

Colosseum's form asks for team details. Nothing in this repository can supply
them, and inventing them would be worse than leaving the field blank.

| Field | Value |
|---|---|
| Team name | _to fill in_ |
| Members | _to fill in_ |
| Contact | _to fill in_ |
| Location | _to fill in_ |
| Prior work / links | _to fill in_ |

## Screenshots

The spec asks for screenshots of the four screens: landing, session, settlement,
and proof. They are not committed, because a screenshot of a running interface
is a claim about the deployment at a moment in time and should be taken against
the live URL rather than staged. Take them from
<https://usagebar.vercel.app> at the commit being submitted.

---

## Reproducing any of this

Nothing here needs to be taken on trust.

| To check | Do this |
|---|---|
| Typecheck, tests, build | Automatic on every push to `main` |
| That the evidence matches the chain | Actions → **Devnet** → `verify-canonical` — sends no transaction, needs no keypair |
| The canonical run from scratch | Actions → **Devnet** → `canonical-run` |
| The extended paths from scratch | Actions → **Devnet** → `extended-paths` |
| The live deployment | Actions → **Probe deployment**, or `node tools/probe-deployed-app.mjs` locally |

The deployment probe runs with **zero dependencies** — Node's own `crypto`
builds the throwaway keypair and signs the transaction — so it needs nothing
installed. It is also the shortest path to seeing the product work end to end
without a browser.

## Honest notes

Two things in this repository were wrong at some point and are recorded rather
than quietly amended, because the way they were caught is more useful than the
fix:

- **The app's close path returned a 502 for any metered tab.** Four verification
  gates passed while that bug was live, because all four drove the tooling and
  the tooling was correct. Only a probe of the deployed application found it.
- **The extended-paths evidence reported channel state read before its own
  transaction.** Nothing was fabricated — they were true reads of the wrong
  moment — and only a raw `getAccountInfo` comparison caught them.

Both are written up in [`../evidence/README.md`](../evidence/README.md).
