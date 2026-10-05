/**
 * Protocol encoding shared by the devnet tooling.
 *
 * Every constant and byte layout here was taken from the program's own source
 * on 2026-10-05, not from documentation. The relevant files are
 * `program/payment_channels/src/instructions/helpers/{voucher,ed25519/*}.rs`
 * and `instructions/mod.rs` in solana-foundation/payment-channels.
 *
 * The rules this module encodes are strict, and the program rejects anything
 * that deviates. They are written down here so a future reader can see exactly
 * what the chain will and will not accept.
 */

// ---------------------------------------------------------------------------
// Fixed addresses
// ---------------------------------------------------------------------------

export const PAYMENT_CHANNELS_PROGRAM =
  process.env.PROGRAM_ID ?? "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX";

/** The native precompile. `consts.rs` pins this exact address. */
export const ED25519_PRECOMPILE = "Ed25519SigVerify111111111111111111111111111";

/** The Instructions sysvar, from which the program reads the bundled ix. */
export const INSTRUCTIONS_SYSVAR = "Sysvar1nstructions1111111111111111111111111";

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const SYSVAR_RENT = "SysvarRent111111111111111111111111111111111";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

// ---------------------------------------------------------------------------
// Instruction discriminators
//
// Read out of the IDL. Note these are NOT an enum in declaration order — the
// IDL carries an explicit `defaultValue` per instruction, and `emitEvent` sits
// far away at 228. Never infer a discriminator; look it up.
// ---------------------------------------------------------------------------

export const DISCRIMINATOR = {
  open: 1,
  settle: 2,
  topUp: 3,
  settleAndSeal: 4,
  requestClose: 5,
  seal: 6,
  distribute: 7,
  withdrawPayer: 8,
  reclaim: 9,
};

export const CHANNEL_STATUS = ["Open", "Sealed", "Closing", "Distributed"];

// ---------------------------------------------------------------------------
// Channel account
// ---------------------------------------------------------------------------

/** `Channel::LEN` — asserted downstream, so a misparse cannot pass silently. */
export const CHANNEL_LEN = 256;

/** `CHANNEL_SEED` is literally the 7 ASCII bytes of the word "channel". */
export const CHANNEL_SEED = "channel";

/**
 * The channel account in IDL field order. Total is exactly 256 bytes.
 *
 * The order matters and is not alphabetical or grouped by type: the `u32`
 * grace period sits between two `i64` timestamps, so a reader that assumes
 * "all the 8-byte fields come first" will decode a plausible-looking channel
 * that is entirely wrong.
 */
export function decodeChannel(data, addressDecoder) {
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

// ---------------------------------------------------------------------------
// Voucher
// ---------------------------------------------------------------------------

/** `VOUCHER_MAGIC` — a tag byte plus a format version byte. */
export const VOUCHER_MAGIC = [0x56, 0x01];

/**
 * `VOUCHER_PAYLOAD_SIZE`, pinned by a `const _: () = assert!(.. == 50)` in the
 * program. This is byte-for-byte the in-memory layout of the Rust
 * `VoucherArgs` struct, which the program transmutes directly. There is no
 * Borsh framing on the wire and no second copy of the voucher anywhere: the
 * signed message *is* the voucher.
 */
export const VOUCHER_PAYLOAD_SIZE = 50;

/**
 * The 50-byte message the operator signs.
 *
 *   magic            2 bytes   [0x56, 0x01]
 *   channel_id      32 bytes   the channel PDA
 *   cumulative       8 bytes   u64 LE — a cumulative ceiling, not a delta
 *   expires_at       8 bytes   i64 LE — 0 means never
 *
 * The amount is CUMULATIVE. That is the whole reason a usage tab works: each
 * voucher supersedes the last, so a dropped or reordered update is harmless.
 */
export function buildVoucherPayload(addressEncoder, channelAddress, cumulativeAmount, expiresAt = 0n) {
  const buffer = new Uint8Array(VOUCHER_PAYLOAD_SIZE);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  buffer.set(VOUCHER_MAGIC, offset);
  offset += 2;
  buffer.set(addressEncoder.encode(channelAddress), offset);
  offset += 32;
  view.setBigUint64(offset, cumulativeAmount, true);
  offset += 8;
  view.setBigInt64(offset, expiresAt, true);
  offset += 8;

  if (offset !== VOUCHER_PAYLOAD_SIZE) {
    throw new Error(`voucher payload is ${offset} bytes, expected ${VOUCHER_PAYLOAD_SIZE}`);
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Ed25519 precompile instruction
// ---------------------------------------------------------------------------

/**
 * The canonical layout the program's parser demands. Its guards are strict:
 * exactly 162 bytes, `num_signatures == 1`, zero padding, all three
 * `*_instruction_index` fields `0xFFFF`, and the three byte offsets exactly as
 * below.
 *
 * NOTE the field ORDER: pubkey (at 16) comes before signature (at 48), which
 * is the reverse of the ordering most people assume from the Solana docs. The
 * precompile itself reads via the offsets, so it accepts either arrangement —
 * but the program's parser pins these exact three values and rejects anything
 * else with `MalformedEd25519Instruction` (error 231).
 *
 *   0        num_signatures        u8   = 1
 *   1        padding              u8   = 0
 *   2..4     signature_offset     u16  = 48
 *   4..6     signature_ix_index   u16  = 0xFFFF
 *   6..8     public_key_offset    u16  = 16
 *   8..10    public_key_ix_index  u16  = 0xFFFF
 *   10..12   message_data_offset  u16  = 112
 *   12..14   message_data_size    u16  = 50
 *   14..16   message_ix_index     u16  = 0xFFFF
 *   16..48   public key           32 bytes
 *   48..112  signature            64 bytes
 *   112..162 message               50 bytes
 */
export const PUBKEY_OFFSET = 16;
export const SIGNATURE_OFFSET = 48;
export const MESSAGE_OFFSET = 112;
export const CANONICAL_IX_DATA_LEN = MESSAGE_OFFSET + VOUCHER_PAYLOAD_SIZE; // 162

export function buildEd25519PrecompileData(publicKey, signature, message) {
  if (publicKey.length !== 32) throw new Error(`public key must be 32 bytes, got ${publicKey.length}`);
  if (signature.length !== 64) throw new Error(`signature must be 64 bytes, got ${signature.length}`);
  if (message.length !== VOUCHER_PAYLOAD_SIZE) {
    throw new Error(`message must be ${VOUCHER_PAYLOAD_SIZE} bytes, got ${message.length}`);
  }

  const data = new Uint8Array(CANONICAL_IX_DATA_LEN);
  const view = new DataView(data.buffer);

  view.setUint8(0, 1); // num_signatures
  view.setUint8(1, 0); // padding
  view.setUint16(2, SIGNATURE_OFFSET, true);
  view.setUint16(4, 0xffff, true); // signature_instruction_index -> this ix
  view.setUint16(6, PUBKEY_OFFSET, true);
  view.setUint16(8, 0xffff, true); // public_key_instruction_index -> this ix
  view.setUint16(10, MESSAGE_OFFSET, true);
  view.setUint16(12, VOUCHER_PAYLOAD_SIZE, true);
  view.setUint16(14, 0xffff, true); // message_instruction_index -> this ix

  data.set(publicKey, PUBKEY_OFFSET);
  data.set(signature, SIGNATURE_OFFSET);
  data.set(message, MESSAGE_OFFSET);

  return data;
}

// ---------------------------------------------------------------------------
// Secret handling
//
// Secrets are read from the environment and never logged. Only public
// addresses derived from them are ever printed.
// ---------------------------------------------------------------------------

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_INDEX = new Map([...ALPHABET].map((character, index) => [character, index]));

export function base58Decode(text) {
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

/**
 * A Solana secret key is 64 bytes: `seed(32) || publicKey(32)`. Both the
 * base58 and the JSON-array encodings are accepted, because which one you get
 * depends on which tool wrote the file.
 */
export function decodeSecretKey(variableName) {
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

/**
 * Sign a voucher with a raw Ed25519 seed via `node:crypto`, so the tooling
 * needs no extra dependency.
 *
 * The PKCS#8 wrapper below is the fixed 16-byte DER prefix for an Ed25519
 * private key; appending the 32-byte seed produces a key `node:crypto` will
 * accept. Returns the 64-byte signature and the 32-byte public key, which is
 * re-derived from the key object rather than copied from the secret key, so a
 * mismatched key pair fails here instead of confusingly on chain.
 */
export async function signVoucher(seed, message) {
  const { createPrivateKey, createPublicKey, sign } = await import("node:crypto");

  if (seed.length !== 32) throw new Error(`Ed25519 seed must be 32 bytes, got ${seed.length}`);

  const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });

  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicKey = new Uint8Array(spki.subarray(spki.length - 32));

  const signature = new Uint8Array(sign(null, message, privateKey));
  if (signature.length !== 64) throw new Error(`expected a 64-byte signature, got ${signature.length}`);

  return { signature, publicKey };
}
