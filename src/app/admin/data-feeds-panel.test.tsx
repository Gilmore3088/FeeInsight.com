// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataFeedsPanel, daysBetween } from "./data-feeds-panel";
import type { FeedFreshness } from "@/lib/data-store/feed-freshness";

afterEach(() => cleanup());

const freshness: FeedFreshness = {
  readAt: "2026-10-05T20:00:00.000Z",
  feeds: [
    { source: "fdic-financials", latestPeriod: "2026Q2", lastSuccessAt: "2026-10-05T11:17:43.000Z", nextAttemptAt: null, failed: 0, scheduled: 0, lastError: null },
    { source: "cfpb", latestPeriod: "2026", lastSuccessAt: "2026-10-04T16:47:57.000Z", nextAttemptAt: null, failed: 2, scheduled: 0, lastError: "HTTP 503" },
  ],
  callReports: [
    { source: "ffiec", latestPeriod: "2026-03-31", lastFetchedAt: "2026-08-10T10:51:17.000Z", behind: true },
  ],
  reports: [
    { key: "published_reports", count: 0, lastAt: null, lastStatus: null, lastError: null },
    { key: "run:atlas.scoreboard", count: null, lastAt: "2026-10-05T12:17:00.000Z", lastStatus: "completed", lastError: null },
  ],
};

describe("DataFeedsPanel", () => {
  it("shows each feed's period, age and failures, and each report's last run", () => {
    render(<DataFeedsPanel freshness={freshness} />);
    expect(screen.getByText("FDIC call reports")).toBeTruthy();
    expect(screen.getByText("2026Q2")).toBeTruthy();
    expect(screen.getByText(/2 failed: HTTP 503/)).toBeTruthy();
    expect(screen.getByText(/Quarter ending 2026-03-31 \(behind other sources\)/)).toBeTruthy();
    expect(screen.getByText("(56 days ago)")).toBeTruthy();
    expect(screen.getByText("Reports published to the public library")).toBeTruthy();
    expect(screen.getByText("(never)")).toBeTruthy();
    expect(screen.getByText("Pipeline scoreboard")).toBeTruthy();
  });

  it("counts whole days", () => {
    expect(daysBetween("2026-10-04T16:00:00.000Z", "2026-10-05T20:00:00.000Z")).toBe(1);
    expect(daysBetween(null, "2026-10-05T20:00:00.000Z")).toBeNull();
  });
});
