import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { compareMeasure, type MonthlyReview } from "@/lib/agents/deming/monthly-review";
import { MonthlyReviewSection } from "./monthly-review";

const held = { key: "knox_without_darwin", label: "Institutions with Knox rows and no Darwin result", unit: "count" as const, better: "lower" as const, limit: { relative: 0.25 }, baseline: 512, baselineNote: "Review: 512." };
const recall = { key: "answer_key_recall", label: "Answer key: share of real fees Knox finds", unit: "share" as const, better: "higher" as const, limit: { points: 0.03 }, baseline: 0.65, baselineNote: null };

const review: MonthlyReview = {
  version: 1,
  month: "2026-11",
  ranAt: "2026-11-01T06:00:00Z",
  lastMonth: "2026-10",
  baselineDate: "2026-10-12",
  agents: [{
    agent: "knox",
    name: "Knox",
    tracker: 1092,
    review: "docs/plans/knox-review-2026-10-12.md",
    measures: [compareMeasure(held, 800, null, 500), compareMeasure(recall, null, "statement timeout", 0.7)],
  }],
  alarms: [{ agent: "knox", key: held.key, label: held.label, from: 500, to: 800, comparedWith: "last_month", tracker: 1092 }],
  measured: 1,
  unknown: 1,
};

describe("monthly review section (#1107)", () => {
  it("shows this month against last month and the review's figure, the alarm, and unknown as unknown", () => {
    const html = renderToStaticMarkup(<MonthlyReviewSection review={review} failed={false} />);
    expect(html).toContain("Monthly review, 2026-11");
    expect(html).toContain("1 measure past its limit.");
    expect(html).toContain("ALARM: Institutions with Knox rows and no Darwin result");
    expect(html).toContain("800");
    expect(html).toContain("↑");
    expect(html).toContain("Unknown: statement timeout");
    expect(html).not.toMatch(/>0\.0%</);
    expect(html).toContain("Tracker #1092");
    expect(html).toContain('scope="col"');
  });

  it("says when no review has run yet", () => {
    expect(renderToStaticMarkup(<MonthlyReviewSection review={null} failed={false} />)).toContain("No monthly review has run yet");
    expect(renderToStaticMarkup(<MonthlyReviewSection review={null} failed />)).toContain("could not be read");
  });
});
