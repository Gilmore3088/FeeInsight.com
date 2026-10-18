import { describe, expect, it } from "vitest";
import { FEE_FAMILIES, PUBLIC_FEE_TYPE_LIMIT, TAXONOMY_COUNT, publicFeeTypes } from "./fee-taxonomy";
import { COUNT_DEFINITIONS, feeHeadlineCounts, publicCategoryCount, stateCoverageCounts, stateCoverageSentence } from "./headline-counts";
import { UNAVAILABLE_LABEL, withPublicCategoryCount, type PublicStatsSummary } from "./public-stats";
import type { FeeCategorySummary } from "./data-store/fees";

const ALL_TYPES = Object.values(FEE_FAMILIES).flat();

function row(fee_category: string, institution_count: number, zero_count = 0): FeeCategorySummary {
  return {
    fee_category,
    institution_count,
    total_observations: institution_count,
    min_amount: null,
    max_amount: null,
    avg_amount: null,
    median_amount: null,
    p25_amount: null,
    p75_amount: null,
    bank_count: 0,
    cu_count: 0,
    zero_count,
    bank_median_amount: null,
    cu_median_amount: null,
  };
}

function summary(over: Partial<PublicStatsSummary> = {}): PublicStatsSummary {
  return {
    institutions: 2900,
    institutionsLabel: "2,900",
    monitored: 3929,
    monitoredLabel: "3,929",
    observations: 50000,
    observationsLabel: "50,000",
    categories: ALL_TYPES.length,
    categoriesLabel: String(ALL_TYPES.length),
    states: 50,
    statesLabel: "50",
    refreshedOn: "Oct 18, 2026",
    freshnessLabel: "Data refreshed Oct 18, 2026",
    complete: true,
    ...over,
  };
}

describe("publicCategoryCount (#1951: 50 vs 52 fee categories)", () => {
  it("counts the public top 50, never every taxonomy type with data", () => {
    // The taxonomy holds more than the public limit; every type has published fees.
    expect(TAXONOMY_COUNT).toBeGreaterThan(PUBLIC_FEE_TYPE_LIMIT);
    const categories = ALL_TYPES.map((key, i) => row(key, 1000 - i));
    expect(publicCategoryCount(categories)).toBe(PUBLIC_FEE_TYPE_LIMIT);
  });

  it("leaves out a public type with no counted institution and anything outside the taxonomy", () => {
    const categories = [...ALL_TYPES.slice(0, 10).map((key) => row(key, 100)), row(ALL_TYPES[10], 0), row("not_a_taxonomy_type", 500)];
    expect(publicCategoryCount(categories)).toBe(10);
  });

  it("is null when the category read failed, so a failed read never prints 0", () => {
    expect(publicCategoryCount([])).toBeNull();
  });

  it("is the same set /fees and the homepage list (publicFeeTypes with data)", () => {
    const categories = ALL_TYPES.map((key, i) => row(key, i % 7 === 0 ? 0 : 500 - i));
    const listed = publicFeeTypes(categories);
    const withData = categories.filter((c) => listed.has(c.fee_category) && c.institution_count > 0).length;
    expect(publicCategoryCount(categories)).toBe(withData);
  });
});

describe("withPublicCategoryCount: the snapshot's category headline", () => {
  it("replaces the raw taxonomy count with the public one", () => {
    const categories = ALL_TYPES.map((key, i) => row(key, 1000 - i));
    const out = withPublicCategoryCount({ summary: summary(), categories });
    expect(out.categories).toBe(PUBLIC_FEE_TYPE_LIMIT);
    expect(out.categoriesLabel).toBe(String(PUBLIC_FEE_TYPE_LIMIT));
    expect(out.complete).toBe(true);
    expect(out.institutionsLabel).toBe("2,900");
  });

  it("keeps a failed count unavailable", () => {
    const failed = summary({ categories: 0, categoriesLabel: UNAVAILABLE_LABEL, complete: false });
    expect(withPublicCategoryCount({ summary: failed, categories: [row("overdraft", 10)] })).toEqual(failed);
  });

  it("marks the summary incomplete when the category benchmarks failed to read", () => {
    const out = withPublicCategoryCount({ summary: summary(), categories: [] });
    expect(out.categoriesLabel).toBe(UNAVAILABLE_LABEL);
    expect(out.complete).toBe(false);
  });
});

describe("feeHeadlineCounts: one institution count per fee", () => {
  it("reads the snapshot's counted institutions and its $0-only count", () => {
    const categories = [row("overdraft", 2502, 3), row("nsf", 2670, 40)];
    expect(feeHeadlineCounts(categories, "overdraft")).toEqual({ institutions: 2502, zeroOnly: 3 });
    expect(feeHeadlineCounts(categories, "wire_domestic_outgoing")).toBeNull();
  });
});

describe("stateCoverageCounts: one definition of a state's coverage", () => {
  const coverage = {
    states: [{ state_code: "FL", monitored: 188, verified_institutions: 112, counted_institutions: 109, verified_fees: 4000 }],
  };

  it("returns headquartered, with published fees and counted, nested", () => {
    expect(stateCoverageCounts(coverage, "FL")).toEqual({ monitored: 188, withFees: 112, counted: 109 });
  });

  it("is null for a state the read does not hold, or a failed read", () => {
    expect(stateCoverageCounts(coverage, "GA")).toBeNull();
    expect(stateCoverageCounts(null, "FL")).toBeNull();
  });

  it("reads counted as unknown on an entry cached before the field existed", () => {
    const old = { states: [{ state_code: "FL", monitored: 188, verified_institutions: 112, verified_fees: 4000 }] };
    expect(stateCoverageCounts(old, "FL")?.counted).toBeNull();
  });
});

describe("COUNT_DEFINITIONS", () => {
  it("is visitor text without em-dashes or pipeline agent names", () => {
    for (const text of Object.values(COUNT_DEFINITIONS)) {
      expect(text).not.toMatch(/—/);
      expect(text).not.toMatch(/\b(Atlas|Magellan|Rosetta|Knox|Darwin)\b/);
    }
  });
});

describe("stateCoverageSentence: all three numbers from one coverage read (#1955)", () => {
  it("states headquartered, with fees and counted, nested", () => {
    expect(stateCoverageSentence({ monitored: 188, withFees: 112, counted: 109 }, "Florida")).toBe(
      "112 of the 188 institutions headquartered in Florida have published fees here, and 109 of them have fees that count toward the medians on this page. ",
    );
  });

  it("drops the medians clause when counted exceeds the institutions with fees", () => {
    const line = stateCoverageSentence({ monitored: 188, withFees: 112, counted: 115 }, "Florida");
    expect(line).toBe("112 of the 188 institutions headquartered in Florida have published fees here. ");
    expect(line).not.toContain("115");
  });

  it("drops the medians clause when counted is unknown, and says nothing without coverage", () => {
    expect(stateCoverageSentence({ monitored: 188, withFees: 112, counted: null }, "Florida")).not.toContain("medians");
    expect(stateCoverageSentence(null, "Florida")).toBe("");
    expect(stateCoverageSentence({ monitored: 188, withFees: 0, counted: 0 }, "Florida")).toBe("");
  });

  it("reads the counted figure from the same coverage entry as the other two", () => {
    const coverage = { states: [{ state_code: "FL", monitored: 188, verified_institutions: 112, counted_institutions: 109 }] };
    expect(stateCoverageSentence(stateCoverageCounts(coverage, "FL"), "Florida")).toContain("and 109 of them");
  });
});
