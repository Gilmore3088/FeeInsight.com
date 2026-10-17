import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { buildTrend, pairStress, type MemShareRow } from "./making-ends-meet-aggregates";

const row = (series_key: string, period: string, value: number | null, respondents: number | null = 100): MemShareRow => ({ series_key, period, value, note: null, respondents });

describe("making ends meet aggregates", () => {
  it("builds a wave trend with changes in percentage points, oldest first", () => {
    const t = buildTrend("mem_paid_overdraft_fee", [row("mem_paid_overdraft_fee", "2022", 14.5, 4000), row("mem_paid_overdraft_fee", "2019", 18.25, 5000), row("other", "2019", 1)]);
    expect(t.waves.map((w) => w.period)).toEqual(["2019", "2022"]);
    expect(t.waves[1]).toMatchObject({ share: 14.5, respondents: 4000, change_pp: -3.75 });
    expect(t.change_since_first_pp).toBe(-3.75);
    expect(t.latest?.period).toBe("2022");
  });

  it("computes no change across a blank or a single wave", () => {
    expect(buildTrend("s", [row("s", "2019", null), row("s", "2022", 10)]).change_since_first_pp).toBeNull();
    expect(buildTrend("s", [row("s", "2022", 10)])).toMatchObject({ change_since_first_pp: null, latest: { change_pp: null } });
    expect(buildTrend("s", [])).toMatchObject({ waves: [], latest: null });
  });

  it("pairs payers with non-payers, each share with its count", () => {
    const pairs = pairStress([
      row("mem_difficulty_paying_bills_among_od_payers", "2022", 62, 800),
      row("mem_difficulty_paying_bills_among_od_nonpayers", "2022", 28, 3200),
      row("mem_used_any_afs_among_od_payers", "2022", 20, 790),
      row("mem_paid_overdraft_fee", "2022", 15),
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({
      measure: "mem_difficulty_paying_bills",
      payers: { share: 62, respondents: 800 },
      nonpayers: { share: 28, respondents: 3200 },
      gap_pp: 34,
    });
    expect(pairs[1]).toMatchObject({ measure: "mem_used_any_afs", nonpayers: null, gap_pp: null });
  });
});
