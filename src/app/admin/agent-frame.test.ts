import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import type { ScoreboardSnapshotRow } from "@/lib/data-store/answer-key";
import type { SpendLine } from "@/lib/data-store/console-spend";
import { AGENT_GUIDES, agentScoreVitals, agentSpendVital, toRecentStep, type FrameAgent } from "./agent-frame";
import { existsSync } from "node:fs";

const snapshot = {
  snapshot_date: "2026-10-12",
  right_document_rate: 0.81,
  right_document_denominator: 2400,
  darwin_backlog: 312,
  goal: {
    liveInstitutions: { live: 3100, addedThisWeek: 42 },
    coverageCells: { readyCells: 64, totalCells: 161, institutionsShort: 900 },
    knoxPasses: { zeroCostShare: 0.62, free: { rowsKept: 620 }, paid: { rowsKept: 380 } },
    wrongAfterPublish: { rate: 0.0123, wrong: 12, published: 975 },
  },
} as unknown as ScoreboardSnapshotRow;

describe("agent frame (admin redesign #1122, step 4)", () => {
  it("gives each pipeline agent the scorecard numbers it owns, dated", () => {
    const values = (agent: FrameAgent) => agentScoreVitals(agent, snapshot).map((vital) => [vital.label, vital.value]);
    expect(values("atlas")).toEqual([["Institutions with live fees", "3,100"]]);
    expect(values("magellan")).toEqual([["Coverage groups", "64 of 161"]]);
    expect(values("rosetta")).toEqual([["Right document", "81.0%"]]);
    expect(values("knox")).toEqual([["Fees found at $0", "62.0%"]]);
    expect(values("darwin")).toEqual([["Darwin backlog", "312"], ["Wrong after publish", "1.2%"]]);
    expect(agentScoreVitals("knox", snapshot)[0].note).toBe("of 1,000 kept fees came from the free pass · scorecard 2026-10-12");
  });

  it("says a number is unknown instead of showing zero", () => {
    for (const agent of Object.keys(AGENT_GUIDES) as FrameAgent[]) {
      const vitals = agentScoreVitals(agent, null);
      expect(vitals.every((vital) => vital.value === null && vital.note === "No scorecard snapshot yet.")).toBe(true);
    }
  });

  it("shows the agent's own spend and cap, and says when the ledger could not be read", () => {
    const lines: SpendLine[] = [{ key: "knox", todayUsd: 1, monthUsd: 12.5, dailyCapUsd: 5, monthlyCapUsd: 100, enabled: true }];
    expect(agentSpendVital("knox", lines)).toMatchObject({ value: "$12.50", note: "of $100.00 monthly cap" });
    expect(agentSpendVital("rosetta", lines)).toMatchObject({ value: "$0.00", note: "No paid calls this month and no cap of its own" });
    expect(agentSpendVital("knox", null)).toMatchObject({ value: null, note: "Could not read provider usage." });
    const off = [{ ...lines[0], enabled: false }];
    expect(agentSpendVital("knox", off).note).toBe("of $100.00 monthly cap; paid calls switched off");
  });

  it("shows a failed step's error and a finished step's summary", () => {
    expect(toRecentStep({ id: 1, title: "Read", status: "failed", summary: "Read 3", error_summary: "timeout", completed_at: "2026-10-13T01:00:00Z" }))
      .toMatchObject({ line: "timeout", at: "2026-10-13T01:00:00.000Z" });
    expect(toRecentStep({ id: 2, step_key: "rosetta-read", status: "completed", summary: "Read 3", started_at: "2026-10-13T00:00:00Z" }))
      .toMatchObject({ title: "rosetta-read", line: "Read 3", at: "2026-10-13T00:00:00.000Z" });
  });

  it("links each agent to a guide that exists", () => {
    for (const path of Object.values(AGENT_GUIDES)) expect(existsSync(path)).toBe(true);
  });
});
