/**
 * The session endpoint: everything the interface needs to drive a tab.
 *
 * One route with an `action` discriminator rather than four routes, because all
 * four actions share the same preconditions — a configured adapter, a valid
 * address, a channel that is in a state where the action means anything. Putting
 * them together means those checks exist once, and the "not configured" answer is
 * identical everywhere instead of being re-invented per file.
 *
 *   GET  ?channel=<address>   read the chain, and describe the service
 *   GET                       describe the service only
 *   POST { action: "open" }   build an unsigned open transaction for a wallet
 *   POST { action: "usage" }  advance the meter by a signed voucher
 *   POST { action: "close" }  seal the channel and pay everyone out
 *
 * Nothing here returns a number it has not read back from chain.
 */

import { buildOpenTransaction, closeChannel, commitUsage, readChannel } from "../../../lib/server/chain";
import type { DecodedChannel } from "../../../lib/server/chain";
import type { ServerConfig } from "../../../lib/server/env";
import {
  jsonError,
  jsonOk,
  readJsonBody,
  requireAddress,
  requireString,
  withConfig,
} from "../../../lib/server/http";
import { PAYMENT_CHANNELS_PROGRAM } from "../../../tools/lib/protocol.mjs";
import { extractContractTerms, isGeminiConfigured } from "../../../lib/metered-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the interface is allowed to know about the deployment. All of it is
 * public: addresses that already appear on chain, and the two pricing numbers
 * the tab displays. No key material is in here, and nothing in this object is
 * secret.
 */
function describeService(config: ServerConfig) {
  return {
    programId: PAYMENT_CHANNELS_PROGRAM,
    mint: config.mint,
    decimals: config.decimals,
    treasuryOwner: config.treasuryOwner,
    ceilingAtomic: config.ceilingAtomic.toString(),
    rateAtomicPerRequest: config.rateAtomicPerRequest.toString(),
    aiConfigured: isGeminiConfigured(),
    gracePeriodSeconds: config.gracePeriodSeconds,
  };
}

/** A channel account as the interface sees it. Bigints travel as strings. */
function describeChannel(channel: DecodedChannel) {
  return {
    payer: channel.payer,
    payee: channel.payee,
    authorizedSigner: channel.authorizedSigner,
    mint: channel.mint,
    deposit: channel.deposit.toString(),
    settled: channel.settled.toString(),
    payoutWatermark: channel.payoutWatermark.toString(),
    status: channel.status,
    openSlot: channel.openSlot.toString(),
    salt: channel.salt.toString(),
  };
}

const STATUS_NAMES = ["Open", "Sealed", "Closing", "Distributed"];

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const channelParam = url.searchParams.get("channel");

  return withConfig(async (config) => {
    if (channelParam === null || channelParam.trim() === "") {
      return jsonOk({ service: describeService(config), channel: null });
    }

    const channelAddress = channelParam.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(channelAddress)) {
      return jsonError(400, '"channel" is not a valid base58 Solana address.');
    }

    const read = await readChannel(config, channelAddress);
    if (read === null) {
      // A closed channel is a normal end state, not a failure: `distribute`
      // deallocates the account entirely on a full close. Saying "not found"
      // plainly is more honest than an error, and the interface can tell the
      // difference between "never existed" and "already finished" because it
      // knows whether it opened one.
      return jsonOk({ service: describeService(config), channel: null, closed: true });
    }

    return jsonOk({
      service: describeService(config),
      channel: {
        ...describeChannel(read.channel),
        address: channelAddress,
        statusName: STATUS_NAMES[read.channel.status] ?? "Unknown",
        bytes: read.bytes,
      },
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : String(error));
  }

  let action: string;
  try {
    action = requireString(body, "action");
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : String(error));
  }

  // Validate the request's addresses before loading configuration, so a
  // malformed request is a 400 even on a deployment that has no keys — the two
  // failures are unrelated and should not be reported as each other. The
  // alternative, letting `requireString` throw inside the handler below, would
  // report a client error as a 502 "the server is broken".
  let address: string | null = null;
  let channel: string | null = null;
  try {
    if (action === "open") {
      address = requireAddress(body, "address");
    } else if (action === "usage" || action === "close") {
      channel = requireString(body, "channel");
    }
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : String(error));
  }

  return withConfig(async (config) => {
    switch (action) {
      case "open": {
        if (address === null) {
          return jsonError(400, '"address" is required to open a tab.');
        }
        const requestedCeiling = typeof body.ceilingAtomic === "string" && /^\d+$/.test(body.ceilingAtomic) ? BigInt(body.ceilingAtomic) : config.ceilingAtomic;
        const built = await buildOpenTransaction(config, address, requestedCeiling);
        return jsonOk({
          service: describeService(config),
          // Unsigned, and the payer is the wallet that will sign it.
          transaction: built.transaction,
          channel: built.channel,
          openSlot: built.openSlot,
          salt: built.salt,
          ceilingAtomic: config.ceilingAtomic.toString(),
        });
      }

      case "usage": {
        if (channel === null) {
          return jsonError(400, '"channel" is required to meter usage.');
        }
        const previous = typeof body.previousCumulativeAtomic === "string" && /^\d+$/.test(body.previousCumulativeAtomic) ? body.previousCumulativeAtomic : "0";
        const previousSignature = typeof body.previousVoucherSignature === "string" && body.previousVoucherSignature.length > 0 ? body.previousVoucherSignature : null;
        const documentText = requireString(body, "documentText");
        const result = await commitUsage(config, channel, previous, previousSignature);
        const extraction = await extractContractTerms(documentText);
        return jsonOk({ ...result, extraction, service: describeService(config) });
      }

      case "close": {
        if (channel === null) {
          return jsonError(400, '"channel" is required to close a tab.');
        }
        const cumulative = typeof body.cumulativeAtomic === "string" && /^\d+$/.test(body.cumulativeAtomic) ? body.cumulativeAtomic : "0";
        const voucherSignature = typeof body.voucherSignature === "string" && body.voucherSignature.length > 0 ? body.voucherSignature : null;
        const result = await closeChannel(config, channel, cumulative, voucherSignature);
        return jsonOk({
          sealSignature: result.sealSignature,
          distributeSignature: result.distributeSignature,
          deposit: result.deposit,
          settled: result.settled,
          paidToProvider: result.paidToProvider,
          returnedToPayer: result.returnedToPayer,
          channelAccountClosed: result.channelAccountClosed,
          service: describeService(config),
        });
      }

      default:
        return jsonError(
          400,
          `Unknown action "${action}". Expected one of: open, usage, close.`,
        );
    }
  });
}
