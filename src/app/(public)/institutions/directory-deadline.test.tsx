import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { InstitutionSearchResult } from "@/lib/data-store/search";

/**
 * #1988: /institutions is prerendered at build time. A headline-count read that missed its
 * deadline threw from the required budget and failed the whole deploy. The counts are now
 * optional: the page renders without them and with a one-minute cache life.
 *
 * Round 2 (Oct 19): the plain page opens on a bounded, cached list of the largest institutions,
 * and the "Published fees available for N" line uses the live count or is left out.
 */
const reads = vi.hoisted(() => ({
  stats: vi.fn(),
  stateSummaries: vi.fn(),
  largest: vi.fn(),
  search: vi.fn(),
  coverage: vi.fn(),
}));
const shortenPageLife = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/public-stats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/public-stats")>()),
  getPublicStatsSummary: reads.stats,
  getPublicCategorySummaries: vi.fn(async () => []),
}));
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getInstitutionStateDirectorySummariesCached: reads.stateSummaries,
  getLargestInstitutionsCached: reads.largest,
  searchInstitutionsCached: reads.search,
  getInstitutionHeadlineCoverageCached: reads.coverage,
}));
vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif" } }));
vi.mock("@/lib/data-store/public-read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/public-read-cache")>()),
  shortenPageLife,
}));

import { InstitutionsDirectory } from "./directory-page";
import { UNAVAILABLE_LABEL, UNAVAILABLE_PUBLIC_STATS } from "@/lib/public-stats";

const never = () => new Promise<never>(() => {});

/** Every string in a rendered element tree's props (children included), without rendering client components. */
function strings(node: unknown, seen = new Set<unknown>()): string[] {
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (!node || typeof node !== "object" || seen.has(node)) return [];
  seen.add(node);
  if (Array.isArray(node)) return node.flatMap((child) => strings(child, seen));
  // An element: its props. Any other object (a result row): its fields.
  const props = "$$typeof" in node ? (node as { props?: Record<string, unknown> }).props ?? {} : node;
  return Object.values(props).flatMap((value) => strings(value, seen));
}

/** The first element's props in a rendered tree that carry `key`. */
function propsWith(node: unknown, key: string, seen = new Set<unknown>()): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsWith(child, key, seen);
      if (found) return found;
    }
    return null;
  }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return null;
  if (key in props) return props;
  return propsWith(Object.values(props), key, seen);
}

function row(id: number, name: string, published: number): InstitutionSearchResult {
  return {
    id,
    institution_name: name,
    city: "Tallahassee",
    state_code: "FL",
    charter_type: "bank",
    asset_size_tier: null,
    asset_size: 1000 - id,
    fee_count: published,
    published_fee_count: published,
    provisional_fee_count: 0,
    fee_publication_status: published > 0 ? "verified" : "unavailable",
  } as unknown as InstitutionSearchResult;
}

const LIVE_STATS = {
  ...UNAVAILABLE_PUBLIC_STATS,
  institutions: 3960,
  institutionsLabel: "3,960",
  monitored: 8775,
  monitoredLabel: "8,775",
  complete: true,
};

describe("institutions directory read deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reads.stateSummaries.mockResolvedValue([]);
    reads.largest.mockResolvedValue([]);
    reads.search.mockResolvedValue({ rows: [], total: 0 });
    reads.coverage.mockResolvedValue(new Map());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders without the counts when the stats read hangs, and shortens the cache life", async () => {
    reads.stats.mockImplementation(never);
    const pending = InstitutionsDirectory({ params: {} });
    await vi.advanceTimersByTimeAsync(15_000);
    const page = (await pending) as ReactElement;
    expect(page).toBeTruthy();
    expect(shortenPageLife).toHaveBeenCalled();
    // An unread count is never shown: no availability line, no "0 of 0", no placeholder dash.
    const text = strings(page).join(" ");
    expect(text).not.toContain("Published fees available for");
    expect(text).not.toMatch(/\b0 of\b/);
    expect(text).not.toContain(UNAVAILABLE_LABEL);
  });
});

describe("institutions directory opening list", () => {
  beforeEach(() => {
    reads.stats.mockResolvedValue(LIVE_STATS);
    reads.stateSummaries.mockResolvedValue([]);
    reads.search.mockResolvedValue({ rows: [], total: 0 });
  });
  afterEach(() => vi.clearAllMocks());

  it("leads with the search, the live availability count and the largest institutions, with no per-request search", async () => {
    reads.largest.mockResolvedValue([row(1, "Big Bank", 40), row(2, "Quiet Bank", 0)]);
    reads.coverage.mockResolvedValue(new Map([[1, 12], [2, 0]]));
    const text = strings(await InstitutionsDirectory({ params: {} })).join(" ");
    expect(text).toContain("Find your bank or credit union");
    expect(text).toContain("Explore published fees and compare institutions.");
    expect(text).toContain("Published fees available for 3,960 banks and credit unions.");
    expect(text).toContain("Largest banks and credit unions");
    expect(text).toContain("Big Bank");
    expect(text).toContain("it does not mean the institution charges $0");
    expect(reads.largest).toHaveBeenCalledWith({ charter_type: undefined, limit: 25 });
    expect(reads.search).not.toHaveBeenCalled();
    expect(reads.coverage).toHaveBeenCalledWith([1, 2]);
    expect(text).not.toMatch(/Track your peers|Find any/);
  });

  it("with Fees available on, reads further down the list and keeps only institutions with fees", async () => {
    reads.largest.mockResolvedValue([row(1, "Big Bank", 40), row(2, "Quiet Bank", 0)]);
    reads.coverage.mockResolvedValue(new Map([[1, 12]]));
    const text = strings(await InstitutionsDirectory({ params: { fees: "1" } })).join(" ");
    expect(reads.largest).toHaveBeenCalledWith({ charter_type: undefined, limit: 100 });
    expect(reads.coverage).toHaveBeenCalledWith([1]);
    expect(text).toContain("Big Bank");
    expect(text).not.toContain("Quiet Bank");
    expect(text).toContain("by total assets with fees in the index");
  });

  it("filters a state's full list to institutions with fees and counts what is left", async () => {
    reads.search.mockResolvedValue({ rows: [row(1, "Big Bank", 40), row(2, "Quiet Bank", 0), row(3, "Third Bank", 3)], total: 3 });
    reads.coverage.mockResolvedValue(new Map([[1, 12], [3, 2]]));
    const text = strings(await InstitutionsDirectory({ params: { state: "FL", fees: "1" } })).join(" ");
    expect(reads.largest).not.toHaveBeenCalled();
    expect(text).toContain("2 institutions with fees in the index in Florida.");
    expect(text).not.toContain("Quiet Bank");
  });

  it("treats a junk name as no search: the opening list, no search read", async () => {
    reads.largest.mockResolvedValue([row(1, "Big Bank", 40)]);
    reads.coverage.mockResolvedValue(new Map([[1, 12]]));
    for (const q of ["--", "&&", "a."]) {
      const text = strings(await InstitutionsDirectory({ params: { q } })).join(" ");
      expect(text).toContain("Largest banks and credit unions");
    }
    expect(reads.search).not.toHaveBeenCalled();
  });

  it("caches an empty opening list for a minute, as for a failed read", async () => {
    reads.largest.mockResolvedValue([]);
    await InstitutionsDirectory({ params: {} });
    expect(shortenPageLife).toHaveBeenCalled();
  });

  it("with Fees available on, takes the exact count from the window when it holds a row without fees", async () => {
    const window = [...Array.from({ length: 30 }, (_, i) => row(i + 1, `Fee Bank ${i + 1}`, 5)), row(99, "Quiet Bank", 0)];
    reads.search.mockResolvedValue({ rows: window, total: 4_000 });
    reads.coverage.mockResolvedValue(new Map());
    const page = await InstitutionsDirectory({ params: { q: "bank", fees: "1" } });
    const text = strings(page).join(" ");
    expect(text).toContain("30 institutions with fees in the index match");
    expect(reads.search).toHaveBeenCalledTimes(1);
  });

  it("past a window full of fees, offers a next page only when it has rows with fees", async () => {
    const full = Array.from({ length: 1_500 }, (_, i) => row(i + 1, `Fee Bank ${i + 1}`, 5));
    const pageRows = Array.from({ length: 25 }, (_, i) => row(5_000 + i, `Late Bank ${i}`, 5));
    reads.search.mockImplementation(async ({ page, pageSize }: { page: number; pageSize: number }) =>
      pageSize === 1_500
        ? { rows: full, total: 4_000 }
        : page === 70
          ? { rows: pageRows, total: 4_000 }
          : { rows: [row(9_000, "Quiet Bank", 0)], total: 4_000 },
    );
    reads.coverage.mockResolvedValue(new Map());
    const page = await InstitutionsDirectory({ params: { q: "bank", fees: "1", page: "70" } });
    expect(strings(page).join(" ")).toContain("Late Bank 0");
    // Page 71 holds no institution with fees, so page 70 is the last.
    expect(propsWith(page, "totalPages")).toMatchObject({ page: 70, totalPages: 70 });
  });
});
