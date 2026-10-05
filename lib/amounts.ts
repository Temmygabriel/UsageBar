/**
 * Amount arithmetic for UsageBar.
 *
 * Rules enforced here (build spec Section 14):
 *   - never use floating point for money;
 *   - amounts are integer atomic units at all times;
 *   - the number of decimals comes from the verified asset, never assumed.
 *
 * The decoding of Solana RPC values (which arrive as JSON numbers or strings)
 * into bigint is intentionally NOT done here. That belongs with the protocol
 * adapter, and it must be written against the verified token decimals rather
 * than a guessed constant.
 */

/** SPL Token mints store decimals as a u8. */
const DECIMALS_MIN = 0;
const DECIMALS_MAX = 255;

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < DECIMALS_MIN || decimals > DECIMALS_MAX) {
    throw new RangeError(
      `decimals must be an integer between ${DECIMALS_MIN} and ${DECIMALS_MAX}, received ${String(decimals)}`,
    );
  }
}

function pow10(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

/**
 * Render an atomic amount as an exact decimal string.
 *
 * Exact means exact: no rounding, no truncation, no locale formatting.
 * formatAtomic(50_000_000n, 6) === "50.000000"
 *
 * Display-layer code decides how many digits to show. This function never
 * silently hides precision, because hidden precision in a settlement UI is a
 * correctness bug waiting to happen.
 */
export function formatAtomic(atomic: bigint, decimals: number): string {
  assertDecimals(decimals);

  const negative = atomic < 0n;
  const magnitude = negative ? -atomic : atomic;
  const base = pow10(decimals);

  const whole = magnitude / base;
  const fraction = magnitude % base;
  const sign = negative ? "-" : "";

  if (decimals === 0) {
    return `${sign}${whole.toString()}`;
  }

  return `${sign}${whole.toString()}.${fraction.toString().padStart(decimals, "0")}`;
}

/**
 * Parse a decimal string into atomic units.
 *
 * Parsing is string-based and exact. "12.40" at 6 decimals is 12_400_000n.
 * An amount with more fractional digits than the asset supports is rejected
 * rather than silently rounded.
 */
export function parseAmount(value: string, decimals: number): bigint {
  assertDecimals(decimals);

  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) {
    throw new SyntaxError(`invalid amount: ${JSON.stringify(value)}`);
  }

  const sign = match[1];
  const whole = match[2];
  const fraction = match[3] ?? "";

  if (fraction.length > decimals) {
    throw new SyntaxError(
      `amount ${JSON.stringify(value)} has more than ${decimals} decimal places`,
    );
  }

  const base = pow10(decimals);
  const fractionValue = decimals === 0 ? 0n : BigInt(fraction.padEnd(decimals, "0"));
  const magnitude = BigInt(whole) * base + fractionValue;

  return sign === "-" ? -magnitude : magnitude;
}

/**
 * Render an atomic amount for the interface.
 *
 * The display convention is two decimal places, matching the locked visual
 * reference in build spec Section 0C. But the verified test mint has SIX
 * decimals, so two places can be a lie: a remainder of `37.600001` would read
 * as `37.60` and the tab would appear not to add up.
 *
 * The rule this function enforces: never hide a digit that is actually there.
 * If the amount is exact at two places it is shown at two; if it is not, the
 * full value is shown instead. Trailing zeros beyond the second place are
 * dropped, so `12.400000` still reads `12.40`.
 *
 * This is a display concern only. Settlement arithmetic stays in `bigint` and
 * never goes through this function.
 */
export function formatForDisplay(atomic: bigint, decimals: number): string {
  const exact = formatAtomic(atomic, decimals);

  // Whole numbers: still show two places, so a column of amounts lines up.
  const dot = exact.indexOf(".");
  if (dot === -1) return `${exact}.00`;

  const fraction = exact.slice(dot + 1);
  const beyondTwo = fraction.slice(2);

  // Exact at two places (or fewer): the common case.
  if (beyondTwo.length === 0 || /^0*$/.test(beyondTwo)) {
    return exact.slice(0, dot + 3).padEnd(dot + 3, "0");
  }

  // More precision than two places and it is not zero. Show all of it rather
  // than round, so the displayed numbers still reconcile.
  return `${exact.slice(0, dot + 3)}${beyondTwo.replace(/0+$/, "")}`;
}

/** Group the whole part in threes: `1234567.89` -> `1,234,567.89`. */
export function groupThousands(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const joined = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return negative ? `-${joined}` : joined;
}

/**
 * The full display string for an amount: exact, never rounded, then grouped.
 * `50000000n` at 6 decimals -> `50.00`.
 */
export function formatAmount(atomic: bigint, decimals: number): string {
  return groupThousands(formatForDisplay(atomic, decimals));
}

/**
 * The required reconciliation (build spec Section 14):
 *
 *   authorized === settled + unused
 */
export function reconciles(authorized: bigint, settled: bigint, unused: bigint): boolean {
  return authorized === settled + unused;
}

/**
 * INV-01 — the amount claimed can never exceed the authorized deposit.
 */
export function withinCeiling(amount: bigint, ceiling: bigint): boolean {
  return amount <= ceiling;
}

/**
 * INV-02 — cumulative vouchers may only move forward.
 *
 * Verified against the current protocol documentation on 2026-10-05:
 * `settle` advances the settled amount monotonically and rejects a
 * non-advancing voucher. So this comparison is STRICT.
 *
 * SOURCE: solana-foundation/payment-channels, docs/001-payment-channel-state-machine.md
 *
 * This is a local pre-check only. The on-chain program is the protocol
 * authority (build spec Section 21) — passing this check does not mean the
 * program will accept the voucher.
 */
export function isAdvancingVoucher(current: bigint, previous: bigint): boolean {
  return current > previous;
}
