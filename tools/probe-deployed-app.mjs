/**
 * Probe the DEPLOYED application, not the tooling.
 *
 * Everything in `tools/` so far drives the program directly. This drives the
 * thing a judge will actually touch: the Vercel deployment, over HTTPS, using
 * only its public API.
 *
 * WHY IT EXISTS
 *
 * "The application deploys to Vercel and reaches devnet RPC" was UNVERIFIED
 * until this script had a green run. A deployment that serves HTML proves
 * nothing about whether its serverless functions hold working keys, can reach
 * the cluster, or sign a transaction that lands. The only way to know is to ask
 * it to move money and then go look at the chain.
 *
 * WHY IT NEEDS NO CRYPTO LIBRARY
 *
 * The faucet, the meter and the payout are all server-signed: the application
 * holds the operator key and signs its own transactions. The one thing a client
 * must sign is `open`, because the deposit is the customer's money and only the
 * customer's key may authorize it.
 *
 * So this script's entire cryptographic requirement is: make an Ed25519 key,
 * and sign one message. Node's `crypto` does both natively. No `@solana/kit`,
 * no dependency, nothing installed. The wire format it parses is twelve lines of
 * offsets, spelled out below with the reason for each.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT
 *
 *   PROVES      the deployed serverless functions hold working keys, reach
 *               devnet RPC, sign, send and confirm; that opening a channel moves
 *               the customer's money into escrow; that the meter advances a real
 *               watermark on chain; that closing pays the provider and refunds
 *               the customer exactly; and that malformed input is refused before
 *               anything is signed.
 *   DOES NOT    exercise the wallet-standard handshake in a browser. That is
 *               the client half and it needs a human with an extension. This
 *               script stands in for the wallet's *cryptography*, never for its
 *               consent screen.
 *
 * Usage:
 *   node tools/probe-deployed-app.mjs [--url https://usagebar.vercel.app]
 *                                     [--rpc https://api.devnet.solana.com]
 *                                     [--channel <address>]   read-only check
 *                                     [--out evidence/deployed-app-probe.json]
 */

import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const APP_URL = argOf("url", "https://usagebar.vercel.app").replace(/\/$/, "");
const RPC_URL = argOf("rpc", "https://api.devnet.solana.com");
const OUT_PATH = argOf("out", null);

/**
 * The channel the canonical run opened. Read-only here: it is a real channel
 * with a real history, and asking the deployment to decode it is a much
 * stronger check than asking it to decode one this script just made, because
 * the expected values are already known and already committed.
 */
const CHANNEL = argOf("channel", "4LtkUAsruLTTi9xzwy6Zd67U8uz8d8sX72gyYsKjPz4S");

/** From `evidence/canonical-run/02-channel-open.json`. */
const EXPECTED_DEPOSIT = "50000000";
const EXPECTED_SETTLED = "6250000";
const EXPECTED_REMAINDER = "43750000";

/** The provider. Its balance is read directly, so the payout is not taken on trust. */
const PROVIDER = "39pNZY2aqhCMaKXeychLHXDNvZ6CTWLPzWAHDPrDzP5T";

/** Long enough for two metering intervals plus a slow devnet confirmation. */
const METER_SECONDS = 5;

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const results = [];
let failures = 0;

function check(condition, description) {
  const ok = Boolean(condition);
  results.push({ ok, description });
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${description}`);
  return ok;
}

function section(title) {
  console.log(`\n${title}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Minimal base58 — the only encoding this script needs: to *write* an address,
// and to read one back out of a message to confirm we are signing the right
// slot. Nothing is ever decoded.
// ---------------------------------------------------------------------------

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes) {
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;

  const digits = [0];
  for (let i = leadingZeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "1".repeat(leadingZeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i]];
  return out;
}

/**
 * A brand new wallet.
 *
 * Unlike a throwaway, this one keeps its private key — it is the customer for
 * the full flow, and the deposit must be authorized by a real signature. The
 * key lives in memory for the length of one process and is never written
 * anywhere, never logged, and never leaves this machine except as a signature.
 */
function freshWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // SPKI DER for Ed25519 is a 12-byte header followed by the 32 raw bytes.
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  return { address: base58Encode(raw), privateKey };
}

/**
 * A valid address that has never been funded and never will be.
 *
 * Used to tell "there is no account here" apart from "there is an account here
 * and it is not a channel". Those are different answers and the deployment is
 * required to give the first as a plain null rather than an error.
 */
function unusedAddress() {
  return freshWallet().address;
}

// ---------------------------------------------------------------------------
// HTTP + raw RPC
// ---------------------------------------------------------------------------

async function requestJson(method, path, body) {
  const response = await fetch(`${APP_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Left null; callers report the raw text, which is more useful for an HTML
    // error page than a parse exception would be.
  }
  return { status: response.status, json, text };
}

const postJson = (path, body) => requestJson("POST", path, body);
const getJson = (path) => requestJson("GET", path);

/**
 * Raw JSON-RPC, deliberately not through the application.
 *
 * Every number this script accepts as true comes from here. If the deployment
 * were wrong about what it did, asking the deployment again would agree with it.
 */
let rpcId = 0;
async function rpc(method, params) {
  rpcId += 1;
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function lamportsOf(owner) {
  const result = await rpc("getBalance", [owner, { commitment: "confirmed" }]);
  return BigInt(result.value);
}

/** Null when no token account exists, which is not the same fact as zero. */
async function tokensOf(owner, mint) {
  const result = await rpc("getTokenAccountsByOwner", [
    owner,
    { mint },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  if (result.value.length === 0) return null;
  return BigInt(result.value[0].account.data.parsed.info.tokenAmount.amount);
}

/**
 * Wait for a signature to reach `confirmed`, then report whether it landed.
 *
 * Polling rather than the application's own answer, and `searchTransactionHistory`
 * rather than the recent cache, so a transaction that landed before we started
 * watching is still found.
 */
async function confirmSignature(signature, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const result = await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    last = result.value[0] ?? null;
    if (last !== null) {
      if (last.err !== null) return { landed: false, error: last.err, status: last };
      if (last.confirmationStatus === "confirmed" || last.confirmationStatus === "finalized") {
        return { landed: true, error: null, status: last };
      }
    }
    await sleep(1000);
  }
  return { landed: false, error: "timed out", status: last };
}

// ---------------------------------------------------------------------------
// Signing the `open` transaction
//
// The deployment builds it and returns it base64-encoded and unsigned. The wire
// layout, and why each offset is where it is:
//
//   [ compact-u16 signature count ]
//   [ N x 64-byte signatures     ]
//   [ message                    ]
//
// The message for a version-0 transaction begins with a prefix byte whose high
// bit is set and whose low seven bits are the version, then the three header
// bytes, then the static account keys. The signature covers the message bytes
// *including* that prefix. Signer i is static account key i — required signers
// are listed first, in order — so slot 0 belongs to the fee payer, which for an
// `open` is the customer. We verify that rather than assume it: if the first key
// in the message is not the wallet we hold, we refuse to sign, because signing
// someone else's slot is how a probe becomes a bug.
// ---------------------------------------------------------------------------

function decodeCompactU16(bytes, offset) {
  let value = 0;
  let shift = 0;
  let consumed = 0;
  for (;;) {
    const byte = bytes[offset + consumed];
    if (byte === undefined) throw new Error("compact-u16 ran off the end of the buffer");
    consumed += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (consumed >= 3) throw new Error("compact-u16 is longer than three bytes");
  }
  return { value, consumed };
}

function signOpenTransaction(base64Transaction, privateKey, expectedPayer) {
  const bytes = Buffer.from(base64Transaction, "base64");

  const { value: signatureCount, consumed: countBytes } = decodeCompactU16(bytes, 0);
  check(signatureCount >= 1, `the open transaction asks for ${signatureCount} signature(s)`);
  if (signatureCount < 1) throw new Error("nothing to sign");

  const messageOffset = countBytes + 64 * signatureCount;
  const message = bytes.subarray(messageOffset);

  check(
    message[0] === 0x80,
    `the message is version ${message[0] & 0x7f} (prefix byte 0x${message[0].toString(16)})`,
  );

  const numRequired = message[1];
  check(
    numRequired === signatureCount,
    `the header's ${numRequired} required signature(s) matches the count`,
  );

  // prefix(1) + header(3) = offset 4, then the compact-u16 key count.
  const keyCount = decodeCompactU16(message, 4);
  const firstKeyStart = 4 + keyCount.consumed;
  const firstKey = base58Encode(message.subarray(firstKeyStart, firstKeyStart + 32));
  const isOurs = check(
    firstKey === expectedPayer,
    `the first signer in the message is our wallet (${firstKey.slice(0, 8)}…)`,
  );
  if (!isOurs) {
    throw new Error("refusing to sign: slot 0 belongs to a key we do not hold");
  }

  const signature = cryptoSign(null, message, privateKey);
  check(signature.length === 64, "we produced a 64-byte Ed25519 signature");

  const signed = Buffer.from(bytes);
  signature.copy(signed, countBytes);
  return signed.toString("base64");
}

// ---------------------------------------------------------------------------
// Stage 1 — the faucet, which the server signs by itself
// ---------------------------------------------------------------------------

async function probeFaucet(wallet, mint) {
  section("Stage 1 — the faucet moves real money");
  console.log(`  app      ${APP_URL}`);
  console.log(`  rpc      ${RPC_URL} (read independently of the app)`);
  console.log(`  wallet   ${wallet.address}`);

  const before = await lamportsOf(wallet.address);
  check(before === 0n, `the new wallet starts empty (${before} lamports)`);

  const response = await postJson("/api/faucet", { address: wallet.address });
  if (response.status !== 200) {
    check(false, `POST /api/faucet returned ${response.status}: ${response.text.slice(0, 300)}`);
    return null;
  }
  check(true, "POST /api/faucet answered 200");

  const body = response.json;
  check(body?.ok === true, "the faucet reported success");
  check(body?.mint === mint, "it funded the mint it advertises");

  for (const [label, signature] of [
    ["SOL", body?.solSignature],
    ["token", body?.tokenSignature],
  ]) {
    if (typeof signature !== "string") {
      check(false, `it returned a ${label} transaction signature`);
      continue;
    }
    const outcome = await confirmSignature(signature);
    check(outcome.landed, `${label} transfer ${signature.slice(0, 16)}… landed on chain`);
    check(
      outcome.status?.confirmationStatus === "confirmed" ||
        outcome.status?.confirmationStatus === "finalized",
      `${label} transfer is ${outcome.status?.confirmationStatus}`,
    );
  }

  // The part that matters: a successful transaction is not proof that anything
  // moved. Look in the accounts.
  const after = await lamportsOf(wallet.address);
  check(after >= BigInt(body?.solLamports ?? 0), `SOL arrived: ${before} → ${after} lamports`);

  const tokens = await tokensOf(wallet.address, mint);
  check(tokens !== null, "the faucet created the wallet's token account");
  check(
    tokens !== null && tokens >= BigInt(body?.tokenAmount ?? 0),
    `TEST arrived: ${tokens} atomic units at ${body?.decimals} decimals`,
  );

  return { solBefore: before.toString(), solAfter: after.toString(), tokens: tokens?.toString() ?? null };
}

// ---------------------------------------------------------------------------
// Stage 2 — the deployment reads a channel we opened earlier
// ---------------------------------------------------------------------------

async function probeSessionRead() {
  section("Stage 2 — the deployment reads real chain state");

  const service = await getJson("/api/session");
  check(service.status === 200, "GET /api/session answered 200");
  const config = service.json?.service;
  check(
    config?.programId === "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX",
    "it names the Payment Channels program",
  );
  check(config?.mint === "6Jpyq8iUszZdZd2z3G9is1nfJh7ZwqbekW9cH2w58hmL", "it names the TEST mint");
  check(config?.decimals === 6, `it reports ${config?.decimals} decimals`);
  check(config?.ceilingAtomic === EXPECTED_DEPOSIT, `the ceiling is ${config?.ceilingAtomic}`);

  const read = await getJson(`/api/session?channel=${CHANNEL}`);
  check(read.status === 200, `GET /api/session?channel=${CHANNEL.slice(0, 8)}… answered 200`);

  const channel = read.json?.channel;
  if (!check(channel !== null && channel !== undefined, "the deployment found the channel on chain")) {
    console.log(`    body: ${read.text.slice(0, 400)}`);
    return;
  }

  check(channel.bytes === 256, `it decoded ${channel.bytes} bytes, matching Channel::LEN`);
  check(channel.deposit === EXPECTED_DEPOSIT, `deposit reads back as ${channel.deposit}`);
  check(channel.settled === EXPECTED_SETTLED, `the settled watermark reads back as ${channel.settled}`);
  check(channel.status === 3, `status is ${channel.status} — ${channel.statusName}`);
  check(
    channel.payee === channel.authorizedSigner,
    "the authorized signer matches the payee, as the canonical run opened it",
  );

  const deposit = BigInt(channel.deposit);
  const settled = BigInt(channel.settled);
  check(settled <= deposit, `the watermark never exceeded the deposit (${settled} <= ${deposit})`);
  check(
    deposit - settled === BigInt(EXPECTED_REMAINDER),
    `the untouched remainder is ${deposit - settled}, the 43.75 TEST returned to the customer`,
  );
}

// ---------------------------------------------------------------------------
// Stage 3 — the full flow, on a wallet this script owns
// ---------------------------------------------------------------------------

async function probeFullFlow(wallet, mint, fundedTokens) {
  section("Stage 3 — open, meter, close: the whole product, against the deployment");

  const openResponse = await postJson("/api/session", {
    action: "open",
    address: wallet.address,
  });
  if (openResponse.status !== 200) {
    check(false, `POST /api/session { open } returned ${openResponse.status}: ${openResponse.text.slice(0, 300)}`);
    return {};
  }
  check(true, "POST /api/session { open } answered 200");

  const built = openResponse.json;
  const channelAddress = built?.channel;
  check(typeof channelAddress === "string", `the deployment derived channel ${channelAddress}`);

  // Sign it, then send it ourselves. Submitting the signed bytes directly is
  // what a wallet does; nothing here trusts the deployment's own view of the
  // result.
  const signedBase64 = signOpenTransaction(built.transaction, wallet.privateKey, wallet.address);
  const openSignature = await rpc("sendTransaction", [
    signedBase64,
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  check(typeof openSignature === "string", `open submitted as ${openSignature.slice(0, 16)}…`);

  const openOutcome = await confirmSignature(openSignature);
  check(openOutcome.landed, "the open transaction landed");
  if (!openOutcome.landed) {
    console.log(`    error: ${JSON.stringify(openOutcome.error)}`);
    return {};
  }

  // Did money actually move? Read the channel account from raw chain state.
  const account = await rpc("getAccountInfo", [channelAddress, { encoding: "base64", commitment: "confirmed" }]);
  check(account?.value !== null, "the channel account now exists on chain");
  if (account?.value == null) return {};

  const data = Buffer.from(account.value.data[0], "base64");
  check(data.length === 256, `it is ${data.length} bytes, matching Channel::LEN`);
  check(data[0] === 1, `discriminator ${data[0]} is the Channel account`);
  check(data[3] === 0, `status ${data[3]} is Open`);
  check(data.readBigUInt64LE(12) === BigInt(EXPECTED_DEPOSIT), `deposit is ${data.readBigUInt64LE(12)} atomic units`);
  check(data.readBigUInt64LE(20) === 0n, "the settled watermark starts at zero");
  check(
    base58Encode(data.subarray(88, 120)) === wallet.address,
    "the payer recorded on chain is our wallet",
  );

  const escrow = await tokensOf(channelAddress, mint);
  check(
    escrow === BigInt(EXPECTED_DEPOSIT),
    `the escrow holds ${escrow} atomic units — the deposit left the customer's wallet`,
  );

  const ourTokensAfterOpen = await tokensOf(wallet.address, mint);
  check(
    ourTokensAfterOpen === fundedTokens - BigInt(EXPECTED_DEPOSIT),
    `the customer's own balance went from ${fundedTokens} to ${ourTokensAfterOpen}, ` +
      "which is exactly the deposit leaving for escrow",
  );

  // -------------------------------------------------------------------------
  // The meter
  // -------------------------------------------------------------------------

  const providerBefore = (await tokensOf(PROVIDER, mint)) ?? 0n;

  let previous = 0n;
  const meterReadings = [];
  for (const round of [1, 2]) {
    const started = Date.now();
    await sleep(METER_SECONDS * 1000);
    const usage = await postJson("/api/session", {
      action: "usage",
      channel: channelAddress,
      seconds: Math.round((Date.now() - started) / 1000),
    });
    check(usage.status === 200, `round ${round}: the meter answered 200`);
    const advanced = usage.json?.advanced === true;
    check(advanced, `round ${round}: the watermark advanced`);
    if (!advanced) {
      console.log(`    reason: ${usage.json?.reason}`);
      continue;
    }
    const settled = BigInt(usage.json.settled);
    check(settled > previous, `round ${round}: settled ${previous} → ${settled}`);
    meterReadings.push({ round, settled: settled.toString(), signature: usage.json.signature });

    // And read it back from the chain, not from the answer.
    const live = await rpc("getAccountInfo", [channelAddress, { encoding: "base64", commitment: "confirmed" }]);
    const liveData = Buffer.from(live.value.data[0], "base64");
    check(
      liveData.readBigUInt64LE(20) === settled,
      `round ${round}: byte 20 of the channel agrees — ${liveData.readBigUInt64LE(20)}`,
    );
    previous = settled;
  }

  if (previous === 0n) {
    check(false, "nothing was metered, so there is no payout to check");
    return {};
  }

  // -------------------------------------------------------------------------
  // The close
  // -------------------------------------------------------------------------

  const closeResponse = await postJson("/api/session", { action: "close", channel: channelAddress });
  if (closeResponse.status !== 200) {
    check(false, `POST /api/session { close } returned ${closeResponse.status}: ${closeResponse.text.slice(0, 300)}`);
    return {};
  }
  check(true, "POST /api/session { close } answered 200");

  const closed = closeResponse.json;
  check(typeof closed?.sealSignature === "string", "it returned a seal signature");
  check(typeof closed?.distributeSignature === "string", "it returned a distribute signature");
  check(closed?.settled === previous.toString(), `it sealed at the watermark the meter reached (${closed?.settled})`);
  check(closed?.deposit === EXPECTED_DEPOSIT, `it reports the deposit as ${closed?.deposit}`);

  const expectedPayout = previous;
  const expectedRefund = BigInt(EXPECTED_DEPOSIT) - previous;
  check(
    closed?.paidToProvider === expectedPayout.toString(),
    `it paid the provider ${closed?.paidToProvider}, exactly the metered amount`,
  );
  check(
    closed?.returnedToPayer === expectedRefund.toString(),
    `it refunded the customer ${closed?.returnedToPayer}, exactly the remainder`,
  );

  // The deployment's own numbers are a claim. Check every one of them.
  const providerAfter = (await tokensOf(PROVIDER, mint)) ?? 0n;
  check(
    providerAfter - providerBefore === expectedPayout,
    `the provider's token account really grew by ${providerAfter - providerBefore}`,
  );

  const ourTokensAtEnd = await tokensOf(wallet.address, mint);
  const refunded = ourTokensAtEnd - ourTokensAfterOpen;
  check(
    refunded === expectedRefund,
    `the customer's balance rose by ${refunded} on the close, exactly the refund`,
  );
  // The number that actually matters to a customer: what the whole session cost.
  // It should be precisely what the meter recorded and not a unit more.
  check(
    ourTokensAtEnd === fundedTokens - expectedPayout,
    `the session cost the customer ${fundedTokens - ourTokensAtEnd} atomic units, ` +
      `exactly the ${expectedPayout} the meter recorded`,
  );

  const escrowAfter = await tokensOf(channelAddress, mint);
  check(escrowAfter === null, "the escrow token account is gone, not merely zeroed");

  const channelAfter = await rpc("getAccountInfo", [channelAddress, { encoding: "base64", commitment: "confirmed" }]);
  const reaped = channelAfter?.value === null;
  console.log(
    reaped
      ? "  note  the channel account was reaped, which only happens past open_slot + 1500"
      : "  note  the channel account survives at status 3: this tab was opened seconds ago, " +
        "and reclamation needs slot > open_slot + 1500. Both are the program behaving correctly.",
  );

  return {
    channel: channelAddress,
    openSignature,
    openSlot: built.openSlot,
    salt: built.salt,
    deposit: EXPECTED_DEPOSIT,
    meterReadings,
    settled: previous.toString(),
    paidToProvider: expectedPayout.toString(),
    returnedToPayer: expectedRefund.toString(),
    sealSignature: closed.sealSignature,
    distributeSignature: closed.distributeSignature,
    channelReaped: reaped,
  };
}

// ---------------------------------------------------------------------------
// Stage 4 — the deployment refuses what it should
// ---------------------------------------------------------------------------

async function probeRefusals() {
  section("Stage 4 — the deployment refuses what it should");

  const distributed = await postJson("/api/session", {
    action: "usage",
    channel: CHANNEL,
    seconds: 5,
  });
  check(distributed.status === 200, "metering an already-distributed channel answered 200");
  check(distributed.json?.advanced === false, "it declined to advance the watermark");
  check(
    /Distributed/i.test(distributed.json?.reason ?? ""),
    `it explained why: "${distributed.json?.reason}"`,
  );

  const badAddress = await postJson("/api/faucet", { address: "not-an-address" });
  check(badAddress.status === 400, `the faucet rejects a bad address with ${badAddress.status}`);

  const missing = await postJson("/api/session", { action: "open" });
  check(missing.status === 400, `open without an address is a ${missing.status}`);

  const unknown = await postJson("/api/session", { action: "detonate" });
  check(unknown.status === 400, `an unknown action is a ${unknown.status}`);

  const blankChannel = await getJson("/api/session?channel=%20");
  check(blankChannel.status === 200, "a blank channel describes the service instead of failing");

  const absent = await getJson(`/api/session?channel=${unusedAddress()}`);
  check(
    absent.status === 200 && absent.json?.channel === null,
    "an address with no channel reports null rather than an error",
  );

  // A *valid* address that holds something which is not a channel. Saying
  // "not found" for it would be wrong — the account exists, it simply is not
  // this program's — and 502 would be wrong too, because nothing failed. 422.
  const notAChannel = await getJson("/api/session?channel=11111111111111111111111111111111");
  check(
    notAChannel.status === 422,
    `an address holding a non-channel account is refused as a bad request ` +
      `(status ${notAChannel.status}), not reported as the server failing`,
  );
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`Probing ${APP_URL}`);
  console.log("Every figure below is read from devnet, not from the application.");

  const service = await getJson("/api/session");
  const mint = service.json?.service?.mint;
  if (typeof mint !== "string") {
    console.error(`\nThe deployment did not describe its service: ${service.text.slice(0, 400)}`);
    process.exitCode = 1;
    return;
  }

  const wallet = freshWallet();

  const faucet = await probeFaucet(wallet, mint);
  await probeSessionRead();
  const flow = await probeFullFlow(wallet, mint, BigInt(faucet?.tokens ?? "0"));
  await probeRefusals();

  const passed = results.filter((r) => r.ok).length;
  section("Summary");
  console.log(`  ${passed}/${results.length} checks passed`);
  if (failures > 0) {
    console.log(`  ${failures} FAILED:`);
    for (const r of results.filter((x) => !x.ok)) console.log(`    - ${r.description}`);
    process.exitCode = 1;
  } else {
    console.log("  The deployment holds working keys, reaches devnet, opens and closes a real");
    console.log("  channel, and pays out exactly. It does NOT prove the browser wallet");
    console.log("  handshake — that needs a human with an extension installed.");
  }

  if (OUT_PATH !== null) {
    const artifact = {
      run: "deployed-app-probe",
      writtenAt: new Date().toISOString(),
      applicationUrl: APP_URL,
      rpcUrl: RPC_URL,
      network: "devnet",
      observed: { faucet, flow },
      checks: { passed, total: results.length },
      failures: results.filter((r) => !r.ok).map((r) => r.description),
      method:
        "Every transaction was submitted through the deployed application's HTTP API except " +
        "`open`, which the application returns unsigned and this script signs, as a wallet " +
        "would. Every balance and account value was then re-read from a devnet RPC endpoint " +
        "that this repository does not control, using raw JSON-RPC rather than the " +
        "application's own client. The customer wallet is generated per run and its private " +
        "key is never written to disk.",
      doesNotProve:
        "The wallet-standard handshake in a browser. This script stands in for a wallet's " +
        "cryptography, never for its consent screen, and no human has approved a transaction.",
    };
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`\n  Wrote ${OUT_PATH}`);
  }
}

main().catch((error) => {
  console.error(`\nThe probe itself threw: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
