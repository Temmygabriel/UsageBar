/**
 * Base58 encoding, for the browser.
 *
 * WHY THIS IS DUPLICATED RATHER THAN IMPORTED
 *
 * `tools/lib/protocol.mjs` already exports a base58 encoder, and normally one
 * copy would be the right answer. But that module also contains a
 * `await import("node:crypto")` for voucher signing, and this one is bundled
 * into the browser. Pulling the protocol module into a client bundle would drag
 * a Node built-in along with it and break the build — or worse, break it only
 * sometimes, depending on how the bundler resolved the dynamic import.
 *
 * So the encoder is copied here, deliberately narrow (encode only — the client
 * never needs to decode), and `tests/protocol-bytes.test.js` asserts that both
 * implementations produce identical output for the same inputs. That test is
 * what makes the duplication safe: the two cannot drift without CI saying so.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Encode bytes as base58.
 *
 * Leading zero bytes become leading '1' characters — the same convention
 * Bitcoin and Solana use, and the reason a Solana address can start with '1'.
 */
export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);

  let text = "";
  while (value > 0n) {
    text = ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }

  for (const byte of bytes) {
    if (byte !== 0) break;
    text = "1" + text;
  }

  return text;
}

/** Decode base64 into bytes. `atob` is available in every browser and in Node 16+. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * The message inside a serialized transaction.
 *
 * A wire transaction is `count || signatures[count] || message`, where `count`
 * is a compact-u16 — one byte for any count below 128, which is every
 * transaction this app produces. So the message starts at `1 + 64 * count`.
 *
 * This exists because the legacy wallet API (`request` with a base58 `message`)
 * takes a message, while the Wallet Standard API takes the whole transaction,
 * and the server sends one encoding that has to serve both. The slice is exact
 * and is covered by a test that decodes the result back with `@solana/kit`.
 */
export function messageFromWireTransaction(
  wireTransaction: Uint8Array,
  signatureCount: number,
): Uint8Array {
  const offset = 1 + 64 * signatureCount;
  if (wireTransaction.length <= offset) {
    throw new Error(
      `A wire transaction carrying ${signatureCount} signature(s) must be longer than ` +
        `${offset} bytes, but it is ${wireTransaction.length}.`,
    );
  }
  return wireTransaction.subarray(offset);
}
