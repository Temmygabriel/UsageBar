/**
 * The UsageBar product state machine (build spec Section 12).
 *
 * This module is deliberately free of any Solana or React import. It holds the
 * rules that decide what the interface is allowed to claim, and those rules are
 * worth being able to unit-test without a network or a browser.
 *
 * The governing rule, from build spec Section 21 and the project README: the
 * protocol is the source of truth. A product state here is a *reading* of
 * verified chain state, never an optimistic guess. In particular nothing may
 * report SETTLED until a readback proves it — Section 12 says of FINALIZING,
 * "No final result is shown until chain state is read back."
 */

/**
 * The six product states, in the order they occur. Section 12 defines a linear
 * machine; the app compresses the protocol's longer lifecycle (Open -> Sealed /
 * Closing -> Distributed -> Reclaim, Section 13) into these, which is
 * explicitly permitted, provided every displayed final state is derived from
 * actual protocol state.
 */
export const PRODUCT_STATES = [
  "READY",
  "OPENING",
  "FUNDED",
  "ACTIVE",
  "FINALIZING",
  "SETTLED",
] as const;

export type ProductState = (typeof PRODUCT_STATES)[number];

/**
 * Where a displayed number came from.
 *
 * This exists because the interface has two genuinely different kinds of
 * number, and conflating them is how a payment UI ends up lying:
 *
 *   PROPOSED — the ceiling the user is about to commit. A configuration value.
 *              Nothing has been spent, nothing is on chain.
 *   ON_CHAIN — read back from the channel account. Provable, linkable.
 *
 * The tab renders them differently and never lets a PROPOSED value wear the
 * verified treatment.
 */
export type ValueProvenance = "PROPOSED" | "ON_CHAIN";

/**
 * The facts a channel must supply before the interface may claim anything
 * about money. Every field is required: a partial channel is not displayable,
 * because a half-known tab is worse than an empty one.
 */
export interface ChannelFacts {
  /** The channel PDA. Base58. */
  readonly address: string;
  /** The signature of the `open` transaction. */
  readonly openTransaction: string;
  /** The deposit, in atomic units. This is the ceiling. */
  readonly deposit: bigint;
  /** The settled watermark, in atomic units, as last read from chain. */
  readonly settled: bigint;
  /** Decimals of the verified mint. Never assumed — see lib/amounts.ts. */
  readonly decimals: number;
  /** The token mint. */
  readonly mint: string;
}

/** One accepted cumulative usage update. */
export interface UsageUpdate {
  /** 1-based, for display only. */
  readonly sequence: number;
  /** The cumulative amount after this update, in atomic units. */
  readonly cumulative: bigint;
  /**
   * The transaction that committed it, or null while it is still pending.
   * A null signature is why an update is never counted as confirmed.
   */
  readonly signature: string | null;
}

/**
 * The share of the ceiling used, clamped to [0, 1], for the meter's geometry.
 *
 * Clamping is not cosmetic. The meter is a filled bar, and a value above 1
 * would render outside its track — silently misrepresenting a ratio. The
 * protocol should never permit settled > deposit (error 235 rejects such a
 * voucher), so a value outside the range means our own decoding is wrong, and
 * `describeMeter` surfaces that rather than drawing it.
 */
export function meterFraction(settled: bigint, ceiling: bigint): number {
  if (ceiling <= 0n) return 0;
  if (settled <= 0n) return 0;
  if (settled >= ceiling) return 1;
  // Both are integers and ceiling > 0, so this division is well-defined. The
  // ratio is scaled through Number because the result feeds a CSS percentage,
  // which is a display value — it never touches a settlement calculation.
  return Number((settled * 10_000n) / ceiling) / 10_000;
}

/** What the meter should say about itself, including when something is wrong. */
export type MeterHealth = "EMPTY" | "PARTIAL" | "FULL" | "INCONSISTENT";

/**
 * Classify the meter, so the UI can refuse to draw an impossible one.
 *
 * INCONSISTENT means settled exceeds the deposit, which the protocol rejects
 * (error 235, `voucherOverDeposit`). Seeing it means a bug on our side, not a
 * legitimate state, and it is surfaced as such.
 */
export function describeMeter(settled: bigint, ceiling: bigint): MeterHealth {
  if (settled > ceiling) return "INCONSISTENT";
  if (settled <= 0n) return "EMPTY";
  if (settled >= ceiling) return "FULL";
  return "PARTIAL";
}

/**
 * The unused remainder: `deposit - settled`, in atomic units.
 *
 * This is the number the product exists to show — "pay for what you actually
 * use" means the rest comes back. It is only meaningful once `settled` has been
 * read from chain, so callers must not render it from a PROPOSED ceiling alone.
 */
export function unusedRemainder(facts: Pick<ChannelFacts, "deposit" | "settled">): bigint {
  return facts.deposit - facts.settled;
}

/**
 * Section 14's required reconciliation: `authorized === settled + unused`.
 *
 * Checked rather than assumed. If this ever fails, the interface is showing
 * numbers that do not add up, and it should say so instead of presenting them
 * as a settled result.
 */
export function reconciles(facts: ChannelFacts): boolean {
  return facts.deposit === facts.settled + unusedRemainder(facts);
}

/**
 * The last update whose transaction is confirmed.
 *
 * Section 12 requires proof for a final state, and a pending update is not
 * proof. Returning null when nothing is confirmed keeps callers from treating
 * an optimistic value as a settled one.
 */
export function lastConfirmedUpdate(updates: readonly UsageUpdate[]): UsageUpdate | null {
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const update = updates[index];
    if (update.signature !== null) return update;
  }
  return null;
}

/** A short, human-scannable form of an address: `7KzNMe2b…oJwo`. */
export function abbreviate(value: string, leading = 8, trailing = 4): string {
  if (value.length <= leading + trailing + 1) return value;
  return `${value.slice(0, leading)}…${value.slice(-trailing)}`;
}

/** The cluster explorer URL for an address. Devnet during development. */
export function explorerAddressUrl(address: string): string {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  return `https://explorer.solana.com/address/${address}?cluster=${cluster}`;
}

/** The cluster explorer URL for a transaction. */
export function explorerTransactionUrl(signature: string): string {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}
