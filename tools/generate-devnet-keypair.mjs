#!/usr/bin/env node
/**
 * Generate a Solana keypair for devnet testing.
 *
 * WHY THIS EXISTS
 * ---------------
 * Automated protocol tests (build spec Phase 3 onward) must be able to sign a
 * real `open` transaction on devnet without a human clicking a wallet popup.
 * That requires a funded devnet keypair.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is NOT the product's user-facing wallet. In the real application the
 * payer is the customer's own wallet in their browser. This key exists only to
 * drive automated tests against devnet.
 *
 *   - devnet only, never mainnet
 *   - never used to hold anything of value
 *   - the private key is written to local-wallet/, which is gitignored
 *
 * IMPLEMENTATION NOTE
 * -------------------
 * Uses only node:crypto. No dependencies, so it runs on a machine with almost
 * no free memory and no toolchain installed. Solana keypairs are Ed25519:
 * a 32-byte seed followed by the 32-byte public key, for 64 bytes total.
 *
 * USAGE
 *   node tools/generate-devnet-keypair.mjs [name]
 *
 * The name defaults to "devnet-smoke-payer". The script refuses to overwrite
 * an existing keypair.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "local-wallet";
const name = process.argv[2] ?? "devnet-smoke-payer";

if (!/^[a-z0-9-]+$/.test(name)) {
  console.error(`Invalid name ${JSON.stringify(name)}. Use lowercase letters, digits and hyphens.`);
  process.exit(1);
}

const jsonPath = join(OUT_DIR, `${name}.json`);
const base58Path = join(OUT_DIR, `${name}.base58.txt`);

if (existsSync(jsonPath) || existsSync(base58Path)) {
  console.error(`Refusing to overwrite an existing keypair at ${jsonPath}`);
  console.error("Delete it deliberately if you really mean to replace it.");
  process.exit(1);
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 encode, Bitcoin alphabet. Leading zero bytes become leading '1's. */
function base58Encode(bytes) {
  let value = 0n;
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    encoded = ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }

  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }

  return encoded;
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

// The raw 32-byte public key is the trailing portion of the SPKI DER encoding.
const spki = publicKey.export({ type: "spki", format: "der" });
const rawPublicKey = spki.subarray(spki.length - 32);

// The raw 32-byte seed is the trailing portion of the PKCS#8 DER encoding.
const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
const rawSeed = pkcs8.subarray(pkcs8.length - 32);

if (rawPublicKey.length !== 32 || rawSeed.length !== 32) {
  console.error("Unexpected DER layout; refusing to write a keypair that may be wrong.");
  process.exit(1);
}

// Self-check: re-derive the public key from the extracted seed and confirm it
// matches. A silently mangled keypair would waste a lot of debugging time.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const rebuiltPrivateKey = createPrivateKey({
  key: Buffer.concat([ED25519_PKCS8_PREFIX, rawSeed]),
  format: "der",
  type: "pkcs8",
});
const rebuiltSpki = createPublicKey(rebuiltPrivateKey).export({ type: "spki", format: "der" });
const rebuiltPublicKey = rebuiltSpki.subarray(rebuiltSpki.length - 32);

if (!rebuiltPublicKey.equals(rawPublicKey)) {
  console.error("Self-check failed: the derived public key does not match. Nothing written.");
  process.exit(1);
}

const secretKey64 = Buffer.concat([rawSeed, rawPublicKey]);
const address = base58Encode(rawPublicKey);

mkdirSync(OUT_DIR, { recursive: true });

// Solana's conventional keypair file: a JSON array of the 64 secret key bytes.
writeFileSync(jsonPath, JSON.stringify(Array.from(secretKey64)), { mode: 0o600 });

// Base58 of the same 64 bytes, which is the form most tooling and wallets accept.
writeFileSync(base58Path, `${base58Encode(secretKey64)}\n`, { mode: 0o600 });

console.log("");
console.log("  devnet keypair created");
console.log("  ----------------------");
console.log(`  name     : ${name}`);
console.log(`  address  : ${address}`);
console.log(`  json     : ${jsonPath}`);
console.log(`  base58   : ${base58Path}`);
console.log("");
console.log("  The address above is public and safe to share.");
console.log("  The two files contain the PRIVATE KEY. They are gitignored.");
console.log("  Never commit them, never paste them into a website, never send them");
console.log("  to another person. For devnet that is only embarrassing; the same");
console.log("  mistake on mainnet is how people lose money.");
console.log("");
