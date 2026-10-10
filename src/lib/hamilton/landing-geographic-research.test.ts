import { describe, expect, it, vi } from "vitest";
import type { IndexEntry, PeerFilterSet } from "@/lib/data-store/fee-index";
import {
  buildGeographicResearchResult, loadLandingGeographicResearch, measureFromIndex,
} from "./landing-geographic-research";

const base = {
  version: 1 as const, task: "compare" as const,
  scope: { kind: "state" as const, stateCode: "WA" as const },
  charter: "credit_union" as const,
  categories: ["paper_statement", "money_order"],
};
function entry(category: string, median: number | null, count: number): IndexEntry {
  return {
    fee_category: category, fee_family: "service", median_amount: median,
    p25_amount: median, p75_amount: median, min_amount: median, max_amount: median,
    institution_count: count, observation_count: count + 2, approved_count: count + 2,
    bank_count: 0, cu_count: count,
    maturity_tier: count < 5 ? "insufficient" : "provisional",
    last_updated: "2026-10-08",
  };
}

describe("governed geographic landing research", () => {
  it("reads Washington CUs against national CUs, not against all institutions", async () => {
    const read = vi.fn(async (_filters: PeerFilterSet[]) => [
      [entry("paper_statement", 2, 9), entry("money_order", 0, 7)],
      [entry("paper_statement", 3, 17), entry("money_order", 1, 15)],
    ]);
    const result = await loadLandingGeographicResearch(base, read);
    expect(read).toHaveBeenCalledWith([{ charter_type: "credit_union", state_code: "WA" }, { charter_type: "credit_union" }]);
    expect(result.comparisons.map((r) => r.difference)).toEqual([-1, -1]);
    expect(result.comparisons[1].selected.median).toBe(0);
    expect(result.categories).toEqual(base.categories);
    expect(result.scope).toEqual(base.scope);
  });
  it("returns national-only selection with no misleading reference delta", async () => {
    const read = vi.fn(async () => [[entry("money_order", 4, 100)]]);
    const result = await loadLandingGeographicResearch({ ...base, scope: { kind: "national" }, charter: "all", categories: ["money_order"] }, read);
    expect(read).toHaveBeenCalledWith([{}]);
    expect(result.comparisons[0].national).toBeNull();
    expect(result.comparisons[0].difference).toBeNull();
  });
  it("withholds thin or missing medians without treating missing as zero", () => {
    const result = buildGeographicResearchResult(base,
      [entry("paper_statement", 0, 4), entry("money_order", 0, 6)],
      [entry("paper_statement", 8, 50)],
    );
    expect(result.comparisons[0].selected).toMatchObject({ median: null, status: "insufficient", institutions: 4 });
    expect(result.comparisons[0].difference).toBeNull();
    expect(result.comparisons[1].national).toMatchObject({ median: null, status: "not_observed" });
    expect(result.comparisons[1].difference).toBeNull();
    expect(result.comparisons[1].selected.median).toBe(0);
  });
  it("withholds negative fee measures and never presents invalid quartiles as prices", () => {
    const badMedian = entry("paper_statement", -2, 15);
    const badQuartile = { ...entry("money_order", 0, 15), p25_amount: -1 };
    expect(measureFromIndex(badMedian)).toMatchObject({ status: "insufficient", median: null });
    expect(measureFromIndex(badQuartile)).toMatchObject({ status: "available", median: 0, p25: null });
    const result = buildGeographicResearchResult(base, [badMedian, badQuartile], [
      entry("paper_statement", 4, 20),
      entry("money_order", 1, 20),
    ]);
    expect(result.comparisons[0].difference).toBeNull();
    expect(result.comparisons[1].selected.median).toBe(0);
    expect(result.comparisons[1].selected.p25).toBeNull();
  });
  it("discloses the reporting dates and observed counts from the source index", () => {
    expect(measureFromIndex(entry("paper_statement", 4, 12))).toMatchObject({
      lastUpdated: "2026-10-08", institutions: 12, observations: 14, status: "available",
    });
  });
  it("rejects unimplemented report/local work instead of creating a false result", async () => {
    const read = vi.fn(async () => []);
    await expect(loadLandingGeographicResearch({ ...base, task: "board_report" }, read)).rejects.toThrow();
    await expect(loadLandingGeographicResearch({ ...base, scope: { kind: "local", institutionId: 123 } }, read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it("fails closed if a source returns the wrong number of cohorts", async () => {
    await expect(loadLandingGeographicResearch(base, async () => [[]])).rejects.toThrow(/unavailable/);
  });
  it("preserves explicit categories in the chosen order and does not leak unused categories", async () => {
    const result = await loadLandingGeographicResearch(base, async () => [
      [entry("overdraft", 30, 100), entry("money_order", 2, 10)],
      [entry("paper_statement", 1, 10)],
    ]);
    expect(result.comparisons.map((row) => row.category)).toEqual(["paper_statement", "money_order"]);
    expect(result.comparisons[0].selected.status).toBe("not_observed");
    expect(result.comparisons[1].national?.status).toBe("not_observed");
  });
});
