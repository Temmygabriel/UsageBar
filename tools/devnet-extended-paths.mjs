#!/usr/bin/env node
/**
 * THE FOUR PATHS THE CANONICAL RUN NEVER TOUCHES.
 *
 * `tools/devnet-canonical-run.mjs` walks one line through the lifecycle: open
 * with an empty plan, meter, `settleAndSeal`, distribute with an empty plan.
 * That is the app's path, and it is the path that matters most — but it leaves
 * four instructions that the program implements and this repository has never
 * executed against the chain:
 *
 *   - `open` with a **non-empty distribution plan**, and `distribute` revealing
 *     it. `encodeDistributionPreimage` writes `recipient(32) || bps(u16)` and
 *     hashes it; the recipient ATAs are appended to the account list in the
 *     same order. Both are unit-tested and neither has ever touched Solana.
 *   - `topUp` (3) — extending a deposit without re-opening the channel.
 *   - `requestClose` (5) -> `seal` (6) — the payer's timeout path.
 *   - `withdrawPayer` (8) — the payer's one-shot refund while Sealed.
 *
 * WHY IT IS WORTH A SCRIPT RATHER THAN ASSUMING
 *
 * A unit test proves our encoder agrees with our reading of the IDL. It cannot
 * prove the program agrees. The preimage layout is exactly the kind of thing
 * where a wrong field order produces a buffer that hashes to *something* — the
 * failure is error 2407 on chain and nothing at all in a test that compares the
 * encoder against itself.
 *
 * TWO SCENARIOS, INDEPENDENTLY FAILING
 *
 * They are wrapped separately and both run whatever the other does, because a
 * run that stops at the first problem tells you one thing when it could have
 * told you two. The process exits non-zero if any check anywhere failed.
 *
 * WHAT THIS DOES NOT PROVE
 *
 * Nothing here is a claim about the deployed application. It drives the
 * program directly, with Devnet keypairs this repository holds. The app does
 * not call `topUp`, `requestClose`, `seal` or `withdrawPayer` at all, and it
 * only ever opens channels with an empty plan — so the interface is unaffected
 * either way. That is the point of writing it down rather than implying that
 * "all instructions verified" means "the product uses them".
 */

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairFromBytes,
  createSignerFromKeyPair,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  BPS_DENOMINATOR,
  CHANNEL_LEN,
  CHANNEL_STATUS,
  DEVNET_TREASURY_OWNER,
  DISCRIMINATOR,
  ED25519_PRECOMPILE,
  INSTRUCTIONS_SYSVAR,
  PAYMENT_CHANNELS_PROGRAM,
  buildCreateAtaIdempotentInstruction,
  buildEd25519PrecompileData,
  buildVoucherPayload,
  channelSeeds,
  decodeChannel,
  decodeSecretKey,
  encodeDistributeData,
  encodeOpenArgs,
  encodeRequestCloseData,
  encodeSealData,
  encodeTopUpData,
  encodeWithdrawPayerData,
  envOr,
  signVoucher,
} from "./lib/protocol.mjs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RUN_NAME = envOr("RUN_NAME", "usagebar-extended-paths-001");
const NETWORK = "devnet";
const EVIDENCE_DIR = envOr("EVIDENCE_DIR", "evidence/extended-paths");

const RPC_URL = envOr("DEVNET_RPC_URL", "https://api.devnet.solana.com");
const WS_URL = envOr("DEVNET_WS_URL", "wss://api.devnet.solana.com");

const TEST_MINT = address(envOr("TEST_MINT", "6Jpyq8iUszZdZd2z3G9is1nfJh7ZwqbekW9cH2w58hmL"));
const TREASURY_OWNER = address(envOr("TREASURY_OWNER", DEVNET_TREASURY_OWNER));

const DECIMALS = 6;
const LAMPORTS_FOR_FEES = 50_000_000n;

// --- Scenario A: a split -----------------------------------------------------

/** 50 TEST, as the interface proposes. */
const SPLIT_DEPOSIT = BigInt(envOr("SPLIT_DEPOSIT", "50000000"));

/** The amount `topUp` adds, which must be non-zero. */
const SPLIT_TOP_UP = BigInt(envOr("SPLIT_TOP_UP", "10000000"));

/**
 * The split itself. The payee is NOT listed: it receives the implicit remainder
 * of `10000 - sum(bps)`, which is 8000 here. That is deliberate — it exercises
 * the remainder branch as well as the explicit ones.
 */
const SPLIT_SHARES = [
  { name: "alpha", seed: "alpha", bps: 1500 },
  { name: "beta", seed: "beta", bps: 500 },
];
const SPLIT_EXPLICIT_BPS = SPLIT_SHARES.reduce((total, entry) => total + entry.bps, 0);

/**
 * 0.333333 TEST per second, which is NOT the application's rate and is chosen
 * for arithmetic rather than realism.
 *
 * Two five-second ticks bill 3,333,330 atomic units. With shares of 1500, 500
 * and the implicit 8000 that is 499,999.5 / 166,666.5 / 2,666,664 — so the
 * first two are not whole numbers. A program that rounds rather than floors,
 * or that hands the payee "whatever is left" instead of its own share, produces
 * visibly different numbers here. At the app's rate of 250000 every split
 * divides exactly and the rounding rule would go untested.
 */
const SPLIT_RATE_PER_SECOND = BigInt(envOr("SPLIT_RATE_PER_SECOND", "333333"));
const SPLIT_TICKS = Number(envOr("SPLIT_TICKS", "2"));
const TICK_SECONDS = Number(envOr("TICK_SECONDS", "5"));

// --- Scenario B: the timeout ------------------------------------------------

const TIMEOUT_DEPOSIT = BigInt(envOr("TIMEOUT_DEPOSIT", "50000000"));

/**
 * Short, because the script has to wait it out. Ten seconds is far longer than
 * confirmation takes (so the early-`seal` refusal below is a real refusal
 * rather than a race) and far shorter than the app's 60, so the run is brief.
 */
const TIMEOUT_GRACE_PERIOD = Number(envOr("TIMEOUT_GRACE_PERIOD", "10"));

/** The app's rate, since this scenario has no rounding to expose. */
const TIMEOUT_RATE_PER_SECOND = BigInt(envOr("TIMEOUT_RATE_PER_SECOND", "250000"));

/** Wall-clock margin added to the grace period before retrying the seal. */
const GRACE_MARGIN_MS = Number(envOr("GRACE_MARGIN_MS", "4000"));

if (!Number.isInteger(SPLIT_TICKS) || SPLIT_TICKS < 1) {
  throw new Error(`SPLIT_TICKS must be a positive integer, got ${SPLIT_TICKS}.`);
}
if (!Number.isInteger(TIMEOUT_GRACE_PERIOD) || TIMEOUT_GRACE_PERIOD <= 0) {
  throw new Error(
    `TIMEOUT_GRACE_PERIOD must be a positive integer, got ${TIMEOUT_GRACE_PERIOD}. ` +
      "The program rejects zero with error 201.",
  );
}

const TOKEN_PROGRAM = TOKEN_PROGRAM_ADDRESS;
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const SYSVAR_RENT = address("SysvarRent111111111111111111111111111111111");
const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

const payerSecretKey = decodeSecretKey("DEVNET_PAYER_KEYPAIR");
const payer = await createSignerFromKeyPair(await createKeyPairFromBytes(payerSecretKey));

const operatorSecretKey = decodeSecretKey("DEVNET_OPERATOR_KEYPAIR");
const operatorSeed = operatorSecretKey.subarray(0, 32);
// Two routes to the same key, on purpose. `operator` is the signer object
// `settleAndSeal` needs in order to sign; `operatorAddress` is the public half
// read straight out of the secret key. If those 64 bytes were half of one
// keypair and half of another, `createKeyPairFromBytes` would reject them — and
// if it did not, the two would disagree here, which is a much clearer failure
// than a channel whose authorized_signer is not who we think it is.
const operator = await createSignerFromKeyPair(await createKeyPairFromBytes(operatorSecretKey));
const operatorAddress = addressDecoder.decode(operatorSecretKey.subarray(32, 64));

if (operator.address !== operatorAddress) {
  throw new Error(
    `DEVNET_OPERATOR_KEYPAIR does not hold a consistent keypair: the signer's address is ` +
      `${operator.address}, but the public half of the secret key is ${operatorAddress}.`,
  );
}

const format = (atomic) => `${Number(atomic) / 10 ** DECIMALS} TEST`;
const explorerTx = (signature) => `https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`;
const explorerAddress = (value) => `https://explorer.solana.com/address/${value}?cluster=${NETWORK}`;

/** `floor(amount * bps / 10000)`, which is the arithmetic the program documents. */
const shareOf = (amount, bps) => (amount * BigInt(bps)) / BigInt(BPS_DENOMINATOR);

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

mkdirSync(EVIDENCE_DIR, { recursive: true });

const written = [];

function writeEvidence(fileName, { observed, expected, method, ...rest }) {
  const payload = {
    run: RUN_NAME,
    network: NETWORK,
    programId: PAYMENT_CHANNELS_PROGRAM,
    assetMint: TEST_MINT,
    tokenProgram: TOKEN_PROGRAM,
    payerPublicKey: payer.address,
    providerPublicKey: operatorAddress,
    writtenAt: new Date().toISOString(),
    clockNote: "writtenAt is the runner's clock, not a blockchain timestamp",
    verificationMethod: method,
    ...rest,
    observed,
    expected,
  };

  writeFileSync(
    join(EVIDENCE_DIR, fileName),
    `${JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
  );
  written.push(fileName);
  console.log(`    evidence: ${fileName}`);
}

const failures = [];
const scenarioFailures = {};

function check(condition, description) {
  if (condition) return true;
  failures.push(description);
  console.log(`    !! FAILED: ${description}`);
  return false;
}

function log(...parts) {
  console.log(...parts);
}

function decoded(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
  );
}

function describeError(error) {
  const parts = [];
  parts.push(error instanceof Error ? error.message : String(error));
  const context = error && typeof error === "object" ? error.context : undefined;
  if (context && Array.isArray(context.logs)) parts.push(context.logs.join("\n"));
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

/**
 * `api.devnet.solana.com` is a shared public endpoint and it rate limits
 * (HTTP 429). A first run of this script died there — after the plan had been
 * committed, the deposit topped up and the channel sealed, with both scenarios
 * reporting `HTTP error (429): Too Many Requests` and neither one reaching the
 * instruction it was written to test.
 *
 * So every RPC call goes through here. The retry is deliberately narrow: it
 * fires on a rate limit and on nothing else. Retrying a program error would
 * resend a transaction that already failed, burn fifteen seconds of backoff,
 * and — worse — turn a genuine on-chain rejection into a slow one, which is
 * exactly the signal the early-`seal` check depends on reading quickly.
 */
const RATE_LIMITED = /429|too many requests|rate.?limit/i;

async function retry(description, call, attempts = 5) {
  let delayMs = 1000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= attempts || !RATE_LIMITED.test(describeError(error))) throw error;
      console.log(
        `    .. ${description} is rate limited; retrying in ${delayMs}ms ` +
          `(attempt ${attempt + 1} of ${attempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

const getSlot = () => retry("getSlot", () => rpc.getSlot().send());
const getLatestBlockhash = () => retry("getLatestBlockhash", () => rpc.getLatestBlockhash().send());
const getBalance = (account) => retry("getBalance", () => rpc.getBalance(account).send());

/**
 * One `getMultipleAccounts` for the whole set rather than one `getAccountInfo`
 * per account. Scenario A watches six token accounts before and after the
 * distribution; read singly that is twelve requests in a burst, which is a
 * large part of what provoked the 429 in the first place.
 */
async function readTokenBalances(accounts) {
  if (accounts.length === 0) return [];
  const info = await retry("getMultipleAccounts", () =>
    rpc.getMultipleAccounts(accounts, { encoding: "base64" }).send(),
  );
  return info.value.map((entry) =>
    entry === null ? null : Buffer.from(entry.data[0], "base64").readBigUInt64LE(64),
  );
}

/** SPL token balance, read from the account so a missing one is null. */
async function readTokenBalance(tokenAccount) {
  return (await readTokenBalances([tokenAccount]))[0];
}

/** Every watched balance at one moment, keyed by the name it was watched under. */
async function snapshotBalances(watched) {
  const values = await readTokenBalances(watched.map((entry) => entry.account));
  return Object.fromEntries(watched.map((entry, index) => [entry.name, values[index]]));
}

async function readChannelAccount(channelAddress) {
  const info = await retry("getAccountInfo", () =>
    rpc.getAccountInfo(channelAddress, { encoding: "base64" }).send(),
  );
  if (info.value === null) return null;
  return {
    lamports: info.value.lamports,
    owner: info.value.owner,
    raw: Buffer.from(info.value.data[0], "base64"),
  };
}

/** Read and decode the channel, throwing rather than returning a half-state. */
async function readChannel(channelAddress, label) {
  const account = await readChannelAccount(channelAddress);
  if (account === null) throw new Error(`${label}: the channel account is gone.`);
  if (account.raw.length !== CHANNEL_LEN) {
    throw new Error(`${label}: the channel is ${account.raw.length} bytes, not ${CHANNEL_LEN}.`);
  }
  return { account, channel: decodeChannel(account.raw, addressDecoder) };
}

/**
 * Build, sign, send and confirm one transaction.
 *
 * `expectFailure` inverts the meaning of a throw: a rejected instruction is the
 * result being looked for, and the error text is returned rather than raised.
 * The call is still recorded — the fee is real even when the instruction is
 * not — because "the program refused this" is itself the thing being proven.
 */
/** Errors that mean "the transport failed", not "the program refused". */
const TRANSPORT_FAILURE =
  /websocket|socket|timed? ?out|fetch failed|429|too many requests|rate.?limit|econnreset|network/i;

/**
 * How many times the confirmation stream claimed a transaction failed when the
 * chain said it had landed. Counted rather than only logged, because it is a
 * fact about the endpoint this ran against and belongs in the artifact.
 */
let confirmationRecoveries = 0;

/**
 * Ask the cluster what it thinks happened to a signature.
 *
 * Only called once the confirmation transport has already complained, because
 * that transport is a WebSocket against a shared public endpoint and it drops.
 * A dropped socket is not a dropped transaction — and on this script's second
 * run it was exactly that: three transactions reported `WebSocket failed to
 * connect` and had in fact landed cleanly, while a fourth reported
 * `Transaction simulation failed` because a 429 retry re-sent a blockhash the
 * cluster had already processed. Believing the transport produced four failed
 * checks for four instructions that all worked.
 */
async function chainOutcome(signature, label) {
  const { value } = await retry(`${label}: getSignatureStatuses`, () =>
    rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send(),
  );
  const status = value[0];
  if (!status) return { settled: false };
  // Landed and rejected by the program. This is a better answer than the
  // transport's text: it carries the program's own error, not a simulation
  // summary that reads the same for every mistake.
  if (status.err) return { settled: true, error: JSON.stringify(status.err) };
  const done = status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized";
  return { settled: done };
}

/**
 * Send a signed transaction and establish whether it landed.
 *
 * Resending is safe throughout: the signature is fixed at signing time, so the
 * cluster deduplicates rather than charging the fee twice.
 */
async function land(signed, signature, label) {
  let lastError = "not attempted";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await retry(`${label}: confirm`, () => sendAndConfirm(signed, { commitment: "confirmed" }));
      return { error: null, recovered: false };
    } catch (error) {
      lastError = describeError(error);
    }

    const outcome = await chainOutcome(signature, label);
    if (outcome.settled) {
      return outcome.error
        ? { error: `${outcome.error}\n${lastError}`, recovered: false }
        : { error: null, recovered: true };
    }
    // Nothing on chain and the failure is not a transport problem: a preflight
    // rejection is deterministic, so a retry only spends another minute
    // producing the same sentence.
    if (!TRANSPORT_FAILURE.test(lastError)) return { error: lastError, recovered: false };
  }

  return { error: lastError, recovered: false };
}

async function send(instructions, { label, expectFailure = false } = {}) {
  const { value: latestBlockhash } = await getLatestBlockhash();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);

  const { error, recovered } = await land(signed, signature, label);

  if (recovered) {
    confirmationRecoveries += 1;
    console.log(`    .. ${label}: the confirmation stream dropped, but the transaction is on chain`);
  }
  if (error === null && expectFailure) {
    check(false, `${label}: the transaction was accepted, but it was expected to be rejected`);
  }
  if (error !== null && !expectFailure) {
    check(false, `${label}: ${error.split("\n")[0]}`);
  }

  return { signature, error };
}

function ataInstructionFor(ataAccount, owner) {
  return buildCreateAtaIdempotentInstruction({
    payer: payer.address,
    payerSigner: payer,
    ata: ataAccount,
    owner,
    mint: TEST_MINT,
    tokenProgram: TOKEN_PROGRAM,
    AccountRole,
  });
}

/** Sign a 50-byte voucher and submit it in a precompile immediately before `settle`. */
async function meterOnce({ channelAddress, ratePerSecond, label }) {
  const before = await readChannel(channelAddress, label);
  if (before.channel.status !== 0) {
    throw new Error(
      `${label}: the channel is ${CHANNEL_STATUS[before.channel.status]}, and usage can only be ` +
        "metered while it is Open.",
    );
  }

  const requested = before.channel.settled + ratePerSecond * BigInt(TICK_SECONDS);
  const target = requested > before.channel.deposit ? before.channel.deposit : requested;
  if (target <= before.channel.settled) {
    throw new Error(
      `${label}: the voucher would not advance the watermark ` +
        `(${before.channel.settled} -> ${target}). The program rejects that with error 234.`,
    );
  }

  const payload = buildVoucherPayload(addressEncoder, channelAddress, target, 0n);
  const { signature: voucherSignature, publicKey } = await signVoucher(operatorSeed, payload);

  if (addressDecoder.decode(publicKey) !== before.channel.authorizedSigner) {
    throw new Error(
      `${label}: the voucher signer is not the channel's authorized_signer ` +
        "-> error 237 (voucherSignerMismatch).",
    );
  }

  const { signature } = await send(
    [
      {
        programAddress: address(ED25519_PRECOMPILE),
        accounts: [],
        data: buildEd25519PrecompileData(publicKey, voucherSignature, payload),
      },
      {
        programAddress: PAYMENT_CHANNELS_PROGRAM,
        accounts: [
          { address: channelAddress, role: AccountRole.WRITABLE },
          { address: address(INSTRUCTIONS_SYSVAR), role: AccountRole.READONLY },
        ],
        data: new Uint8Array([DISCRIMINATOR.settle]),
      },
    ],
    { label },
  );

  const after = await readChannel(channelAddress, label);
  check(
    after.channel.settled === target,
    `${label}: the transaction confirmed but the watermark is ${after.channel.settled}, not ${target}`,
  );

  return { target, signature, payload, publicKey, voucherSignature, before: before.channel };
}

/** Open a channel and return everything the later steps need to address it. */
async function openChannel({ label, saltOffset = 0, gracePeriod, deposit, recipients = [] }) {
  const openSlot = BigInt(await getSlot());
  const salt = BigInt(Date.now() + saltOffset);

  const [channelAddress, channelBump] = await getProgramDerivedAddress({
    programAddress: PAYMENT_CHANNELS_PROGRAM,
    seeds: channelSeeds(addressEncoder, {
      payer: payer.address,
      payee: operatorAddress,
      mint: TEST_MINT,
      authorizedSigner: operatorAddress,
      salt,
      openSlot,
    }),
  });

  const [channelTokenAccount] = await findAssociatedTokenPda({
    owner: channelAddress,
    tokenProgram: TOKEN_PROGRAM,
    mint: TEST_MINT,
  });

  const existing = await readChannelAccount(channelAddress);
  if (existing !== null) {
    throw new Error(
      `${label}: a channel already exists at ${channelAddress}. That should be impossible for a ` +
        "fresh salt; do not trust this run.",
    );
  }

  const payerBefore = await readTokenBalance(payerTokenAccount);
  if (payerBefore === null || payerBefore < deposit) {
    throw new Error(
      `${label}: the payer holds ${payerBefore} atomic units, less than the ${deposit} deposit. ` +
        "Fund the payer token account before running this.",
    );
  }

  const { signature } = await send(
    [
      {
        programAddress: PAYMENT_CHANNELS_PROGRAM,
        accounts: [
          { address: payer.address, role: AccountRole.WRITABLE_SIGNER }, // payer
          { address: payer.address, role: AccountRole.WRITABLE_SIGNER }, // rentPayer
          { address: operatorAddress, role: AccountRole.READONLY }, // payee
          { address: TEST_MINT, role: AccountRole.READONLY }, // mint
          { address: operatorAddress, role: AccountRole.READONLY }, // authorizedSigner
          { address: channelAddress, role: AccountRole.WRITABLE },
          { address: payerTokenAccount, role: AccountRole.WRITABLE },
          { address: channelTokenAccount, role: AccountRole.WRITABLE },
          { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
          { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
          { address: SYSVAR_RENT, role: AccountRole.READONLY },
          { address: ASSOCIATED_TOKEN_PROGRAM, role: AccountRole.READONLY },
          { address: eventAuthority, role: AccountRole.READONLY },
          { address: PAYMENT_CHANNELS_PROGRAM, role: AccountRole.READONLY }, // selfProgram
        ],
        data: encodeOpenArgs({
          addressEncoder,
          salt,
          deposit,
          gracePeriod,
          openSlot,
          recipients,
        }),
      },
    ],
    { label: `${label}: open` },
  );

  const { account, channel } = await readChannel(channelAddress, label);
  const escrow = await readTokenBalance(channelTokenAccount);

  check(channel.status === 0, `${label}: status is ${channel.status}, not 0 (Open)`);
  check(channel.deposit === deposit, `${label}: deposit is ${channel.deposit}, not ${deposit}`);
  check(channel.gracePeriod === gracePeriod, `${label}: grace period is ${channel.gracePeriod}`);
  check(escrow === deposit, `${label}: the escrow holds ${escrow}, not ${deposit}`);

  return {
    label,
    channelAddress,
    channelBump,
    channelTokenAccount,
    salt,
    openSlot,
    signature,
    channel,
    escrowLamports: account.lamports,
  };
}

// ---------------------------------------------------------------------------
// Scenario A — a real distribution plan
// ---------------------------------------------------------------------------

async function scenarioSplit() {
  log("");
  log("  SCENARIO A: a distribution plan with real recipients");
  log("  ============================================================");

  // Two recipients nobody holds a key for. Derived rather than random so the
  // addresses in the evidence can be re-derived by a reader, and so the run is
  // reproducible: a random recipient would make the artifact uncheckable.
  const recipients = [];
  for (const entry of SPLIT_SHARES) {
    const [recipient] = await getProgramDerivedAddress({
      programAddress: PAYMENT_CHANNELS_PROGRAM,
      seeds: ["usagebar", "split", entry.seed],
    });
    const [ata] = await findAssociatedTokenPda({
      owner: recipient,
      tokenProgram: TOKEN_PROGRAM,
      mint: TEST_MINT,
    });
    recipients.push({ ...entry, recipient, ata });
  }

  log(`    payee          : ${operatorAddress}  (implicit ${BPS_DENOMINATOR - SPLIT_EXPLICIT_BPS} bps)`);
  for (const entry of recipients) {
    log(`    ${entry.name.padEnd(14)} : ${entry.recipient}  (${entry.bps} bps)`);
  }
  log("");

  const opened = await openChannel({
    label: "split:open",
    saltOffset: 0,
    gracePeriod: 60,
    deposit: SPLIT_DEPOSIT,
    recipients: recipients.map((entry) => ({ recipient: entry.recipient, bps: entry.bps })),
  });

  log(`    channel        : ${opened.channelAddress}  (bump ${opened.channelBump})`);
  log(`    openSlot       : ${opened.openSlot}`);
  log(`    salt           : ${opened.salt}`);
  log(`    tx             : ${opened.signature}`);
  log("");

  // The plan is committed as a HASH at open, so the only way to know the bytes
  // were accepted is to hash the same bytes locally and compare. This is the
  // first time that has happened with a non-empty plan on chain.
  const planPreimage = Buffer.from(
    encodeDistributeData(addressEncoder, recipients.map((e) => ({ recipient: e.recipient, bps: e.bps }))).subarray(1),
  );
  const planHash = createHash("sha256").update(planPreimage).digest("hex");

  log(`    plan preimage  : ${planPreimage.toString("hex")}`);
  log(`    sha256         : ${planHash}`);
  log(`    committed      : ${opened.channel.distributionHash}`);
  log("");

  check(
    planHash === opened.channel.distributionHash,
    `the plan committed at open (${opened.channel.distributionHash}) is not the hash of the plan ` +
      `we sent (${planHash})`,
  );

  writeEvidence("01-split-open.json", {
    scenario: "split",
    channel: opened.channelAddress,
    channelBump: opened.channelBump,
    transactionSignature: opened.signature,
    explorer: explorerTx(opened.signature),
    explorerChannel: explorerAddress(opened.channelAddress),
    observed: {
      channel: decoded(opened.channel),
      channelBytes: CHANNEL_LEN,
      escrowLamports: opened.escrowLamports,
      planPreimageHex: planPreimage.toString("hex"),
      planCommittedHash: opened.channel.distributionHash,
      planSentHash: planHash,
      recipients: recipients.map((e) => ({
        name: e.name,
        recipient: e.recipient,
        tokenAccount: e.ata,
        bps: e.bps,
      })),
    },
    expected: {
      deposit: SPLIT_DEPOSIT.toString(),
      status: 0,
      settled: "0",
      planCommittedHash: planHash,
    },
    method:
      "the plan was encoded to its preimage, hashed locally with SHA-256, and compared against the " +
      "distribution_hash the channel stored — the program never reveals the plan, it only checks the hash",
  });

  // --- topUp ---------------------------------------------------------------

  log(`  A2: topUp (+${format(SPLIT_TOP_UP)})`);

  const escrowBeforeTopUp = await readTokenBalance(opened.channelTokenAccount);
  const payerBeforeTopUp = await readTokenBalance(payerTokenAccount);

  const topUp = await send(
    [
      {
        programAddress: PAYMENT_CHANNELS_PROGRAM,
        accounts: [
          { address: payer.address, role: AccountRole.WRITABLE_SIGNER },
          { address: opened.channelAddress, role: AccountRole.WRITABLE },
          { address: payerTokenAccount, role: AccountRole.WRITABLE },
          { address: opened.channelTokenAccount, role: AccountRole.WRITABLE },
          { address: TEST_MINT, role: AccountRole.READONLY },
          { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
        ],
        data: encodeTopUpData(SPLIT_TOP_UP),
      },
    ],
    { label: "split: topUp" },
  );

  const afterTopUp = await readChannel(opened.channelAddress, "split:topUp");
  const escrowAfterTopUp = await readTokenBalance(opened.channelTokenAccount);
  const payerAfterTopUp = await readTokenBalance(payerTokenAccount);
  const toppedUpDeposit = SPLIT_DEPOSIT + SPLIT_TOP_UP;

  log(`    deposit        : ${format(opened.channel.deposit)} -> ${format(afterTopUp.channel.deposit)}`);
  log(`    escrow         : ${format(escrowAfterTopUp ?? 0n)}`);
  log(`    tx             : ${topUp.signature}`);
  log("");

  check(
    afterTopUp.channel.deposit === toppedUpDeposit,
    `after topUp the deposit is ${afterTopUp.channel.deposit}, expected ${toppedUpDeposit}`,
  );
  check(
    escrowAfterTopUp === toppedUpDeposit,
    `after topUp the escrow holds ${escrowAfterTopUp}, expected ${toppedUpDeposit}`,
  );
  check(
    payerAfterTopUp === (payerBeforeTopUp ?? 0n) - SPLIT_TOP_UP,
    `the payer went ${payerBeforeTopUp} -> ${payerAfterTopUp}, expected a fall of ${SPLIT_TOP_UP}`,
  );
  // The committed plan must survive a deposit change, or a payer could top up
  // and quietly alter where the money goes.
  check(
    afterTopUp.channel.distributionHash === opened.channel.distributionHash,
    "topUp changed the channel's committed distribution plan",
  );

  writeEvidence("02-split-topup.json", {
    scenario: "split",
    channel: opened.channelAddress,
    transactionSignature: topUp.signature,
    explorer: explorerTx(topUp.signature),
    observed: {
      depositBefore: opened.channel.deposit.toString(),
      depositAfter: afterTopUp.channel.deposit.toString(),
      escrowBefore: escrowBeforeTopUp?.toString() ?? null,
      escrowAfter: escrowAfterTopUp?.toString() ?? null,
      payerBalanceBefore: payerBeforeTopUp?.toString() ?? null,
      payerBalanceAfter: payerAfterTopUp?.toString() ?? null,
      distributionHashBefore: opened.channel.distributionHash,
      distributionHashAfter: afterTopUp.channel.distributionHash,
    },
    expected: {
      depositAfter: toppedUpDeposit.toString(),
      escrowAfter: toppedUpDeposit.toString(),
      payerBalanceAfter: ((payerBeforeTopUp ?? 0n) - SPLIT_TOP_UP).toString(),
      distributionHashAfter: opened.channel.distributionHash,
    },
    method:
      "the channel and both token accounts were re-read after the transaction: the deposit field, the " +
      "escrow balance and the payer's balance must all move by exactly the topped-up amount",
  });

  // --- meter ---------------------------------------------------------------

  log(`  A3: metering (${SPLIT_TICKS} x ${TICK_SECONDS}s at ${SPLIT_RATE_PER_SECOND}/s)`);

  const vouchers = [];
  for (let index = 1; index <= SPLIT_TICKS; index += 1) {
    const startedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, TICK_SECONDS * 1000));
    const elapsedMs = Math.round(performance.now() - startedAt);

    const result = await meterOnce({
      channelAddress: opened.channelAddress,
      ratePerSecond: SPLIT_RATE_PER_SECOND,
      label: `split: voucher ${index}`,
    });

    log(`    voucher ${index}      : ${format(result.target)}  (billed ${elapsedMs} ms of real time)`);
    vouchers.push({ index, target: result.target.toString(), signature: result.signature, elapsedMs });
  }

  const metered = await readChannel(opened.channelAddress, "split: after metering");
  const settled = metered.channel.settled;
  const payoutWatermark = metered.channel.payoutWatermark;

  log(`    watermark      : ${format(settled)}`);
  log("");

  // --- close: settleAndSeal ------------------------------------------------

  log("  A4: close (settleAndSeal, no voucher)");

  const seal = await send(
    [
      {
        programAddress: PAYMENT_CHANNELS_PROGRAM,
        accounts: [
          { address: operatorAddress, role: AccountRole.READONLY_SIGNER, signer: operator },
          { address: opened.channelAddress, role: AccountRole.WRITABLE },
          { address: address(INSTRUCTIONS_SYSVAR), role: AccountRole.READONLY },
        ],
        // No voucher. A voucher must STRICTLY advance the watermark (error
        // 234), and the meter already reached this value, so attaching one
        // would bill seconds that were never metered.
        data: new Uint8Array([DISCRIMINATOR.settleAndSeal, 0]),
      },
    ],
    { label: "split: settleAndSeal" },
  );

  const sealed = await readChannel(opened.channelAddress, "split: after seal");
  log(`    status         : ${sealed.channel.status} (${CHANNEL_STATUS[sealed.channel.status]})`);
  log(`    tx             : ${seal.signature}`);
  log("");

  check(sealed.channel.status === 1, `the channel is ${CHANNEL_STATUS[sealed.channel.status]}, not Sealed`);

  // --- distribute ----------------------------------------------------------

  log("  A5: distribute (revealing the plan)");

  // Everything that receives a share, watched under one name each. The payee's
  // is keyed `payee` rather than by its address so the checks below read as the
  // sentence they are making.
  const watched = [
    { name: "payer", account: payerTokenAccount },
    { name: "escrow", account: opened.channelTokenAccount },
    { name: "payee", account: payeeTokenAccount },
    { name: "treasury", account: treasuryTokenAccount },
    ...recipients.map((entry) => ({ name: entry.name, account: entry.ata })),
  ];

  const balancesBefore = await snapshotBalances(watched);

  const distributeData = encodeDistributeData(
    addressEncoder,
    recipients.map((e) => ({ recipient: e.recipient, bps: e.bps })),
  );
  const revealedPreimage = Buffer.from(distributeData.subarray(1));
  const revealedHash = createHash("sha256").update(revealedPreimage).digest("hex");

  check(
    revealedHash === sealed.channel.distributionHash,
    "the plan being revealed does not hash to the channel's commitment -> error 2407",
  );

  // The recipient ATAs are appended in the SAME ORDER as the preimage entries.
  // Reversing them is the obvious mistake and the program cannot detect it from
  // the hash alone — it would simply pay the wrong people.
  const distributeInstruction = {
    programAddress: PAYMENT_CHANNELS_PROGRAM,
    accounts: [
      { address: opened.channelAddress, role: AccountRole.WRITABLE },
      { address: sealed.channel.payer, role: AccountRole.WRITABLE },
      { address: sealed.channel.rentPayer, role: AccountRole.WRITABLE },
      { address: opened.channelTokenAccount, role: AccountRole.WRITABLE },
      { address: payerTokenAccount, role: AccountRole.WRITABLE },
      { address: payeeTokenAccount, role: AccountRole.WRITABLE },
      { address: treasuryTokenAccount, role: AccountRole.WRITABLE },
      { address: sealed.channel.mint, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: eventAuthority, role: AccountRole.READONLY },
      { address: PAYMENT_CHANNELS_PROGRAM, role: AccountRole.READONLY },
      ...recipients.map((entry) => ({ address: entry.ata, role: AccountRole.WRITABLE })),
    ],
    data: distributeData,
  };

  // CreateIdempotent, so running this twice is harmless and it does not matter
  // which of these accounts already exist from an earlier run.
  const createInstructions = [
    ataInstructionFor(payeeTokenAccount, sealed.channel.payee),
    ataInstructionFor(treasuryTokenAccount, TREASURY_OWNER),
    ...recipients.map((entry) => ataInstructionFor(entry.ata, entry.recipient)),
  ];

  const distribute = await send([...createInstructions, distributeInstruction], {
    label: "split: distribute",
  });

  const balancesAfter = await snapshotBalances(watched);

  // What the program documents, recomputed here from the channel's own numbers.
  // The payee's share is the implicit remainder, so it gets its own basis-point
  // count rather than "whatever is left" — the two differ by the flooring dust.
  const payeeBps = BPS_DENOMINATOR - SPLIT_EXPLICIT_BPS;
  const expected = {};
  for (const entry of recipients) {
    expected[entry.name] = shareOf(settled, entry.bps) - shareOf(payoutWatermark, entry.bps);
  }
  expected.payee = shareOf(settled, payeeBps) - shareOf(payoutWatermark, payeeBps);
  expected.payer = sealed.channel.deposit - settled;
  expected.treasury =
    (balancesBefore.escrow ?? 0n) - Object.values(expected).reduce((total, value) => total + value, 0n);

  /** What actually arrived, as a delta on what was observed before. */
  const received = Object.fromEntries(
    watched.map((entry) => [entry.name, (balancesAfter[entry.name] ?? 0n) - (balancesBefore[entry.name] ?? 0n)]),
  );

  log(`    settled        : ${format(settled)}`);
  log("");
  for (const entry of recipients) {
    log(
      `    ${entry.name.padEnd(14)} : ${format(received[entry.name])}   ` +
        `(${entry.bps} bps, expected ${format(expected[entry.name])})`,
    );
    check(
      received[entry.name] === expected[entry.name],
      `${entry.name} received ${received[entry.name]}, expected ${expected[entry.name]}`,
    );
  }

  log(
    `    payee          : ${format(received.payee)}   ` +
      `(implicit ${payeeBps} bps, expected ${format(expected.payee)})`,
  );
  log(`    payer refund   : ${format(received.payer)}   (expected ${format(expected.payer)})`);
  log(`    treasury dust  : ${format(received.treasury)}   (expected ${format(expected.treasury)})`);
  log(`    escrow after   : ${balancesAfter.escrow === null ? "(closed)" : format(balancesAfter.escrow)}`);
  log(`    tx             : ${distribute.signature}`);
  log("");

  check(received.payee === expected.payee, `the payee received ${received.payee}, expected ${expected.payee}`);
  check(received.payer === expected.payer, `the payer received ${received.payer}, expected ${expected.payer}`);
  check(
    received.treasury === expected.treasury,
    `the treasury received ${received.treasury}, expected ${expected.treasury}`,
  );

  // Conservation, read rather than computed: every token that arrived in a
  // recipient, in the payee's account, back to the payer, or in the treasury
  // must equal the tokens that left the escrow. The treasury's expected value
  // above is derived from the escrow, so checking against it would be checking
  // the arithmetic against itself — this compares five independently observed
  // deltas against a sixth account's change.
  //
  // The escrow is excluded from the sum, and that is the whole subtlety: it is
  // watched too, so its own delta is minus everything the others gained, and
  // including it makes the total zero on a run where nothing went wrong. The
  // first version of this check did exactly that and reported failure on a
  // distribution where all five payouts had matched to the atomic unit.
  const totalReceived = Object.entries(received)
    .filter(([name]) => name !== "escrow")
    .reduce((total, [, value]) => total + value, 0n);
  const escrowDrained = (balancesBefore.escrow ?? 0n) - (balancesAfter.escrow ?? 0n);

  check(
    totalReceived === escrowDrained,
    `${totalReceived} atomic units arrived across the five payout accounts, but the escrow fell ` +
      `by ${escrowDrained}`,
  );
  check(
    (balancesAfter.escrow ?? 0n) === 0n,
    `the escrow still holds ${balancesAfter.escrow}; it should have been drained and closed`,
  );

  writeEvidence("03-split-distributed.json", {
    scenario: "split",
    channel: opened.channelAddress,
    transactionSignature: distribute.signature,
    explorer: explorerTx(distribute.signature),
    observed: {
      channel: decoded(sealed.channel),
      // Tolerant of a reaped PDA for the same reason as the timeout scenario:
      // both outcomes are the program behaving correctly, and which one you get
      // depends only on how long the channel lived.
      channelReaped: (await readChannelAccount(opened.channelAddress)) === null,
      distributeError: distribute.error,
      planRevealedHex: revealedPreimage.toString("hex"),
      planRevealedSha256: revealedHash,
      deposit: sealed.channel.deposit.toString(),
      settled: settled.toString(),
      payoutWatermark: payoutWatermark.toString(),
      recipientOrder: recipients.map((entry) => ({ name: entry.name, ata: entry.ata, bps: entry.bps })),
      received: Object.fromEntries(
        Object.entries(received).map(([key, value]) => [key, value.toString()]),
      ),
      escrowBalanceAfter: balancesAfter.escrow?.toString() ?? null,
    },
    expected: {
      planRevealedSha256: sealed.channel.distributionHash,
      ...Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, value.toString()])),
      escrowBalanceAfter: null,
    },
    method:
      "every recipient's tokens were counted by re-reading its token account before and after the " +
      "transaction, and each share was recomputed as floor(settled * bps / 10000) minus " +
      "floor(payout_watermark * bps / 10000) from the channel's own fields rather than from the " +
      "amounts this script asked for",
    doesNotProve:
      "the deployed application does not open channels with a plan; this exercises the program's " +
      "split, not the product's payout path",
  });

  return {
    channel: opened.channelAddress,
    settled,
    expected,
    received: Object.fromEntries(Object.entries(received).map(([key, value]) => [key, value.toString()])),
  };
}

// ---------------------------------------------------------------------------
// Scenario B — requestClose, seal, withdrawPayer
// ---------------------------------------------------------------------------

async function scenarioTimeout() {
  log("");
  log("  SCENARIO B: the payer's timeout, and the refund that must not happen twice");
  log("  ============================================================");

  const opened = await openChannel({
    label: "timeout:open",
    saltOffset: 1,
    gracePeriod: TIMEOUT_GRACE_PERIOD,
    deposit: TIMEOUT_DEPOSIT,
  });

  log(`    channel        : ${opened.channelAddress}  (bump ${opened.channelBump})`);
  log(`    openSlot       : ${opened.openSlot}`);
  log(`    grace period   : ${opened.channel.gracePeriod}s`);
  log(`    tx             : ${opened.signature}`);
  log("");

  writeEvidence("04-timeout-open.json", {
    scenario: "timeout",
    channel: opened.channelAddress,
    channelBump: opened.channelBump,
    transactionSignature: opened.signature,
    explorer: explorerTx(opened.signature),
    explorerChannel: explorerAddress(opened.channelAddress),
    observed: {
      channel: decoded(opened.channel),
      escrowLamports: opened.escrowLamports,
      payerBalance: (await readTokenBalance(payerTokenAccount))?.toString() ?? null,
    },
    expected: {
      deposit: TIMEOUT_DEPOSIT.toString(),
      status: 0,
      gracePeriod: TIMEOUT_GRACE_PERIOD,
      closureStartedAt: "0",
      payerWithdrawnAt: "0",
    },
    method: "the channel account was re-read and decoded after the open transaction confirmed",
  });

  // --- meter, so there is something to protect -----------------------------

  log(`  B2: metering (1 x ${TICK_SECONDS}s at ${TIMEOUT_RATE_PER_SECOND}/s)`);

  const voucher = await meterOnce({
    channelAddress: opened.channelAddress,
    ratePerSecond: TIMEOUT_RATE_PER_SECOND,
    label: "timeout: voucher 1",
  });

  log(`    voucher 1      : ${format(voucher.target)}`);
  log("");

  // --- requestClose --------------------------------------------------------

  log("  B3: requestClose (payer-signed)");

  const requestClose = await send(
    [
      {
        programAddress: PAYMENT_CHANNELS_PROGRAM,
        accounts: [
          { address: payer.address, role: AccountRole.WRITABLE_SIGNER },
          { address: opened.channelAddress, role: AccountRole.WRITABLE },
        ],
        data: encodeRequestCloseData(),
      },
    ],
    { label: "timeout: requestClose" },
  );
  const requestCloseConfirmedAt = Date.now();

  const closing = await readChannel(opened.channelAddress, "timeout: after requestClose");

  log(`    status         : ${closing.channel.status} (${CHANNEL_STATUS[closing.channel.status]})`);
  log(`    started at     : ${closing.channel.closureStartedAt}`);
  log(`    tx             : ${requestClose.signature}`);
  log("");

  check(
    closing.channel.status === 2,
    `after requestClose the status is ${closing.channel.status} (${CHANNEL_STATUS[closing.channel.status]}), ` +
      "not 2 (Closing)",
  );
  check(
    closing.channel.closureStartedAt !== 0n,
    "requestClose did not stamp closure_started_at, so the grace period cannot be measured from anything",
  );
  check(
    closing.channel.settled === voucher.target,
    `requestClose changed the watermark: ${voucher.target} -> ${closing.channel.settled}`,
  );

  writeEvidence("05-timeout-request-close.json", {
    scenario: "timeout",
    channel: opened.channelAddress,
    transactionSignature: requestClose.signature,
    explorer: explorerTx(requestClose.signature),
    observed: {
      statusBefore: 0,
      statusAfter: closing.channel.status,
      closureStartedAt: closing.channel.closureStartedAt.toString(),
      payerWithdrawnAt: closing.channel.payerWithdrawnAt.toString(),
      settled: closing.channel.settled.toString(),
      payerBalance: (await readTokenBalance(payerTokenAccount))?.toString() ?? null,
      gracePeriodSeconds: closing.channel.gracePeriod,
    },
    expected: {
      statusAfter: 2,
      settled: voucher.target.toString(),
      payerWithdrawnAt: "0",
    },
    method:
      "the channel was re-read after confirmation; the raw closure_started_at is recorded without " +
      "asserting a unit, because this run did not independently establish whether it is seconds or " +
      "slots and a comment claiming one would be a guess",
    doesNotProve:
      "that closure_started_at is a unix timestamp — only that it is stamped with something and that " +
      "seal is refused until the grace period measured from it has elapsed",
  });

  // --- seal too early, and prove it is refused -----------------------------

  log("  B4: seal before the grace period has elapsed (expected to be refused)");

  const earlySeal = await send(
    [
      {
        programAddress: PAYMENT_CHANNELS_PROGRAM,
        accounts: [{ address: opened.channelAddress, role: AccountRole.WRITABLE }],
        data: encodeSealData(),
      },
    ],
    { label: "timeout: early seal", expectFailure: true },
  );

  const afterEarlySeal = await readChannel(opened.channelAddress, "timeout: after early seal");

  log(`    status         : ${afterEarlySeal.channel.status} (${CHANNEL_STATUS[afterEarlySeal.channel.status]})`);
  log(`    tx             : ${earlySeal.signature}`);
  log(`    refused with   : ${(earlySeal.error ?? "(accepted — see the failed check above)").split("\n")[0]}`);
  log("");

  // This is the check that makes the refusal meaningful. An error alone could
  // be anything — wrong accounts, wrong discriminator, a bad program id. If the
  // status is unchanged AND the identical instruction succeeds later with
  // nothing changed but the clock, then time was the only variable.
  check(
    afterEarlySeal.channel.status === 2,
    `sealing before the grace period elapsed was accepted; the status is ` +
      `${afterEarlySeal.channel.status} (${CHANNEL_STATUS[afterEarlySeal.channel.status]})`,
  );

  writeEvidence("06-timeout-seal-refused.json", {
    scenario: "timeout",
    channel: opened.channelAddress,
    transactionSignature: earlySeal.signature,
    explorer: explorerTx(earlySeal.signature),
    observed: {
      attempted: "seal, immediately after requestClose",
      rejected: earlySeal.error !== null,
      error: earlySeal.error,
      statusAfter: afterEarlySeal.channel.status,
      elapsedMsSinceRequestClose: Date.now() - requestCloseConfirmedAt,
      gracePeriodSeconds: afterEarlySeal.channel.gracePeriod,
    },
    expected: {
      rejected: true,
      statusAfter: 2,
    },
    method:
      "the identical `seal` instruction is retried below once the grace period has elapsed. It is the " +
      "only variable that changes between the two attempts, so a rejection here and a success there " +
      "is what attributes the rejection to the clock rather than to a malformed instruction",
    doesNotProve:
      "which error code the grace guard returns — the text is recorded verbatim rather than mapped to " +
      "a name this script has not verified",
  });

  // --- wait it out ---------------------------------------------------------

  const elapsed = Date.now() - requestCloseConfirmedAt;
  const waitMs = TIMEOUT_GRACE_PERIOD * 1000 + GRACE_MARGIN_MS - elapsed;
  if (waitMs > 0) {
    log(`  B5: waiting ${Math.ceil(waitMs / 1000)}s for the ${TIMEOUT_GRACE_PERIOD}s grace period`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  const waitedMs = Date.now() - requestCloseConfirmedAt;

  // --- seal ----------------------------------------------------------------

  log("  B6: seal (permissionless — no signer in its account list)");

  const seal = await send(
    [
      {
        programAddress: PAYMENT_CHANNELS_PROGRAM,
        accounts: [{ address: opened.channelAddress, role: AccountRole.WRITABLE }],
        data: encodeSealData(),
      },
    ],
    { label: "timeout: seal" },
  );

  const sealed = await readChannel(opened.channelAddress, "timeout: after seal");

  log(`    status         : ${sealed.channel.status} (${CHANNEL_STATUS[sealed.channel.status]})`);
  log(`    watermark kept : ${format(sealed.channel.settled)}  (unchanged by the seal)`);
  log(`    tx             : ${seal.signature}`);
  log("");

  check(
    sealed.channel.status === 1,
    `after the grace period the status is ${sealed.channel.status} ` +
      `(${CHANNEL_STATUS[sealed.channel.status]}), not 1 (Sealed)`,
  );
  check(
    sealed.channel.settled === voucher.target,
    `the seal moved the watermark: ${voucher.target} -> ${sealed.channel.settled}. Sealing is not ` +
      "settling; it must freeze what the meter reached.",
  );

  writeEvidence("07-timeout-sealed.json", {
    scenario: "timeout",
    channel: opened.channelAddress,
    transactionSignature: seal.signature,
    explorer: explorerTx(seal.signature),
    observed: {
      statusBefore: afterEarlySeal.channel.status,
      statusAfter: sealed.channel.status,
      closureStartedAt: sealed.channel.closureStartedAt.toString(),
      elapsedMsSinceRequestClose: waitedMs,
      gracePeriodSeconds: sealed.channel.gracePeriod,
      settledBefore: voucher.target.toString(),
      settledAfter: sealed.channel.settled.toString(),
    },
    expected: {
      statusAfter: 1,
      settledAfter: voucher.target.toString(),
    },
    method:
      "the same instruction that was refused above, retried after the grace period elapsed, with the " +
      "channel re-read afterwards to confirm both the status and that the watermark was left alone",
  });

  // --- withdrawPayer -------------------------------------------------------

  log("  B7: withdrawPayer (payer-signed, one shot)");

  const payerBeforeWithdraw = await readTokenBalance(payerTokenAccount);
  const escrowBeforeWithdraw = await readTokenBalance(opened.channelTokenAccount);
  const expectedRefund = sealed.channel.deposit - sealed.channel.settled;

  const withdraw = await send(
    [
      {
        programAddress: PAYMENT_CHANNELS_PROGRAM,
        accounts: [
          { address: payer.address, role: AccountRole.WRITABLE_SIGNER },
          { address: opened.channelAddress, role: AccountRole.WRITABLE },
          { address: opened.channelTokenAccount, role: AccountRole.WRITABLE },
          { address: payerTokenAccount, role: AccountRole.WRITABLE },
          { address: TEST_MINT, role: AccountRole.READONLY },
          { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
        ],
        data: encodeWithdrawPayerData(),
      },
    ],
    { label: "timeout: withdrawPayer" },
  );

  const afterWithdraw = await readChannel(opened.channelAddress, "timeout: after withdrawPayer");
  const payerAfterWithdraw = await readTokenBalance(payerTokenAccount);
  const escrowAfterWithdraw = await readTokenBalance(opened.channelTokenAccount);
  const refunded = (payerAfterWithdraw ?? 0n) - (payerBeforeWithdraw ?? 0n);

  log(`    refunded       : ${format(refunded)}   (expected ${format(expectedRefund)})`);
  log(`    stamped at     : ${afterWithdraw.channel.payerWithdrawnAt}`);
  log(`    escrow         : ${format(escrowAfterWithdraw ?? 0n)}`);
  log(`    tx             : ${withdraw.signature}`);
  log("");

  check(refunded === expectedRefund, `the payer was refunded ${refunded}, expected ${expectedRefund}`);
  check(
    escrowAfterWithdraw === (escrowBeforeWithdraw ?? 0n) - expectedRefund,
    `the escrow went ${escrowBeforeWithdraw} -> ${escrowAfterWithdraw}, expected a fall of ${expectedRefund}`,
  );
  check(
    afterWithdraw.channel.payerWithdrawnAt !== 0n,
    "withdrawPayer did not stamp payer_withdrawn_at, so nothing records that the refund already happened",
  );
  // The channel survives its own refund. This is what makes withdrawPayer the
  // escape hatch rather than a close: the merchant still has to be paid.
  check(
    afterWithdraw.channel.status === 1,
    `withdrawPayer left the channel in status ${afterWithdraw.channel.status}; it must stay Sealed`,
  );

  writeEvidence("08-timeout-payer-refund.json", {
    scenario: "timeout",
    channel: opened.channelAddress,
    transactionSignature: withdraw.signature,
    explorer: explorerTx(withdraw.signature),
    observed: {
      statusAfter: afterWithdraw.channel.status,
      payerWithdrawnAt: afterWithdraw.channel.payerWithdrawnAt.toString(),
      payerBalanceBefore: payerBeforeWithdraw?.toString() ?? null,
      payerBalanceAfter: payerAfterWithdraw?.toString() ?? null,
      escrowBefore: escrowBeforeWithdraw?.toString() ?? null,
      escrowAfter: escrowAfterWithdraw?.toString() ?? null,
      refunded: refunded.toString(),
    },
    expected: {
      refunded: expectedRefund.toString(),
      statusAfter: 1,
      escrowAfter: ((escrowBeforeWithdraw ?? 0n) - expectedRefund).toString(),
    },
    method:
      "the payer's token account and the escrow were both re-read; the refund is claimed only because " +
      "tokens arrived, not because the transaction succeeded",
  });

  // --- distribute, and the gate that must hold -----------------------------

  log("  B8: distribute — the payer must NOT be refunded a second time");

  const watched = [
    { name: "payer", account: payerTokenAccount },
    { name: "escrow", account: opened.channelTokenAccount },
    { name: "payee", account: payeeTokenAccount },
    { name: "treasury", account: treasuryTokenAccount },
  ];

  const balancesBefore = await snapshotBalances(watched);

  // Empty plan: this channel was opened without recipients, so the reveal is
  // the four zero bytes of a zero count.
  const distributeData = encodeDistributeData(addressEncoder, []);
  const revealedHash = createHash("sha256").update(Buffer.from(distributeData.subarray(1))).digest("hex");

  check(
    revealedHash === sealed.channel.distributionHash,
    "the empty plan does not hash to the channel's commitment -> error 2407",
  );

  const distribute = await send(
    [
      ataInstructionFor(payeeTokenAccount, operatorAddress),
      ataInstructionFor(treasuryTokenAccount, TREASURY_OWNER),
      {
        programAddress: PAYMENT_CHANNELS_PROGRAM,
        accounts: [
          { address: opened.channelAddress, role: AccountRole.WRITABLE },
          { address: sealed.channel.payer, role: AccountRole.WRITABLE },
          { address: sealed.channel.rentPayer, role: AccountRole.WRITABLE },
          { address: opened.channelTokenAccount, role: AccountRole.WRITABLE },
          { address: payerTokenAccount, role: AccountRole.WRITABLE },
          { address: payeeTokenAccount, role: AccountRole.WRITABLE },
          { address: treasuryTokenAccount, role: AccountRole.WRITABLE },
          { address: sealed.channel.mint, role: AccountRole.READONLY },
          { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
          { address: eventAuthority, role: AccountRole.READONLY },
          { address: PAYMENT_CHANNELS_PROGRAM, role: AccountRole.READONLY },
        ],
        data: distributeData,
      },
    ],
    { label: "timeout: distribute" },
  );

  const balancesAfter = await snapshotBalances(watched);

  const payeeReceived = (balancesAfter.payee ?? 0n) - (balancesBefore.payee ?? 0n);
  // THE CHECK THIS SCENARIO EXISTS FOR. `distribute` refunds the payer on its
  // way past unless `payer_withdrawn_at` says the refund already happened. If
  // the gate is missing, this is a second payment out of an escrow that only
  // holds the settled amount — a real double-spend, and one that a green
  // "distribute succeeded" would not reveal.
  const payerReceivedAgain = (balancesAfter.payer ?? 0n) - (balancesBefore.payer ?? 0n);
  const treasuryReceived = (balancesAfter.treasury ?? 0n) - (balancesBefore.treasury ?? 0n);

  const expectedPayee = sealed.channel.settled - sealed.channel.payoutWatermark;

  log(`    payee          : ${format(payeeReceived)}   (expected ${format(expectedPayee)})`);
  log(`    payer AGAIN    : ${format(payerReceivedAgain)}   (expected ${format(0n)})`);
  log(`    treasury dust  : ${format(treasuryReceived)}`);
  log(`    escrow after   : ${balancesAfter.escrow === null ? "(closed)" : format(balancesAfter.escrow)}`);
  log(`    tx             : ${distribute.signature}`);
  log("");

  check(payeeReceived === expectedPayee, `the payee received ${payeeReceived}, expected ${expectedPayee}`);
  check(
    payerReceivedAgain === 0n,
    `the payer was refunded a SECOND time, of ${payerReceivedAgain} atomic units, after ` +
      "withdrawPayer had already refunded them",
  );
  check(
    (balancesAfter.escrow ?? 0n) === 0n,
    `the escrow still holds ${balancesAfter.escrow}; it should have been drained and closed`,
  );

  // The channel PDA is deallocated when `distribute` runs more than 1500 slots
  // after `open`, and this channel has lived for about twenty seconds — so it
  // should still be here, at status 3 (Distributed). But "gone" is a correct
  // outcome too, and it must be recorded as found rather than turned into a
  // throw: reading a reaped channel with `readChannel` would fail the scenario
  // for the program doing the right thing.
  const finalAccount = await readChannelAccount(opened.channelAddress);
  const finalStatus =
    finalAccount === null ? null : decodeChannel(finalAccount.raw, addressDecoder).status;

  log(`    channel PDA    : ${finalAccount === null ? "reaped" : `status ${finalStatus}`}`);
  log("");

  writeEvidence("09-timeout-distributed.json", {
    scenario: "timeout",
    channel: opened.channelAddress,
    transactionSignature: distribute.signature,
    explorer: explorerTx(distribute.signature),
    observed: {
      statusBefore: 1,
      statusAfter: finalStatus,
      channelReaped: finalAccount === null,
      distributeError: distribute.error,
      settled: sealed.channel.settled.toString(),
      payoutWatermark: sealed.channel.payoutWatermark.toString(),
      payerWithdrawnAt: sealed.channel.payerWithdrawnAt.toString(),
      payeeReceived: payeeReceived.toString(),
      payerReceived: payerReceivedAgain.toString(),
      treasuryReceived: treasuryReceived.toString(),
      escrowBalanceAfter: balancesAfter.escrow?.toString() ?? null,
    },
    expected: {
      payeeReceived: expectedPayee.toString(),
      payerReceived: "0",
      escrowBalanceAfter: null,
    },
    method:
      "the payer's and the provider's token accounts were re-read before and after; the payer's delta " +
      "being exactly zero is the whole claim, and it is the number a transaction-success check would " +
      "have missed",
    doesNotProve:
      "what would have happened without the earlier withdrawPayer — the gate is proven by the zero, " +
      "not by a comparison against a run that omitted the refund",
  });

  return {
    channel: opened.channelAddress,
    settled: sealed.channel.settled,
    payeeReceived,
    payerReceivedAgain,
    refundedEarlier: refunded,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

log("");
log(`  ${RUN_NAME}`);
log("  ============================================================");
log(`  cluster        : ${RPC_URL}`);
log(`  payer          : ${payer.address}`);
log(`  provider       : ${operatorAddress}`);
log(`  mint           : ${TEST_MINT}`);
log("");

const feePayerLamports = await getBalance(payer.address);
if (feePayerLamports.value < LAMPORTS_FOR_FEES) {
  throw new Error(
    `The fee payer holds ${feePayerLamports.value} lamports and this run sends about a dozen ` +
      `transactions. Fund it with at least ${LAMPORTS_FOR_FEES}.`,
  );
}

const [payerTokenAccount] = await findAssociatedTokenPda({
  owner: payer.address,
  tokenProgram: TOKEN_PROGRAM,
  mint: TEST_MINT,
});
const [payeeTokenAccount] = await findAssociatedTokenPda({
  owner: operatorAddress,
  tokenProgram: TOKEN_PROGRAM,
  mint: TEST_MINT,
});
const [treasuryTokenAccount] = await findAssociatedTokenPda({
  owner: TREASURY_OWNER,
  tokenProgram: TOKEN_PROGRAM,
  mint: TEST_MINT,
});
const [eventAuthority] = await getProgramDerivedAddress({
  programAddress: PAYMENT_CHANNELS_PROGRAM,
  seeds: ["event_authority"],
});

if ((await readTokenBalance(payerTokenAccount)) === null) {
  throw new Error(
    `The payer has no token account for ${TEST_MINT}. It must hold the deposit before it can open a ` +
      "channel; the faucet exists for exactly this.",
  );
}

const scenarios = [
  ["split", scenarioSplit],
  ["timeout", scenarioTimeout],
];

const summary = {};

for (const [name, run] of scenarios) {
  const before = failures.length;
  try {
    summary[name] = { completed: true, result: decoded(await run()) };
  } catch (error) {
    const text = describeError(error);
    summary[name] = { completed: false, error: text };
    check(false, `${name}: ${text.split("\n")[0]}`);
  }
  scenarioFailures[name] = failures.length - before;
}

const totalChecks = failures.length === 0 ? "all" : `${failures.length} of them`;
log("");
log("  ============================================================");
log(`  ${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length} failed check(s)`);
for (const [name, count] of Object.entries(scenarioFailures)) {
  log(`    ${name.padEnd(10)}: ${count === 0 ? "clean" : `${count} failed`}`);
}
log(`  evidence written: ${written.length} file(s) to ${EVIDENCE_DIR}`);
log("");

writeEvidence("10-summary.json", {
  scenario: "summary",
  channel: null,
  transactionSignature: null,
  observed: {
    scenarios: summary,
    evidenceFiles: written,
    failedChecks: failures,
    confirmationRecoveries,
  },
  expected: {
    failedChecks: [],
  },
  method:
    "the two scenarios are independent; one failing does not prevent the other from running, and " +
    "the process exits non-zero if any check anywhere failed",
  doesNotProve:
    "anything about the deployed application. This script drives the program directly with keypairs " +
    "the repository holds. The app calls none of these instructions and opens channels with an empty " +
    "plan, so the interface is unaffected either way.",
});

if (failures.length > 0) {
  process.exitCode = 1;
}
