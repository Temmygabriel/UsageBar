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
  CHANNEL_ERRORS,
  DISCRIMINATOR,
  MAX_DISTRIBUTION_RECIPIENTS,
  MESSAGE_OFFSET,
  PUBKEY_OFFSET,
  SIGNATURE_OFFSET,
  SYSTEM_TRANSFER_DISCRIMINATOR,
  TOKEN_TRANSFER_DISCRIMINATOR,
  VOUCHER_PAYLOAD_SIZE,
  annotateChannelErrors,
  buildCreateAtaIdempotentInstruction,
  buildEd25519PrecompileData,
  buildSystemTransferInstruction,
  buildTokenTransferInstruction,
  buildVoucherPayload,
  channelSeeds,
  encodeDistributeData,
  encodeDistributionPreimage,
  encodeOpenArgs,
  encodeRequestCloseData,
  encodeSealData,
  encodeTopUpData,
  encodeWithdrawPayerData,
  readTokenAccountAmount,
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

describe("argument-less instruction data", () => {
  /**
   * A one-byte instruction has no room to be subtly wrong: it is either the
   * right discriminator or a completely different instruction. That is exactly
   * why it is worth pinning — the failure mode is not a malformed buffer, it
   * is calling `seal` when you meant `withdrawPayer`, and the program would
   * execute it happily if the accounts happened to line up.
   */
  it("is the right single byte for each of the three", () => {
    expect([...encodeRequestCloseData()]).toEqual([DISCRIMINATOR.requestClose]);
    expect([...encodeSealData()]).toEqual([DISCRIMINATOR.seal]);
    expect([...encodeWithdrawPayerData()]).toEqual([DISCRIMINATOR.withdrawPayer]);
  });

  it("matches the discriminator table, whose numbers are load-bearing", () => {
    expect([...encodeRequestCloseData()]).toEqual([5]);
    expect([...encodeSealData()]).toEqual([6]);
    expect([...encodeWithdrawPayerData()]).toEqual([8]);
    // 7 is `distribute`, and the gap between 6 and 8 is not a mistake here.
    expect(DISCRIMINATOR.distribute).toBe(7);
    expect(DISCRIMINATOR.topUp).toBe(3);
  });
});

describe("topUp instruction data", () => {
  it("is the discriminator followed by a little-endian u64", () => {
    const data = encodeTopUpData(10_000_000n);
    expect(data.length).toBe(9);
    expect(data[0]).toBe(DISCRIMINATOR.topUp);
    expect(Buffer.from(data.subarray(1)).readBigUInt64LE(0)).toBe(10_000_000n);
  });

  it("writes the low byte first, which is the difference between 1 and 2^56", () => {
    // 0x0102030405060708 read little-endian. A big-endian encoder produces a
    // plausible buffer that asks for an amount nobody intended.
    const data = encodeTopUpData(0x0102030405060708n);
    expect([...data.subarray(1)]).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("refuses a zero amount rather than sending a no-op", () => {
    expect(() => encodeTopUpData(0n)).toThrow(/non-zero/);
    expect(() => encodeTopUpData(-1n)).toThrow(/non-zero/);
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

// ---------------------------------------------------------------------------
// The `open` instruction, the channel PDA seeds, and the two transfers the
// faucet uses. All three are new with the chain adapter, and all three are the
// kind of layout that looks right while being wrong: a u32 sitting between two
// u64s, a seed ORDER that is not the field order, and discriminators that are
// plain integers with no self-describing structure.
// ---------------------------------------------------------------------------

/** A deterministic encoder, so a seed or account can be identified by its bytes. */
const labelledEncoder = {
  encode: (value) => new Uint8Array(32).fill(String(value).charCodeAt(0) % 256),
};

const ROLE = {
  WRITABLE_SIGNER: "writableSigner",
  WRITABLE: "writable",
  READONLY: "readonly",
  READONLY_SIGNER: "readonlySigner",
};

/**
 * A stand-in for a `TransactionSigner`.
 *
 * Module scope, not per-describe-block. Three separate blocks assert that the
 * signer they were handed is the very object that ends up in the account meta,
 * and when this was block-scoped those blocks threw `ReferenceError: SIGNER is
 * not defined` instead of testing anything — a fixture that made the tests fail
 * loudly, which is the good version of this mistake, but still a mistake.
 */
const SIGNER = { address: "payerSigner" };

describe("open instruction", () => {
  const args = {
    addressEncoder: labelledEncoder,
    salt: 7n,
    deposit: 50_000_000n,
    gracePeriod: 60,
    openSlot: 1234n,
    recipients: [],
  };

  it("starts with the open discriminator, which is 1", () => {
    expect(encodeOpenArgs(args)[0]).toBe(1);
    expect(DISCRIMINATOR.open).toBe(1);
  });

  it("lays the arguments out in declaration order, with the u32 grace period in the middle", () => {
    const data = encodeOpenArgs(args);
    const view = new DataView(data.buffer);

    // This is the trap the test exists for. The two u64s at the end are NOT
    // adjacent to each other — a 4-byte grace period sits between them, so a
    // reader that assumes "all the 8-byte fields come first" decodes a
    // plausible and entirely wrong struct.
    expect(view.getBigUint64(1, true)).toBe(7n); // salt
    expect(view.getBigUint64(9, true)).toBe(50_000_000n); // deposit
    expect(view.getUint32(17, true)).toBe(60); // gracePeriod
    expect(view.getBigUint64(21, true)).toBe(1234n); // openSlot
    expect(view.getUint32(29, true)).toBe(0); // recipient count
  });

  it("is exactly as long as its fields require", () => {
    // 1 + 8 + 8 + 4 + 8 + 4 = 33 for an empty plan.
    expect(encodeOpenArgs(args).length).toBe(33);
  });

  it("frames the recipient list as a u32 count followed by 34-byte entries", () => {
    const data = encodeOpenArgs({
      ...args,
      recipients: [
        { recipient: "AAA", bps: 6000 },
        { recipient: "BBB", bps: 4000 },
      ],
    });
    const view = new DataView(data.buffer);

    expect(view.getUint32(29, true)).toBe(2);
    expect(data.length).toBe(33 + 2 * 34);
    expect(view.getUint16(33 + 32, true)).toBe(6000);
    expect(view.getUint16(33 + 34 + 32, true)).toBe(4000);
  });

  it("rejects a zero grace period here rather than paying to learn it on chain", () => {
    // The program rejects zero with error 201 (gracePeriodMustBeNonZero). That
    // costs a round trip and an opaque hex code to discover, so it is refused
    // before a transaction is built.
    expect(() => encodeOpenArgs({ ...args, gracePeriod: 0 })).toThrow(/201/);
    expect(() => encodeOpenArgs({ ...args, gracePeriod: -1 })).toThrow(/201/);
  });
});

describe("channel PDA seeds", () => {
  const seeds = channelSeeds(labelledEncoder, {
    payer: "P",
    payee: "Y",
    mint: "M",
    authorizedSigner: "S",
    salt: 9n,
    openSlot: 258n,
  });

  it("has seven seeds, in the order the program derives them", () => {
    expect(seeds.length).toBe(7);
    expect(seeds[0]).toBe("channel");
  });

  it("orders the four keys as payer, payee, mint, authorizedSigner", () => {
    // NOT the IDL's account order, and not alphabetical. Getting this wrong
    // produces an address that simply has no channel in it.
    const firstBytes = seeds.slice(1, 5).map((seed) => seed[0]);
    expect(firstBytes).toEqual(["P", "Y", "M", "S"].map((label) => label.charCodeAt(0)));
  });

  it("encodes the two u64s little-endian, with openSlot last", () => {
    expect(seeds[5].length).toBe(8);
    expect(new DataView(seeds[5].buffer).getBigUint64(0, true)).toBe(9n);
    expect(seeds[6].length).toBe(8);
    expect(new DataView(seeds[6].buffer).getBigUint64(0, true)).toBe(258n);
  });
});

describe("system transfer", () => {
  const build = () =>
    buildSystemTransferInstruction({
      from: "from",
      fromSigner: SIGNER,
      to: "to",
      lamports: 50_000_000n,
      AccountRole: ROLE,
    });

  it("uses instruction index 2 and a 12-byte payload", () => {
    const data = build().data;
    expect(data.length).toBe(12);
    expect(new DataView(data.buffer).getUint32(0, true)).toBe(2);
    expect(SYSTEM_TRANSFER_DISCRIMINATOR).toBe(2);
    expect(new DataView(data.buffer).getBigUint64(4, true)).toBe(50_000_000n);
  });

  it("has source then destination, and only the source is a signer", () => {
    const instruction = build();
    expect(instruction.accounts.map((account) => account.address)).toEqual(["from", "to"]);
    expect(instruction.accounts.map((account) => account.role)).toEqual([
      "writableSigner",
      "writable",
    ]);
    expect(instruction.accounts[0].signer).toBe(SIGNER);
  });

  it("refuses a zero or negative transfer rather than sending a pointless transaction", () => {
    expect(() =>
      buildSystemTransferInstruction({
        from: "from",
        fromSigner: SIGNER,
        to: "to",
        lamports: 0n,
        AccountRole: ROLE,
      }),
    ).toThrow(/no-op/);
  });
});

describe("SPL token transfer", () => {
  const build = (amount = 100_000_000n) =>
    buildTokenTransferInstruction({
      source: "source",
      destination: "destination",
      authority: "authority",
      authoritySigner: SIGNER,
      amount,
      tokenProgram: "tokenProgram",
      AccountRole: ROLE,
    });

  it("uses instruction index 3 and a 9-byte payload", () => {
    const data = build().data;
    expect(data.length).toBe(9);
    expect(data[0]).toBe(3);
    expect(TOKEN_TRANSFER_DISCRIMINATOR).toBe(3);
    expect(new DataView(data.buffer).getBigUint64(1, true)).toBe(100_000_000n);
  });

  it("orders source, destination, authority — and the authority is the only signer", () => {
    const instruction = build();
    expect(instruction.accounts.map((account) => account.address)).toEqual([
      "source",
      "destination",
      "authority",
    ]);
    expect(instruction.accounts.map((account) => account.role)).toEqual([
      "writable",
      "writable",
      "readonlySigner",
    ]);
    expect(instruction.programAddress).toBe("tokenProgram");
  });

  it("refuses a zero amount", () => {
    expect(() => build(0n)).toThrow(/no-op/);
  });
});

describe("readTokenAccountAmount", () => {
  it("reads the u64 at byte offset 64, where SPL puts it", () => {
    // mint (32) || owner (32) || amount (8). The offset is the whole point:
    // reading at 32 gives the owner's first bytes, which is a plausible number
    // and a completely wrong balance.
    const data = new Uint8Array(165);
    new DataView(data.buffer).setBigUint64(64, 21_500_000n, true);
    expect(readTokenAccountAmount(data)).toBe(21_500_000n);
  });

  it("reads from the right place inside a larger buffer", () => {
    // A real token account read back from RPC arrives as a view into a larger
    // backing buffer, not as a zero-offset array, so the offset has to be
    // honoured: `DataView(buffer, byteOffset, byteLength)` starts at the
    // account, not at the start of the buffer. Slicing fewer than 165 bytes
    // here would be testing the length guard instead of the offset.
    const ACCOUNT_START = 100;
    const backing = new Uint8Array(ACCOUNT_START + 165);
    new DataView(backing.buffer).setBigUint64(ACCOUNT_START + 64, 42n, true);
    const account = backing.subarray(ACCOUNT_START, ACCOUNT_START + 165);
    expect(account.length).toBe(165);
    expect(readTokenAccountAmount(account)).toBe(42n);
  });

  it("refuses a buffer too short to hold an amount", () => {
    expect(() => readTokenAccountAmount(new Uint8Array(64))).toThrow(/too short/);
  });
});

describe("CHANNEL_ERRORS", () => {
  it("names the code the grace-period guard actually returned", () => {
    // The one entry in this table with a chain receipt behind it. Extended-paths
    // scenario B called `seal` before the grace period had elapsed and the
    // cluster answered `custom program error: 0x899`; 0x899 is 2201, and
    // `errors.rs` puts `SealGracePeriodNotElapsed` under `// ix seal`.
    expect(CHANNEL_ERRORS[2201]).toBe("SealGracePeriodNotElapsed");
    expect(CHANNEL_ERRORS[0x899]).toBe("SealGracePeriodNotElapsed");
  });

  it("carries the distribution codes the encoder's own guards cite", () => {
    // `encodeDistributionPreimage` throws naming these four, so a wrong name
    // here is a wrong error message at the call site, not just a wrong lookup.
    expect(CHANNEL_ERRORS[260]).toBe("InvalidRecipientCount");
    expect(CHANNEL_ERRORS[261]).toBe("InvalidSplitConfig");
    expect(CHANNEL_ERRORS[263]).toBe("DuplicateRecipient");
  });

  it("cites codes by their decimal number, wherever they appear", () => {
    // Every key has to be a plain integer string. A hex key would still be a
    // valid object key and would silently never match the decimal lookup.
    for (const key of Object.keys(CHANNEL_ERRORS)) {
      expect(key).toMatch(/^\d+$/);
    }
  });
});

describe("annotateChannelErrors", () => {
  it("appends the decimal code and the name", () => {
    expect(annotateChannelErrors("custom program error: 0x899")).toBe(
      "custom program error: 0x899 (2201, SealGracePeriodNotElapsed)",
    );
  });

  it("leaves a code it does not know exactly as it found it", () => {
    // The point of the table being a subset. Inventing a name for a code nobody
    // has read the source for is worse than printing bare hex, because bare hex
    // reads as "unknown" and a wrong name reads as "known".
    const text = "custom program error: 0x7fff";
    expect(annotateChannelErrors(text)).toBe(text);
  });

  it("leaves text with no program error untouched", () => {
    const text = "WebSocket failed to connect";
    expect(annotateChannelErrors(text)).toBe(text);
  });

  it("annotates every code in a block, not just the first", () => {
    const annotated = annotateChannelErrors("custom program error: 0xc8\ncustom program error: 0x899");
    expect(annotated).toContain("(200, DepositMustBeNonZero)");
    expect(annotated).toContain("(2201, SealGracePeriodNotElapsed)");
  });

  it("is idempotent, so a re-described error does not stack annotations", () => {
    // `land()` merges a transport failure with a chain-reported one and the
    // result is described again on the way into the evidence file.
    const once = annotateChannelErrors("custom program error: 0x899");
    expect(annotateChannelErrors(once)).toBe(once);
    expect(annotateChannelErrors(annotateChannelErrors(once))).toBe(once);
  });

  it("accepts uppercase hex digits", () => {
    // The prefix is always lowercase in the runtime's own message, but the hex
    // digits are not guaranteed to be: `0xC8` is the same code as `0xc8`.
    expect(annotateChannelErrors("custom program error: 0xC8")).toBe(
      "custom program error: 0xC8 (200, DepositMustBeNonZero)",
    );
  });
});
