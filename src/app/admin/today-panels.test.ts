import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import type { ScoreboardSnapshotRow } from "@/lib/data-store/answer-key";
import { todayVitals, type Vital } from "./today-panels";

const spend: Vital = { label: "Spend today", value: "$4.10", note: "of $75.00 daily cap (UTC day)", href: "/admin/controls" };

describe("todayVitals (admin redesign #1122)", () => {
  it("shows the five numbers from the newest scorecard, dated, with spend live", () => {
    const snapshot = {
      snapshot_date: "2026-10-12",
      darwin_backlog: 312,
      goal: {
        accuracy: { accuracy: 0.92, scorable: 400 },
        coverageCells: { readyCells: 64, totalCells: 161 },
        wrongAfterPublish: { rate: 0.0123, wrong: 12, published: 975 },
      },
    } as unknown as ScoreboardSnapshotRow;
    const vitals = todayVitals(snapshot, spend);
    expect(vitals.map((vital) => vital.label)).toEqual([
      "Accuracy, 7 days", "Coverage groups", "Wrong after publish", "Spend today", "Darwin backlog",
    ]);
    expect(vitals.map((vital) => vital.value)).toEqual(["92.0%", "64 of 161", "1.2%", "$4.10", "312"]);
    expect(vitals[0].note).toBe("target 95%, 400 fees audited · scorecard 2026-10-12");
    expect(vitals[2].note).toContain("target under 1%, 12 of 975");
  });

  it("says a number is unknown instead of showing zero", () => {
    const vitals = todayVitals(null, spend);
    expect(vitals.filter((vital) => vital.label !== "Spend today").every((vital) => vital.value === null)).toBe(true);
    expect(vitals[0].note).toBe("No scorecard snapshot yet.");
    const older = todayVitals({ snapshot_date: "2026-10-01", goal: null, darwin_backlog: null } as unknown as ScoreboardSnapshotRow, spend);
    expect(older[1]).toMatchObject({ value: null, note: "Not in the newest scorecard." });
  });
});
