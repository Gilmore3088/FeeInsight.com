import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  catalogQuality,
  categoryShares,
  dataQualitySql,
  gradeCheck,
  runDataQuality,
  summarizeDataQuality,
  type CatalogCounts,
} from "./data-quality";

const noSamples = { duplicates: [], stale: [], noCategory: [], noSource: [] };

function counts(overrides: Partial<CatalogCounts> = {}): CatalogCounts {
  return {
    liveFees: 10_000, institutions: 1_000, duplicates: 50, stale: 900, noCategory: 0, offTaxonomy: 0,
    noSource: 20, noDocument: 40, samples: noSamples,
    categories: [{ category: "overdraft", institutions: 800 }, { category: "nsf", institutions: 600 }],
    ...overrides,
  };
}

describe("Deming daily data-quality checks (#1065)", () => {
  it("grades against the skills' thresholds and does not grade a catalog under 100 fees", () => {
    expect(gradeCheck("duplicates", 50, 10_000)).toMatchObject({ rate: 0.005, status: "pass", query: "deming.dq_duplicates" });
    expect(gradeCheck("duplicates", 100, 10_000).status).toBe("warn");
    expect(gradeCheck("duplicates", 301, 10_000).status).toBe("fail");
    expect(gradeCheck("stale", 1_500, 10_000).status).toBe("warn");
    expect(gradeCheck("stale", 3_001, 10_000).status).toBe("fail");
    expect(gradeCheck("noCategory", 801, 10_000).status).toBe("fail");
    expect(gradeCheck("noSource", 5, 40)).toMatchObject({ rate: 0.125, status: "too_few" });
  });

  it("judges each category's share of institutions against its median over earlier checks", () => {
    const history = [
      { institutions: 1_000, categories: [{ category: "overdraft", institutions: 800 }, { category: "nsf", institutions: 300 }, { category: "rare", institutions: 5 }] },
      { institutions: 1_000, categories: [{ category: "overdraft", institutions: 790 }, { category: "nsf", institutions: 310 }, { category: "wire", institutions: 200 }] },
      { institutions: 1_000, categories: [{ category: "overdraft", institutions: 810 }, { category: "nsf", institutions: 290 }, { category: "wire", institutions: 210 }] },
    ];
    const result = categoryShares({ institutions: 1_000, categories: [{ category: "overdraft", institutions: 500 }, { category: "nsf", institutions: 600 }, { category: "wire", institutions: 210 }] }, history);
    expect(result.status).toBe("fail");
    expect(result.baselineChecks).toBe(3);
    // overdraft fell to 62% of normal, nsf doubled; wire (absent in one check, so 0 there) and the 5-institution category are in line or not judged.
    expect(result.drifts).toEqual([
      { category: "overdraft", normalShare: 0.8, share: 0.5, institutions: 500, direction: "down" },
      { category: "nsf", normalShare: 0.3, share: 0.6, institutions: 600, direction: "up" },
    ]);
    expect(categoryShares({ institutions: 1_000, categories: [] }, []).status).toBe("no_baseline");
    // A rise alone is coverage growth or a fold rule landing: watched, not an alarm (#1579).
    const risen = categoryShares({ institutions: 1_000, categories: [{ category: "overdraft", institutions: 800 }, { category: "nsf", institutions: 600 }, { category: "wire", institutions: 210 }] }, history);
    expect(risen.status).toBe("warn");
    expect(risen.drifts.map((drift) => drift.direction)).toEqual(["up"]);
  });

  it("names a failing check as an ALARM in the summary and keeps dollar and rate fees apart", async () => {
    const row = (live: number, extra: Record<string, unknown> = {}) => ({
      live_fees: live, institutions: 900, duplicates: 400, stale: 100, no_category: 0, off_taxonomy: 2, no_source: 10, no_document: 30,
      duplicates_sample: ["11", 12], stale_sample: null, no_category_sample: [], no_source_sample: [7],
      categories: JSON.stringify([{ category: "overdraft", institutions: 700 }]), ...extra,
    });
    const unsafe = vi.fn()
      .mockResolvedValueOnce([row(10_000)])
      .mockResolvedValueOnce([row(40, { duplicates: 30 })]);
    const db = Object.assign(vi.fn(async () => []), { unsafe });
    const result = await runDataQuality({ db: db as never });
    expect(unsafe.mock.calls[0][0]).toContain("FROM published_fee_catalog c");
    expect(unsafe.mock.calls[1][0]).toContain("FROM published_fee_rate_catalog c");
    expect(unsafe.mock.calls[0][1]).toEqual([90, expect.arrayContaining(["overdraft", "nsf"]), 20]);
    expect(result.dollar.checks.duplicates).toMatchObject({ count: 400, rate: 0.04, status: "fail" });
    expect(result.dollar.samples.duplicates).toEqual([11, 12]);
    expect(result.rate.checks.duplicates.status).toBe("too_few");
    expect(result.failing).toEqual(["dollar.duplicates"]);
    expect(summarizeDataQuality(result)).toContain("ALARM: duplicates");
    expect(summarizeDataQuality(result)).toContain("category shares recorded (first check, nothing to compare)");
  });

  it("reads only, from the live catalogs, with the rate kept in its own column", () => {
    for (const view of ["published_fee_catalog", "published_fee_rate_catalog"] as const) {
      const text = dataQualitySql(view);
      expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
      expect(text).not.toContain("extracted_fees");
      expect(text).toContain("COALESCE(sd.last_checked_at, sd.crawled_at, c.created_at)");
    }
    expect(dataQualitySql("published_fee_rate_catalog")).toContain("c.rate_percent AS value");
    expect(dataQualitySql("published_fee_catalog")).toContain("c.amount AS value");
    expect(catalogQuality("dollar", counts(), []).checks.stale.status).toBe("pass");
  });
});
