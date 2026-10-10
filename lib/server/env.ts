/**
 * Server configuration and secret handling for the Devnet chain adapter.
 *
 * NODE ONLY. Nothing in this file may be imported from a client component: it
 * reads private keys out of the environment. Next.js will not inline a
 * non-`NEXT_PUBLIC_` variable into a client bundle, but the real protection is
 * that no client module imports this file at all — see `lib/wallet.ts`, which
 * is the only module the browser uses and which holds no secrets.
 *
 * WHY THE KEYS LIVE ON THE SERVER
 *
 * A payment channel has three keys, and they are not interchangeable:
 *
 *   payer              the customer. Holds their own key in their own wallet.
 *                      This is the whole point of the product, and for the demo
 *                      this is the judge's Phantom.
 *   payee              the service provider. Also co-signs the close, because
 *                      `settleAndSeal` is a cooperative close and requires it.
 *   authorized_signer  signs usage vouchers off-chain.
 *
 * The last two belong to the service, so they live here as environment
 * variables and are never sent to a browser. For this demo the provider is one
 * key doing both jobs: the same key signs the meter and receives the money.
 * That is a simplification, not a requirement — the protocol keeps the two
 * roles separate, and a real provider would separate them.
 *
 * FAILURE MODE
 *
 * If the secrets are absent — a fresh deploy, or a reviewer who cloned the repo
 * — this returns a reason rather than throwing, so the API can answer 503 with
 * an explanation and the interface can say plainly that the chain adapter is
 * unconfigured. A crash with a stack trace would be a worse answer than an
 * honest "not set up yet".
 */

import { getAddressDecoder } from "@solana/kit";

import {
  DEVNET_TREASURY_OWNER,
  decodeSecretKey,
  envOr,
} from "../../tools/lib/protocol.mjs";

/** The verified test mint created for this project. See docs/ASSET_PROVENANCE.md. */
const DEFAULT_TEST_MINT = "6Jpyq8iUszZdZd2z3G9is1nfJh7ZwqbekW9cH2w58hmL";

/** 50 TEST, matching the ceiling the interface proposes. */
const DEFAULT_CEILING = 50_000_000n;

/** One TEST per successfully completed AI contract-review request. */
const DEFAULT_RATE_PER_REQUEST = 1_000_000n;

/**
 * 50,000,000 lamports = 0.05 SOL per faucet call.
 *
 * Sized against what opening a tab actually costs, not guessed: the channel
 * account is 256 bytes and the channel's token account is 165, so the two rents
 * together are a little under 0.003 SOL, and transaction fees on Devnet are
 * 5,000 lamports each. 0.05 SOL covers roughly ten opens with room to spare.
 */
const DEFAULT_SOL_PER_WALLET = 50_000_000n;

/** 100 TEST per faucet call — two full tabs' worth. */
const DEFAULT_TOKENS_PER_WALLET = 100_000_000n;

const DEFAULT_DECIMALS = 6;

export interface ServerConfig {
  readonly rpcUrl: string;
  readonly wsUrl: string;
  readonly mint: string;
  readonly treasuryOwner: string;
  readonly decimals: number;
  readonly ceilingAtomic: bigint;
  readonly rateAtomicPerRequest: bigint;
  readonly gracePeriodSeconds: number;
  readonly solPerWallet: bigint;
  readonly tokensPerWallet: bigint;
  /** The funder: pays fees for server-submitted transactions and stocks the faucet. */
  readonly payerSecretKey: Uint8Array;
  /** The service provider: signs usage vouchers and co-signs the close. */
  readonly operatorSecretKey: Uint8Array;
  /** The provider's own token account owner, derived from the key above. */
  readonly payeeAddress: string;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: ServerConfig }
  | { readonly ok: false; readonly reason: string };

function positiveBigInt(name: string, fallback: bigint): bigint {
  const raw = envOr(name, "");
  if (raw === "") return fallback;
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    throw new Error(`${name} is "${raw}", which is not an integer.`);
  }
  if (value <= 0n) throw new Error(`${name} must be positive, got ${value}.`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = envOr(name, "");
  if (raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}".`);
  }
  return value;
}

/**
 * Load and validate the configuration.
 *
 * Returns a result rather than throwing so callers can render an honest
 * "unconfigured" state. Genuine misconfiguration (a key that is present but
 * the wrong length, a rate that is not a number) still throws, because that is
 * a bug worth surfacing loudly rather than degrading around.
 */
export function loadServerConfig(): ConfigResult {
  const missing: string[] = [];

  if (envOr("DEVNET_PAYER_KEYPAIR", "") === "") missing.push("DEVNET_PAYER_KEYPAIR");
  if (envOr("DEVNET_OPERATOR_KEYPAIR", "") === "") missing.push("DEVNET_OPERATOR_KEYPAIR");

  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `The chain adapter is not configured: ${missing.join(" and ")} ` +
        `${missing.length === 1 ? "is" : "are"} not set in this environment. ` +
        "These are Devnet keypairs held as server-side environment variables; they are never " +
        "sent to a browser. Until they are set the interface can describe the product but " +
        "cannot touch the chain.",
    };
  }

  const payerSecretKey = decodeSecretKey("DEVNET_PAYER_KEYPAIR");
  const operatorSecretKey = decodeSecretKey("DEVNET_OPERATOR_KEYPAIR");

  // A Solana secret key is seed(32) || publicKey(32), so the address is the
  // trailing half. Reading it directly avoids depending on whether the
  // generated CryptoKey happens to be extractable — the same technique the
  // proven tooling uses.
  const payeeAddress = getAddressDecoder().decode(operatorSecretKey.subarray(32, 64));

  return {
    ok: true,
    config: {
      rpcUrl: envOr("DEVNET_RPC_URL", "https://api.devnet.solana.com"),
      wsUrl: envOr("DEVNET_WS_URL", "wss://api.devnet.solana.com"),
      mint: envOr("TEST_MINT", DEFAULT_TEST_MINT),
      treasuryOwner: envOr("TREASURY_OWNER", DEVNET_TREASURY_OWNER),
      decimals: positiveInteger("TEST_MINT_DECIMALS", DEFAULT_DECIMALS),
      ceilingAtomic: positiveBigInt("USAGEBAR_CEILING", DEFAULT_CEILING),
      rateAtomicPerRequest: positiveBigInt("USAGEBAR_RATE_PER_REQUEST", DEFAULT_RATE_PER_REQUEST),
      gracePeriodSeconds: positiveInteger("USAGEBAR_GRACE_PERIOD", 60),
      solPerWallet: positiveBigInt("USAGEBAR_SOL_PER_WALLET", DEFAULT_SOL_PER_WALLET),
      tokensPerWallet: positiveBigInt("USAGEBAR_TOKENS_PER_WALLET", DEFAULT_TOKENS_PER_WALLET),
      payerSecretKey,
      operatorSecretKey,
      payeeAddress,
    },
  };
}
