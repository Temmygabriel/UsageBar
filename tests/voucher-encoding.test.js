/**
 * Encoding tests for the voucher and the Ed25519 precompile payload.
 *
 * These are not decoration. The program's parser (`ed25519/parse.rs`) rejects
 * anything that is not the canonical 162-byte layout, with a strict guard on
 * every field, and it fails on chain with a single opaque error code (231,
 * `malformedEd25519Instruction`). The layouts also cannot be checked by
 * reading them — the field ORDER is counter-intuitive (pubkey sits before
 * signature), so a "reasonable-looking" encoder is wrong.
 *
 * So the exact parser guards are re-implemented here and run against the bytes
 * we produce. If the encoder drifts from the program, this fails on push
 * rather than during a demo.
 *
 * Written as plain JavaScript on purpose: `protocol.mjs` has no dependencies
 * (only `node:crypto`), and tsconfig's `include` covers only `.ts`/`.tsx`, so
 * this stays out of the typecheck without needing a declaration file.
 */

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ATA_CREATE_IDEMPOTENT,
  BPS_DENOMINATOR,
  CANONICAL_IX_DATA_LEN,
  DISCRIMINATOR,
  MAX_DISTRIBUTION_RECIPIENTS,
  MESSAGE_OFFSET,
  PUBKEY_OFFSET,
  SIGNATURE_OFFSET,
  VOUCHER_PAYLOAD_SIZE,
  buildCreateAtaIdempotentInstruction,
  buildEd25519PrecompileData,
  buildVoucherPayload,
  encodeDistributeData,
  encodeDistributionPreimage,
  signVoucher,
} from "../tools/lib/protocol.mjs";

/** Stand-in channel PDA bytes; the encoder is address-agnostic. */
const CHANNEL_BYTES = new Uint8Array(32).map((_, index) => index + 1);
const encoderReturningChannel = { encode: () => CHANNEL_BYTES };
const OPERATOR_SEED = new Uint8Array(32).fill(0x42);

const spkiFrom = (publicKey) =>
  createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey)]),
    format: "der",
    type: "spki",
  });

/**
 * A faithful re-implementation of the guards in the program's
 * `instructions/helpers/ed25519/parse.rs`. Byte-for-byte the same checks:
 * length, num_signatures, padding, the three instruction indices, the three
 * canonical offsets, and the message size.
 */
function parseLikeTheProgram(bytes) {
  if (bytes.length !== CANONICAL_IX_DATA_LEN) throw new Error("Length");
  if (bytes[0] !== 1) throw new Error("NumSignatures");
  if (bytes[1] !== 0) throw new Error("Padding");

  const offsets = bytes.subarray(2, 16);
  const read = (index) => offsets[index] | (offsets[index + 1] << 8);

  // signature_instruction_index, public_key_instruction_index,
  // message_instruction_index — all must be the u16::MAX "this instruction"
  // sentinel, or the precompile would read from a sibling instruction.
  if (read(2) !== 0xffff || read(6) !== 0xffff || read(12) !== 0xffff) {
    throw new Error("CrossInstruction");
  }
  if (read(0) !== SIGNATURE_OFFSET || read(4) !== PUBKEY_OFFSET || read(8) !== MESSAGE_OFFSET) {
    throw new Error("NonCanonicalOffsets");
  }
  if (read(10) !== VOUCHER_PAYLOAD_SIZE) throw new Error("MessageSize");

  return { pubkey: bytes.subarray(16, 48), message: bytes.subarray(112, 162) };
}

const littleEndian = (value, bytes) => [...new Uint8Array(new BigUint64Array([value]).buffer)];

describe("voucher payload", () => {
  it("is exactly 50 bytes, as `const _: () = assert!(.. == 50)` requires", () => {
    const payload = buildVoucherPayload(encoderReturningChannel, null, 12_400_000n, 0n);
    expect(payload.length).toBe(50);
    expect(VOUCHER_PAYLOAD_SIZE).toBe(50);
  });

  it("lays out magic || channel_id || cumulative || expires_at", () => {
    const payload = buildVoucherPayload(encoderReturningChannel, null, 12_400_000n, 0n);

    expect([...payload.subarray(0, 2)]).toEqual([0x56, 0x01]);
    expect([...payload.subarray(2, 34)]).toEqual([...CHANNEL_BYTES]);
    expect([...payload.subarray(34, 42)]).toEqual(littleEndian(12_400_000n));
    expect([...payload.subarray(42, 50)]).toEqual(new Array(8).fill(0));
  });

  it("encodes expires_at as a signed i64 well before the cumulative field", () => {
    const payload = buildVoucherPayload(encoderReturningChannel, null, 1n, 1_900_000_000n);
    // Two's-complement little-endian, and emphatically NOT at the cumulative
    // offset — the two 8-byte fields are easy to transpose.
    expect([...payload.subarray(42, 50)]).toEqual(littleEndian(1_900_000_000n));
    expect([...payload.subarray(34, 42)]).toEqual(littleEndian(1n));
  });
});

describe("Ed25519 precompile payload", () => {
  it("is 162 bytes with pubkey@16, signature@48, message@112", async () => {
    const payload = buildVoucherPayload(encoderReturningChannel, null, 12_400_000n, 0n);
    const { signature, publicKey } = await signVoucher(OPERATOR_SEED, payload);
    const data = buildEd25519PrecompileData(publicKey, signature, payload);

    expect(data.length).toBe(162);
    expect(CANONICAL_IX_DATA_LEN).toBe(162);

    const view = new DataView(data.buffer);
    expect(view.getUint8(0)).toBe(1); // num_signatures
    expect(view.getUint8(1)).toBe(0); // padding
    expect(view.getUint16(2, true)).toBe(48); // signature_offset
    expect(view.getUint16(4, true)).toBe(0xffff); // signature_instruction_index
    expect(view.getUint16(6, true)).toBe(16); // public_key_offset
    expect(view.getUint16(8, true)).toBe(0xffff); // public_key_instruction_index
    expect(view.getUint16(10, true)).toBe(112); // message_data_offset
    expect(view.getUint16(12, true)).toBe(50); // message_data_size
    expect(view.getUint16(14, true)).toBe(0xffff); // message_instruction_index

    expect([...data.subarray(16, 48)]).toEqual([...publicKey]);
    expect([...data.subarray(48, 112)]).toEqual([...signature]);
    expect([...data.subarray(112, 162)]).toEqual([...payload]);
  });

  it("produces bytes the program's parser guards accept", async () => {
    const payload = buildVoucherPayload(encoderReturningChannel, null, 18_900_000n, 0n);
    const { signature, publicKey } = await signVoucher(OPERATOR_SEED, payload);
    const parsed = parseLikeTheProgram(buildEd25519PrecompileData(publicKey, signature, payload));

    expect([...parsed.pubkey]).toEqual([...publicKey]);
    expect([...parsed.message]).toEqual([...payload]);
  });

  it("rejects impossible inputs at build time rather than on chain", () => {
    const payload = buildVoucherPayload(encoderReturningChannel, null, 1n, 0n);
    expect(() => buildEd25519PrecompileData(new Uint8Array(31), new Uint8Array(64), payload)).toThrow(
      /public key must be 32 bytes/,
    );
    expect(() => buildEd25519PrecompileData(new Uint8Array(32), new Uint8Array(63), payload)).toThrow(
      /signature must be 64 bytes/,
    );
    expect(() =>
      buildEd25519PrecompileData(new Uint8Array(32), new Uint8Array(64), new Uint8Array(49)),
    ).toThrow(/message must be 50 bytes/);
  });

  it("is rejected by the parser if an instruction index is tampered with", async () => {
    const payload = buildVoucherPayload(encoderReturningChannel, null, 1n, 0n);
    const { signature, publicKey } = await signVoucher(OPERATOR_SEED, payload);
    const data = buildEd25519PrecompileData(publicKey, signature, payload);

    const tampered = Uint8Array.from(data);
    tampered[8] = 0; // public_key_instruction_index no longer 0xFFFF
    expect(() => parseLikeTheProgram(tampered)).toThrow(/CrossInstruction/);
  });
});

describe("voucher signing", () => {
  it("produces a signature that verifies against the key signVoucher derived", async () => {
    const payload = buildVoucherPayload(encoderReturningChannel, null, 12_400_000n, 0n);
    const { signature, publicKey } = await signVoucher(OPERATOR_SEED, payload);

    expect(signature.length).toBe(64);
    expect(publicKey.length).toBe(32);
    expect(edVerify(null, Buffer.from(payload), spkiFrom(publicKey), Buffer.from(signature))).toBe(true);
  });

  it("does not verify once the amount is changed — the amount is covered by the signature", async () => {
    const payload = buildVoucherPayload(encoderReturningChannel, null, 12_400_000n, 0n);
    const { signature, publicKey } = await signVoucher(OPERATOR_SEED, payload);

    const inflated = buildVoucherPayload(encoderReturningChannel, null, 50_000_000n, 0n);
    expect(edVerify(null, Buffer.from(inflated), spkiFrom(publicKey), Buffer.from(signature))).toBe(false);
  });

  it("refuses a seed that is not 32 bytes", async () => {
    await expect(signVoucher(new Uint8Array(31), new Uint8Array(50))).rejects.toThrow(
      /Ed25519 seed must be 32 bytes/,
    );
  });
});

describe("distribution preimage", () => {
  const encoderReturning = (byte) => ({ encode: () => new Uint8Array(32).fill(byte) });

  it("encodes an empty plan as the bare 4-byte count prefix", () => {
    const preimage = encodeDistributionPreimage(encoderReturning(1), []);
    expect(preimage.length).toBe(4);
    expect([...preimage]).toEqual([0, 0, 0, 0]);
  });

  it("hashes an empty plan to the digest the live channel committed at open", () => {
    // This value is not invented: it is what the channel on devnet actually
    // stores in `distribution_hash`, which was committed when the channel was
    // opened. If our reading of the preimage layout were wrong, these two
    // would not agree — and `distribute` would fail on chain.
    const preimage = encodeDistributionPreimage(encoderReturning(1), []);
    expect(createHash("sha256").update(Buffer.from(preimage)).digest("hex")).toBe(
      "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119",
    );
  });

  it("lays out entries as recipient(32) || bps(u16 LE), 34 bytes each", () => {
    const preimage = encodeDistributionPreimage(encoderReturning(9), [{ recipient: "r", bps: 2500 }]);
    expect(preimage.length).toBe(4 + 34);
    expect(new DataView(preimage.buffer).getUint32(0, true)).toBe(1);
    expect([...preimage.subarray(4, 36)]).toEqual(new Array(32).fill(9));
    expect(new DataView(preimage.buffer).getUint16(36, true)).toBe(2500);
  });

  it("rejects plans the program would reject, naming the error code", () => {
    const encoder = encoderReturning(1);
    // Unlike `encoderReturning`, this one derives distinct bytes per recipient,
    // so the duplicate check does not fire before the check under test.
    const distinct = {
      encode: (value) => {
        const bytes = new Uint8Array(32);
        bytes[0] = (String(value).charCodeAt(0) % 251) + 1;
        return bytes;
      },
    };

    expect(() => encodeDistributionPreimage(encoder, [{ recipient: "a", bps: 0 }])).toThrow(/error 261/);
    expect(() =>
      encodeDistributionPreimage(distinct, [{ recipient: "a", bps: 9000 }, { recipient: "b", bps: 2000 }]),
    ).toThrow(/over the 10000 maximum/);
    expect(() =>
      encodeDistributionPreimage(distinct, [{ recipient: "a", bps: 100 }, { recipient: "a", bps: 100 }]),
    ).toThrow(/duplicate recipient/);
    expect(() =>
      encodeDistributionPreimage(
        encoder,
        Array.from({ length: MAX_DISTRIBUTION_RECIPIENTS + 1 }, () => ({ recipient: "a", bps: 1 })),
      ),
    ).toThrow(/at most 32 recipients/);
  });

  it("prefixes the distribute instruction data with its discriminator", () => {
    const data = encodeDistributeData(encoderReturning(1), []);
    expect(data[0]).toBe(DISCRIMINATOR.distribute);
    expect(data[0]).toBe(7);
    expect([...data.subarray(1)]).toEqual([0, 0, 0, 0]);
  });

  it("pins the basis-point denominator", () => {
    expect(BPS_DENOMINATOR).toBe(10_000);
  });
});

describe("ATA creation instruction", () => {
  /**
   * The Associated Token Program's layout is fixed by the program itself, and
   * the builder is hand-rolled because the Solana packages are installed only
   * in CI, so its export names cannot be checked on the development machine.
   * These assertions are what keeps that hand-rolling honest.
   */
  const AccountRole = { READONLY: 0, WRITABLE: 1, READONLY_SIGNER: 2, WRITABLE_SIGNER: 3 };
  const SIGNER = { address: "payerSigner" };

  const build = () =>
    buildCreateAtaIdempotentInstruction({
      payer: "payer",
      payerSigner: SIGNER,
      ata: "ata",
      owner: "owner",
      mint: "mint",
      tokenProgram: "tokenProgram",
      AccountRole,
    });

  it("targets the Associated Token Program with the CreateIdempotent tag", () => {
    const instruction = build();
    expect(instruction.programAddress).toBe("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    // 1, not 0: plain `Create` fails when the account already exists, which
    // would make a retried close impossible.
    expect([...instruction.data]).toEqual([1]);
    expect(ATA_CREATE_IDEMPOTENT).toBe(1);
  });

  it("orders the six accounts exactly as the program requires", () => {
    const instruction = build();
    expect(instruction.accounts.map((account) => account.address)).toEqual([
      "payer",
      "ata",
      "owner",
      "mint",
      "11111111111111111111111111111111",
      "tokenProgram",
    ]);
    expect(instruction.accounts.map((account) => account.role)).toEqual([
      AccountRole.WRITABLE_SIGNER,
      AccountRole.WRITABLE,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
    ]);
  });

  it("carries the payer's signer object, without which the transaction cannot be signed", () => {
    expect(build().accounts[0].signer).toBe(SIGNER);
    // The other five must NOT be signers.
    expect(build().accounts.slice(1).every((account) => account.signer === undefined)).toBe(true);
  });
});
