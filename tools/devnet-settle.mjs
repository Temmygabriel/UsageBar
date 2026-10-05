#!/usr/bin/env node
/**
 * THE SECOND GATE: advance a channel's settled watermark with a real
 * cumulative voucher.
 *
 * Opening a channel only proves we can move money in. This proves we can move
 * the *watermark* — which is the actual product. A usage tab is: authorize
 * once, meter usage off-chain by signing cumulative vouchers, settle on chain.
 * If a voucher the operator signs is not accepted by the program, there is no
 * product, no matter how good the interface looks.
 *
 * The voucher is NOT passed to `settle`. `settle`'s entire instruction data is
 * its discriminator byte, and its only two accounts are the channel and the
 * Instructions sysvar. The program finds the voucher by loading instruction
 * `current - 1` from that sysvar and parsing it as an Ed25519 precompile
 * payload — whose signed message *is* the 50-byte voucher. So the signature is
 * checked by the native precompile, and the program only reads the bytes it
 * already knows were verified.
 *
 * That means the two instructions must be adjacent and in this order:
 *
 *     [0] Ed25519SigVerify...   sign the voucher
 *     [1] settle                read it back out of the sysvar
 *
 * Getting this wrong produces error 230 (`missingEd25519Verification`). This
 * requirement appears nowhere in the build spec.
 *
 * All byte layouts come from the program's own source (see tools/lib/protocol.mjs).
 * Nothing here is simulated: if this prints OK, the chain said so.
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

import {
  CHANNEL_LEN,
  CHANNEL_STATUS,
  DISCRIMINATOR,
  ED25519_PRECOMPILE,
  INSTRUCTIONS_SYSVAR,
  PAYMENT_CHANNELS_PROGRAM,
  buildEd25519PrecompileData,
  buildVoucherPayload,
  decodeChannel,
  decodeSecretKey,
  signVoucher,
} from "./lib/protocol.mjs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RPC_URL = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = process.env.DEVNET_WS_URL ?? "wss://api.devnet.solana.com";

/** The channel opened by `open-channel`, salt 1. */
const CHANNEL = address(
  process.env.CHANNEL ?? "7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo",
);
const SALT = BigInt(process.env.SALT ?? "1");

/**
 * The cumulative ceiling to settle to, in atomic units. A comma-separated list
 * settles successively, each superseding the last — which is how the product
 * actually behaves, and is more convincing than one jump.
 *
 * 12.4 then 18.9 TEST against a 50 TEST deposit: enough headroom to leave a
 * remainder worth recovering later.
 */
const CUMULATIVE_STEPS = (process.env.CUMULATIVE ?? "12400000,18900000")
  .split(",")
  .map((part) => part.trim())
  .filter((part) => part !== "")
  .map((part) => {
    try {
      return BigInt(part);
    } catch {
      throw new Error(`CUMULATIVE contains ${JSON.stringify(part)}, which is not an integer.`);
    }
  });

/** 0 means the voucher never expires. */
const EXPIRES_AT = BigInt(process.env.EXPIRES_AT ?? "0");

if (CUMULATIVE_STEPS.length === 0) {
  throw new Error("CUMULATIVE must contain at least one amount.");
}

const DECIMALS = 6;
const format = (atomic) => `${Number(atomic) / 10 ** DECIMALS} TEST`;

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);

const payerSecretKey = decodeSecretKey("DEVNET_PAYER_KEYPAIR");
const payer = await createSignerFromKeyPair(await createKeyPairFromBytes(payerSecretKey));

const operatorSecretKey = decodeSecretKey("DEVNET_OPERATOR_KEYPAIR");
const operatorSeed = operatorSecretKey.subarray(0, 32);

console.log("");
console.log(`  cluster   : ${RPC_URL}`);
console.log(`  channel   : ${CHANNEL}`);
console.log(`  payer     : ${payer.address}  (fee payer; not a voucher signer)`);
console.log("");

// ---------------------------------------------------------------------------
// Read the channel. Everything below is derived from chain state, not config.
// ---------------------------------------------------------------------------

const accountInfo = await rpc.getAccountInfo(CHANNEL, { encoding: "base64" }).send();
if (accountInfo.value === null) {
  throw new Error(
    `No channel at ${CHANNEL}. Run the Devnet workflow with script=open-channel first.`,
  );
}
if (accountInfo.value.owner !== PAYMENT_CHANNELS_PROGRAM) {
  throw new Error(`Account is owned by ${accountInfo.value.owner}, not the payment channels program.`);
}

const channel = decodeChannel(Buffer.from(accountInfo.value.data[0], "base64"), addressDecoder);

console.log("  CHANNEL STATE (from chain)");
console.log(`    status        : ${channel.status} (${CHANNEL_STATUS[channel.status] ?? "unknown"})`);
console.log(`    deposit       : ${format(channel.deposit)}`);
console.log(`    settled       : ${format(channel.settled)}`);
console.log(`    payee         : ${channel.payee}`);
console.log(`    auth signer   : ${channel.authorizedSigner}`);
console.log(`    openSlot      : ${channel.openSlot}`);
console.log("");

// Re-derive the address from the decoded fields. If the program and we
// disagree about the seeds, every voucher would be rejected as
// VoucherChannelMismatch (232), which is a confusing way to find out.
const [derivedChannel] = await getProgramDerivedAddress({
  programAddress: PAYMENT_CHANNELS_PROGRAM,
  seeds: [
    "channel",
    addressEncoder.encode(channel.payer),
    addressEncoder.encode(channel.payee),
    addressEncoder.encode(channel.mint),
    addressEncoder.encode(channel.authorizedSigner),
    new Uint8Array(new BigUint64Array([channel.salt]).buffer),
    new Uint8Array(new BigUint64Array([channel.openSlot]).buffer),
  ],
});

if (derivedChannel !== CHANNEL) {
  throw new Error(
    `Re-derived ${derivedChannel} from the channel's own fields, but it lives at ${CHANNEL}. ` +
      "The PDA seeds in tools/lib/protocol.mjs are wrong.",
  );
}

// `salt` is recovered from chain state, so confirm it matches what was asked
// for — otherwise we are settling a different channel than intended.
if (channel.salt !== SALT) {
  throw new Error(`Channel salt is ${channel.salt}, but SALT=${SALT} was configured.`);
}

if (channel.status !== 0) {
  throw new Error(
    `Channel status is ${channel.status} (${CHANNEL_STATUS[channel.status]}), but settle only ` +
      "advances a channel in status 0 (Open).",
  );
}

// ---------------------------------------------------------------------------
// Pre-flight. The program's own guards are mirrored here, each with the error
// code it would otherwise fail with, so a mistake costs milliseconds instead
// of a CI round trip and an opaque `custom program error: 0x..`.
// ---------------------------------------------------------------------------

const nowUnix = BigInt(Math.floor(Date.now() / 1000));

function checkVoucherGuards(cumulative, settled) {
  const problems = [];

  if (cumulative > channel.deposit) {
    problems.push(
      `${format(cumulative)} exceeds the ${format(channel.deposit)} deposit ` +
        "-> error 235 (voucherOverDeposit)",
    );
  }
  if (settled >= cumulative) {
    problems.push(
      `${format(cumulative)} does not strictly advance the ${format(settled)} watermark ` +
        "-> error 234 (voucherWatermarkNotMonotonic). Cumulative amounts must increase each time.",
    );
  }
  if (EXPIRES_AT !== 0n && nowUnix >= EXPIRES_AT) {
    problems.push(
      `expires_at is ${EXPIRES_AT} and the chain clock is already ${nowUnix} ` +
        "-> error 233 (voucherExpired)",
    );
  }
  return problems;
}

let expectedSettled = channel.settled;
for (const step of CUMULATIVE_STEPS) {
  const problems = checkVoucherGuards(step, expectedSettled);
  if (problems.length > 0) {
    console.log(`  VOUCHER PLAN REJECTED for ${format(step)}:`);
    for (const problem of problems) console.log(`    - ${problem}`);
    console.log("");
    process.exit(1);
  }
  expectedSettled = step;
}

console.log(`  PLAN: settle ${format(channel.settled)} -> ${CUMULATIVE_STEPS.map(format).join(" -> ")}`);
console.log("");

// ---------------------------------------------------------------------------
// Settle, one transaction per step.
// ---------------------------------------------------------------------------

const results = [];

for (const cumulative of CUMULATIVE_STEPS) {
  const voucherPayload = buildVoucherPayload(addressEncoder, CHANNEL, cumulative, EXPIRES_AT);
  const { signature: voucherSignature, publicKey } = await signVoucher(operatorSeed, voucherPayload);

  // The program compares the precompile's pubkey against the channel's
  // authorized_signer, so a wrong key here would surface as error 237.
  if (addressDecoder.decode(publicKey) !== channel.authorizedSigner) {
    throw new Error(
      `The operator key derives to ${addressDecoder.decode(publicKey)}, but the channel's ` +
        `authorized_signer is ${channel.authorizedSigner} -> error 237 (voucherSignerMismatch).`,
    );
  }

  console.log(`  --- settling to ${format(cumulative)} ---`);
  console.log(`    voucher   : ${Buffer.from(voucherPayload).toString("hex")}`);
  console.log(`    signed by : ${addressDecoder.decode(publicKey)}`);
  console.log(`    signature : ${Buffer.from(voucherSignature).toString("hex")}`);

  const precompileInstruction = {
    programAddress: address(ED25519_PRECOMPILE),
    // The native precompile takes no accounts.
    accounts: [],
    data: buildEd25519PrecompileData(publicKey, voucherSignature, voucherPayload),
  };

  const settleInstruction = {
    programAddress: address(PAYMENT_CHANNELS_PROGRAM),
    accounts: [
      { address: CHANNEL, role: AccountRole.WRITABLE },
      { address: address(INSTRUCTIONS_SYSVAR), role: AccountRole.READONLY },
    ],
    // Only the discriminator: the voucher arrives via the precompile above.
    data: new Uint8Array([DISCRIMINATOR.settle]),
  };

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // ORDER IS LOAD-BEARING. The program loads instruction `current - 1` and
  // requires it to be the precompile. Any instruction between these two — even
  // a harmless one — breaks settlement with error 230.
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([precompileInstruction, settleInstruction], m),
  );

  const signedTransaction = await signTransactionMessageWithSigners(message);
  const transactionSignature = getSignatureFromTransaction(signedTransaction);

  console.log(`    tx        : ${transactionSignature}`);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signedTransaction, {
    commitment: "confirmed",
  });

  // -------------------------------------------------------------------------
  // Read the watermark back. A confirmed transaction is not evidence that the
  // number moved; only the account is.
  // -------------------------------------------------------------------------

  const readback = await rpc.getAccountInfo(CHANNEL, { encoding: "base64" }).send();
  if (readback.value === null) {
    throw new Error("The channel vanished after settlement. Do not trust this run.");
  }

  const after = decodeChannel(Buffer.from(readback.value.data[0], "base64"), addressDecoder);

  if (after.bytesConsumed !== CHANNEL_LEN) {
    throw new Error(`Decoded ${after.bytesConsumed} bytes, expected ${CHANNEL_LEN}.`);
  }
  if (after.settled !== cumulative) {
    throw new Error(
      `Transaction confirmed but the watermark is ${after.settled}, not ${cumulative}. ` +
        "Do not trust this run.",
    );
  }

  console.log(`    settled   : ${format(after.settled)}   CONFIRMED FROM CHAIN`);
  console.log("");

  results.push({ cumulative, transactionSignature, status: after.status });
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

console.log("  RESULT");
console.log("  ------");
for (const result of results) {
  console.log(`    ${format(result.cumulative).padEnd(14)} settled   tx ${result.transactionSignature}`);
}
console.log("");
console.log(
  `  The watermark advanced monotonically through ${results.length} cumulative vouchers, ` +
    "each signed off-chain by the operator and accepted by the program.",
);
console.log(
  `  Remaining escrow: ${format(channel.deposit - results[results.length - 1].cumulative)} of ` +
    `${format(channel.deposit)}.`,
);
console.log(`  explorer: https://explorer.solana.com/address/${CHANNEL}?cluster=devnet`);
console.log("");
