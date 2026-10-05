#!/usr/bin/env node
/**
 * THE THIRD GATE: close the tab and pay everyone out.
 *
 * This is the step that delivers the product's promise. Two things have to
 * happen, and they are separate instructions:
 *
 *   1. `settleAndSeal` — commit the final voucher and lock the watermark.
 *      Different from `settle` in two ways that matter: it needs the PAYEE's
 *      signature (it is a cooperative close, not a permissionless crank), and
 *      its discriminator is 4, not 2. Like `settle`, it finds the voucher in
 *      the Ed25519 precompile at `current - 1` when its option tag is 1.
 *
 *   2. `distribute` — move the money. The payee gets the settled amount, the
 *      payer gets the unused remainder back, and any rounding dust goes to the
 *      treasury. On a channel older than OPEN_SLOT_WINDOW the channel account
 *      is deallocated entirely and its rent returns to the rent payer.
 *
 * It also settles a question that has been open since the audit: what the
 * devnet treasury owner actually is. See TREASURY_OWNER_SENTINEL_HEX in
 * tools/lib/protocol.mjs. The short version is that the live program very
 * likely carries a placeholder, and the dust that lands there is unspendable.
 *
 * Nothing here is simulated. Balances are read from chain before and after.
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

import {
  CHANNEL_STATUS,
  DISCRIMINATOR,
  ED25519_PRECOMPILE,
  INSTRUCTIONS_SYSVAR,
  PAYMENT_CHANNELS_PROGRAM,
  TREASURY_OWNER_SENTINEL_HEX,
  base58Encode,
  buildEd25519PrecompileData,
  buildVoucherPayload,
  decodeChannel,
  decodeSecretKey,
  encodeDistributeData,
  encodeSettleAndSealData,
  envOr,
  signVoucher,
} from "./lib/protocol.mjs";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RPC_URL = envOr("DEVNET_RPC_URL", "https://api.devnet.solana.com");
const WS_URL = envOr("DEVNET_WS_URL", "wss://api.devnet.solana.com");

const CHANNEL = address(
  envOr("CHANNEL", "7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo"),
);

/**
 * The final cumulative amount, in atomic units. Must strictly exceed the
 * channel's current watermark — a voucher that does not advance it is rejected
 * with error 234.
 */
const FINAL_CUMULATIVE = BigInt(envOr("FINAL_CUMULATIVE", "21500000"));

/** 0 means the voucher never expires. */
const EXPIRES_AT = BigInt(envOr("EXPIRES_AT", "0"));

/**
 * The treasury owner. Blank (the workflow's default) means the 0xBEEF
 * placeholder the deployed program almost certainly carries; override with
 * TREASURY_OWNER once the program ships a real one.
 */
const TREASURY_OWNER_INPUT = envOr("TREASURY_OWNER", "");
const USING_PLACEHOLDER_TREASURY = TREASURY_OWNER_INPUT === "";

const DECIMALS = 6;
const format = (atomic) => `${Number(atomic) / 10 ** DECIMALS} TEST`;

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

// ---------------------------------------------------------------------------
// SPL token balance, read straight from the account so a missing account is a
// null rather than a thrown RPC error. The `amount` field is a u64 at byte
// offset 64 of a classic SPL token account.
// ---------------------------------------------------------------------------

async function readTokenBalance(rpc, tokenAccount) {
  const info = await rpc.getAccountInfo(tokenAccount, { encoding: "base64" }).send();
  if (info.value === null) return null;
  const data = Buffer.from(info.value.data[0], "base64");
  return data.readBigUInt64LE(64);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);

const payerSecretKey = decodeSecretKey("DEVNET_PAYER_KEYPAIR");
const payer = await createSignerFromKeyPair(await createKeyPairFromBytes(payerSecretKey));

const payeeSecretKey = decodeSecretKey("DEVNET_PAYEE_KEYPAIR");
const payee = await createSignerFromKeyPair(await createKeyPairFromBytes(payeeSecretKey));

const operatorSecretKey = decodeSecretKey("DEVNET_OPERATOR_KEYPAIR");
const operatorSeed = operatorSecretKey.subarray(0, 32);

const TOKEN_PROGRAM = TOKEN_PROGRAM_ADDRESS;

console.log("");
console.log(`  cluster  : ${RPC_URL}`);
console.log(`  channel  : ${CHANNEL}`);
console.log("");

// ---------------------------------------------------------------------------
// Read the channel
// ---------------------------------------------------------------------------

const accountInfo = await rpc.getAccountInfo(CHANNEL, { encoding: "base64" }).send();
if (accountInfo.value === null) {
  throw new Error(`No channel at ${CHANNEL}. It may already have been distributed.`);
}

const channel = decodeChannel(Buffer.from(accountInfo.value.data[0], "base64"), addressDecoder);

console.log("  CHANNEL STATE (from chain)");
console.log(`    status    : ${channel.status} (${CHANNEL_STATUS[channel.status] ?? "unknown"})`);
console.log(`    deposit   : ${format(channel.deposit)}`);
console.log(`    settled   : ${format(channel.settled)}`);
console.log(`    openSlot  : ${channel.openSlot}`);
console.log("");

if (channel.status !== 0) {
  throw new Error(
    `Channel status is ${channel.status} (${CHANNEL_STATUS[channel.status]}); expected 0 (Open). ` +
      "A previous run may have already sealed it.",
  );
}
if (payee.address !== channel.payee) {
  throw new Error(
    `DEVNET_PAYEE_KEYPAIR derives to ${payee.address}, but the channel's payee is ` +
      `${channel.payee}. settleAndSeal requires the payee to sign.`,
  );
}

const [payerTokenAccount] = await findAssociatedTokenPda({
  owner: channel.payer,
  tokenProgram: TOKEN_PROGRAM,
  mint: channel.mint,
});
const [channelTokenAccount] = await findAssociatedTokenPda({
  owner: CHANNEL,
  tokenProgram: TOKEN_PROGRAM,
  mint: channel.mint,
});
const [payeeTokenAccount] = await findAssociatedTokenPda({
  owner: channel.payee,
  tokenProgram: TOKEN_PROGRAM,
  mint: channel.mint,
});

/**
 * The treasury owner. Defaults to the 0xBEEF placeholder when the input is
 * blank.
 */
const TREASURY_OWNER = address(
  USING_PLACEHOLDER_TREASURY
    ? base58Encode(Buffer.from(TREASURY_OWNER_SENTINEL_HEX, "hex"))
    : TREASURY_OWNER_INPUT,
);
const [treasuryTokenAccount] = await findAssociatedTokenPda({
  owner: TREASURY_OWNER,
  tokenProgram: TOKEN_PROGRAM,
  mint: channel.mint,
});

const [eventAuthority] = await getProgramDerivedAddress({
  programAddress: PAYMENT_CHANNELS_PROGRAM,
  seeds: ["event_authority"],
});

// ---------------------------------------------------------------------------
// Balances before — the only baseline that makes the "after" numbers mean
// anything.
// ---------------------------------------------------------------------------

const before = {
  payer: await readTokenBalance(rpc, payerTokenAccount),
  channel: await readTokenBalance(rpc, channelTokenAccount),
  payee: await readTokenBalance(rpc, payeeTokenAccount),
  treasury: await readTokenBalance(rpc, treasuryTokenAccount),
};

console.log("  BALANCES BEFORE");
console.log(`    payer    : ${before.payer === null ? "(none)" : format(before.payer)}`);
console.log(`    channel  : ${before.channel === null ? "(none)" : format(before.channel)}`);
console.log(`    payee    : ${before.payee === null ? "(none)" : format(before.payee)}`);
console.log(`    treasury : ${before.treasury === null ? "(no account)" : format(before.treasury)}`);
console.log("");

// ===========================================================================
// STEP 1 — settleAndSeal
// ===========================================================================

if (FINAL_CUMULATIVE <= channel.settled) {
  throw new Error(
    `FINAL_CUMULATIVE is ${FINAL_CUMULATIVE} but the watermark is already ${channel.settled}. ` +
      "A voucher must strictly advance it -> error 234 (voucherWatermarkNotMonotonic).",
  );
}
if (FINAL_CUMULATIVE > channel.deposit) {
  throw new Error(
    `FINAL_CUMULATIVE is ${FINAL_CUMULATIVE}, over the ${channel.deposit} deposit ` +
      "-> error 235 (voucherOverDeposit).",
  );
}
if (EXPIRES_AT !== 0n && BigInt(Math.floor(Date.now() / 1000)) >= EXPIRES_AT) {
  throw new Error(`expires_at ${EXPIRES_AT} is not in the future -> error 233 (voucherExpired).`);
}

console.log(`  STEP 1: settleAndSeal at ${format(FINAL_CUMULATIVE)} (payee-signed)`);

const voucherPayload = buildVoucherPayload(addressEncoder, CHANNEL, FINAL_CUMULATIVE, EXPIRES_AT);
const { signature: voucherSignature, publicKey } = await signVoucher(operatorSeed, voucherPayload);

if (addressDecoder.decode(publicKey) !== channel.authorizedSigner) {
  throw new Error(
    `Operator key derives to ${addressDecoder.decode(publicKey)}, but the channel's ` +
      `authorized_signer is ${channel.authorizedSigner} -> error 237 (voucherSignerMismatch).`,
  );
}

console.log(`    voucher   : ${Buffer.from(voucherPayload).toString("hex")}`);

const precompileInstruction = {
  programAddress: address(ED25519_PRECOMPILE),
  accounts: [],
  data: buildEd25519PrecompileData(publicKey, voucherSignature, voucherPayload),
};

const settleAndSealInstruction = {
  programAddress: address(PAYMENT_CHANNELS_PROGRAM),
  accounts: [
    // The payee is the authority here — this is the cooperative close. The
    // `signer` property is what lets the kit sign with it; passing a bare
    // signer object as `address` is what produced the earlier
    // "[object Object]" base58 error.
    { address: payee.address, role: AccountRole.READONLY_SIGNER, signer: payee },
    { address: CHANNEL, role: AccountRole.WRITABLE },
    { address: address(INSTRUCTIONS_SYSVAR), role: AccountRole.READONLY },
  ],
  data: encodeSettleAndSealData(true),
};

{
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    // Precompile first: the program reads instruction `current - 1`.
    (m) => appendTransactionMessageInstructions([precompileInstruction, settleAndSealInstruction], m),
  );
  const signedTransaction = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signedTransaction);

  console.log(`    tx        : ${signature}`);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signedTransaction, {
    commitment: "confirmed",
  });

  const readback = await rpc.getAccountInfo(CHANNEL, { encoding: "base64" }).send();
  if (readback.value === null) throw new Error("The channel vanished after settleAndSeal.");

  const sealed = decodeChannel(Buffer.from(readback.value.data[0], "base64"), addressDecoder);
  if (sealed.status !== 1) {
    throw new Error(
      `Expected status 1 (Sealed) after settleAndSeal, got ${sealed.status} ` +
        `(${CHANNEL_STATUS[sealed.status]}).`,
    );
  }
  if (sealed.settled !== FINAL_CUMULATIVE) {
    throw new Error(`Expected watermark ${FINAL_CUMULATIVE}, chain says ${sealed.settled}.`);
  }

  console.log(`    status    : SEALED, watermark ${format(sealed.settled)}   CONFIRMED FROM CHAIN`);
  console.log("");
}

// ===========================================================================
// STEP 2 — distribute
// ===========================================================================

console.log("  STEP 2: distribute");

/**
 * This channel was opened with no recipients, so the plan reveal is the
 * 4-byte count prefix alone. Its SHA-256 is checked against the commitment the
 * channel has carried since `open` — if these disagree, `distribute` would
 * fail with a hash mismatch, and we would rather know here.
 */
const distributeData = encodeDistributeData(addressEncoder, []);
const preimageHash = createHash("sha256").update(Buffer.from(distributeData.subarray(1))).digest("hex");

console.log(`    preimage  : ${Buffer.from(distributeData.subarray(1)).toString("hex")} (count=0, no recipients)`);
console.log(`    sha256    : ${preimageHash}`);
console.log(`    committed : ${channel.distributionHash}`);

if (preimageHash !== channel.distributionHash) {
  throw new Error(
    "The revealed plan does not hash to the channel's committed distribution_hash. " +
      "distribute would reject this on chain.",
  );
}
console.log("    match     : yes");
console.log("");

console.log(`    treasury owner     : ${TREASURY_OWNER}`);
console.log(`    treasury token acct: ${treasuryTokenAccount}`);
if (USING_PLACEHOLDER_TREASURY) {
  console.log("");
  console.log("    NOTE: this is the 0xBEEF placeholder from constants.rs, not a real");
  console.log("    owner. Any dust sent there is permanently unspendable. Whether the");
  console.log("    deployed program agrees is exactly what this step tests.");
}
console.log("");

const distributeInstruction = {
  programAddress: address(PAYMENT_CHANNELS_PROGRAM),
  // Account order is fixed by the IDL and must match exactly. `payer` and
  // `rentPayer` are writable but NOT signers: distribute is permissionless,
  // and receiving lamports needs no signature.
  accounts: [
    { address: CHANNEL, role: AccountRole.WRITABLE }, // channel
    { address: channel.payer, role: AccountRole.WRITABLE }, // payer
    { address: channel.rentPayer, role: AccountRole.WRITABLE }, // rentPayer
    { address: channelTokenAccount, role: AccountRole.WRITABLE }, // channelTokenAccount
    { address: payerTokenAccount, role: AccountRole.WRITABLE }, // payerTokenAccount
    { address: payeeTokenAccount, role: AccountRole.WRITABLE }, // payeeTokenAccount
    { address: treasuryTokenAccount, role: AccountRole.WRITABLE }, // treasuryTokenAccount
    { address: channel.mint, role: AccountRole.READONLY }, // mint
    { address: TOKEN_PROGRAM, role: AccountRole.READONLY }, // tokenProgram
    { address: eventAuthority, role: AccountRole.READONLY }, // eventAuthority
    { address: address(PAYMENT_CHANNELS_PROGRAM), role: AccountRole.READONLY }, // selfProgram
    // No recipient ATAs: the plan has no recipients.
  ],
  data: distributeData,
};

{
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([distributeInstruction], m),
  );
  const signedTransaction = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signedTransaction);

  console.log(`    tx        : ${signature}`);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signedTransaction, {
    commitment: "confirmed",
  });
  console.log("    confirmed");
  console.log("");
}

// ---------------------------------------------------------------------------
// Read it back. Everyone's balance, and the channel's fate.
// ---------------------------------------------------------------------------

const after = {
  payer: await readTokenBalance(rpc, payerTokenAccount),
  channel: await readTokenBalance(rpc, channelTokenAccount),
  payee: await readTokenBalance(rpc, payeeTokenAccount),
  treasury: await readTokenBalance(rpc, treasuryTokenAccount),
};

const channelAfter = await rpc.getAccountInfo(CHANNEL, { encoding: "base64" }).send();

console.log("  WHAT ACTUALLY MOVED");
console.log("  -------------------");

const show = (label, beforeValue, afterValue) => {
  const b = beforeValue === null ? "—" : format(beforeValue);
  const a = afterValue === null ? "—" : format(afterValue);
  let delta = "";
  if (beforeValue !== null || afterValue !== null) {
    const d = (afterValue ?? 0n) - (beforeValue ?? 0n);
    delta = d === 0n ? "  (unchanged)" : `  (${d > 0n ? "+" : ""}${format(d)})`;
  }
  console.log(`    ${label.padEnd(9)}: ${b.padStart(12)} -> ${a.padStart(12)}${delta}`);
};

show("payer", before.payer, after.payer);
show("channel", before.channel, after.channel);
show("payee", before.payee, after.payee);
show("treasury", before.treasury, after.treasury);
console.log("");

if (channelAfter.value === null) {
  console.log("    channel account: DEALLOCATED (the full close — rent returned to the rent payer)");
} else {
  const finalState = decodeChannel(Buffer.from(channelAfter.value.data[0], "base64"), addressDecoder);
  console.log(
    `    channel account: still present, status ${finalState.status} ` +
      `(${CHANNEL_STATUS[finalState.status]}), payoutWatermark ${format(finalState.payoutWatermark)}`,
  );
  console.log("    (it was opened recently enough that the rent has to be reclaimed separately)");
}
console.log("");

// ---------------------------------------------------------------------------
// Verdict — the product's promise, checked rather than asserted.
// ---------------------------------------------------------------------------

const payeeReceived = (after.payee ?? 0n) - (before.payee ?? 0n);
const payerReceived = (after.payer ?? 0n) - (before.payer ?? 0n);
const treasuryReceived = (after.treasury ?? 0n) - (before.treasury ?? 0n);
const escrowEmptied = (after.channel ?? 0n) === 0n;

console.log("  RESULT");
console.log("  ------");
console.log(`    the provider was paid        : ${format(payeeReceived)}`);
console.log(`    the customer got back        : ${format(payerReceived)}`);
console.log(`    rounding dust to treasury    : ${format(treasuryReceived)}`);
console.log(`    escrow drained to zero       : ${escrowEmptied ? "yes" : "NO"}`);
console.log("");

const problems = [];
if (payeeReceived !== FINAL_CUMULATIVE - channel.settled) {
  problems.push(
    `the payee received ${payeeReceived}, expected the settled delta ` +
      `${FINAL_CUMULATIVE - channel.settled}`,
  );
}
if (payerReceived !== channel.deposit - FINAL_CUMULATIVE) {
  problems.push(
    `the payer received back ${payerReceived}, expected the unused remainder ` +
      `${channel.deposit - FINAL_CUMULATIVE}`,
  );
}
if (!escrowEmptied) problems.push("the escrow still holds tokens after distribution");

if (problems.length > 0) {
  console.log("  THE SPLIT DOES NOT MATCH WHAT WAS PROMISED");
  for (const problem of problems) console.log(`    - ${problem}`);
  console.log("");
  process.exit(1);
}

console.log("  The tab is closed: the provider was paid for exactly what was metered,");
console.log("  and the customer got the unused remainder back.");
console.log(`  explorer: https://explorer.solana.com/address/${CHANNEL}?cluster=devnet`);
console.log("");
