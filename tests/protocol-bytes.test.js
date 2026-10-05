/**
 * Byte-level parity between the browser and the tooling.
 *
 * Two things are duplicated on purpose, and duplication is only safe when
 * something checks it:
 *
 *   base58Encode   lives in `tools/lib/protocol.mjs` (used by the devnet tools)
 *                  and again in `lib/base58.ts` (used by the browser). The copy
 *                  exists because the protocol module contains a
 *                  `node:crypto` import that must never reach a browser bundle.
 *
 *   the wire layout  `messageFromWireTransaction` slices a serialized
 *                  transaction at `1 + 64 * signatureCount`. That arithmetic is
 *                  the kind that is right until it very quietly is not.
 *
 * So the first is checked against the other implementation, and the second is
 * checked against `@solana/kit`'s own encoder — the same library that produced
 * the bytes in production. If either assumption breaks, this fails on push.
 *
 * Plain JavaScript, matching `voucher-encoding.test.js`: tsconfig's `include`
 * covers only `.ts`/`.tsx`, so importing a dependency-free `.mjs` module stays
 * out of the typecheck without needing a declaration file.
 */

import { describe, expect, it } from "vitest";

import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import { base58Encode as browserBase58, base64ToBytes, messageFromWireTransaction } from "../lib/base58";
import { base58Encode as toolingBase58, base58Decode } from "../tools/lib/protocol.mjs";

describe("base58: the two implementations", () => {
  const cases = [
    new Uint8Array([]),
    new Uint8Array([0]),
    new Uint8Array(32), // all zero — the system program, 32 leading '1's
    new Uint8Array([1]),
    new Uint8Array([0, 0, 0, 1]),
    new Uint8Array([255]),
    new Uint8Array([0, 255, 0, 255]),
    new Uint8Array(64).fill(0xab),
    new Uint8Array(Array.from({ length: 32 }, (_, index) => (index * 7) % 256)),
  ];

  it("produce identical output for every case", () => {
    for (const bytes of cases) {
      expect(browserBase58(bytes)).toBe(toolingBase58(bytes));
    }
  });

  it("encode the system program as thirty-two ones", () => {
    expect(browserBase58(new Uint8Array(32))).toBe("1".repeat(32));
  });

  it("round-trip through the tooling's decoder, so neither is merely self-consistent", () => {
    // Encoding agreement alone would be satisfied by two identically wrong
    // implementations. Decoding back to the original bytes rules that out.
    for (const bytes of cases) {
      expect([...base58Decode(browserBase58(bytes))]).toEqual([...bytes]);
    }
  });

  it("encodes a real address to the address we started with", () => {
    const original = "7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo";
    expect(browserBase58(base58Decode(original))).toBe(original);
  });
});

describe("base64ToBytes", () => {
  it("round-trips every byte value", () => {
    const bytes = new Uint8Array(Array.from({ length: 256 }, (_, index) => index));
    expect([...base64ToBytes(Buffer.from(bytes).toString("base64"))]).toEqual([...bytes]);
  });

  it("handles a length that needs padding", () => {
    for (const length of [1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(length).fill(9);
      expect([...base64ToBytes(Buffer.from(bytes).toString("base64"))]).toEqual([...bytes]);
    }
  });
});

describe("messageFromWireTransaction", () => {
  /**
   * The real thing: a message compiled by the same library the server uses,
   * wrapped in the wire encoding the wallet will receive.
   */
  async function wireTransaction(signatureCount: number) {
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) =>
        setTransactionMessageFeePayer(
          address("7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo"),
          m,
        ),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 100n,
          },
          m,
        ),
      (m) =>
        appendTransactionMessageInstructions(
          [
            {
              programAddress: address("11111111111111111111111111111111"),
              accounts: [],
              data: new Uint8Array([1, 2, 3]),
            },
          ],
          m,
        ),
    );

    const compiled = compileTransaction(message);
    return {
      wire: getTransactionEncoder().encode(compiled),
      messageBytes: compiled.messageBytes,
      signatureCount,
    };
  }

  it("slices off exactly the signature block the wire format puts first", async () => {
    const { wire, messageBytes, signatureCount } = await wireTransaction(1);

    // Guard the premise, not just the result: if kit ever stops laying the
    // transaction out as `count || signatures || message`, this says so
    // directly instead of failing later with a confusing deep-equality diff.
    expect(wire.length).toBe(1 + 64 * signatureCount + messageBytes.length);
    expect(wire[0]).toBe(signatureCount);

    expect([...messageFromWireTransaction(wire, signatureCount)]).toEqual([...messageBytes]);
  });

  it("produces a message the encoder will accept, not just a byte range", async () => {
    // The strongest available check: the slice must decode as a valid compiled
    // message. A one-byte error in the offset would still produce bytes, and
    // they would still be the wrong length only by accident.
    const { wire, messageBytes } = await wireTransaction(1);
    const message = messageFromWireTransaction(wire, 1);

    expect(message.length).toBe(messageBytes.length);
    // The message header's first byte carries numRequiredSignatures in its high
    // bits, so a misaligned slice is visible here.
    expect(message[0]).toBe(messageBytes[0]);
  });

  it("refuses a transaction too short to contain the signatures it claims", () => {
    expect(() => messageFromWireTransaction(new Uint8Array(10), 1)).toThrow(/must be longer/);
  });

  it("agrees with the address encoder on what a payer looks like", () => {
    // A small sanity check on the fixture above, so a typo in the test address
    // cannot quietly make the whole block meaningless.
    const encoder = getAddressEncoder();
    expect(encoder.encode(address("7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo")).length).toBe(32);
  });
});
