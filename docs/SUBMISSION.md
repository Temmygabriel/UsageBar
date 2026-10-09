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
> Our demo uses camera rental as a simple usage-based service. In the committed
> canonical run, **50.00 test units are authorized, 6.25 is consumed over five
> metered intervals, and 43.75 is returned to the customer** — read back from
> the chain, not from a local calculation. The mechanism is Solana Payment
> Channels, the deployed program at
> `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX`, rather than a custom
> payment-channel contract.

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

1. **Open.** The customer connects Phantom and signs one transaction. It moves
   their deposit into a channel PDA and registers the provider and the
   authorized signer. The customer's key never leaves their wallet, and nothing
   else is ever asked of them.
2. **Meter.** The provider signs cumulative vouchers — 50-byte Ed25519 messages
   carrying a running total, never a delta. Each is submitted with the
   `settle` instruction, which reads the voucher from the instructions sysvar
   rather than from its own data. No blockchain transfer happens per usage
   event.
3. **Close.** The provider seals the channel, freezing the watermark at the last
   metered reading, and `distribute` pays the provider what was metered and
   returns `deposit − settled` to the customer.

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
| Wallet | Phantom, via the browser provider — no Solana library is bundled into the client |
| Hosting | Vercel (serverless API routes hold the provider's key) |
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

- **No human has completed the wallet handshake in a browser.** The deployment
  probe signs the `open` transaction itself. That stands in for a wallet's
  cryptography — the format, the slot, the signature — and never for Phantom's
  consent screen. This is the largest remaining gap and the one CI structurally
  cannot cover.
- **The application does not use the four extended paths.** They are proven
  against the program, driven directly by tooling. A judge cannot reach them by
  clicking anything. A proven instruction is not an integrated one.
- **Metering is simulated.** The camera is a demo service; the meter advances on
  a real clock against real vouchers, but the usage it represents is not real
  telemetry, and nothing here claims otherwise.
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
