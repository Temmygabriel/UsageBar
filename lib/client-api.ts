/**
 * Typed access to the chain API, for the browser.
 *
 * Every amount crossing this boundary is a decimal STRING and is parsed to a
 * bigint here, at the edge. Nothing in the interface ever holds a token amount
 * as a JavaScript number, because numbers lose precision above 2^53 and a
 * rounded token amount is a wrong balance — see the file header in `lib/amounts.ts`.
 *
 * The `unconfigured` flag is the important one. A deployment without the Devnet
 * keys is a legitimate state, not a crash, and it gets its own status so the
 * interface can say precisely what is missing instead of showing a generic
 * error or — far worse — a plausible number it made up.
 */

import type { ChannelFacts } from "./session";

/** What the server is willing to say about the deployment. All of it is public. */
export interface ServiceDescription {
  readonly programId: string;
  readonly mint: string;
  readonly decimals: number;
  readonly treasuryOwner: string;
  readonly ceilingAtomic: string;
  readonly rateAtomicPerRequest: string;
  readonly gracePeriodSeconds: number;
  readonly groqConfigured: boolean;
}

/** A channel account as the server read it. Amounts are decimal strings. */
export interface SessionChannel {
  readonly address: string;
  readonly payer: string;
  readonly payee: string;
  readonly authorizedSigner: string;
  readonly mint: string;
  readonly deposit: string;
  readonly settled: string;
  readonly payoutWatermark: string;
  readonly status: number;
  readonly statusName?: string;
  readonly openSlot: string;
  readonly salt: string;
  readonly bytes?: number;
}

export class ApiError extends Error {
  readonly status: number;
  /** True when the deployment is missing its Devnet keys, rather than broken. */
  readonly unconfigured: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.unconfigured = status === 503;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    throw new ApiError(
      `Could not reach the server (${error instanceof Error ? error.message : String(error)}). ` +
        "Check the connection and try again.",
      0,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      `The server answered with ${response.status} and a body that was not JSON.`,
      response.status,
    );
  }

  const body = payload as { ok?: boolean; error?: string } & Record<string, unknown>;

  if (response.ok && body.ok === true) {
    return body as T;
  }

  throw new ApiError(
    typeof body.error === "string" ? body.error : `The request failed (${response.status}).`,
    response.status,
  );
}

/**
 * Turn a channel from the wire into the facts the interface displays.
 *
 * `decimals` is passed in rather than assumed. The mint's precision is a
 * property of the token, read from the service description the server sends,
 * and hard-coding six here would be exactly the kind of quiet assumption that
 * makes a payment interface wrong about money the day the mint changes.
 */
export function toChannelFacts(
  channel: SessionChannel,
  openTransaction: string,
  decimals: number,
): ChannelFacts {
  return {
    address: channel.address,
    openTransaction,
    deposit: BigInt(channel.deposit),
    settled: BigInt(channel.settled),
    decimals,
    mint: channel.mint,
  };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export interface SessionRead {
  readonly service: ServiceDescription;
  readonly channel: (SessionChannel & { statusName: string }) | null;
  /** True when the server looked and found nothing — a finished tab, not an error. */
  readonly closed?: boolean;
}

export function readSession(channel?: string): Promise<SessionRead> {
  const query = channel === undefined ? "" : `?channel=${encodeURIComponent(channel)}`;
  return call<SessionRead>(`/api/session${query}`, { cache: "no-store" });
}

export interface OpenResponse {
  readonly service: ServiceDescription;
  readonly transaction: string;
  readonly channel: string;
  readonly openSlot: string;
  readonly salt: string;
  readonly ceilingAtomic: string;
}

export function buildOpenTransaction(address:string,ceilingAtomic:string):Promise<OpenResponse>{return call<OpenResponse>("/api/session",{method:"POST",body:JSON.stringify({action:"open",address,ceilingAtomic})});}

export interface UsageResponse
}

export interface ExtractionResult{readonly documentType:string;readonly summary:string;readonly parties:string[];readonly dates:string[];readonly monetaryTerms:string[];readonly clauses:string[];readonly risks:string[];readonly missingDetails:string[];readonly disclaimer:string;}
export interface UsageResponse{readonly advanced:boolean;readonly cumulative:string;readonly voucherSignature:string|null;readonly reason:string|null;readonly extraction:ExtractionResult|null;readonly service:ServiceDescription;}
export function runMeteredExtraction(channel:string,previousCumulativeAtomic:string,previousVoucherSignature:string|null,documentText:string):Promise<UsageResponse>{return call<UsageResponse>("/api/session",{method:"POST",body:JSON.stringify({action:"usage",channel,previousCumulativeAtomic,previousVoucherSignature,documentText})});}

export interface CloseResponse {
  readonly sealSignature: string;
  readonly distributeSignature: string;
  readonly deposit: string;
  readonly settled: string;
  readonly paidToProvider: string;
  readonly returnedToPayer: string;
  readonly channelAccountClosed: boolean;
  readonly service: ServiceDescription;
}

export function closeSession(channel:string,cumulativeAtomic:string,voucherSignature:string|null):Promise<CloseResponse>{return call<CloseResponse>("/api/session",{method:"POST",body:JSON.stringify({action:"close",channel,cumulativeAtomic,voucherSignature})});}

export interface FaucetResponse {
  readonly solSignature: string;
  readonly tokenSignature: string;
  readonly solLamports: string;
  readonly tokenAmount: string;
  readonly decimals: number;
  readonly mint: string;
}

export function requestFaucet(address: string): Promise<FaucetResponse> {
  return call<FaucetResponse>("/api/faucet", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export interface WalletBalances {
  readonly solLamports: string;
  /** Null means the wallet has no token account at all — different from zero. */
  readonly tokens: string | null;
  readonly hasTokenAccount: boolean;
  readonly decimals: number;
  readonly mint: string;
}

export function readWalletBalances(address: string): Promise<WalletBalances> {
  return call<WalletBalances>(`/api/wallet?address=${encodeURIComponent(address)}`, {
    cache: "no-store",
  });
}
