import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { NATIONAL_INDEX_NAV } from "@/components/nav-items";
import { PRODUCT_NAME } from "@/lib/constants";
import { nationalFindings } from "./findings";

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

describe("national page naming", () => {
  it("names the page as the Bank Fee Index, national edition, in the menu", () => {
    expect(NATIONAL_INDEX_NAV.label).toBe(`${PRODUCT_NAME}: national`);
  });
});
