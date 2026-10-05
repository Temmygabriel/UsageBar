/**
 * The faucet.
 *
 * A judge should not have to find a Devnet faucet, wait for an airdrop, create a
 * token account and acquire a custom mint before they can see the product work.
 * This route does all four in one call, so the demo starts with a click.
 *
 * WHAT IT HANDS OUT, AND WHY IT IS SAFE TO HAND OUT
 *
 * Devnet SOL and a test token that exists only on Devnet. Neither has any value
 * and neither can be bridged. The worst outcome of abuse is that a test wallet
 * needs topping up from the public faucet, which is a two-minute fix — a very
 * different risk from a mainnet endpoint, and the reason this is acceptable to
 * expose without authentication.
 *
 * It is rate limited in memory. See `lib/server/rate-limit.ts` for exactly how
 * much that is and is not worth.
 */

import { fundWallet } from "../../../lib/server/chain";
import { jsonError, jsonOk, readJsonBody, requireAddress, withConfig } from "../../../lib/server/http";
import { callerKey, checkRateLimit } from "../../../lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Two wallets per caller per hour is a demo's worth and no more. */
const PER_CALLER = { limit: 2, windowMs: 60 * 60 * 1000 };
/** The same wallet may be topped up twice a day; more than that is a loop. */
const PER_WALLET = { limit: 2, windowMs: 12 * 60 * 60 * 1000 };

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : String(error));
  }

  let recipient: string;
  try {
    recipient = requireAddress(body, "address");
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : String(error));
  }

  const caller = checkRateLimit(`caller:${callerKey(request)}`, PER_CALLER);
  if (!caller.allowed) {
    return jsonError(
      429,
      `This browser has already been funded recently. Try again in about ` +
        `${Math.ceil(caller.retryAfterSeconds / 60)} minute(s), or open a tab with the funds ` +
        "you already have.",
    );
  }

  const wallet = checkRateLimit(`wallet:${recipient}`, PER_WALLET);
  if (!wallet.allowed) {
    return jsonError(
      429,
      "This wallet has already been funded recently. It should still hold enough test funds " +
        "to open a tab.",
    );
  }

  return withConfig(async (config) => {
    const result = await fundWallet(config, recipient);
    return jsonOk({
      solSignature: result.solSignature,
      tokenSignature: result.tokenSignature,
      solLamports: result.solLamports,
      tokenAmount: result.tokenAmount,
      decimals: config.decimals,
      mint: config.mint,
    });
  });
}
