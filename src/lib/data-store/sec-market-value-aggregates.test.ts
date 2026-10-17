import { describe, expect, it } from "vitest";

import { changeOver, floatToEquity } from "./sec-market-value-aggregates";

describe("SEC market value reads", () => {
  it("compares the newest value with one old enough", () => {
    const rows = [
      { period_end: "2025-06-30", value: 70 },
      { period_end: "2025-03-31", value: 66 },
      { period_end: "2024-06-28", value: 56 },
    ];
    expect(changeOver(rows, 300)).toEqual({ latest: rows[0], prior: rows[2], change_pct: 25 });
    expect(changeOver(rows.slice(0, 2), 300)).toEqual({ latest: rows[0], prior: null, change_pct: null });
    expect(changeOver([], 300).latest).toBeNull();
    expect(changeOver([{ period_end: "2025-06-30", value: 5 }, { period_end: "2024-06-30", value: 0 }], 300).change_pct).toBeNull();
  });

  it("gives float-to-equity only with positive equity", () => {
    expect(floatToEquity({ period_end: "2025-06-30", value: 1500 }, { period_end: "2025-06-30", value: 1000 })).toBe(1.5);
    expect(floatToEquity({ period_end: "2025-06-30", value: 1500 }, { period_end: "2025-06-30", value: -3 })).toBeNull();
    expect(floatToEquity(null, { period_end: "2025-06-30", value: 1000 })).toBeNull();
  });
});
