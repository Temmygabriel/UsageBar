/**
 * What a wallet holds.
 *
 * The interface asks this before offering to open a tab, so that a wallet with
 * no funds is met with "get test funds first" rather than with a chain error
 * that says `custom program error: 0x1`. Guiding someone to the next step is
 * worth one extra round trip.
 *
 * Reading a public balance needs no secrets, but this shares the same RPC
 * configuration and the same "not configured" answer as the rest of the API, so
 * that a deployment without keys behaves consistently everywhere instead of
 * working in one place and failing in another.
 */

import { readWalletBalances } from "../../../lib/server/chain";
import { jsonError, jsonOk, withConfig } from "../../../lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const address = new URL(request.url).searchParams.get("address");

  if (address === null || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return jsonError(400, '"address" must be a valid base58 Solana address.');
  }

  return withConfig(async (config) => {
    const balances = await readWalletBalances(config, address);
    return jsonOk({
      solLamports: balances.solLamports,
      tokens: balances.tokens,
      hasTokenAccount: balances.tokens !== null,
      decimals: config.decimals,
      mint: config.mint,
    });
  });
}
