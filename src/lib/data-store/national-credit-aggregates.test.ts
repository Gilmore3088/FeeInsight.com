import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { sql } from "./connection";
import { changeOver, compareStateToNation, getNationalCreditSummary, medianWithCount, summarizeSeries } from "./national-credit-aggregates";

const weekly = Array.from({ length: 14 }, (_, i) => ({
  source: "national-series",
  series_key: "natl_h8_deposits_all",
  period: `2026-${String(Math.floor(i / 4) + 7).padStart(2, "0")}-${String((i % 4) * 7 + 1).padStart(2, "0")}`,
  value: 100 + i,
  unit: "billions_dollars",
  note: null,
}));

describe("national credit aggregates", () => {
  it("summarises latest value with 4- and 12-period changes, in any input order", () => {
    const [s] = summarizeSeries([...weekly].reverse());
    expect(s.period).toBe(weekly[13].period);
    expect(s.value).toBe(113);
    expect(s.change_4).toMatchObject({ period: weekly[9].period, value: 109, change: 4 });
    expect(s.change_4.pct_change).toBeCloseTo(3.6697, 3);
    expect(s.change_12).toMatchObject({ value: 101, change: 12 });
  });

  it("computes no change across a blank or a missing history", () => {
    const points = [
      { period: "2026Q3", value: 5 },
      { period: "2026Q2", value: null },
    ];
    expect(changeOver(points, 1)).toMatchObject({ change: null, pct_change: null });
    expect(changeOver(points, 4)).toMatchObject({ period: null, change: null });
    expect(changeOver([{ period: "2026Q3", value: -2 }, { period: "2026Q2", value: 0 }], 1)).toMatchObject({ change: -2, pct_change: null });
  });

  it("compares a state with the nation and the states' median with its count", () => {
    const [state] = summarizeSeries([
      { source: "nyfed-household-debt", series_key: "hhd_auto_balance_per_capita", period: "2024Q4", value: 6000, unit: "dollars", note: null },
    ]);
    const [row] = compareStateToNation(
      [state],
      [{ series_key: "hhd_auto_balance_per_capita", period: "2024Q4", value: 5000 }],
      [{ series_key: "hhd_auto_balance_per_capita", period: "2024Q4", states: 51, median: 5100, rank: 7 }],
    );
    expect(row).toMatchObject({ national_value: 5000, difference: 1000, ratio: 1.2, states_median: 5100, states_count: 51, rank: 7 });
    const [none] = compareStateToNation([state], [], []);
    expect(none).toMatchObject({ national_value: null, difference: null, ratio: null, states_median: null, states_count: 0 });
  });

  it("medians carry their count and skip nulls", () => {
    expect(medianWithCount([3, null, 1, 2, 10])).toEqual({ median: 2.5, count: 4 });
    expect(medianWithCount([null])).toEqual({ median: null, count: 0 });
  });

  it("never reads a struck series (Freddie Mac PMMS, Philadelphia Fed cards; 2026-10-18)", async () => {
    const mocked = sql as unknown as ReturnType<typeof vi.fn>;
    mocked.mockReset();
    mocked.mockResolvedValue([]);
    await getNationalCreditSummary();
    const [strings, ...values] = mocked.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toContain("series_key <> ALL(?::text[])");
    expect(values).toContainEqual(expect.arrayContaining(["natl_pmms_30y_fixed", "natl_lbccm_apr_avg"]));
  });
});
