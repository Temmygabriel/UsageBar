# Limitations

**Build spec Section 62.**
Last updated: 2026-10-05.

What UsageBar does not do. Only limitations that actually remain are listed —
each one is true of the deployed system today, and each says whether it is a
deliberate boundary of the demo or a piece of work not yet done.

The through-line: **this is a working payment protocol with a real product on
top of it, running on Devnet, with a test asset. It is not a payment business.**

---

## 1. The meter measures time, not physical usage

The tab bills `0.25 TEST per second` while it is open, in five-second ticks that
advance by exactly the seconds that elapsed. That is checkable against a
stopwatch, which is the point — but it is not metering anything physical.

There is **no camera telemetry, no sensor integration, and no metering of a real
machine**. Nothing distinguishes a tab that is being used from a tab that is
sitting open. The build spec's "pay for what you use" is demonstrated at the
protocol level — authorize a ceiling, meter against it off-chain, settle once,
refund the remainder — and the *source* of the usage signal is a timer.

**Why it is not more.** A trustworthy usage oracle is the whole difficulty of
this class of product, and it is a hardware and attestation problem rather than a
payments one. The payment channel is the part this project set out to prove, and
it is the part that is proven. Wiring a camera to a placeholder would have made
the demo look more complete while proving strictly less.

---

## 2. Devnet only, with a test asset

The application runs on **Solana Devnet**. The token is a classic SPL Token mint
created for this project. Neither SOL nor `TEST` has any value, and neither can
be bridged to a network where it would.

There is no mainnet code path, no mainnet default, and no mainnet funds. The
environment variables are named `DEVNET_*` so that a copy-paste cannot quietly
point a deployment at mainnet.

**What this means for a reader:** the protocol behaviour is real and the money
movement is real *within Devnet*. The economic claims are not being made.

---

## 3. Public RPC, and what that costs

The default endpoint is the public `api.devnet.solana.com`. It is rate limited,
occasionally slow, and not something to build a product on.

How the system handles that, rather than pretending it does not happen:

- Confirmation is **polled**, not subscribed, so a serverless function does not
  hold a websocket open. A dropped socket would look exactly like a slow
  transaction, and the code refuses to guess which.
- **A failed read is a failure, never a zero.** Nothing displays a number it did
  not read from chain, so an unreachable RPC produces an error the interface can
  show instead of a stale or invented balance.
- **A failed tick stops the meter** and says why. Continuing to tick against a
  chain we cannot reach would leave a stale number on screen looking current.
- Faucet calls depend on the funder wallet holding Devnet SOL. If it runs dry the
  faucet fails with a clear message rather than a generic error.

---

## 4. No authentication, and no accounts

Any endpoint can be called by anyone who can reach the deployment. There are no
user accounts, no sessions, no logins, and no per-user history — the channel
address is the only handle, and it is a public chain address.

This is deliberate: the product's whole claim is that a tab does not need a
relationship with the provider. But it does mean the deployment is not a service
in any operational sense.

Related: **the faucet's rate limiter is best-effort.** It is in-memory, so it
resets on deploy and each serverless instance has its own counters. It stops
double-clicks and page reloads, not a determined caller. See
[`SECURITY.md`](SECURITY.md) — the honest protection is that the faucet holds
nothing of value.

---

## 5. One server key holds two protocol roles

`payee` (who gets paid) and `authorized_signer` (who signs the meter) are the
same keypair on the server. The protocol keeps them separate; a real provider
would too, because they are different trust positions. Merged here to remove a
moving part.

The consequence if that key leaked is bounded but real: an attacker could bill
every open tab to its full ceiling. They could not exceed any deposit (error 235)
and could not change who gets paid (error 2407), but on a network where the
amounts matter, that would be the reason to separate the roles and hold the
`payee` key in something better than an environment variable.

---

## 6. The wallet handshake has never been run by a human

**This is the largest unverified surface in the system.** `open` is signed in the
visitor's browser, and the bridge tries Wallet Standard first, then the legacy
`request` form. Both paths are written and reviewed; neither has been exercised
from a real browser with a real extension.

It is also the one path CI structurally cannot cover — it needs a browser and a
wallet, not a Node process. This is stated in the interface's own status text and
in [`CLAIM_STATUS.md`](CLAIM_STATUS.md), and it is the first thing to close
before the demo.

---

## 7. Protocol paths that are written but never executed

Three instruction paths have code and no on-chain run behind them:

| Path | Status | Does it block the product? |
|---|---|---|
| `withdrawPayer` (disc 8) | **UNVERIFIED** | No. It is the *pull* refund path. The proven `distribute` path already refunds the payer directly. |
| `requestClose` / `seal` (disc 5, 6) | **UNVERIFIED** | No, but it is the payer-protection timeout. The cooperative `settleAndSeal` path was used instead, so the "customer is protected if the provider disappears" claim is **not** demonstrated — what is demonstrated is that the refund happens in `distribute`. |
| `topUp` (disc 3) | **UNVERIFIED** | No. A tab is opened at its final ceiling. |

And one shape rather than one path: **a distribution plan with real recipients
has never executed on chain.** Every run used the empty plan. The
`recipient(32) || bps(u16)` layout is unit-tested and its hash commitment was
verified against the channel (the empty-plan preimage hashes to exactly the
`distribution_hash` the channel carried), but the non-empty encoding has not been
run.

---

## 8. No merchant integration, no custody, no compliance

- **No merchant integration.** Nothing plugs into a point-of-sale system, a
  billing platform, or an existing payment rail. It is a standalone application.
- **No production payment custody.** The escrow is the program's channel account,
  and the keys are a Devnet keypair in an environment variable. There is no
  custody arrangement, no segregation, and no operational key management.
- **No regulatory posture.** Nothing here has been assessed for money
  transmission, licensing, or any other regulatory obligation. It is a hackathon
  build on a test network.
- **No commercial validation.** No merchant has been interviewed, no demand has
  been measured, and no pricing has been tested against a real cost of service.
  The 0.25 TEST/second rate is chosen to make the meter visibly move during a
  demo, not because it reflects anything.

---

## 9. Scale

Hackathon scale. One channel is a 256-byte account and costs a little under
0.003 SOL in rent; the serverless deployment is a single function with no queue,
no worker, and no retry policy of its own. Nothing here has been tested under
concurrency beyond the idempotency arguments in
[`SECURITY.md`](SECURITY.md#retry-safety), which are reasoned and unit-tested but
never load-tested.

---

## What is *not* a limitation

Listed because the opposite is often assumed, and because these are the claims
the evidence actually supports:

- The protocol is the **real, deployed** Payment Channels program on Devnet, not
  a mock, a simulation, or a local validator.
- Money genuinely moves. The proof offered throughout is not a transaction
  signature but **balances changing accounts**: `1000000 → 999950` out of the
  customer's account, `0 → 50` into escrow, `21.5` to the provider and `+28.5`
  back to the customer on close, escrow drained to zero and the account reaped.
- Every displayed result is read back **from chain** after the transaction
  confirms. A `usage` update that does not read back as exactly the target throws
  rather than reporting success.

See [`CLAIM_STATUS.md`](CLAIM_STATUS.md) for the full list with evidence, and
[`../PROGRESS.md`](../PROGRESS.md) for the running log.
