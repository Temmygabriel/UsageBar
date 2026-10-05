#!/usr/bin/env node
/**
 * Create the UsageBar devnet test token (asset decision "Option A").
 *
 * WHY A PURPOSE-BUILT MINT
 * ------------------------
 * The demo needs a token whose supply we control completely, so the same test
 * produces the same numbers every time. Devnet USDC cannot do that: Circle's
 * faucet gives 20 units per two hours, which cannot fund a 50-unit ceiling in
 * a single claim, and the balance drifts between runs because anyone can spend
 * it. A mint we own makes the run reproducible.
 *
 * The token is a TEST token and is labelled as one everywhere it appears. It is
 * never presented as USDC or as anything with value.
 *
 * WHAT IT DOES
 * ------------
 *   1. Creates an SPL Token mint at the address derived from
 *      DEVNET_TEST_MINT_KEYPAIR, with 6 decimals.
 *   2. Creates the payer's associated token account for it.
 *   3. Mints the test supply into that account.
 *   4. Reads the mint back from the chain and prints what the chain says.
 *
 * It is idempotent: if the mint already exists it reports that and changes
 * nothing, so re-running it is safe.
 *
 * SECRETS
 * -------
 * Reads DEVNET_PAYER_KEYPAIR and DEVNET_TEST_MINT_KEYPAIR from the environment.
 * Both are devnet-only keys that hold nothing of value. Neither is ever printed
 * or included in any error message.
 */

import {
  appendTransactionMessageInstructions,
  createKeyPairFromBytes,
  createSignerFromKeyPair,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { getCreateAccountInstruction } from "@solana-program/system";

const RPC_URL = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = process.env.DEVNET_WS_URL ?? "wss://api.devnet.solana.com";

const DECIMALS = 6;
/** 82 bytes is the size of a classic SPL Token mint account. */
const MINT_ACCOUNT_SIZE = 82n;
/** Whole tokens to mint. Large enough that a test can never exhaust it. */
const MINT_WHOLE_TOKENS = 1_000_000n;

// ---------------------------------------------------------------------------
// Key handling
// ---------------------------------------------------------------------------

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_INDEX = new Map([...ALPHABET].map((character, index) => [character, index]));

function base58Decode(text) {
  let value = 0n;
  for (const character of text) {
    const index = ALPHABET_INDEX.get(character);
    if (index === undefined) {
      throw new Error(`Invalid base58 character ${JSON.stringify(character)}`);
    }
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
 * Accept either format, so a key pasted from a wallet and a key written by
 * tools/generate-devnet-keypair.mjs both work.
 */
function decodeSecretKey(variableName) {
  const raw = process.env[variableName];
  if (!raw || raw.trim() === "") {
    throw new Error(`${variableName} is not set. Add it as a repository secret.`);
  }

  const trimmed = raw.trim();
  const bytes = trimmed.startsWith("[")
    ? new Uint8Array(JSON.parse(trimmed))
    : base58Decode(trimmed);

  if (bytes.length !== 64) {
    throw new Error(
      `${variableName} decoded to ${bytes.length} bytes, but a Solana secret key is 64. ` +
        "Check that the whole value was copied.",
    );
  }

  return bytes;
}

async function signerFrom(variableName) {
  const keyPair = await createKeyPairFromBytes(decodeSecretKey(variableName));
  return await createSignerFromKeyPair(keyPair);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);

const payer = await signerFrom("DEVNET_PAYER_KEYPAIR");
const mintSigner = await signerFrom("DEVNET_TEST_MINT_KEYPAIR");
const mintAddress = mintSigner.address;

console.log("");
console.log(`  cluster     : ${RPC_URL}`);
console.log(`  payer       : ${payer.address}`);
console.log(`  test mint   : ${mintAddress}`);
console.log("");

const existing = await rpc.getAccountInfo(mintAddress, { encoding: "jsonParsed" }).send();

if (existing.value !== null) {
  console.log("  The mint already exists. Nothing was changed.");
  console.log(`  Owner program : ${existing.value.owner}`);
  console.log(`  Data          : ${JSON.stringify(existing.value.data)}`);
  console.log("");
  console.log("  Re-running this script is safe; it will not create a second mint.");
  console.log("");
  process.exit(0);
}

console.log("  Mint does not exist yet. Creating it.");
console.log("");

const [payerTokenAccount] = await findAssociatedTokenPda({
  owner: payer.address,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
  mint: mintAddress,
});

const lamports = await rpc.getMinimumBalanceForRentExemption(MINT_ACCOUNT_SIZE).send();

const instructions = [
  getCreateAccountInstruction({
    payer,
    newAccount: mintSigner,
    lamports,
    space: MINT_ACCOUNT_SIZE,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  }),
  getInitializeMint2Instruction({
    mint: mintAddress,
    decimals: DECIMALS,
    mintAuthority: payer.address,
    freezeAuthority: null,
  }),
  await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer,
    owner: payer.address,
    mint: mintAddress,
  }),
  getMintToInstruction({
    mint: mintAddress,
    token: payerTokenAccount,
    mintAuthority: payer,
    amount: MINT_WHOLE_TOKENS * 10n ** BigInt(DECIMALS),
  }),
];

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

const message = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayerSigner(payer, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
  (m) => appendTransactionMessageInstructions(instructions, m),
);

const signedTransaction = await signTransactionMessageWithSigners(message);
const signature = getSignatureFromTransaction(signedTransaction);

console.log(`  Sending transaction ${signature}`);
console.log("  Waiting for confirmation...");

await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signedTransaction, {
  commitment: "confirmed",
});

console.log("  Confirmed.");
console.log("");

// ---------------------------------------------------------------------------
// Read it back. The chain, not this script, is the source of truth.
// ---------------------------------------------------------------------------

const readback = await rpc.getAccountInfo(mintAddress, { encoding: "jsonParsed" }).send();

if (readback.value === null) {
  throw new Error("The transaction confirmed but the mint is not readable. Do not trust this run.");
}

const parsed = readback.value.data;

console.log("  WHAT THE CHAIN SAYS");
console.log("  -------------------");
console.log(`  mint address  : ${mintAddress}`);
console.log(`  owner program : ${readback.value.owner}`);
console.log(`  lamports      : ${readback.value.lamports}`);
console.log(`  parsed data   : ${JSON.stringify(parsed?.parsed?.info ?? parsed, null, 2)}`);
console.log("");
console.log(`  payer balance of TEST: ${JSON.stringify(
  (await rpc.getTokenAccountBalance(payerTokenAccount).send()).value,
)}`);
console.log("");
console.log(`  explorer: https://explorer.solana.com/address/${mintAddress}?cluster=devnet`);
console.log(`  tx      : https://explorer.solana.com/tx/${signature}?cluster=devnet`);
console.log("");
