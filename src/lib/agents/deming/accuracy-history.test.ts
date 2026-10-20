import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
import { bucketAccuracyHistory, readAccuracyHistory } from "./accuracy-history";
import { accuracyDays, type AuditObservation } from "./accuracy-measure";

const now = new Date("2026-10-21T10:00:00Z");
function day(at: string, series = 75) {
  return accuracyDays([{ at, detail: {
    reporting_version: 1, version: 5, category_guard_version: series, source_check_version: 18, name_check_version: 23,
    seed: at.slice(0, 10), right: 1, scorable: 1, no_text: 0, sampled: 1, observations: [[Number(at.slice(8, 10)), "right"] as AuditObservation],
  } }]).days[0];
}

describe("persisted weekly accuracy history", () => {
  it("reconstructs calendar weeks from durable daily snapshots, without counting copied rolling windows twice", () => {
    const a = day("2026-10-18T01:00:00Z");
    const b = day("2026-10-19T01:00:00Z");
    const result = bucketAccuracyHistory([a, a, b], now, 2);
    expect(result.weeks).toHaveLength(2);
    expect(result.weeks[0]).toMatchObject({ weekStart: "2026-10-12", right: 1, scorable: 1, audits: 1, partial: false });
    expect(result.weeks[1]).toMatchObject({ weekStart: "2026-10-19", right: 1, scorable: 1, audits: 1, partial: true });
  });

  it("shows a changed scorer as a separate row even within the same week", () => {
    const result = bucketAccuracyHistory([day("2026-10-19T01:00:00Z"), day("2026-10-20T01:00:00Z", 76)], now, 1);
    expect(result.weeks.map((week) => [week.series, week.scoringChanged, week.scorable])).toEqual([
      ["1.5.75.18.23", false, 1], ["1.5.76.18.23", true, 1],
    ]);
  });

  it("keeps unknown-version legacy counts apart and gives quiet weeks no evidence, not zero accuracy", () => {
    const old = { at: "2026-10-12T01:00:00Z", right: 198, scorable: 200, accuracy: 0.99, amount: 2, category: 0, evidence: 0, notAFee: 0, name: 0 };
    const result = bucketAccuracyHistory([old, day("2026-10-19T01:00:00Z")], now, 3);
    expect(result.weeks[0]).toMatchObject({ audits: 0, accuracy: null, range: null });
    expect(result.weeks[1]).toMatchObject({ series: null, right: 198, range: null, status: "legacy" });
    expect(result.weeks[2]).toMatchObject({ scoringChanged: true, series: "1.5.75.18.23" });
  });

  it("reads only the persisted audit receipts, so history survives run-event retention", async () => {
    const db = vi.fn(async () => [{ day: day("2026-10-19T01:00:00Z") }]);
    const result = await readAccuracyHistory(db as never, now);
    expect(result.weeks.at(-1)).toMatchObject({ audits: 1, right: 1 });
    const query = (db.mock.calls[0] as unknown as [TemplateStringsArray])[0].join("?");
    expect(query).toContain("pipeline_scoreboard_snapshots");
    expect(query).not.toContain("agent_run_events");
    expect(query).toContain("DISTINCT ON");
  });

  it("keeps pre-receipt rolling snapshots visible without adding their overlapping totals", async () => {
    const db = vi.fn(async () => [
      { day: null, snapshot_day: "2026-10-12", legacy: { right: 1393, scorable: 1400, accuracy: 0.995 } },
      { day: null, snapshot_day: "2026-10-13", legacy: { right: 1394, scorable: 1400, accuracy: 0.996 } },
    ]);
    const result = await readAccuracyHistory(db as never, now);
    expect(result.legacySnapshots).toHaveLength(2);
    expect(result.weeks.every((week) => week.audits === 0 && week.range === null)).toBe(true);
  });
});
