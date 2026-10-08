import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const mockSql = vi.fn();
  return { getSql: () => mockSql, sql: mockSql };
});

import { sql } from "./connection";
import { getCallReportFreshness, getRegistryFeedFreshness, getReportFreshness } from "./feed-freshness";

const mock = sql as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mock.mockReset());

describe("getRegistryFeedFreshness", () => {
  it("maps registry rows to feed freshness", async () => {
    mock.mockResolvedValueOnce([
      {
        source: "fdic-financials",
        latest_period: "2026Q2",
        last_success_at: new Date("2026-10-05T11:17:43Z"),
        next_attempt_at: null,
        failed: 0,
        scheduled: 0,
        last_error: null,
      },
    ]);
    expect(await getRegistryFeedFreshness()).toEqual([
      {
        source: "fdic-financials",
        latestPeriod: "2026Q2",
        lastSuccessAt: "2026-10-05T11:17:43.000Z",
        nextAttemptAt: null,
        failed: 0,
        scheduled: 0,
        lastError: null,
      },
    ]);
  });
});

describe("getCallReportFreshness", () => {
  it("flags a source whose newest quarter is older than another source's", async () => {
    mock.mockResolvedValueOnce([
      { source: "fdic", latest_period: new Date("2026-06-30T00:00:00Z"), last_fetched_at: new Date("2026-10-05T11:17:43Z") },
      { source: "ncua", latest_period: "2026-03-31", last_fetched_at: "2026-08-10T10:51:17Z" },
    ]);
    const rows = await getCallReportFreshness();
    expect(rows.map((r) => [r.source, r.latestPeriod, r.behind])).toEqual([
      ["fdic", "2026-06-30", false],
      ["ncua", "2026-03-31", true],
    ]);
  });

  it("reads only the fdic and ncua sources", async () => {
    mock.mockResolvedValueOnce([]);
    await getCallReportFreshness();
    expect((mock.mock.calls[0][0] as string[]).join("?")).toContain("source IN ('fdic', 'ncua')");
  });
});

describe("getReportFreshness", () => {
  it("lists report files, library, Pro reports and each scheduled run, including ones that never ran", async () => {
    const results = [
      [
        { report_type: "monthly_pulse", complete: 2, last_complete_at: "2026-08-10T11:20:50Z", last_status: "complete", last_error: null },
      ],
      [{ n: 0, last_at: null }],
      [{ n: 12, last_at: "2026-10-05T19:44:00Z" }],
      [{ triggered_by: "atlas.scoreboard", status: "completed", last_at: "2026-10-05T12:17:00Z", error_summary: null }],
    ];
    // sql([...]) builds the IN list; only tagged-template calls are queries.
    mock.mockImplementation((first: unknown) =>
      Array.isArray(first) && !("raw" in first) ? first : Promise.resolve(results.shift()),
    );
    const rows = await getReportFreshness();
    expect(rows.find((r) => r.key === "report_jobs:monthly_pulse")).toMatchObject({ count: 2, lastAt: "2026-08-10T11:20:50Z" });
    expect(rows.find((r) => r.key === "published_reports")).toMatchObject({ count: 0, lastAt: null });
    expect(rows.find((r) => r.key === "hamilton_reports")).toMatchObject({ count: 12 });
    expect(rows.find((r) => r.key === "run:atlas.scoreboard")).toMatchObject({ count: null, lastStatus: "completed" });
    expect(rows.find((r) => r.key === "run:atlas.daily_brief")).toMatchObject({ count: null, lastAt: null, lastStatus: null });
  });
});
