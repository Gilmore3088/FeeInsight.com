import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, cacheCalls } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  cacheCalls: [] as Array<{ keys: string[]; tags: string[] }>,
}));
vi.mock("./connection", () => ({ getSql: () => sqlMock }));
vi.mock("next/cache", () => ({
  unstable_cache: (read: () => Promise<unknown>, keys: string[], opts: { tags: string[] }) => {
    cacheCalls.push({ keys, tags: opts.tags });
    return read;
  },
}));

import {
  PUBLISHED_REPORTS_TAG,
  filterReportCatalog,
  getPublicReportCatalogCached,
  type PublicReportRow,
} from "./published-reports";

const row = (over: Partial<PublicReportRow>): PublicReportRow => ({
  id: "1", report_type: "national_index", slug: "a", title: "A", published_at: "2026-10-01T00:00:00.000Z", ...over,
});

beforeEach(() => sqlMock.mockReset());

describe("public report catalog (#1953)", () => {
  it("reads through the data cache under the tag the publish action invalidates", () => {
    expect(cacheCalls).toEqual([{ keys: ["published-report-catalog-v1"], tags: [PUBLISHED_REPORTS_TAG] }]);
  });

  it("returns plain rows with ISO dates and keeps an empty catalog empty", async () => {
    sqlMock.mockResolvedValueOnce([{ id: 7, report_type: "state_index", slug: "fl", title: "Florida", published_at: new Date("2026-10-02T12:00:00Z") }]);
    expect(await getPublicReportCatalogCached()).toEqual([
      { id: "7", report_type: "state_index", slug: "fl", title: "Florida", published_at: "2026-10-02T12:00:00.000Z" },
    ]);
    sqlMock.mockResolvedValueOnce([]);
    expect(await getPublicReportCatalogCached()).toEqual([]);
  });

  it("throws a database error so it is never cached as an empty catalog", async () => {
    sqlMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(getPublicReportCatalogCached()).rejects.toThrow("timeout");
  });

  it("applies the type and date filters to the cached rows", () => {
    const rows = [
      row({ id: "1", report_type: "national_index", published_at: "2026-10-10T00:00:00.000Z" }),
      row({ id: "2", report_type: "state_index", published_at: "2026-06-01T00:00:00.000Z" }),
    ];
    expect(filterReportCatalog(rows, null, null).map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterReportCatalog(rows, "state_index", null).map((r) => r.id)).toEqual(["2"]);
    expect(filterReportCatalog(rows, null, "2026-09-01T00:00:00.000Z").map((r) => r.id)).toEqual(["1"]);
  });
});
