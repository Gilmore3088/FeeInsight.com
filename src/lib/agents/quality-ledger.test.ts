import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { qualityLedgerLines, readQualityLedger } from "./quality-ledger";

describe("readQualityLedger", () => {
  it("reads the three live counts and the newest answer-key score", async () => {
    const db = Object.assign(vi.fn((strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join("").includes("answer_key_score_runs")
          ? [{ id: 9, agent_run_id: null, scorer_version: 2, scored_at: "2026-10-14T16:53:00Z", banks_scored: 62, fees_expected: 2320, precision: "0.874", recall: "0.575" }]
          : [{ live_fees: 76629, stored_notes: 0, per_item_periods: 6, no_source_link: 13 }],
      ),
    ), { unsafe: vi.fn((text: string) => text) });
    const ledger = await readQualityLedger(db as never);
    expect(ledger).toEqual({
      answerKey: { precision: 0.874, recall: 0.575, scoredAt: "2026-10-14T16:53:00Z", scorerVersion: 2 },
      liveFees: 76629, storedNotes: 0, perItemPeriods: 6, noSourceLink: 13,
    });
    const perItem = String(db.unsafe.mock.calls[0]?.[0]);
    expect(perItem).toContain("(fee_category = 'nsf' AND frequency IN ('monthly', 'annual', 'daily'))");
    expect(perItem).toContain("(fee_category = 'overdraft' AND frequency IN ('monthly', 'annual', 'quarterly', 'daily'))");
    expect(perItem).toContain("(fee_category = 'continuous_od' AND frequency IN ('monthly', 'quarterly', 'annual'))");
  });

  it("says so when the answer key has no score", () => {
    expect(qualityLedgerLines({ answerKey: null, liveFees: 0, storedNotes: 0, perItemPeriods: 0, noSourceLink: 0 })[0]).toBe("Answer key: no score yet.");
  });
});
