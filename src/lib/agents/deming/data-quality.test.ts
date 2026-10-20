import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  catalogQuality,
  categoryShares,
  dataQualityDetail,
  dataQualitySql,
  documentLinkKey,
  documentLinkKeySql,
  gradeCheck,
  runDataQuality,
  summarizeDataQuality,
  type CatalogCounts,
} from "./data-quality";

const noSamples = { duplicates: [], stale: [], noCategory: [], noSource: [] };

function counts(overrides: Partial<CatalogCounts> = {}): CatalogCounts {
  return {
    liveFees: 10_000, institutions: 1_000, duplicates: 50, sameAmount: 120, stale: 900, noCategory: 0, offTaxonomy: 0,
    noSource: 20, noDocument: 40, linkMismatch: 0, linkUrlVariant: 0, linkReadPage: 0, linkMismatchSample: [], samples: noSamples,
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
      link_mismatch: 25, link_url_variant: 14, link_read_page: 9, link_mismatch_sample: ["3", 4],
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
    // #1347: counted beside the graded checks, never an alarm.
    expect(dataQualityDetail(result).dollar.link_mismatch).toEqual({ count: 25, url_variants: 14, read_page: 9, sample: [3, 4] });
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

  it("#1347: counts a link to another page as a mismatch, never the same page written another way", () => {
    // Live on prod (read-only, Oct 17): each pair is one page.
    const same: Array<[string, string]> = [
      ["https://3riversfcu.org/fee-disclosure?print=1", "https://3riversfcu.org/fee-disclosure"],
      ["https://www.twinriversfcu.org/rates.php?e=1183&print=1", "https://www.twinriversfcu.org/rates.php?e=1183"],
      ["https://www.cinfed.com/about/schedule-of-fees.html?print=1&output=amp", "https://www.cinfed.com/about/schedule-of-fees.html?print=1"],
      ["http://bank.example/fees/", "https://www.bank.example/fees"],
      ["https://bank.example/Fees.pdf#page=2", "https://bank.example/fees.pdf"],
      ["https://bank.example/fees?utm_source=x&id=7", "https://bank.example/fees/?id=7"],
      // Oct 17: 587 live links differed from their document's URL only by a default port or "%20".
      ["https://www.goldenrulecu.org/services/fee-schedule", "https://www.goldenrulecu.org:443/services/fee-schedule"],
      ["https://www.coffee.bank/assets/files/5mEWZuG6/Additional%20Service%20and%20Fee%20Disclosure.pdf", "https://www.coffee.bank/assets/files/5mEWZuG6/Additional Service and Fee Disclosure.pdf"],
      ["http://bank.example:80/fees", "https://bank.example/fees"],
    ];
    for (const [link, document] of same) expect(documentLinkKey(link)).toBe(documentLinkKey(document));
    // Another page, another document, or a parameter that picks the page is a mismatch.
    const other: Array<[string, string]> = [
      ["https://bank.example/fees-2025.pdf", "https://bank.example/fees.pdf"],
      ["https://bank.example/rates.php?e=1183", "https://bank.example/rates.php?e=540"],
      ["https://bank.example/fees", "https://other.example/fees"],
      ["https://bank.example/fees?blueprint=1", "https://bank.example/fees"],
      ["https://bank.example:8443/fees", "https://bank.example/fees"],
    ];
    for (const [link, document] of other) expect(documentLinkKey(link)).not.toBe(documentLinkKey(document));
    expect(documentLinkKey("  ")).toBeNull();
    const text = dataQualitySql("published_fee_catalog");
    expect(text).toContain("NULLIF(btrim(sd.document_url), '') AS document_url");
    expect(text).toContain("AS link_mismatch");
    // A link to the page the document's text was read from is the fee's source, counted apart.
    expect(text).toContain("NULLIF(btrim(ast.source_url), '') AS read_url");
    expect(text).toContain("AS link_read_page");
    expect(text).toContain(documentLinkKeySql("source_url"));
  });
});
