import { describe, expect, it } from "vitest";
import { buildNationalTrends } from "./national-trends";
import type { SegmentFeeRow } from "@/lib/data-store/fee-index";
import { renderNationalTrendsSection, thousandsShort } from "@/lib/report-templates/templates/national-trends-section";

// Invented fixtures: no real institution or figure.
let nextId = 1;
function inst(state: string, district: number, tier: string, fees: Partial<Record<string, number | number[]>>): SegmentFeeRow[] {
  const id = nextId++;
  return Object.entries(fees).flatMap(([fee, amount]) =>
    (Array.isArray(amount) ? amount : [amount as number]).map((a) => ({
      institution_id: id,
      fee_category: fee,
      amount: a,
      institution_name: `Test Institution ${id}`,
      state_code: state,
      charter_type: id % 2 ? "bank" : "credit_union",
      asset_size_tier: tier,
      fed_district: district,
    })),
  );
}

const rows: SegmentFeeRow[] = [
  // Texas, Dallas district: six institutions, overdraft 25..35 plus one at 80.
  ...[25, 28, 30, 32, 35, 80].flatMap((od) => inst("TX", 11, "community_small", { overdraft: od, monthly_maintenance: 10 })),
  // Ohio, Cleveland district: five institutions, one with tiered overdraft (highest tier counts).
  ...inst("OH", 4, "community_mid", { overdraft: [20, 36] }),
  ...[30, 30, 30, 30].flatMap((od) => inst("OH", 4, "community_mid", { overdraft: od })),
  // Vermont: two institutions, too few to rank.
  ...[29, 31].flatMap((od) => inst("VT", 1, "community_small", { overdraft: od })),
];

const income = Array.from({ length: 20 }, (_, i) => {
  const year = 2026 - Math.floor((i + 2) / 4);
  const q = ((4 - ((i + 2) % 4)) % 4) + 1;
  return {
    quarter: `${year}-Q${q}`,
    total_service_charges: 10_000_000 + (19 - i) * 100_000,
    total_institutions: 8000,
    bank_service_charges: 8_000_000,
    cu_service_charges: 2_000_000 + (19 - i) * 100_000,
    yoy_change_pct: i < 16 ? 4 : null,
  };
});

const districtIncome = [
  { quarter: income[0].quarter, fed_district: 11, total_service_charges: 900_000, institutions: 600 },
  { quarter: `${Number(income[0].quarter.slice(0, 4)) - 1}${income[0].quarter.slice(4)}`, fed_district: 11, total_service_charges: 800_000, institutions: 610 },
];

describe("national trends", () => {
  const trends = buildNationalTrends({ feeRows: rows, nationalIncome: income, districtIncome });

  it("gives every district a row, with a median only where five or more institutions publish", () => {
    expect(trends.districts).toHaveLength(12);
    const dallas = trends.districts.find((d) => d.district === 11)!;
    expect(dallas).toMatchObject({ name: "Dallas", institutions: 6 });
    expect(dallas.fees.overdraft).toEqual({ median: 31, institutions: 6 });
    expect(dallas.income).toEqual({ quarter: income[0].quarter, thousands: 900_000, yoyPct: 12.5, institutions: 600 });
    const boston = trends.districts.find((d) => d.district === 1)!;
    expect(boston.fees.overdraft).toEqual({ median: null, institutions: 2 });
    expect(trends.districts.find((d) => d.district === 2)!.institutions).toBe(0);
  });

  it("ranks states highest median first, uses the highest overdraft tier, and lists small states unranked", () => {
    const od = trends.stateRankings.find((r) => r.fee === "overdraft")!;
    expect(od.ranked.map((s) => [s.rank, s.state, s.median, s.institutions])).toEqual([
      [1, "TX", 31, 6],
      [2, "OH", 30, 5],
    ]);
    expect(od.tooFew).toEqual([{ state: "VT", institutions: 2 }]);
  });

  it("orders states that share a median by their upper and lower percentiles", () => {
    const tied = [
      ...[30, 30, 30, 30, 30].flatMap((od) => inst("KS", 10, "community_small", { overdraft: od })),
      ...[25, 28, 30, 35, 40].flatMap((od) => inst("NE", 10, "community_small", { overdraft: od })),
      ...[25, 28, 30, 35, 40].flatMap((od) => inst("IA", 7, "community_small", { overdraft: od })),
    ];
    const ranking = buildNationalTrends({ feeRows: tied, nationalIncome: [], districtIncome: [] }).stateRankings[0];
    expect(ranking.ranked.map((s) => [s.rank, s.state])).toEqual([
      [1, "IA"],
      [1, "NE"],
      [3, "KS"],
    ]);
  });

  it("breaks fees out by asset size in tier order", () => {
    expect(trends.tiers.map((t) => [t.tier, t.institutions, t.fees.overdraft.median])).toEqual([
      ["community_small", 8, 30.5],
      ["community_mid", 5, 30],
    ]);
  });

  it("keeps sixteen quarters of income, newest first", () => {
    expect(trends.income).toHaveLength(16);
    expect(trends.income[0]).toMatchObject({ quarter: income[0].quarter, yoyPct: 4 });
  });

  it("names institutions above the outlier fence, highest first", () => {
    const od = trends.outliers.find((o) => o.fee === "overdraft")!;
    expect(od.aboveFence).toBe(od.highest.length);
    expect(od.highest[0]).toEqual({ institution: "Test Institution 6", state: "TX", amount: 80 });
    expect(od.highest.every((h) => h.amount > od.fence)).toBe(true);
    expect(od.highest.map((h) => h.amount)).toEqual([...od.highest.map((h) => h.amount)].sort((a, b) => b - a));
  });

  it("renders the chapter with no advice words and a how-this-was-built note", () => {
    const html = renderNationalTrendsSection(trends, { number: "06" });
    expect(html).toContain("Districts, States and Size");
    expect(html).toContain("11 Dallas");
    expect(html).toContain("too few (2)");
    expect(html).toContain("Not ranked (fewer than five institutions): VT (2).");
    expect(html).toContain("How this was built.");
    expect(html).not.toMatch(/recommend|should|raise|lower your/i);
  });

  it("leaves out district fee medians and size tiers when another chapter shows them", () => {
    const html = renderNationalTrendsSection(trends, { number: "09", title: "Rankings, Income Trend and Outliers", districtFees: false, tiers: false });
    expect(html).toContain("Rankings, Income Trend and Outliers");
    expect(html).toContain("Service-charge income by Federal Reserve district");
    expect(html).not.toContain("Median published fee by Federal Reserve district");
    expect(html).not.toContain("Median published fee by asset size");
    expect(html).toContain("State ranking");
  });

  it("formats thousands as billions and millions", () => {
    expect(thousandsShort(11_936_642)).toBe("$11.9B");
    expect(thousandsShort(842_000)).toBe("$842M");
  });
});
