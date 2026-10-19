import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * #1988: /institutions is prerendered at build time. A headline-count read that missed its
 * deadline threw from the required budget and failed the whole deploy. The counts are now
 * optional: the page renders with the unavailable label and a one-minute cache life.
 */
const reads = vi.hoisted(() => ({
  stats: vi.fn(),
  stateSummaries: vi.fn(),
}));
const shortenPageLife = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/public-stats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/public-stats")>()),
  getPublicStatsSummary: reads.stats,
  getPublicCategorySummaries: vi.fn(async () => []),
}));
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getInstitutionStateDirectorySummariesCached: reads.stateSummaries,
  searchInstitutionsCached: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("@/lib/data-store/market-readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/market-readiness")>()),
  getInstitutionHeadlineCoverage: vi.fn(async () => null),
}));
vi.mock("@/lib/custom-report/sample-report", () => ({ sampleReportAvailable: vi.fn(async () => false) }));
vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif" } }));
vi.mock("@/lib/data-store/public-read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/public-read-cache")>()),
  shortenPageLife,
}));

import { InstitutionsDirectory } from "./directory-page";
import { UNAVAILABLE_LABEL } from "@/lib/public-stats";

const never = () => new Promise<never>(() => {});

/** Every string in a rendered element tree's props (children included), without rendering client components. */
function strings(node: unknown, seen = new Set<unknown>()): string[] {
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (!node || typeof node !== "object" || seen.has(node)) return [];
  seen.add(node);
  if (Array.isArray(node)) return node.flatMap((child) => strings(child, seen));
  const props = (node as { props?: Record<string, unknown> }).props;
  return props ? Object.values(props).flatMap((value) => strings(value, seen)) : [];
}

describe("institutions directory read deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reads.stateSummaries.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders with unavailable counts when the stats read hangs, and shortens the cache life", async () => {
    reads.stats.mockImplementation(never);
    const pending = InstitutionsDirectory({ params: {} });
    await vi.advanceTimersByTimeAsync(15_000);
    const page = (await pending) as ReactElement;
    expect(page).toBeTruthy();
    expect(shortenPageLife).toHaveBeenCalled();
    // An unread count is never shown as a number: no "0 of 0" coverage line.
    const text = strings(page).join(" ");
    expect(text).not.toMatch(/\b0 of\b/);
    expect(text).not.toContain(UNAVAILABLE_LABEL);
  });
});
