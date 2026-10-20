import { beforeEach, describe, expect, it, vi } from "vitest";
import { getInstitutionIdsWithFeeDates, getStatesWithFeeData } from "@/lib/data-store";
import { getPublicFeeTypes, getPublicSnapshot } from "@/lib/public-stats";
import { publicFeeTypes } from "@/lib/fee-taxonomy";
import { SITE_URL } from "@/lib/constants";

// A minimal stand-in for Next's data cache: it stores a value only when the wrapped function
// returns, and serves the stored value afterwards, as unstable_cache does within its revalidate.
const cache = vi.hoisted(() => ({
  stored: undefined as unknown,
  options: undefined as { revalidate?: number | false } | undefined,
  keyParts: undefined as string[] | undefined,
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[], options: { revalidate?: number }) => {
    cache.keyParts = keyParts;
    cache.options = options;
    return async () => {
      if (cache.stored !== undefined) return cache.stored;
      const value = await fn();
      cache.stored = value;
      return value;
    };
  },
}));

vi.mock("@/lib/data-store", () => ({
  getDataFreshness: vi.fn(() => Promise.resolve(null)),
  getInstitutionIdsWithFeeDates: vi.fn(),
  getStatesWithFeeData: vi.fn(),
  getTopCitiesByState: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getStateMarketCitiesCached: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/lib/public-stats", () => ({ getPublicSnapshot: vi.fn(), getPublicFeeTypes: vi.fn() }));
vi.mock("@/lib/guides/source", () => ({ loadGuides: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/data-store/connection", () => ({
  getSql: vi.fn(() => () => Promise.resolve([])),
}));
vi.mock("@/lib/custom-report/sample-report", () => ({
  sampleReportAvailable: vi.fn(() => Promise.resolve(false)),
}));

const ONE_HOUR_SECONDS = 3600;
const institution = { id: 7, last_fee_at: "2026-10-01T00:00:00.000Z", verified_fee_count: 40 };

async function loadSitemap() {
  vi.resetModules();
  return import("./sitemap");
}

function paths(entries: Array<{ url: string }>): string[] {
  return entries.map((e) => e.url.replace(SITE_URL, ""));
}

describe("sitemap render and cache config", () => {
  beforeEach(() => {
    cache.stored = undefined;
    vi.clearAllMocks();
    vi.mocked(getInstitutionIdsWithFeeDates).mockResolvedValue([institution]);
    vi.mocked(getStatesWithFeeData).mockResolvedValue([
      { state_code: "TX", institution_count: 242, fee_count: 4328 },
    ]);
    vi.mocked(getPublicSnapshot).mockResolvedValue({ summary: {} as never, categories: [] as never });
    vi.mocked(getPublicFeeTypes).mockResolvedValue(publicFeeTypes([]));
  });

  it("should_render_on_request_and_cache_the_full_sitemap_for_an_hour", async () => {
    const mod = await loadSitemap();
    expect(mod.dynamic).toBe("force-dynamic");
    expect("revalidate" in mod).toBe(false);
    await mod.default();
    expect(cache.options?.revalidate).toBe(ONE_HOUR_SECONDS);
    expect(cache.keyParts).toContain("sitemap");
  });

  it("should_return_the_same_urls_through_the_cache_with_dates_as_iso_strings", async () => {
    const { default: sitemap } = await loadSitemap();
    const entries = await sitemap();
    expect(paths(entries)).toEqual(expect.arrayContaining(["", "/methodology", "/institution/7", "/research/state/TX"]));
    const profile = entries.find((e) => e.url === `${SITE_URL}/institution/7`);
    expect(profile?.lastModified).toBe(institution.last_fee_at);
    expect(cache.stored).toEqual(entries);
  });

  it("should_not_cache_a_sitemap_built_with_a_failed_secondary_read", async () => {
    vi.mocked(getStatesWithFeeData).mockRejectedValue(new Error("ReadDeadlineError"));
    const { default: sitemap } = await loadSitemap();
    const entries = await sitemap();
    expect(paths(entries)).toContain("/institution/7");
    expect(cache.stored).toBeUndefined();
  });

  it("should_serve_the_database_free_sitemap_uncached_when_the_institution_read_fails", async () => {
    vi.mocked(getInstitutionIdsWithFeeDates).mockRejectedValue(new Error("ReadDeadlineError"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: sitemap } = await loadSitemap();
    const result = paths(await sitemap());
    expect(result).toContain("/methodology");
    expect(result.some((p) => p.startsWith("/institution/"))).toBe(false);
    expect(getStatesWithFeeData).not.toHaveBeenCalled();
    expect(cache.stored).toBeUndefined();
  });
});
