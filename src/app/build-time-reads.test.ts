import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * #1048: /methodology, /research/data-sources, /about and /for-institutions are ISR pages, so
 * `next build` prerendered them and their reads ran against the database. A busy pool held
 * those reads past Next's 60-second page limit (#2483's build, 2026-10-20). During the build
 * they now render without reading the database, with a one-minute life, and the first
 * regeneration on request reads the cached public data
 * (findings/2026-10-20-sitemap-build-time-db-reads.md).
 */
const reads = vi.hoisted(() => ({
  snapshot: vi.fn(),
  summary: vi.fn(),
  categories: vi.fn(),
  stats: vi.fn(),
  coverage: vi.fn(),
  sample: vi.fn(),
  sampleAvailable: vi.fn(),
  ladder: vi.fn(),
  shortenPageLife: vi.fn(async () => undefined),
}));

vi.mock("@/lib/public-stats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/public-stats")>()),
  getPublicSnapshot: reads.snapshot,
  getPublicStatsSummary: reads.summary,
  getPublicCategorySummaries: reads.categories,
}));
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getStatsCached: reads.stats,
  getDataCoverageSummaryCached: reads.coverage,
}));
vi.mock("@/lib/custom-report/sample-report", () => ({
  DEMO_SAMPLE_INSTITUTION_ID: 323,
  loadSampleReport: reads.sample,
  sampleReportAvailable: reads.sampleAvailable,
}));
vi.mock("@/app/for-institutions/market-ladder", () => ({ MarketLadder: () => null, readSampleLadder: reads.ladder }));
vi.mock("@/lib/data-store/public-read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/public-read-cache")>()),
  shortenPageLife: reads.shortenPageLife,
}));
vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif" } }));
vi.mock("@/components/consumer-nav", () => ({ ConsumerNav: () => null }));
vi.mock("@/components/customer-footer", () => ({ CustomerFooter: () => null }));
vi.mock("@/components/public/search-modal", () => ({ SearchModal: () => null }));

import { UNAVAILABLE_PUBLIC_STATS } from "@/lib/public-stats";
import MethodologyPage from "./(public)/methodology/page";
import DataSourcesPage from "./(public)/research/data-sources/page";
import AboutPage from "./(public)/about/page";
import ForInstitutionsPage from "./for-institutions/page";

const PAGES = [
  ["/methodology", MethodologyPage],
  ["/research/data-sources", DataSourcesPage],
  ["/about", AboutPage],
  ["/for-institutions", ForInstitutionsPage],
] as const;

const LIVE_SUMMARY = { ...UNAVAILABLE_PUBLIC_STATS, complete: true, institutions: 10, institutionsLabel: "10" };

beforeEach(() => {
  vi.clearAllMocks();
  reads.snapshot.mockResolvedValue({ summary: LIVE_SUMMARY, categories: [] });
  reads.summary.mockResolvedValue(LIVE_SUMMARY);
  reads.categories.mockResolvedValue([{ fee_category: "overdraft", institution_count: 40 }]);
  reads.stats.mockResolvedValue({ with_fee_url: 5, banks: 3, credit_unions: 2 });
  reads.coverage.mockResolvedValue({ fdic_financials: 1, ncua_financials: 1 });
  reads.sample.mockResolvedValue(null);
  reads.sampleAvailable.mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function dataReadCount(): number {
  return [reads.snapshot, reads.summary, reads.categories, reads.stats, reads.coverage, reads.sample,
    reads.sampleAvailable, reads.ladder].reduce((sum, read) => sum + read.mock.calls.length, 0);
}

describe("database-backed ISR pages during next build", () => {
  it.each(PAGES)("%s reads nothing during the build and keeps the build copy for a minute", async (_path, Page) => {
    vi.stubEnv("NEXT_PHASE", PHASE_PRODUCTION_BUILD);
    await Page();
    expect(dataReadCount()).toBe(0);
    expect(reads.shortenPageLife).toHaveBeenCalled();
  });

  it.each(PAGES)("%s reads the cached public data on request", async (_path, Page) => {
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    await Page();
    expect(dataReadCount()).toBeGreaterThan(0);
  });

  it("keeps the normal page life when every read on request succeeds", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    await MethodologyPage();
    expect(reads.shortenPageLife).not.toHaveBeenCalled();
  });

  it("shortens /methodology's life when a read on request failed", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    reads.stats.mockRejectedValue(new Error("pool busy"));
    await MethodologyPage();
    expect(reads.shortenPageLife).toHaveBeenCalled();
  });
});
