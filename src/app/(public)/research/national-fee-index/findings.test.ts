import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { NATIONAL_INDEX_NAV } from "@/components/nav-items";
import { PRODUCT_NAME } from "@/lib/constants";
import { datasetDescription, districtMedians, nationalFindings, subheadLead } from "./findings";

const entry = (fee_category: string, median_amount: number | null, institution_count: number): IndexEntry => ({
  fee_category,
  fee_family: null,
  median_amount,
  p25_amount: null,
  p75_amount: null,
  min_amount: null,
  max_amount: null,
  institution_count,
  observation_count: institution_count,
  approved_count: institution_count,
  bank_count: 0,
  cu_count: 0,
  maturity_tier: median_amount === null ? "insufficient" : "strong",
  last_updated: null,
});

const cpi = {
  bankFees: { date: "2026-09-01", value: 1, yoyPct: 1 },
  allItems: { date: "2026-09-01", value: 1, yoyPct: 3.7 },
};

describe("nationalFindings", () => {
  it("states the overdraft median, the most-published fee and the CPI comparison from the data given", () => {
    const findings = nationalFindings(
      [entry("overdraft", 30, 2498), entry("stop_payment", 27.5, 3173), entry("nsf", 30, 2668)],
      cpi,
    );
    expect(findings.map((f) => f.text)).toEqual([
      "The median overdraft fee is $30, across 2,498 banks and credit unions that publish one.",
      "Stop Payment is the fee the most institutions publish (3,173), with a median of $27.50.",
      "Prices for bank services rose 1% in the year to September 2026, against a 3.7% rise in all consumer prices.",
    ]);
  });

  it("leaves out a finding whose figure is missing rather than filling it in", () => {
    const findings = nationalFindings([entry("overdraft", null, 2498), entry("nsf", 30, 12)], {
      bankFees: null,
      allItems: null,
    });
    expect(findings.map((f) => f.key)).toEqual(["most_published"]);
  });

  it("says fell when bank service prices went down", () => {
    const [f] = nationalFindings([], {
      bankFees: { date: "2026-09-01", value: 1, yoyPct: -0.4 },
      allItems: { date: "2026-09-01", value: 1, yoyPct: 2.1 },
    });
    expect(f.text).toBe(
      "Prices for bank services fell 0.4% in the year to September 2026, against a 2.1% rise in all consumer prices.",
    );
  });
});

describe("finding card figures", () => {
  it("carries the overdraft range only when all five figures are known", () => {
    const full = { ...entry("overdraft", 30, 2498), min_amount: 0, p25_amount: 25, p75_amount: 33, max_amount: 50 };
    const [withRange] = nationalFindings([full], { bankFees: null, allItems: null });
    expect(withRange).toMatchObject({ key: "overdraft", median: 30, institutions: 2498, range: { min: 0, p25: 25, median: 30, p75: 33, max: 50 } });
    const [noRange] = nationalFindings([entry("overdraft", 30, 2498)], { bankFees: null, allItems: null });
    expect(noRange).toMatchObject({ key: "overdraft", range: null });
  });

  it("ranks the most-published fees, leader first, for the bars", () => {
    const [, top] = nationalFindings(
      [entry("overdraft", 30, 2498), entry("stop_payment", 27.5, 3173), entry("nsf", 30, 2668), entry("paper_statement", 3, 10)],
      { bankFees: null, allItems: null },
    );
    expect(top.key).toBe("most_published");
    if (top.key !== "most_published") return;
    expect(top.leaders.map((l) => l.category)).toEqual(["stop_payment", "nsf", "overdraft", "paper_statement"]);
    expect(top.leaders[0].category).toBe(top.category);
  });

  it("builds the bars only from fees the reader's table holds", () => {
    const index = [
      entry("overdraft", 30, 2498),
      entry("stop_payment", 27.5, 3173),
      entry("nsf", 30, 2668),
      entry("paper_statement", 3, 2600),
      entry("wire_domestic_incoming", 15, 2500),
    ];
    const [, top] = nationalFindings(index, { bankFees: null, allItems: null }, new Set(["stop_payment", "overdraft", "nsf"]));
    if (top.key !== "most_published") throw new Error("expected the most-published finding");
    expect(top.leaders.map((l) => l.category)).toEqual(["stop_payment", "nsf", "overdraft"]);
  });

  it("keeps the top fee first when the reader's table lacks it, and fills the rest from the table", () => {
    const index = [entry("overdraft", 30, 2498), entry("stop_payment", 27.5, 3173), entry("nsf", 30, 2668), entry("paper_statement", 3, 2600)];
    const [, top] = nationalFindings(index, { bankFees: null, allItems: null }, new Set(["overdraft", "nsf"]));
    if (top.key !== "most_published") throw new Error("expected the most-published finding");
    expect(top.category).toBe("stop_payment");
    expect(top.leaders.map((l) => l.category)).toEqual(["stop_payment", "nsf", "overdraft"]);
  });

  it("gives the CPI card both twelve-month changes", () => {
    const [f] = nationalFindings([], cpi);
    expect(f).toMatchObject({ key: "cpi", month: "September 2026", bankPct: 1, allPct: 3.7 });
  });
});

describe("districtMedians", () => {
  it("orders districts and leaves a thin district without a median", () => {
    const rows = districtMedians([
      { dimension_value: "District 12", count: 269, median_amount: 25, min_amount: 0, max_amount: 40, avg_amount: 24 },
      { dimension_value: "District 3", count: 4, median_amount: 32, min_amount: 0, max_amount: 40, avg_amount: 30 },
      { dimension_value: "Unknown", count: 9, median_amount: 30, min_amount: 0, max_amount: 40, avg_amount: 30 },
    ]);
    expect(rows).toEqual([
      { district: 3, name: "Philadelphia", median: null, institutions: 4 },
      { district: 12, name: "San Francisco", median: 25, institutions: 269 },
    ]);
    expect(districtMedians(null)).toEqual([]);
  });
});

describe("national page naming", () => {
  it("names the page as the Bank Fee Index, national edition, in the menu", () => {
    expect(NATIONAL_INDEX_NAV.label).toBe(`${PRODUCT_NAME}: national`);
  });
});

describe("count clauses", () => {
  it("drops the count when the figure is unavailable instead of printing a placeholder", () => {
    expect(subheadLead("3,909")).toBe("Median fees from the published fee schedules of 3,909 banks and credit unions");
    expect(subheadLead("—")).toBe("Median fees from the published fee schedules of U.S. banks and credit unions");
    expect(datasetDescription("50")).toContain("across 50 bank");
    expect(datasetDescription("—")).toBe(
      "National medians across bank and credit union fee categories, from published fee schedules.",
    );
  });
});
