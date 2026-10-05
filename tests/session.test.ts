import { describe, expect, it } from "vitest";

import { formatAmount, formatAtomic, formatForDisplay, groupThousands, parseAmount } from "../lib/amounts";
import {
  abbreviate,
  describeMeter,
  lastConfirmedUpdate,
  meterFraction,
  reconciles,
  unusedRemainder,
  type ChannelFacts,
  type UsageUpdate,
} from "../lib/session";

/**
 * The arithmetic the interface is allowed to show.
 *
 * These are not decoration. Section 14 of the build spec requires the tab's
 * numbers to reconcile (`authorized === settled + unused`), and the display
 * rules exist because a payment UI that quietly rounds is a payment UI that
 * lies about money. The 6-decimal cases below are the ones that would actually
 * bite: the locked visual reference shows two decimal places, but the verified
 * test mint has six.
 */

describe("formatForDisplay", () => {
  it("shows two places when the amount is exact at two", () => {
    expect(formatForDisplay(50_000_000n, 6)).toBe("50.00");
    expect(formatForDisplay(12_400_000n, 6)).toBe("12.40");
    expect(formatForDisplay(37_600_000n, 6)).toBe("37.60");
  });

  it("still shows two places for a whole number, so a column lines up", () => {
    expect(formatForDisplay(50_000_000n, 6)).toBe("50.00");
    expect(formatForDisplay(0n, 6)).toBe("0.00");
  });

  it("does NOT hide precision beyond two places", () => {
    // The case the rule exists for. Rounding this to 37.60 would make the
    // tab's three numbers fail to reconcile, and the interface would look
    // correct while being wrong.
    expect(formatForDisplay(37_600_001n, 6)).toBe("37.600001");
    expect(formatForDisplay(12_345_678n, 6)).toBe("12.345678");
  });

  it("drops trailing zeros beyond the second place rather than padding", () => {
    expect(formatForDisplay(12_400_000n, 6)).toBe("12.40");
    expect(formatForDisplay(12_450_000n, 6)).toBe("12.45");
    expect(formatForDisplay(12_450_010n, 6)).toBe("12.45001");
  });

  it("handles a zero-decimal asset", () => {
    expect(formatForDisplay(50n, 0)).toBe("50.00");
  });

  it("never rounds away a nonzero remainder, at any precision", () => {
    // Whatever the value, re-parsing the display string must give it back.
    for (const atomic of [1n, 999_999n, 1_000_001n, 37_600_001n, 12_345_678n, 49_999_999n]) {
      expect(parseAmount(formatForDisplay(atomic, 6), 6)).toBe(atomic);
    }
  });
});

describe("formatAtomic", () => {
  it("is exact, with no rounding and no grouping", () => {
    expect(formatAtomic(50_000_000n, 6)).toBe("50.000000");
    expect(formatAtomic(1n, 6)).toBe("0.000001");
    expect(formatAtomic(0n, 6)).toBe("0.000000");
  });

  it("keeps the sign", () => {
    expect(formatAtomic(-1_500_000n, 6)).toBe("-1.500000");
  });
});

describe("groupThousands", () => {
  it("groups the whole part only", () => {
    expect(groupThousands("1234567.89")).toBe("1,234,567.89");
    expect(groupThousands("999.00")).toBe("999.00");
    expect(groupThousands("1000.00")).toBe("1,000.00");
    expect(groupThousands("50.00")).toBe("50.00");
  });

  it("keeps the sign outside the grouping", () => {
    expect(groupThousands("-1234.50")).toBe("-1,234.50");
  });
});

describe("formatAmount", () => {
  it("is the display format the tab renders", () => {
    expect(formatAmount(50_000_000n, 6)).toBe("50.00");
    expect(formatAmount(12_400_000n, 6)).toBe("12.40");
    expect(formatAmount(999_950_000_000n, 6)).toBe("999,950.00");
  });
});

describe("meterFraction", () => {
  it("is the used share of the ceiling", () => {
    expect(meterFraction(12_400_000n, 50_000_000n)).toBeCloseTo(0.248, 4);
    expect(meterFraction(0n, 50_000_000n)).toBe(0);
    expect(meterFraction(50_000_000n, 50_000_000n)).toBe(1);
  });

  it("clamps, so the bar can never be drawn outside its track", () => {
    // Would otherwise render at 200% width — a wrong ratio that still looks
    // like a plausible bar, which is the worst kind of wrong.
    expect(meterFraction(100_000_000n, 50_000_000n)).toBe(1);
    expect(meterFraction(-1n, 50_000_000n)).toBe(0);
  });

  it("returns 0 for a zero ceiling rather than dividing by zero", () => {
    expect(meterFraction(0n, 0n)).toBe(0);
  });
});

describe("describeMeter", () => {
  it("classifies the ordinary readings", () => {
    expect(describeMeter(0n, 50_000_000n)).toBe("EMPTY");
    expect(describeMeter(12_400_000n, 50_000_000n)).toBe("PARTIAL");
    expect(describeMeter(50_000_000n, 50_000_000n)).toBe("FULL");
  });

  it("flags an impossible reading rather than drawing it", () => {
    // settled > deposit is rejected by the program (error 235,
    // voucherOverDeposit), so seeing it means our own decoding is wrong.
    // The interface should look wrong, not plausible.
    expect(describeMeter(50_000_001n, 50_000_000n)).toBe("INCONSISTENT");
  });
});

describe("reconciliation (build spec Section 14)", () => {
  const facts: ChannelFacts = {
    address: "7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo",
    openTransaction: "2Uoz4SE93ct5v3RrXQnzFhy8Dn4bwi8FBcf817Vm3SjNm1Umi2q9jzxLF95SdEsCC8r2KsKHDYKSo8JaNuDLgoh",
    deposit: 50_000_000n,
    settled: 21_500_000n,
    decimals: 6,
    mint: "6Jpyq8iUszZdZd2z3G9is1nfJh7ZwqbekW9cH2w58hmL",
  };

  it("computes the unused remainder as deposit minus settled", () => {
    expect(unusedRemainder(facts)).toBe(28_500_000n);
  });

  it("satisfies authorized = settled + unused", () => {
    expect(reconciles(facts)).toBe(true);
  });

  it("matches the real numbers from the Devnet close", () => {
    // These are the actual amounts that moved on 2026-10-05: a 50 TEST
    // deposit, sealed at 21.5, with 28.5 returned to the payer.
    expect(formatAmount(facts.deposit, 6)).toBe("50.00");
    expect(formatAmount(facts.settled, 6)).toBe("21.50");
    expect(formatAmount(unusedRemainder(facts), 6)).toBe("28.50");
  });
});

describe("lastConfirmedUpdate", () => {
  const update = (sequence: number, cumulative: bigint, signature: string | null): UsageUpdate => ({
    sequence,
    cumulative,
    signature,
  });

  it("returns null when nothing has been confirmed", () => {
    expect(lastConfirmedUpdate([])).toBeNull();
    expect(lastConfirmedUpdate([update(1, 100n, null)])).toBeNull();
  });

  it("skips a pending update and returns the last confirmed one", () => {
    // Section 12 requires proof for a final state. An unconfirmed update is
    // not proof, so it must not become the number the tab reports.
    const updates = [
      update(1, 100n, "sig-a"),
      update(2, 200n, "sig-b"),
      update(3, 300n, null),
    ];
    expect(lastConfirmedUpdate(updates)?.cumulative).toBe(200n);
  });
});

describe("abbreviate", () => {
  it("shortens a long address for display", () => {
    expect(abbreviate("7KzNMe2btqSc23744Yk6aAWak4kfBNtNkkcJCsZ2oJwo")).toBe("7KzNMe2b…oJwo");
  });

  it("leaves a short value alone rather than making it unreadable", () => {
    expect(abbreviate("abc")).toBe("abc");
  });
});
