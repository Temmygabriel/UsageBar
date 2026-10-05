/**
 * Shared shapes for the chain API.
 *
 * Every bigint crosses the wire as a decimal STRING, never as a number.
 * JavaScript numbers lose precision above 2^53, and a silently rounded token
 * amount is exactly the kind of wrong this project exists to avoid — the whole
 * display layer in `lib/amounts.ts` is built around never rounding money away.
 * A string is parsed back to a bigint at the edge, so no value is ever a float.
 */

import { loadServerConfig, type ServerConfig } from "./env";

export function jsonError(status: number, message: string): Response {
  return Response.json({ ok: false, error: message }, { status });
}

export function jsonOk(payload: Record<string, unknown>): Response {
  return Response.json({ ok: true, ...payload });
}

/**
 * Run a handler with a loaded configuration, or answer 503 with the reason.
 *
 * The unconfigured case is deliberately not an error the interface has to guess
 * at: it returns a specific status and a sentence explaining what is missing,
 * so the tab can say "the chain adapter is not configured" instead of showing a
 * generic failure or, far worse, showing a plausible number it invented.
 */
export async function withConfig(
  handler: (config: ServerConfig) => Promise<Response>,
): Promise<Response> {
  let loaded;
  try {
    loaded = loadServerConfig();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : String(error));
  }

  if (!loaded.ok) {
    return jsonError(503, loaded.reason);
  }

  try {
    return await handler(loaded.config);
  } catch (error) {
    return jsonError(502, error instanceof Error ? error.message : String(error));
  }
}

/** Read a JSON body, refusing anything that is not a plain object. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new Error("The request body was not valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/** A required, non-empty string field. */
export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`"${field}" is required and must be a non-empty string.`);
  }
  return value.trim();
}

/** An optional positive number field, defaulted. */
export function optionalPositiveNumber(
  body: Record<string, unknown>,
  field: string,
  fallback: number,
): number {
  const value = body[field];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`"${field}" must be a positive number.`);
  }
  return value;
}

/**
 * A base58 Solana address, checked before it reaches the chain.
 *
 * The length check is the useful part: `address()` throws a genuinely
 * confusing message for a bad string (`Expected base58-encoded address string
 * of length in the range [32, 44]`), and this turns the common case — a wallet
 * passing `undefined` — into a sentence that names the problem.
 */
export function requireAddress(body: Record<string, unknown>, field: string): string {
  const value = requireString(body, field);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    throw new Error(`"${field}" is not a valid base58 Solana address.`);
  }
  return value;
}
