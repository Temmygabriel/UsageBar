/**
 * Durable, provider-side state for off-chain usage vouchers.
 *
 * Vercel functions are stateless. Keeping the latest voucher only in the browser
 * would let a customer refresh, edit localStorage, or submit an older voucher at
 * close. This store keeps only the cumulative amount, its provider signature,
 * and a request count — never contract text or AI output.
 *
 * Uses Upstash Redis over its REST API, so no TCP connection pool or package is
 * required in a serverless function. Free-tier limits still apply.
 */

export interface MeterUsageState {
  readonly cumulative: string;
  readonly voucherSignature: string | null;
  readonly count: number;
}

export interface MeterUsageSnapshot {
  readonly state: MeterUsageState;
  /** The exact Redis value read, used as the compare-and-set revision. */
  readonly raw: string | null;
}

export function isMeterStoreConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim());
}

function redisUrl(): string {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  if (!url) throw new Error("Meter storage is not configured. Add UPSTASH_REDIS_REST_URL in Vercel.");
  return url.replace(/\/+$/, "");
}

function redisToken(): string {
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!token) throw new Error("Meter storage is not configured. Add UPSTASH_REDIS_REST_TOKEN in Vercel.");
  return token;
}

function keyFor(channelAddress: string): string {
  return `usagebar:meter:v1:${channelAddress}`;
}

async function redisCommand(command: string[]): Promise<unknown> {
  const response = await fetch(redisUrl(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${redisToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Meter storage returned HTTP ${response.status} with a non-JSON response.`);
  }

  if (!response.ok) throw new Error(`Meter storage returned HTTP ${response.status}.`);
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const detail = (payload as { error?: unknown }).error;
    throw new Error(`Meter storage rejected a command: ${typeof detail === "string" ? detail.slice(0, 180) : "unknown error"}.`);
  }
  if (typeof payload !== "object" || payload === null || !("result" in payload)) {
    throw new Error("Meter storage returned an unexpected response.");
  }
  return (payload as { result: unknown }).result;
}

function parseStoredState(raw: string): MeterUsageState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The stored meter record is invalid JSON. Refusing to issue or settle a voucher.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("The stored meter record is invalid. Refusing to issue or settle a voucher.");
  }
  const value = parsed as Record<string, unknown>;
  if (typeof value.cumulative !== "string" || !/^\d+$/.test(value.cumulative)) {
    throw new Error("The stored cumulative amount is invalid. Refusing to issue or settle a voucher.");
  }
  if (value.voucherSignature !== null && (typeof value.voucherSignature !== "string" || !/^[0-9a-f]{128}$/i.test(value.voucherSignature))) {
    throw new Error("The stored voucher signature is invalid. Refusing to issue or settle a voucher.");
  }
  if (typeof value.count !== "number" || !Number.isSafeInteger(value.count) || value.count < 0) {
    throw new Error("The stored usage count is invalid. Refusing to issue or settle a voucher.");
  }
  return {
    cumulative: value.cumulative,
    voucherSignature: value.voucherSignature,
    count: value.count,
  };
}

/**
 * Read the latest provider-held usage. If this channel has never produced an
 * off-chain voucher, its on-chain watermark is the only valid starting point.
 */
export async function readMeterUsageState(
  channelAddress: string,
  onChainCumulative: string,
): Promise<MeterUsageSnapshot> {
  if (!isMeterStoreConfigured()) {
    throw new Error("The off-chain meter store is not configured. Add both Upstash Redis REST environment variables in Vercel.");
  }
  const rawValue = await redisCommand(["GET", keyFor(channelAddress)]);
  if (rawValue === null) {
    if (!/^\d+$/.test(onChainCumulative)) throw new Error("The on-chain watermark is invalid.");
    return {
      state: { cumulative: onChainCumulative, voucherSignature: null, count: 0 },
      raw: null,
    };
  }
  if (typeof rawValue !== "string") throw new Error("Meter storage returned a non-string record.");
  const state = parseStoredState(rawValue);
  const stored = BigInt(state.cumulative);
  const onChain = BigInt(onChainCumulative);
  if (stored < onChain) {
    throw new Error("The provider-held voucher is older than the on-chain watermark. Refusing to meter or settle stale state.");
  }
  return { state, raw: rawValue };
}

/**
 * Atomically advance only if the state is still exactly what the caller read.
 * This prevents two concurrent review requests from issuing equal or stale
 * cumulative vouchers. Redis Lua scripts are supported by the Upstash REST API.
 */
export async function compareAndSetMeterUsageState(
  channelAddress: string,
  expectedRaw: string | null,
  nextState: MeterUsageState,
): Promise<boolean> {
  if (!isMeterStoreConfigured()) {
    throw new Error("The off-chain meter store is not configured. Add both Upstash Redis REST environment variables in Vercel.");
  }
  const script = [
    "local current = redis.call('GET', KEYS[1])",
    "local expected = ARGV[1]",
    "if expected == '__USAGEBAR_MISSING__' then",
    "  if current then return 0 end",
    "else",
    "  if current ~= expected then return 0 end",
    "end",
    "redis.call('SET', KEYS[1], ARGV[2])",
    "return 1",
  ].join("\n");
  const result = await redisCommand([
    "EVAL",
    script,
    "1",
    keyFor(channelAddress),
    expectedRaw ?? "__USAGEBAR_MISSING__",
    JSON.stringify(nextState),
  ]);
  return result === 1 || result === "1";
}
