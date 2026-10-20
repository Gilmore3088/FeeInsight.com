import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * /guides is cached for an hour. When the guides read fails it serves the seed list, and that
 * render must be cached for a minute (shortenPageLife), not the hour, so the next render reads
 * the database again (#1811).
 */
const reads = vi.hoisted(() => ({ published: vi.fn() }));
const shortenPageLife = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/data-store/guides", () => ({ getPublishedGuides: reads.published }));
vi.mock("@/lib/public-stats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/public-stats")>()),
  getPublicSnapshot: vi.fn(async () => ({
    summary: {
      complete: true,
      institutionsLabel: "1,000",
      monitoredLabel: "9,000",
      observationsLabel: "50,000",
      freshnessLabel: "Data refreshed Oct 14, 2026",
    },
    categories: [{ fee_category: "overdraft", median_amount: 30 }],
  })),
}));
vi.mock("@/lib/data-store/public-read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/public-read-cache")>()),
  shortenPageLife,
}));

import GuidesIndexPage from "./page";
import { SEED_GUIDES } from "@/lib/guides/source";

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("/guides seed fallback cache life (#1811)", () => {
  it("caches a render that fell back to the seed after a failed read for a minute", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    reads.published.mockRejectedValue(new Error("connection reset"));
    await GuidesIndexPage();
    expect(shortenPageLife).toHaveBeenCalled();
  });

  it("keeps the hour when the guides came from the database", async () => {
    reads.published.mockResolvedValue(SEED_GUIDES);
    await GuidesIndexPage();
    expect(shortenPageLife).not.toHaveBeenCalled();
  });

  it("keeps the hour when the table is reachable but not seeded yet", async () => {
    reads.published.mockResolvedValue([]);
    await GuidesIndexPage();
    expect(shortenPageLife).not.toHaveBeenCalled();
  });
});
