import { describe, expect, it } from "vitest";
import type { ExtractedFee } from "@/lib/data-store/types";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { buildCheckRows, marketBand, parseCheckId, stateGroupLabel } from "./check-data";

const fee = (overrides: Partial<ExtractedFee>): ExtractedFee =>
  ({
    id: 1,
    institution_id: 323,
    institution_name: "Test Bank",
    fee_name: "Fee",
    fee_audience: "consumer",
    fee_category: null,
    amount: 10,
    frequency: null,
    conditions: null,
    extraction_confidence: 1,
    review_status: "approved",
    validation_flags: null,
    source_url: "https://bank.example/fees.pdf",
    ...overrides,
  }) as ExtractedFee;

const entry = (category: string, median: number, overrides: Partial<IndexEntry> = {}): IndexEntry => ({
  fee_category: category,
  fee_family: null,
  median_amount: median,
  p25_amount: median * 0.8,
  p75_amount: median * 1.2,
  min_amount: 0,
  max_amount: median * 2,
  institution_count: 40,
  observation_count: 40,
  approved_count: 40,
  bank_count: 30,
  cu_count: 10,
  maturity_tier: "strong",
  last_updated: null,
  ...overrides,
});

describe("marketBand", () => {
  it("drops a market with too few institutions or a missing bound", () => {
    expect(marketBand(entry("nsf", 30, { maturity_tier: "insufficient" }))).toBeNull();
    expect(marketBand(entry("nsf", 30, { p25_amount: null }))).toBeNull();
    expect(marketBand(undefined)).toBeNull();
    expect(marketBand(entry("nsf", 30))).toEqual({ min: 0, p25: 24, median: 30, p75: 36, max: 60, institutions: 40 });
  });
});

describe("buildCheckRows", () => {
  const fees = [
    fee({ id: 1, fee_category: "overdraft", fee_name: "Overdraft Item Paid", amount: 35 }),
    fee({ id: 2, fee_category: "nsf", fee_name: "NSF Item Returned", amount: 30 }),
    fee({ id: 3, fee_category: "stop_payment", fee_name: "Stop Payment", amount: 25 }),
  ];

  it("keeps rows with a state or national median, in headline order, with both bands", () => {
    const rows = buildCheckRows({
      verifiedFees: fees,
      nationalIndex: [entry("overdraft", 30), entry("nsf", 28)],
      stateIndex: [entry("overdraft", 32)],
      fallbackSourceUrl: null,
    });
    expect(rows.map((row) => row.category)).toEqual(["overdraft", "nsf"]);
    expect(rows[0].state?.median).toBe(32);
    expect(rows[0].nation?.median).toBe(30);
    expect(rows[1].state).toBeNull();
    expect(rows[0].sourceUrl).toBe("https://bank.example/fees.pdf");
  });

  it("names the state group only when a row has a state band", () => {
    const rows = buildCheckRows({ verifiedFees: fees, nationalIndex: [entry("nsf", 28)], stateIndex: [], fallbackSourceUrl: null });
    expect(stateGroupLabel(rows, "Florida", "bank")).toBeNull();
    const withState = buildCheckRows({ verifiedFees: fees, nationalIndex: [], stateIndex: [entry("nsf", 28)], fallbackSourceUrl: null });
    expect(stateGroupLabel(withState, "Florida", "credit_union")).toBe("Florida credit unions");
  });
});

describe("parseCheckId", () => {
  it("accepts a positive integer only", () => {
    expect(parseCheckId("323")).toBe(323);
    expect(parseCheckId("0")).toBeNull();
    expect(parseCheckId("12abc")).toBeNull();
    expect(parseCheckId(undefined)).toBeNull();
  });
});
