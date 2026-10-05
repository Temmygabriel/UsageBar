import { describe, expect, it } from "vitest";

import {
  formatAtomic,
  isAdvancingVoucher,
  parseAmount,
  reconciles,
  withinCeiling,
} from "../lib/amounts";

/**
 * Canonical demo numbers (build spec Section 24).
 *
 * The decimals used here are 6, matching the verified Devnet USDC mint
 * 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (6 decimals, classic SPL Token,
 * verified 2026-10-05). The asset decision is not final — see
 * docs/PROTOCOL_DECISION.md — so these tests pass decimals explicitly rather
 * than importing a constant, and they must be re-run against whatever asset
 * is finally chosen.
 */
const USDC_DECIMALS = 6;

const AUTHORIZED = 50_000_000n; // 50.00
const FINAL_USAGE = 12_400_000n; // 12.40
const UNUSED = 37_600_000n; // 37.60

const USAGE_TRAIL = [2_400_000n, 4_800_000n, 7_200_000n, 9_800_000n, 12_400_000n];

describe("parseAmount", () => {
  it("parses a canonical amount exactly, with no float rounding", () => {
    expect(parseAmount("12.40", USDC_DECIMALS)).toBe(FINAL_USAGE);
    expect(parseAmount("50.00", USDC_DECIMALS)).toBe(AUTHORIZED);
    expect(parseAmount("37.60", USDC_DECIMALS)).toBe(UNUSED);
  });

  it("handles values that are unsafe as IEEE-754 floats", () => {
    // 0.1 + 0.2 !== 0.3 in float arithmetic. In integer units it must be exact.
    expect(parseAmount("0.1", USDC_DECIMALS) + parseAmount("0.2", USDC_DECIMALS)).toBe(
      parseAmount("0.3", USDC_DECIMALS),
    );
  });

  it("parses whole numbers and zero", () => {
    expect(parseAmount("0", USDC_DECIMALS)).toBe(0n);
    expect(parseAmount("7", USDC_DECIMALS)).toBe(7_000_000n);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseAmount("  12.40  ", USDC_DECIMALS)).toBe(FINAL_USAGE);
  });

  it("rejects more fractional digits than the asset supports", () => {
    expect(() => parseAmount("12.4000001", USDC_DECIMALS)).toThrow(SyntaxError);
  });

  it("rejects malformed input rather than guessing", () => {
    for (const bad of ["", "abc", "1.2.3", "1e6", "-", ".5", "1,000"]) {
      expect(() => parseAmount(bad, USDC_DECIMALS)).toThrow();
    }
  });

  it("rejects an invalid decimals value", () => {
    expect(() => parseAmount("1.00", -1)).toThrow(RangeError);
    expect(() => parseAmount("1.00", 1.5)).toThrow(RangeError);
  });
});

describe("formatAtomic", () => {
  it("renders the canonical demo amounts exactly", () => {
    expect(formatAtomic(AUTHORIZED, USDC_DECIMALS)).toBe("50.000000");
    expect(formatAtomic(FINAL_USAGE, USDC_DECIMALS)).toBe("12.400000");
    expect(formatAtomic(UNUSED, USDC_DECIMALS)).toBe("37.600000");
  });

  it("pads the fractional part so place value is never ambiguous", () => {
    expect(formatAtomic(1n, USDC_DECIMALS)).toBe("0.000001");
    expect(formatAtomic(0n, USDC_DECIMALS)).toBe("0.000000");
    expect(formatAtomic(7_000_000n, USDC_DECIMALS)).toBe("7.000000");
  });

  it("handles a zero-decimal asset", () => {
    expect(formatAtomic(42n, 0)).toBe("42");
  });

  it("handles negative amounts without losing the sign", () => {
    expect(formatAtomic(-1_500_000n, USDC_DECIMALS)).toBe("-1.500000");
  });

  it("round-trips through parseAmount", () => {
    for (const atomic of [0n, 1n, FINAL_USAGE, AUTHORIZED, UNUSED, 123_456_789n]) {
      expect(parseAmount(formatAtomic(atomic, USDC_DECIMALS), USDC_DECIMALS)).toBe(atomic);
    }
  });

  it("rejects an invalid decimals value", () => {
    expect(() => formatAtomic(1n, -1)).toThrow(RangeError);
  });
});

describe("reconciles (INV-08, build spec Section 14)", () => {
  it("accepts the canonical demo reconciliation", () => {
    expect(reconciles(AUTHORIZED, FINAL_USAGE, UNUSED)).toBe(true);
  });

  it("rejects a reconciliation that does not balance", () => {
    expect(reconciles(AUTHORIZED, FINAL_USAGE, 37_600_001n)).toBe(false);
    expect(reconciles(AUTHORIZED, FINAL_USAGE, 0n)).toBe(false);
  });

  it("holds when nothing was used", () => {
    expect(reconciles(AUTHORIZED, 0n, AUTHORIZED)).toBe(true);
  });
});

describe("withinCeiling (INV-01)", () => {
  it("accepts an amount at or under the ceiling", () => {
    expect(withinCeiling(FINAL_USAGE, AUTHORIZED)).toBe(true);
    expect(withinCeiling(AUTHORIZED, AUTHORIZED)).toBe(true);
  });

  it("rejects an amount above the ceiling", () => {
    expect(withinCeiling(AUTHORIZED + 1n, AUTHORIZED)).toBe(false);
  });
});

describe("isAdvancingVoucher (INV-02)", () => {
  it("accepts a strictly increasing cumulative amount", () => {
    for (let i = 1; i < USAGE_TRAIL.length; i++) {
      expect(isAdvancingVoucher(USAGE_TRAIL[i], USAGE_TRAIL[i - 1])).toBe(true);
    }
  });

  it("rejects an equal amount, matching the protocol's strict monotonicity", () => {
    expect(isAdvancingVoucher(FINAL_USAGE, FINAL_USAGE)).toBe(false);
  });

  it("rejects a lower amount", () => {
    expect(isAdvancingVoucher(2_400_000n, 4_800_000n)).toBe(false);
  });

  it("accepts the first voucher against a zero watermark", () => {
    expect(isAdvancingVoucher(USAGE_TRAIL[0], 0n)).toBe(true);
  });
});

describe("the full canonical run", () => {
  it("reconciles after every step of the usage trail", () => {
    // At each point, the unused remainder is the ceiling minus the current
    // cumulative amount, and the three values must always balance.
    for (const cumulative of USAGE_TRAIL) {
      const unused = AUTHORIZED - cumulative;
      expect(reconciles(AUTHORIZED, cumulative, unused)).toBe(true);
      expect(withinCeiling(cumulative, AUTHORIZED)).toBe(true);
    }
  });

  it("never exceeds the ceiling at any point in the trail", () => {
    const overCeiling = USAGE_TRAIL.map((n) => withinCeiling(n, AUTHORIZED));
    expect(overCeiling.every(Boolean)).toBe(true);
  });
});
