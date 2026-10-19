import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * /research prerenders at build time (ISR). A required read that misses its deadline fails the
 * build (findings/2026-10-19-required-read-fails-build.md), so every read here is optional:
 * a hung read renders an honest "unavailable" state and a one-minute cache life.
 */
const reads = vi.hoisted(() => ({
  snapshot: vi.fn(),
  coverage: vi.fn(),
  national: vi.fn(),
  district: vi.fn(),
}));
const shortenPageLife = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/public-stats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/public-stats")>()),
  getPublicSnapshot: reads.snapshot,
  getPublicNationalIndex: reads.national,
}));
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getResearchCoverageCached: reads.coverage,
  getDistrictFeeIndexesCached: reads.district,
  getPublishedArticleSummariesCached: vi.fn(async () => []),
}));
vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif-var" } }));
vi.mock("@/lib/custom-report/sample-report", () => ({ sampleReportAvailable: vi.fn(async () => false) }));
vi.mock("@/lib/data-store/public-read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/public-read-cache")>()),
  shortenPageLife,
}));

import ResearchHubPage from "./page";
import { UNAVAILABLE_LABEL } from "@/lib/public-stats";

const never = () => new Promise<never>(() => {});
/** The element tree's text and props, without component references (which can be circular). */
const textOf = (page: ReactElement) =>
  JSON.stringify(page, (key, value: unknown) => (key === "type" || key === "_owner" || key === "_store" ? undefined : value));

describe("research hub read deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders with unavailable states when every read hangs, and shortens the cache life", async () => {
    for (const read of Object.values(reads)) read.mockImplementation(never);
    const pending = ResearchHubPage();
    await vi.advanceTimersByTimeAsync(15_000);
    const page = (await pending) as ReactElement;
    const text = textOf(page);
    expect(text).toContain(UNAVAILABLE_LABEL);
    expect(text).toContain("available right now. Try again in a minute.");
    expect(text).toContain("District comparisons aren't available right now.");
    expect(text).not.toContain("Reports for 0 states");
    expect(shortenPageLife).toHaveBeenCalled();
  });

  it("keeps the page when only the coverage read fails", async () => {
    reads.snapshot.mockImplementation(never);
    reads.national.mockResolvedValue([]);
    reads.district.mockResolvedValue(null);
    reads.coverage.mockRejectedValue(new Error("pool exhausted"));
    const pending = ResearchHubPage();
    await vi.advanceTimersByTimeAsync(15_000);
    const page = (await pending) as ReactElement;
    expect(textOf(page)).toContain("Reports for all 12 Federal Reserve districts and the U.S.");
    expect(shortenPageLife).toHaveBeenCalled();
  });
});
