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
 *
 * "Plain JavaScript" is load-bearing. This file is `.js`, and vitest parses it
 * with rolldown's JS parser — not the TypeScript one. A `: number` annotation
 * left on a function parameter is a *syntax error* here, and it took the whole
 * suite down with it: the file reported `(0 test)` rather than a failing
 * assertion, so every check below silently stopped running.
 */

import { describe, expect, it } from "vitest";

import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
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
   * The real thing: a message compiled AND SIGNED by the same library the
   * server uses, wrapped in the wire encoding the wallet will receive.
   *
   * Signed rather than merely compiled, because the arithmetic under test is
   * `1 + 64 * signatureCount`. An unsigned message encodes as `count = 0`, which
   * a slicer that hardcoded offset 1 would also get right — so the fixture has
   * to carry a real 64-byte signature slot for these tests to mean anything.
   *
   * The signer is generated fresh and holds nothing: it is never funded, never
   * appears on chain, and is not a secret. Its only job is to make kit's own
   * encoder emit one signature slot, so the offset is checked against the
   * library that produced it rather than against our own arithmetic.
   */
  async function wireTransaction(version = 0) {
    const signer = await generateKeyPairSigner();

    const message = pipe(
      createTransactionMessage({ version }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
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

    const signed = await signTransactionMessageWithSigners(message);
    return {
      wire: getTransactionEncoder().encode(signed),
      messageBytes: signed.messageBytes,
      // Fixed by the single signer above. The first test asserts this against
      // `wire[0]`, so if kit ever changes how many slots the fixture produces,
      // the premise fails loudly instead of the arithmetic quietly going untested.
      signatureCount: 1,
    };
  }

  it("slices off exactly the signature block the wire format puts first", async () => {
    const { wire, messageBytes, signatureCount } = await wireTransaction();

    // Guard the premise, not just the result: if kit ever stops laying the
    // transaction out as `count || signatures || message`, this says so
    // directly instead of failing later with a confusing deep-equality diff.
    expect(wire.length).toBe(1 + 64 * signatureCount + messageBytes.length);
    expect(wire[0]).toBe(signatureCount);

    expect([...messageFromWireTransaction(wire, signatureCount)]).toEqual([...messageBytes]);
  });

  it("slices at an offset that is load-bearing, not coincidentally correct", async () => {
    // Deep equality above already pins the exact bytes. This rules out the
    // failure it could pass for the wrong reason: if the 64-byte step were
    // doing nothing, slicing by one signature too few would still find the
    // message. It must not — it must land 64 bytes early.
    const { wire, messageBytes, signatureCount } = await wireTransaction();
    const asIfUnsigned = messageFromWireTransaction(wire, signatureCount - 1);

    expect(asIfUnsigned.length).toBe(messageBytes.length + 64);
    expect([...asIfUnsigned]).not.toEqual([...messageBytes]);
  });

  it("produces a slice that decodes as a compiled message, not just a byte range", async () => {
    // The strongest check available: the bytes must *be* a valid compiled
    // message, not merely the right length. A one-byte error in the offset
    // would still produce a buffer, and only a decode says whether it is real.
    //
    // Both sides are decoded with kit's own decoder and compared as decoded
    // messages rather than re-encoded. Re-encoding would add an assumption about
    // the encoder being the exact inverse; this needs only that the same decoder
    // reads two byte ranges as the same message.
    const { wire, messageBytes, signatureCount } = await wireTransaction();
    const decoder = getCompiledTransactionMessageDecoder();

    const fromSlice = decoder.decode(messageFromWireTransaction(wire, signatureCount));
    const fromMessage = decoder.decode(messageBytes);

    expect(fromSlice.version).toBe(0);
    expect(fromSlice).toEqual(fromMessage);
  });

  it("slices a legacy message correctly for legacy injected wallet APIs", async () => {
    const { wire, messageBytes, signatureCount } = await wireTransaction("legacy");
    const decoder = getCompiledTransactionMessageDecoder();
    const fromSlice = decoder.decode(messageFromWireTransaction(wire, signatureCount));

    // The legacy Phantom-style request API accepts a base58-encoded legacy
    // message, not a v0 message with a version prefix.
    expect(wire[0]).toBe(signatureCount);
    expect(fromSlice.version).toBe("legacy");
    expect([...messageFromWireTransaction(wire, signatureCount)]).toEqual([...messageBytes]);
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
