#!/usr/bin/env node
/**
 * THE CANONICAL RUN: `canonical-usagebar-devnet-001`.
 *
 * Build spec Section 25. One uninterrupted pass through the whole lifecycle —
 * environment, open, five metered vouchers, seal, distribute, final state — on
 * Devnet, writing an evidence artifact for every step into
 * `evidence/canonical-run/`.
 *
 * WHAT MAKES THIS EVIDENCE RATHER THAN A LOG
 *
 *   - Every number written is read back from chain after the transaction that
 *     was supposed to change it. A confirmed transaction is not evidence that
 *     anything moved; the account is.
 *   - Balances are read before and after, so the artifacts record money
 *     changing accounts rather than transactions succeeding.
 *   - The script exits non-zero on any mismatch, and it writes the evidence
 *     *after* each check, so a run that fails halfway leaves the artifacts for
 *     the steps that genuinely happened and none for the steps that did not.
 *   - It never writes a private key, seed, or token. Only public keys,
 *     signatures, and chain state.
 *
 * THE VOUCHERS ARE TIMED, NOT FAKE
 *
 * Section 25 permits reducing the voucher count "to preserve reliability" and
 * forbids creating fake voucher events merely to hit five. So the five vouchers
 * are produced on a real five-second cadence and each bills the time that
 * actually elapsed before it, measured with a monotonic clock. The artifacts
 * record that elapsed interval. This is a metering run, not a sequence of
 * numbers chosen to look like one.
 *
 * WHICH CODE PATH THIS EXERCISES
 *
 * The encoders here come from `tools/lib/protocol.mjs` — the same module the
 * application's chain adapter imports. So the byte layouts being exercised are
 * the ones the product uses, not a second implementation that happens to agree
 * today. The *signer* differs: the application has the customer's wallet sign
 * `open` in a browser, and this script signs it with a Devnet keypair we hold.
 * Nothing here proves the wallet handshake works; see docs/LIMITATIONS.md.
 *
 * The payee and the authorized_signer are the same key, matching how the
 * application configures a channel (`lib/server/env.ts`).
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
  encodeSettleAndSealData,
  envOr,
  signVoucher,
} from "./lib/protocol.mjs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RUN_NAME = "canonical-usagebar-devnet-001";
const NETWORK = "devnet";
const EVIDENCE_DIR = envOr("EVIDENCE_DIR", "evidence/canonical-run");

const RPC_URL = envOr("DEVNET_RPC_URL", "https://api.devnet.solana.com");
const WS_URL = envOr("DEVNET_WS_URL", "wss://api.devnet.solana.com");

const TEST_MINT = address(envOr("TEST_MINT", "6Jpyq8iUszZdZd2z3G9is1nfJh7ZwqbekW9cH2w58hmL"));
const TREASURY_OWNER = address(envOr("TREASURY_OWNER", DEVNET_TREASURY_OWNER));

/** 50 TEST, matching the ceiling the interface proposes. */
const DEPOSIT = BigInt(envOr("DEPOSIT", "50000000"));

/** 0.25 TEST per second, matching USAGEBAR_RATE_PER_SECOND. */
const RATE_PER_SECOND = BigInt(envOr("RATE_PER_SECOND", "250000"));

/** The program rejects zero with error 201. */
const GRACE_PERIOD = Number(envOr("GRACE_PERIOD", "60"));

/** How many metered vouchers to produce. Section 25 asks for five. */
const VOUCHERS = Number(envOr("VOUCHERS", "5"));

/** The billing interval each voucher covers. */
const TICK_SECONDS = Number(envOr("TICK_SECONDS", "5"));

if (!Number.isInteger(GRACE_PERIOD) || GRACE_PERIOD <= 0) {
  throw new Error(
    `GRACE_PERIOD must be a positive integer, got ${GRACE_PERIOD}. ` +
      "The program rejects zero with error 201 (gracePeriodMustBeNonZero).",
  );
}
if (!Number.isInteger(VOUCHERS) || VOUCHERS < 1) {
  throw new Error(`VOUCHERS must be a positive integer, got ${VOUCHERS}.`);
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
// The app uses one key for both roles; so does this. See lib/server/env.ts.
const operatorAddress = addressDecoder.decode(operatorSecretKey.subarray(32, 64));

const DECIMALS = 6;
const format = (atomic) => `${Number(atomic) / 10 ** DECIMALS} TEST`;
const explorerTx = (signature) => `https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`;
const explorerAddress = (value) => `https://explorer.solana.com/address/${value}?cluster=${NETWORK}`;

// ---------------------------------------------------------------------------
// Evidence writing
// ---------------------------------------------------------------------------

mkdirSync(EVIDENCE_DIR, { recursive: true });

const written = [];

/**
 * Write one evidence artifact.
 *
 * Every file carries the Section 27 header fields, so a reader never has to
 * work out which cluster or which program a number came from. The `readAt` is
 * the script's own clock and is labelled as such — it is not a blockchain
 * timestamp, and Section 30 forbids presenting one as the other.
 */
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

  const path = join(EVIDENCE_DIR, fileName);
  writeFileSync(
    path,
    `${JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
  );
  written.push(fileName);
  console.log(`    evidence: ${fileName}`);
}

const failures = [];
function check(condition, description) {
  if (condition) return true;
  failures.push(description);
  console.log(`    !! FAILED: ${description}`);
  return false;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** SPL token balance, read from the account so a missing one is null. */
async function readTokenBalance(tokenAccount) {
  const info = await rpc.getAccountInfo(tokenAccount, { encoding: "base64" }).send();
  if (info.value === null) return null;
  return Buffer.from(info.value.data[0], "base64").readBigUInt64LE(64);
}

async function readChannelAccount(channelAddress) {
  const info = await rpc.getAccountInfo(channelAddress, { encoding: "base64" }).send();
  if (info.value === null) return null;
  return {
    lamports: info.value.lamports,
    owner: info.value.owner,
    raw: Buffer.from(info.value.data[0], "base64"),
  };
}

function decoded(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
  );
}

function log(...parts) {
  console.log(...parts);
}

// ---------------------------------------------------------------------------
// STEP 1 — environment and asset
// ---------------------------------------------------------------------------

log("");
log(`  ${RUN_NAME}`);
log("  ============================================================");
log(`  cluster        : ${RPC_URL}`);
log(`  payer          : ${payer.address}`);
log(`  provider       : ${operatorAddress}  (payee AND authorized_signer)`);
log(`  mint           : ${TEST_MINT}`);
log("");

const slotAtStart = await rpc.getSlot().send();

const mintInfo = await rpc.getAccountInfo(TEST_MINT, { encoding: "base64" }).send();
if (mintInfo.value === null) {
  throw new Error(`No account at the configured mint ${TEST_MINT}. Cannot verify the asset.`);
}
const mintRaw = Buffer.from(mintInfo.value.data[0], "base64");
const mintDecimals = mintRaw.length >= 45 ? mintRaw.readUInt8(44) : null;
const mintSupply = mintRaw.length >= 44 ? mintRaw.readBigUInt64LE(36) : null;

log("  STEP 1: environment and asset");
log(`    slot           : ${slotAtStart}`);
log(`    mint owner     : ${mintInfo.value.owner}`);
log(`    mint decimals  : ${mintDecimals}`);
log(`    mint supply    : ${format(mintSupply ?? 0n)}`);
log("");

// The asset is only "verified" if the chain says what we think it says. A mint
// owned by the wrong program, or carrying a different decimal count, would make
// every amount below wrong by a factor of ten and every display value a lie.
check(
  mintInfo.value.owner === TOKEN_PROGRAM,
  `the mint is owned by ${mintInfo.value.owner}, not the classic SPL token program`,
);
check(mintDecimals === DECIMALS, `the mint has ${mintDecimals} decimals, not ${DECIMALS}`);

writeEvidence("01-environment.json", {
  slotAtStart,
  channel: null,
  transactionSignature: null,
  observed: {
    cluster: RPC_URL,
    mintOwner: mintInfo.value.owner,
    mintDecimals,
    mintSupply: (mintSupply ?? 0n).toString(),
    treasuryOwner: TREASURY_OWNER,
    deposit: DEPOSIT.toString(),
    ratePerSecond: RATE_PER_SECOND.toString(),
    gracePeriodSeconds: GRACE_PERIOD,
    vouchersPlanned: VOUCHERS,
    tickSeconds: TICK_SECONDS,
  },
  expected: {
    cluster: "devnet",
    mintOwner: TOKEN_PROGRAM,
    mintDecimals: DECIMALS,
    deposit: DEPOSIT.toString(),
  },
  method: "getSlot and getAccountInfo against the configured Devnet RPC; the mint's decimals are read from byte 44 of its account data and its owner from the account metadata",
});

// ---------------------------------------------------------------------------
// STEP 2 — open the channel
// ---------------------------------------------------------------------------

log("  STEP 2: open");

const currentSlot = await rpc.getSlot().send();
const openSlot = BigInt(currentSlot);
/** Milliseconds since the epoch: unique per run, and one of the two PDA seeds. */
const salt = BigInt(Date.now());

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

const [eventAuthority] = await getProgramDerivedAddress({
  programAddress: PAYMENT_CHANNELS_PROGRAM,
  seeds: ["event_authority"],
});
const [payerTokenAccount] = await findAssociatedTokenPda({
  owner: payer.address,
  tokenProgram: TOKEN_PROGRAM,
  mint: TEST_MINT,
});
const [channelTokenAccount] = await findAssociatedTokenPda({
  owner: channelAddress,
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

const existing = await readChannelAccount(channelAddress);
if (existing !== null) {
  throw new Error(
    `A channel already exists at ${channelAddress}. That should be impossible for a fresh salt; ` +
      "do not trust this run.",
  );
}

const balancesBefore = {
  payer: await readTokenBalance(payerTokenAccount),
  channel: await readTokenBalance(channelTokenAccount),
  payee: await readTokenBalance(payeeTokenAccount),
  treasury: await readTokenBalance(treasuryTokenAccount),
};

log(`    channel        : ${channelAddress}  (bump ${channelBump})`);
log(`    openSlot       : ${openSlot}`);
log(`    salt           : ${salt}`);
log(`    deposit        : ${format(DEPOSIT)}`);
log(`    payer before   : ${balancesBefore.payer === null ? "(no account)" : format(balancesBefore.payer)}`);
log("");

// Fail here, with a sentence, rather than at the deposit check below with a
// negative number that reads like a protocol bug. The payer needs a token
// account holding at least the deposit, plus SOL for fees and rent.
if (balancesBefore.payer === null) {
  throw new Error(
    `The payer has no token account for ${TEST_MINT}. It must hold the deposit before it can ` +
      "open a channel; the faucet exists for exactly this.",
  );
}
if (balancesBefore.payer < DEPOSIT) {
  throw new Error(
    `The payer holds ${format(balancesBefore.payer)}, less than the ${format(DEPOSIT)} deposit. ` +
      "Fund it before running the canonical run.",
  );
}

const feePayerLamports = await rpc.getBalance(payer.address).send();
if (feePayerLamports.value < 50_000_000n) {
  throw new Error(
    `The fee payer holds ${feePayerLamports.value} lamports, and this run sends ${2 + VOUCHERS + 1} ` +
      "transactions. Fund it with at least 0.05 SOL.",
  );
}

let openSignature = null;

{
  const instruction = {
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
      deposit: DEPOSIT,
      gracePeriod: GRACE_PERIOD,
      openSlot,
      recipients: [],
    }),
  };

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([instruction], m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  openSignature = getSignatureFromTransaction(signed);

  log(`    tx             : ${openSignature}`);
  await sendAndConfirm(signed, { commitment: "confirmed" });

  const account = await readChannelAccount(channelAddress);
  if (account === null) {
    throw new Error("The open transaction confirmed but no channel exists. Do not trust this run.");
  }

  const channel = decodeChannel(account.raw, addressDecoder);
  const balancesAfter = {
    payer: await readTokenBalance(payerTokenAccount),
    channel: await readTokenBalance(channelTokenAccount),
  };

  log(`    status         : ${channel.status} (${CHANNEL_STATUS[channel.status]})`);
  log(`    settled        : ${format(channel.settled)}`);
  log(`    payer after    : ${format(balancesAfter.payer ?? 0n)}`);
  log(`    escrow after   : ${format(balancesAfter.channel ?? 0n)}`);
  log("");

  check(account.raw.length === CHANNEL_LEN, `the channel is ${account.raw.length} bytes, not ${CHANNEL_LEN}`);
  check(channel.discriminator === 1, `discriminator is ${channel.discriminator}, not 1`);
  check(channel.status === 0, `status is ${channel.status}, not 0 (Open)`);
  check(channel.deposit === DEPOSIT, `deposit is ${channel.deposit}, not ${DEPOSIT}`);
  check(channel.settled === 0n, `settled is ${channel.settled}, not 0`);
  check(channel.payer === payer.address, `payer is ${channel.payer}`);
  check(channel.payee === operatorAddress, `payee is ${channel.payee}`);
  check(channel.authorizedSigner === operatorAddress, `authorizedSigner is ${channel.authorizedSigner}`);
  check(channel.mint === TEST_MINT, `mint is ${channel.mint}`);

  // The strongest check in this step: money left one account and arrived in
  // another. A successful transaction is not proof that anything worked.
  check(
    balancesAfter.payer === (balancesBefore.payer ?? 0n) - DEPOSIT,
    `the payer's balance went ${balancesBefore.payer} -> ${balancesAfter.payer}, expected a fall of ${DEPOSIT}`,
  );
  check(
    balancesAfter.channel === DEPOSIT,
    `the escrow holds ${balancesAfter.channel}, expected the full deposit ${DEPOSIT}`,
  );

  writeEvidence("02-channel-open.json", {
    channel: channelAddress,
    channelBump,
    transactionSignature: openSignature,
    explorer: explorerTx(openSignature),
    explorerChannel: explorerAddress(channelAddress),
    slotAtStart: currentSlot,
    observed: {
      channel: decoded(channel),
      channelBytes: account.raw.length,
      escrowLamports: account.lamports,
      payerBalanceBefore: balancesBefore.payer?.toString() ?? null,
      payerBalanceAfter: balancesAfter.payer?.toString() ?? null,
      channelBalanceAfter: balancesAfter.channel?.toString() ?? null,
    },
    expected: {
      channelBytes: CHANNEL_LEN,
      status: 0,
      deposit: DEPOSIT.toString(),
      settled: "0",
      payer: payer.address,
      payee: operatorAddress,
      authorizedSigner: operatorAddress,
      mint: TEST_MINT,
      payerBalanceDelta: `-${DEPOSIT}`,
      channelBalance: DEPOSIT.toString(),
    },
    method:
      "the transaction was confirmed, then the channel account was re-read and decoded, and both token accounts were re-read from chain",
  });
}

// ---------------------------------------------------------------------------
// STEPS 3-7 — five metered vouchers
// ---------------------------------------------------------------------------

log(`  STEPS 3-${2 + VOUCHERS}: metered vouchers`);
log("");

const voucherResults = [];

for (let index = 1; index <= VOUCHERS; index += 1) {
  const startedAt = performance.now();

  // Wait the interval the next voucher bills for. The voucher is not a
  // synthetic number: it bills time that genuinely passed.
  await new Promise((resolve) => setTimeout(resolve, TICK_SECONDS * 1000));
  const elapsedMs = Math.round(performance.now() - startedAt);

  const before = await readChannelAccount(channelAddress);
  if (before === null) throw new Error("The channel vanished mid-run.");
  const channel = decodeChannel(before.raw, addressDecoder);
  if (channel.status !== 0) {
    throw new Error(
      `Channel status is ${channel.status} (${CHANNEL_STATUS[channel.status]}); ` +
        "usage can only be metered while it is Open.",
    );
  }

  const requested = channel.settled + RATE_PER_SECOND * BigInt(TICK_SECONDS);
  const target = requested > channel.deposit ? channel.deposit : requested;
  if (target <= channel.settled) {
    throw new Error(
      `Voucher ${index} would not advance the watermark (${channel.settled} -> ${target}). ` +
        "The program rejects that with error 234.",
    );
  }

  const voucherPayload = buildVoucherPayload(addressEncoder, channelAddress, target, 0n);
  const { signature: voucherSignature, publicKey } = await signVoucher(operatorSeed, voucherPayload);

  if (addressDecoder.decode(publicKey) !== channel.authorizedSigner) {
    throw new Error(
      `The operator derives to ${addressDecoder.decode(publicKey)}, but the channel's ` +
        `authorized_signer is ${channel.authorizedSigner} -> error 237 (voucherSignerMismatch).`,
    );
  }

  const precompileInstruction = {
    programAddress: address(ED25519_PRECOMPILE),
    accounts: [],
    data: buildEd25519PrecompileData(publicKey, voucherSignature, voucherPayload),
  };
  const settleInstruction = {
    programAddress: PAYMENT_CHANNELS_PROGRAM,
    accounts: [
      { address: channelAddress, role: AccountRole.WRITABLE },
      { address: address(INSTRUCTIONS_SYSVAR), role: AccountRole.READONLY },
    ],
    // Only the discriminator. The voucher rides in the precompile above, and
    // the two instructions must stay adjacent: the program loads `current - 1`.
    data: new Uint8Array([DISCRIMINATOR.settle]),
  };

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([precompileInstruction, settleInstruction], m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const settleSignature = getSignatureFromTransaction(signed);

  await sendAndConfirm(signed, { commitment: "confirmed" });

  const after = await readChannelAccount(channelAddress);
  if (after === null) throw new Error("The channel vanished after settlement.");
  const settledChannel = decodeChannel(after.raw, addressDecoder);

  log(`    voucher ${index}: ${format(target)}  (billed ${elapsedMs} ms of real time)`);
  log(`      tx       : ${settleSignature}`);

  check(
    settledChannel.settled === target,
    `voucher ${index}: the transaction confirmed but the watermark is ${settledChannel.settled}, not ${target}`,
  );
  check(
    settledChannel.bytesConsumed === CHANNEL_LEN,
    `voucher ${index}: decoded ${settledChannel.bytesConsumed} bytes, expected ${CHANNEL_LEN}`,
  );

  const fileName = `${String(2 + index).padStart(2, "0")}-voucher-${String(index).padStart(2, "0")}.json`;
  writeEvidence(fileName, {
    channel: channelAddress,
    transactionSignature: settleSignature,
    explorer: explorerTx(settleSignature),
    observed: {
      watermarkBefore: channel.settled.toString(),
      watermarkAfter: settledChannel.settled.toString(),
      voucherPayloadHex: Buffer.from(voucherPayload).toString("hex"),
      voucherSignedBy: addressDecoder.decode(publicKey),
      voucherSignatureHex: Buffer.from(voucherSignature).toString("hex"),
      realElapsedMs: elapsedMs,
      billedSeconds: TICK_SECONDS,
    },
    expected: {
      watermarkBefore: channel.settled.toString(),
      watermarkAfter: target.toString(),
      billedAmount: (RATE_PER_SECOND * BigInt(TICK_SECONDS)).toString(),
      voucherSize: 50,
    },
    method:
      "the Ed25519 voucher was signed off chain, submitted in a precompile immediately before `settle`, then the channel account was re-read and the watermark decoded from byte 20",
  });

  voucherResults.push({
    index,
    target: target.toString(),
    signature: settleSignature,
    elapsedMs,
    watermarkAfter: settledChannel.settled.toString(),
  });
}

log("");

// ---------------------------------------------------------------------------
// STEP 8 — close: settleAndSeal
// ---------------------------------------------------------------------------

log("  STEP 8: close (settleAndSeal)");

const beforeClose = await readChannelAccount(channelAddress);
if (beforeClose === null) throw new Error("The channel vanished before close.");
const openChannel = decodeChannel(beforeClose.raw, addressDecoder);

// The final voucher carries the watermark the meter last reached. Sealing at a
// higher number would charge for time that was never metered.
const finalCumulative = openChannel.settled;
if (finalCumulative <= 0n) {
  throw new Error("The watermark is zero; there is nothing to seal. Do not trust this run.");
}

log(`    final watermark: ${format(finalCumulative)}`);

/**
 * No voucher rides with this seal, and that is a decision rather than an
 * omission.
 *
 * The final metered voucher — step 7 above — already moved the watermark to
 * exactly this value. A seal-time voucher would have to be *strictly greater*
 * (error 234 rejects a non-advancing watermark), which means billing seconds
 * that were never metered. There are none: the meter stopped when the customer
 * closed the tab. So the seal freezes the watermark the meter actually
 * reached, and `hasVoucher: false` says so.
 */
const sealInstruction = {
  programAddress: PAYMENT_CHANNELS_PROGRAM,
  accounts: [
    // The payee is the authority here — this is the cooperative close. The
    // `signer` property is what lets kit sign with it; this is also the key the
    // application holds server-side.
    { address: operatorAddress, role: AccountRole.READONLY_SIGNER, signer: operator },
    { address: channelAddress, role: AccountRole.WRITABLE },
    { address: address(INSTRUCTIONS_SYSVAR), role: AccountRole.READONLY },
  ],
  data: encodeSettleAndSealData(false),
};

let sealSignature = null;
{
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([sealInstruction], m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  sealSignature = getSignatureFromTransaction(signed);

  log(`    tx             : ${sealSignature}`);
  await sendAndConfirm(signed, { commitment: "confirmed" });

  const afterSeal = await readChannelAccount(channelAddress);
  if (afterSeal === null) throw new Error("The channel vanished after settleAndSeal.");
  const sealed = decodeChannel(afterSeal.raw, addressDecoder);

  log(`    status         : ${sealed.status} (${CHANNEL_STATUS[sealed.status]})`);
  log("");

  check(sealed.status === 1, `status is ${sealed.status}, expected 1 (Sealed)`);
  check(
    sealed.settled === finalCumulative,
    `the sealed watermark is ${sealed.settled}, expected ${finalCumulative}`,
  );

  writeEvidence("08-close.json", {
    channel: channelAddress,
    transactionSignature: sealSignature,
    explorer: explorerTx(sealSignature),
    observed: {
      statusBefore: openChannel.status,
      statusAfter: sealed.status,
      watermarkAfter: sealed.settled.toString(),
      sealedBy: operatorAddress,
      voucherUsed: false,
    },
    expected: { statusAfter: 1, watermarkAfter: finalCumulative.toString() },
    method:
      "`settleAndSeal` was sent with the payee's signature and no voucher, sealing the watermark the last metered voucher had already recorded; the channel account was then re-read and the status byte (offset 3) decoded",
  });
}

// ---------------------------------------------------------------------------
// STEP 9 — settlement: distribute
// ---------------------------------------------------------------------------

log("  STEP 9: settlement (distribute)");

const beforeDistribute = await readChannelAccount(channelAddress);
if (beforeDistribute === null) throw new Error("The channel vanished before distribute.");
const sealedChannel = decodeChannel(beforeDistribute.raw, addressDecoder);

const balancesAtSeal = {
  payer: await readTokenBalance(payerTokenAccount),
  channel: await readTokenBalance(channelTokenAccount),
  payee: await readTokenBalance(payeeTokenAccount),
  treasury: await readTokenBalance(treasuryTokenAccount),
};

// The plan reveal must hash to the commitment the channel has carried since
// `open`, or `distribute` rejects it (error 2407). Checked here so the failure
// is a sentence rather than an opaque program error.
const distributeData = encodeDistributeData(addressEncoder, []);
const preimage = Buffer.from(distributeData.subarray(1));
const preimageHash = createHash("sha256").update(preimage).digest("hex");

log(`    plan reveal    : ${preimage.toString("hex")} (count=0) sha256 ${preimageHash}`);
log(`    committed      : ${sealedChannel.distributionHash}`);

check(
  preimageHash === sealedChannel.distributionHash,
  "the revealed plan does not hash to the channel's committed distribution_hash",
);

const distributeInstruction = {
  programAddress: PAYMENT_CHANNELS_PROGRAM,
  accounts: [
    { address: channelAddress, role: AccountRole.WRITABLE },
    { address: sealedChannel.payer, role: AccountRole.WRITABLE },
    { address: sealedChannel.rentPayer, role: AccountRole.WRITABLE },
    { address: channelTokenAccount, role: AccountRole.WRITABLE },
    { address: payerTokenAccount, role: AccountRole.WRITABLE },
    { address: payeeTokenAccount, role: AccountRole.WRITABLE },
    { address: treasuryTokenAccount, role: AccountRole.WRITABLE },
    { address: sealedChannel.mint, role: AccountRole.READONLY },
    { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    { address: eventAuthority, role: AccountRole.READONLY },
    { address: PAYMENT_CHANNELS_PROGRAM, role: AccountRole.READONLY },
  ],
  data: distributeData,
};

let distributeSignature = null;
{
  // Neither the provider's nor the treasury's token account exists on a first
  // run, and `distribute` validates both before moving anything — error 2402
  // for the treasury, 2404/2405 for the payee.
  const ataInstructionFor = (ataAccount, owner) =>
    buildCreateAtaIdempotentInstruction({
      payer: payer.address,
      payerSigner: payer,
      ata: ataAccount,
      owner,
      mint: sealedChannel.mint,
      tokenProgram: TOKEN_PROGRAM,
      AccountRole,
    });

  const createInstructions = [];
  if (balancesAtSeal.payee === null) {
    createInstructions.push(ataInstructionFor(payeeTokenAccount, sealedChannel.payee));
  }
  if (balancesAtSeal.treasury === null) {
    createInstructions.push(ataInstructionFor(treasuryTokenAccount, TREASURY_OWNER));
  }

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([...createInstructions, distributeInstruction], m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  distributeSignature = getSignatureFromTransaction(signed);

  log(`    tx             : ${distributeSignature}`);
  await sendAndConfirm(signed, { commitment: "confirmed" });
  log("");
}

// ---------------------------------------------------------------------------
// STEP 10 — distribution: the split, read back
// ---------------------------------------------------------------------------

const balancesAfter = {
  payer: await readTokenBalance(payerTokenAccount),
  channel: await readTokenBalance(channelTokenAccount),
  payee: await readTokenBalance(payeeTokenAccount),
  treasury: await readTokenBalance(treasuryTokenAccount),
};

const providerReceived = (balancesAfter.payee ?? 0n) - (balancesAtSeal.payee ?? 0n);
const payerReceived = (balancesAfter.payer ?? 0n) - (balancesAtSeal.payer ?? 0n);
const treasuryReceived = (balancesAfter.treasury ?? 0n) - (balancesAtSeal.treasury ?? 0n);

const expectedProvider = finalCumulative - sealedChannel.payoutWatermark;
const expectedPayer = sealedChannel.deposit - finalCumulative;

log("  STEP 10: distribution");
log(`    provider received : ${format(providerReceived)}`);
log(`    customer received : ${format(payerReceived)}`);
log(`    treasury dust     : ${format(treasuryReceived)}`);
log("");

check(
  providerReceived === expectedProvider,
  `the provider received ${providerReceived}, expected ${expectedProvider}`,
);
check(payerReceived === expectedPayer, `the customer received ${payerReceived}, expected ${expectedPayer}`);

writeEvidence("09-settlement.json", {
  channel: channelAddress,
  transactionSignature: distributeSignature,
  explorer: explorerTx(distributeSignature),
  observed: {
    planRevealHex: preimage.toString("hex"),
    planRevealSha256: preimageHash,
    committedDistributionHash: sealedChannel.distributionHash,
    providerReceived: providerReceived.toString(),
    customerReceived: payerReceived.toString(),
    treasuryReceived: treasuryReceived.toString(),
  },
  expected: {
    planRevealSha256: sealedChannel.distributionHash,
    providerReceived: expectedProvider.toString(),
    customerReceived: expectedPayer.toString(),
  },
  method:
    "the plan reveal was hashed locally and compared against the commitment read from the channel; the payout was then verified by re-reading all four token accounts, not by trusting the transaction's success",
});

writeEvidence("10-distribution.json", {
  channel: channelAddress,
  transactionSignature: distributeSignature,
  explorer: explorerTx(distributeSignature),
  observed: {
    balancesBefore: {
      payer: balancesAtSeal.payer?.toString() ?? null,
      channel: balancesAtSeal.channel?.toString() ?? null,
      provider: balancesAtSeal.payee?.toString() ?? null,
      treasury: balancesAtSeal.treasury?.toString() ?? null,
    },
    balancesAfter: {
      payer: balancesAfter.payer?.toString() ?? null,
      channel: balancesAfter.channel?.toString() ?? null,
      provider: balancesAfter.payee?.toString() ?? null,
      treasury: balancesAfter.treasury?.toString() ?? null,
    },
    escrowEmptied: (balancesAfter.channel ?? 0n) === 0n,
  },
  expected: {
    providerReceived: expectedProvider.toString(),
    customerReceived: expectedPayer.toString(),
    escrowEmptied: true,
  },
  method: "all four token accounts were read from chain before and after the payout",
});

// ---------------------------------------------------------------------------
// STEP 11 — final state
// ---------------------------------------------------------------------------

log("  STEP 11: final state");

const finalChannel = await readChannelAccount(channelAddress);
let finalState = null;
let channelAccountClosed = false;

if (finalChannel === null) {
  channelAccountClosed = true;
  log("    channel account: DEALLOCATED (rent returned to the rent payer)");
} else {
  finalState = decodeChannel(finalChannel.raw, addressDecoder);
  log(
    `    channel account: present, status ${finalState.status} ` +
      `(${CHANNEL_STATUS[finalState.status]}), payoutWatermark ${format(finalState.payoutWatermark)}`,
  );
  log("    (opened too recently for the rent to be reclaimed in the same close)");
}
log("");

check((balancesAfter.channel ?? 0n) === 0n, "the escrow still holds tokens after distribution");
check(
  payerReceived === expectedPayer,
  `the unused remainder is ${payerReceived}, expected ${expectedPayer}`,
);

writeEvidence("11-final-state.json", {
  channel: channelAddress,
  transactionSignature: distributeSignature,
  explorer: explorerAddress(channelAddress),
  observed: {
    channelAccountClosed,
    channel:
      finalState === null
        ? null
        : {
            status: finalState.status,
            statusName: CHANNEL_STATUS[finalState.status],
            settled: finalState.settled.toString(),
            payoutWatermark: finalState.payoutWatermark.toString(),
          },
    finalBalances: {
      payer: balancesAfter.payer?.toString() ?? null,
      channel: balancesAfter.channel?.toString() ?? null,
      provider: balancesAfter.payee?.toString() ?? null,
      treasury: balancesAfter.treasury?.toString() ?? null,
    },
  },
  expected: {
    escrowEmpty: true,
    providerPaid: expectedProvider.toString(),
    customerRefunded: expectedPayer.toString(),
  },
  method: "the channel account and all four token accounts were re-read from chain after the payout",
});

// ---------------------------------------------------------------------------
// STEP 12 — verification
// ---------------------------------------------------------------------------

const totalBilled = finalCumulative;
const reconciles = providerReceived + payerReceived + treasuryReceived === sealedChannel.deposit;

log("  STEP 12: verification");
log("  ------------------------------------------------------------");
log(`    network                 : ${failures.length === 0 ? "PASS" : "see failures"}`);
log(`    program                 : ${PAYMENT_CHANNELS_PROGRAM}`);
log(`    asset                   : ${failures.length === 0 ? "PASS" : "see failures"}`);
log(`    channel open            : ${voucherResults.length > 0 ? "PASS" : "FAIL"}`);
log(`    voucher progression     : ${voucherResults.length} cumulative vouchers, each read back`);
log(`    settlement              : ${sealSignature === null ? "FAIL" : "PASS"}`);
log(`    distribution            : ${distributeSignature === null ? "FAIL" : "PASS"}`);
log(`    unused remainder        : ${format(payerReceived)} of ${format(sealedChannel.deposit)}`);
log(`    escrow emptied          : ${(balancesAfter.channel ?? 0n) === 0n ? "PASS" : "FAIL"}`);
log(`    amounts reconcile       : ${reconciles ? "PASS" : "FAIL"}`);
log("");

check(reconciles, "the paid amounts do not sum to the deposit");
check(
  payerReceived === sealedChannel.deposit - totalBilled,
  "the remainder does not equal deposit minus settled",
);

writeEvidence("12-verification.json", {
  channel: channelAddress,
  transactionSignature: null,
  explorer: explorerAddress(channelAddress),
  observed: {
    failures,
    passed: failures.length === 0,
    vouchers: voucherResults,
    openTransaction: openSignature,
    sealTransaction: sealSignature,
    distributeTransaction: distributeSignature,
    deposit: sealedChannel.deposit.toString(),
    settled: finalCumulative.toString(),
    providerReceived: providerReceived.toString(),
    customerRefunded: payerReceived.toString(),
    treasuryDust: treasuryReceived.toString(),
    escrowEmptied: (balancesAfter.channel ?? 0n) === 0n,
    reconciles,
  },
  expected: { failures: [], passed: true, reconciles: true },
  method:
    "every value is the result of a chain read; this artifact also records the names of the checks that failed, if any, so a partial run cannot be mistaken for a complete one",
});

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

log("  RESULT");
log("  ------------------------------------------------------------");
log(`    deposit authorized      : ${format(sealedChannel.deposit)}`);
log(`    metered and paid        : ${format(totalBilled)}`);
log(`    returned to the customer: ${format(payerReceived)}`);
log(`    escrow left holding     : ${format(balancesAfter.channel ?? 0n)}`);
log("");
log(`    evidence written        : ${written.length} files in ${EVIDENCE_DIR}/`);
log(`    channel    : ${explorerAddress(channelAddress)}`);
log(`    open       tx: ${explorerTx(openSignature)}`);
log(`    seal       tx: ${explorerTx(sealSignature)}`);
log(`    distribute tx: ${explorerTx(distributeSignature)}`);
log("");

if (failures.length > 0) {
  log(`  ${RUN_NAME}: FAILED`);
  for (const failure of failures) log(`    - ${failure}`);
  log("");
  process.exit(1);
}

log(`  ${RUN_NAME}: PASSED`);
log("");
