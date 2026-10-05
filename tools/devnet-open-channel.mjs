#!/usr/bin/env node
/**
 * THE GATE: open one real payment channel on devnet and read it back.
 *
 * Everything else in UsageBar waits behind this. If a channel cannot be opened
 * and read back, no amount of UI matters.
 *
 * This script does not use the official TypeScript client, because that client
 * pins `@solana/kit ^6.1.0` while the current release is 8.4.0. Instead it
 * builds the `open` instruction directly from the program's own IDL, which is
 * the same source of truth the generated client comes from.
 *
 * Everything encoded here was taken from
 * `program/payment_channels/idl/payment_channels.json` and the program source,
 * and is recorded in docs/CLAIM_STATUS.md:
 *
 *   - `open` discriminator is 1 (u8)
 *   - arguments are (salt:u64, deposit:u64, gracePeriod:u32, openSlot:u64,
 *     recipients: {recipient:pubkey, bps:u16}[] prefixed with a u32 count)
 *   - the channel PDA is
 *     ["channel", payer, payee, mint, authorized_signer, salt(u64 LE),
 *      open_slot(u64 LE), bump]
 *   - channelTokenAccount must be exactly ATA(channel, mint, token_program)
 *     (program error 51)
 *   - the channel account decodes to exactly 256 bytes, matching Channel::LEN
 *
 * Nothing here is simulated. If this script prints OK, a channel exists on
 * devnet and the chain said so.
 */

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairFromBytes,
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

// ---------------------------------------------------------------------------
// Fixed addresses
// ---------------------------------------------------------------------------

const PAYMENT_CHANNELS_PROGRAM = address(
  process.env.PROGRAM_ID ?? "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX",
);
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const SYSVAR_RENT = address("SysvarRent111111111111111111111111111111111");
const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Our devnet test token, verified from chain readback. See docs/ASSET_PROVENANCE.md
const TEST_MINT = address(
  process.env.TEST_MINT ?? "6Jpyq8iUszZdZd2z3G9is1nfJh7ZwqbekW9cH2w58hmL",
);
const PAYEE = address(process.env.PAYEE ?? "8spx4F7VCCHdCoGux1FuLhx4z3ebAUvJxnhNBB7rjqcc");
const OPERATOR = address(process.env.OPERATOR ?? "39pNZY2aqhCMaKXeychLHXDNvZ6CTWLPzWAHDPrDzP5T");

const RPC_URL = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = process.env.DEVNET_WS_URL ?? "wss://api.devnet.solana.com";

const DECIMALS = 6n;
/** 50 TEST, to match the demo's stated ceiling. */
const DEPOSIT = BigInt(process.env.DEPOSIT ?? "50000000");
const SALT = BigInt(process.env.SALT ?? "1");
const GRACE_PERIOD = Number(process.env.GRACE_PERIOD ?? "0");

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

// ---------------------------------------------------------------------------
// Secret handling (same rules as the bootstrap script: never printed)
// ---------------------------------------------------------------------------

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

function base58Decode(text) {
  let value = 0n;
  for (const character of text) {
    const index = ALPHABET_INDEX.get(character);
    if (index === undefined) throw new Error(`Invalid base58 character ${JSON.stringify(character)}`);
    value = value * 58n + BigInt(index);
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const character of text) {
    if (character !== "1") break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

function decodeSecretKey(variableName) {
  const raw = process.env[variableName];
  if (!raw || raw.trim() === "") {
    throw new Error(`${variableName} is not set. Add it as a repository secret.`);
  }
  const trimmed = raw.trim();
  const bytes = trimmed.startsWith("[") ? new Uint8Array(JSON.parse(trimmed)) : base58Decode(trimmed);
  if (bytes.length !== 64) {
    throw new Error(`${variableName} decoded to ${bytes.length} bytes, but a Solana secret key is 64.`);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Instruction encoding, taken from the IDL
// ---------------------------------------------------------------------------

const OPEN_DISCRIMINATOR = 1;

/**
 * openArgs: salt u64, deposit u64, gracePeriod u32, openSlot u64,
 *           recipients (u32 count, then {pubkey, u16 bps} each)
 */
function encodeOpenArgs({ salt, deposit, gracePeriod, openSlot, recipients }) {
  const size = 1 + 8 + 8 + 4 + 8 + 4 + recipients.length * 34;
  const buffer = new Uint8Array(size);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  view.setUint8(offset, OPEN_DISCRIMINATOR);
  offset += 1;
  view.setBigUint64(offset, salt, true);
  offset += 8;
  view.setBigUint64(offset, deposit, true);
  offset += 8;
  view.setUint32(offset, gracePeriod, true);
  offset += 4;
  view.setBigUint64(offset, openSlot, true);
  offset += 8;
  view.setUint32(offset, recipients.length, true);
  offset += 4;

  for (const entry of recipients) {
    buffer.set(addressEncoder.encode(entry.recipient), offset);
    offset += 32;
    view.setUint16(offset, entry.bps, true);
    offset += 2;
  }

  return buffer;
}

/** The channel account, in IDL field order. Total is 256 bytes. */
function decodeChannel(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  const readU8 = () => view.getUint8(offset++);
  const readU32 = () => {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const readU64 = () => {
    const value = view.getBigUint64(offset, true);
    offset += 8;
    return value;
  };
  const readI64 = () => {
    const value = view.getBigInt64(offset, true);
    offset += 8;
    return value;
  };
  const readPubkey = () => {
    const value = addressDecoder.decode(data.subarray(offset, offset + 32));
    offset += 32;
    return value;
  };

  const channel = {
    discriminator: readU8(),
    version: readU8(),
    bump: readU8(),
    status: readU8(),
  };
  channel.salt = readU64();
  channel.deposit = readU64();
  channel.settled = readU64();
  channel.payoutWatermark = readU64();
  channel.closureStartedAt = readI64();
  channel.payerWithdrawnAt = readI64();
  channel.gracePeriod = readU32();
  channel.distributionHash = Buffer.from(data.subarray(offset, offset + 32)).toString("hex");
  offset += 32;
  channel.payer = readPubkey();
  channel.payee = readPubkey();
  channel.authorizedSigner = readPubkey();
  channel.mint = readPubkey();
  channel.rentPayer = readPubkey();
  channel.openSlot = readU64();
  channel.bytesConsumed = offset;

  return channel;
}

const STATUS_NAMES = ["Open", "Sealed", "Closing", "Distributed"];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);

const payerKeyPair = await createKeyPairFromBytes(decodeSecretKey("DEVNET_PAYER_KEYPAIR"));
const payerAddress = addressDecoder.decode(
  new Uint8Array(await crypto.subtle.exportKey("raw", payerKeyPair.publicKey)),
);
const payer = { address: payerAddress, keyPair: payerKeyPair };

console.log("");
console.log(`  cluster        : ${RPC_URL}`);
console.log(`  payer          : ${payer.address}`);
console.log(`  payee          : ${PAYEE}`);
console.log(`  authorizedSigner: ${OPERATOR}`);
console.log(`  mint           : ${TEST_MINT}`);
console.log(`  deposit        : ${DEPOSIT} atomic (${Number(DEPOSIT) / 10 ** Number(DECIMALS)} TEST)`);
console.log(`  salt           : ${SALT}`);
console.log("");

const currentSlot = await rpc.getSlot().send();
const openSlot = BigInt(currentSlot);
console.log(`  current slot   : ${currentSlot}  (using as openSlot)`);

const TOKEN_PROGRAM = TOKEN_PROGRAM_ADDRESS;
const encoder = addressEncoder;

const [channelAddress, channelBump] = await getProgramDerivedAddress({
  programAddress: PAYMENT_CHANNELS_PROGRAM,
  seeds: [
    "channel",
    encoder.encode(payer.address),
    encoder.encode(PAYEE),
    encoder.encode(TEST_MINT),
    encoder.encode(OPERATOR),
    new Uint8Array(new BigUint64Array([SALT]).buffer),
    new Uint8Array(new BigUint64Array([openSlot]).buffer),
  ],
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

console.log(`  channel        : ${channelAddress}  (bump ${channelBump})`);
console.log(`  channel token  : ${channelTokenAccount}`);
console.log(`  payer token    : ${payerTokenAccount}`);
console.log("");

const existing = await rpc.getAccountInfo(channelAddress, { encoding: "base64" }).send();
if (existing.value !== null) {
  console.log("  A channel already exists at this address. Nothing was sent.");
  console.log("  Change SALT to open a different one.");
  console.log("");
  const decoded = decodeChannel(Buffer.from(existing.value.data[0], "base64"));
  console.log("  EXISTING CHANNEL");
  console.log(JSON.stringify(decoded, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value, 2));
  console.log("");
  process.exit(0);
}

const instructionData = encodeOpenArgs({
  salt: SALT,
  deposit: DEPOSIT,
  gracePeriod: GRACE_PERIOD,
  openSlot,
  recipients: [],
});

// Account order is fixed by the IDL and must match exactly.
const instruction = {
  programAddress: PAYMENT_CHANNELS_PROGRAM,
  accounts: [
    { address: payer, role: AccountRole.WRITABLE_SIGNER }, // payer
    { address: payer, role: AccountRole.WRITABLE_SIGNER }, // rentPayer (same key)
    { address: PAYEE, role: AccountRole.READONLY },
    { address: TEST_MINT, role: AccountRole.READONLY },
    { address: OPERATOR, role: AccountRole.READONLY },
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
  data: instructionData,
};

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

const message = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayerSigner(payer, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
  (m) => appendTransactionMessageInstructions([instruction], m),
);

const signedTransaction = await signTransactionMessageWithSigners(message);
const signature = getSignatureFromTransaction(signedTransaction);

console.log(`  Sending open: ${signature}`);
console.log("  Waiting for confirmation...");

await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signedTransaction, {
  commitment: "confirmed",
});

console.log("  Confirmed.");
console.log("");

// ---------------------------------------------------------------------------
// Read it back. The chain is the only acceptable source of truth here.
// ---------------------------------------------------------------------------

const readback = await rpc.getAccountInfo(channelAddress, { encoding: "base64" }).send();

if (readback.value === null) {
  throw new Error("The transaction confirmed but no channel exists. Do not trust this run.");
}

const raw = Buffer.from(readback.value.data[0], "base64");
const decoded = decodeChannel(raw);

console.log("  WHAT THE CHAIN SAYS");
console.log("  -------------------");
console.log(`  channel address : ${channelAddress}`);
console.log(`  owner program   : ${readback.value.owner}`);
console.log(`  lamports        : ${readback.value.lamports}`);
console.log(`  bytes           : ${raw.length}`);
console.log(`  fields consumed : ${decoded.bytesConsumed}`);
console.log("");
console.log(
  JSON.stringify(
    { ...decoded, status: `${decoded.status} (${STATUS_NAMES[decoded.status] ?? "unknown"})` },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);
console.log("");

// A structural check, so a wrong-but-readable result cannot pass silently.
const failures = [];
if (raw.length !== 256) failures.push(`expected a 256-byte channel, got ${raw.length}`);
if (decoded.discriminator !== 1) failures.push(`expected discriminator 1, got ${decoded.discriminator}`);
if (decoded.deposit !== DEPOSIT) failures.push(`deposit is ${decoded.deposit}, expected ${DEPOSIT}`);
if (decoded.payer !== payer.address) failures.push(`payer is ${decoded.payer}`);
if (decoded.payee !== PAYEE) failures.push(`payee is ${decoded.payee}`);
if (decoded.mint !== TEST_MINT) failures.push(`mint is ${decoded.mint}`);
if (decoded.authorizedSigner !== OPERATOR) failures.push(`authorizedSigner is ${decoded.authorizedSigner}`);
if (decoded.status !== 0) failures.push(`status is ${decoded.status}, expected 0 (Open)`);

if (failures.length > 0) {
  console.log("  STRUCTURAL CHECK FAILED");
  for (const failure of failures) console.log(`    - ${failure}`);
  process.exit(1);
}

console.log("  STRUCTURAL CHECK PASSED: a real channel is open on devnet.");
console.log(`  explorer: https://explorer.solana.com/address/${channelAddress}?cluster=devnet`);
console.log(`  tx      : https://explorer.solana.com/tx/${signature}?cluster=devnet`);
console.log("");
