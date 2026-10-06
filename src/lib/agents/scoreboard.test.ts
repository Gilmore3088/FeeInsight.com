import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { PRICED_LINE_PATTERN, summarizeScoreboard, type ScoreboardSnapshotResult } from "./scoreboard";

const NUMBERS: ScoreboardSnapshotResult["numbers"] = {
  coverage: { rate: 0.4123, numerator: 4123, denominator: 10000 },
  rightDocument: { rate: 0.75, numerator: 3, denominator: 4, windowDays: 30 },
  knoxYield: { yield: 0.8, fees: 8, pricedLines: 10, sampleSize: 2 },
  depth: { median: 9, liveInstitutions: 120 },
  accuracy: { precision: 0.9, recall: 0.6, scoreRunId: 4, scoredAt: "2026-10-04T12:00:00.000Z" },
  freshness: { medianDays: 12.5, liveFees: 900 },
  knoxSurvival: {
    rate: 0.88,
    live: 880,
    published: 1000,
    byStrategy: [{ strategy: "extract.rules", rate: 0.88, live: 880, published: 1000 }],
  },
};

describe("scoreboard", () => {
  it("matches priced lines the same way as the fee-page check", () => {
    const pattern = new RegExp(PRICED_LINE_PATTERN);
    expect(pattern.test("Overdraft $32.00")).toBe(true);
    expect(pattern.test("Overdraft $ 32")).toBe(true);
    expect(pattern.test("Overdraft fee")).toBe(false);
  });

  it("summarizes the numbers with units", () => {
    const summary = summarizeScoreboard({ schemaReady: true, snapshotDate: "2026-10-04", numbers: NUMBERS, stored: true });
    expect(summary).toBe(
      "Atlas recorded the 2026-10-04 scoreboard: coverage 41.2% (4,123 of 10,000), right documents 75.0%, Knox yield 0.80 fees per priced line, depth 9 categories, accuracy 90.0% precision / 60.0% recall, freshness 12.5 days, Knox survival 88.0% of 1,000 published fees still live.",
    );
  });

  it("says when nothing was stored", () => {
    const summary = summarizeScoreboard({
      schemaReady: false,
      snapshotDate: "2026-10-04",
      numbers: { ...NUMBERS, rightDocument: null, knoxYield: null, accuracy: null },
      stored: false,
    });
    expect(summary).toContain("migration is not applied");
    expect(summary).toContain("right documents n/a");
  });
});
