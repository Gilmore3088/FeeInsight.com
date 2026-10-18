import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store", () => ({ getInstitutionById: vi.fn() }));
vi.mock("@/lib/data-store/fee-index", () => ({ getInstitutionOwnFees: vi.fn() }));
vi.mock("./peer-index", () => ({ resolveHamiltonPeerIndex: vi.fn() }));

import { buildInstitutionPositioning, gapPriority } from "./institution-position";

function benchmark(fee_category: string, median_amount: number | null, institution_count = 30) {
  return {
    fee_category,
    median_amount,
    institution_count,
    maturity_tier: (median_amount === null ? "insufficient" : "strong") as "strong" | "insufficient",
  };
}

/** Own fees as the reader gives them: one stated price per category. */
type Own = { price: number | null; low: number; high: number; fees: { name: string; amount: number }[] };
function own(entries: [string, number][]): Map<string, Own> {
  return new Map(entries.map(([category, price]) => [category, { price, low: price, high: price, fees: [{ name: "Fee", amount: price }] }]));
}

describe("gapPriority", () => {
  it("ranks by the size of the gap, above or below the median", () => {
    expect(gapPriority(30)).toBe("high");
    expect(gapPriority(-25)).toBe("high");
    expect(gapPriority(12)).toBe("medium");
    expect(gapPriority(-9.9)).toBe("low");
    expect(gapPriority(null)).toBe("low");
  });
});

describe("buildInstitutionPositioning", () => {
  const base = {
    institutionId: 2945,
    institutionName: "First Bank",
    benchmarkLabel: "GA bank peers",
    benchmarkSource: "selected-institution-default" as const,
  };

  it("compares each own fee with the benchmark median, largest gap first", () => {
    const result = buildInstitutionPositioning({
      ...base,
      benchmark: [benchmark("overdraft", 28), benchmark("nsf", 20), benchmark("wire_domestic_outgoing", null, 3)],
      ownFees: own([
        ["overdraft", 35],
        ["nsf", 19],
        ["wire_domestic_outgoing", 25],
        ["stop_payment", 30],
      ]),
    });

    expect(result.entries.map((entry) => entry.feeCategory)).toEqual(["overdraft", "nsf"]);
    expect(result.entries[0]).toMatchObject({ yourAmount: 35, benchmarkMedian: 28, gapAmount: 7, gapPct: 25 });
    expect(result.topGap?.feeCategory).toBe("overdraft");
    expect(result.priority).toBe("high");
    expect(result.ownFeeCount).toBe(4);
  });

  it("has no gap or priority when the institution has no fees", () => {
    const result = buildInstitutionPositioning({ ...base, benchmark: [benchmark("overdraft", 28)], ownFees: own([]) });

    expect(result.entries).toEqual([]);
    expect(result.topGap).toBeNull();
    expect(result.priority).toBeNull();
  });

  it("keeps a $0 benchmark median without dividing by zero", () => {
    const result = buildInstitutionPositioning({
      ...base,
      benchmark: [benchmark("account_research", 0)],
      ownFees: own([["account_research", 5]]),
    });

    expect(result.entries[0]).toMatchObject({ gapAmount: 5, gapPct: null });
    expect(result.priority).toBe("low");
  });

  it("shows several different fees as their range, with no gap or headline figure", () => {
    const result = buildInstitutionPositioning({
      ...base,
      benchmark: [benchmark("garnishment", 125), benchmark("overdraft", 28)],
      ownFees: new Map<string, Own>([
        ["garnishment", { price: null, low: 150, high: 175, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }] }],
        ...own([["overdraft", 30]]),
      ]),
    });

    const garnishment = result.entries.find((entry) => entry.feeCategory === "garnishment");
    expect(garnishment).toMatchObject({ yourAmount: null, yourLow: 150, yourHigh: 175, gapAmount: null, gapPct: null });
    // The $162.50 median of the two never becomes the bank's price or its largest gap.
    expect(result.topGap?.feeCategory).toBe("overdraft");
  });
});
