/**
 * A best-effort, in-memory rate limiter for the faucet.
 *
 * WHY THIS IS HONEST RATHER THAN SECURE
 *
 * On a serverless platform each instance holds its own memory, and instances
 * are created and destroyed freely. So this limiter is not a security boundary:
 * a determined caller can outrun it by hitting a cold instance, and the limits
 * reset on every deploy. Saying so plainly is better than a comment claiming a
 * guarantee the platform cannot provide.
 *
 * What it does buy is real: it stops the accidental cases that actually happen
 * — a double-clicked button, a page that retries on load, a curious reviewer
 * refreshing — from draining a Devnet faucet that only holds test money.
 *
 * The real protections against a drained faucet are structural and outside this
 * file: the wallet holds Devnet-only funds, has no mainnet value, and can be
 * topped up from the public faucet at any time.
 */

interface Window {
  readonly limit: number;
  readonly windowMs: number;
}

const windows = new Map<string, Window>();
const hits = new Map<string, number[]>();

/** Drop entries that can no longer affect a decision, so the maps stay small. */
function prune(now: number, windowMs: number) {
  if (hits.size < 5_000) return;
  for (const [key, times] of hits) {
    const live = times.filter((time) => now - time < windowMs);
    if (live.length === 0) hits.delete(key);
    else hits.set(key, live);
  }
  for (const [key, entry] of windows) {
    if (now - (hits.get(key)?.at(-1) ?? 0) > entry.windowMs * 10) windows.delete(key);
  }
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/**
 * Record an attempt against `key` and say whether it is allowed.
 *
 * Returns the wait time on refusal so the caller can say something useful
 * rather than a bare "too many requests".
 */
export function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): RateLimitVerdict {
  const now = Date.now();
  prune(now, windowMs);

  windows.set(key, { limit, windowMs });

  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);

  if (recent.length >= limit) {
    const oldest = recent[0];
    hits.set(key, recent);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * The caller's address, as best the platform can tell us.
 *
 * On Vercel `x-forwarded-for` is set by the edge and can be trusted there; in
 * local development it is absent and every request shares one bucket, which is
 * the right behaviour for a developer testing their own button.
 */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.trim() !== "") {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip")?.trim() || "local";
}
