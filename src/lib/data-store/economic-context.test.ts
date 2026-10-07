import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { buildIndicatorSeries, fomcPolicyAction } from "./economic-context";

describe("buildIndicatorSeries", () => {
  it("finds the year-ago point and returns history oldest first", () => {
    const rows = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7 - i, 1));
      return { observation_date: d, value: String(4 + i * 0.1) };
    });
    const series = buildIndicatorSeries("TXUR", rows)!;
    expect(series.latest).toEqual({ date: "2026-08-01", value: 4 });
    expect(series.year_ago?.date).toBe("2025-08-01");
    expect(series.year_ago?.value).toBeCloseTo(5.2);
    expect(series.history[0].date).toBe("2025-07-01");
    expect(series.history.at(-1)?.date).toBe("2026-08-01");
  });

  it("returns no year-ago point when the series is short, and null when empty", () => {
    expect(buildIndicatorSeries("X", [{ observation_date: "2026-08-01", value: 1 }])?.year_ago).toBeNull();
    expect(buildIndicatorSeries("X", [{ observation_date: "2026-08-01", value: "n/a" }])).toBeNull();
  });

  it("drops stored zeros as missing months, except where zero is a real reading", () => {
    const rows = [
      { observation_date: "2025-12-01", value: "4.3" },
      { observation_date: "2025-11-01", value: "0" },
      { observation_date: "2025-10-01", value: "4.2" },
    ];
    expect(buildIndicatorSeries("TXUR", rows)!.history.map((p) => p.value)).toEqual([4.2, 4.3]);
    expect(buildIndicatorSeries("FEDFUNDS", rows)!.history.map((p) => p.value)).toEqual([4.2, 0, 4.3]);
  });
});

describe("fomcPolicyAction", () => {
  it("finds the sentence that records the rate decision", () => {
    const text =
      "Staff Economic Outlook. Inflation eased. Committee Policy Actions In support of the Committee's goals, almost all members agreed to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent. Members noted risks.";
    expect(fomcPolicyAction(text)).toBe(
      "In support of the Committee's goals, almost all members agreed to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent.",
    );
  });

  it("returns null when the minutes have no decision sentence", () => {
    expect(fomcPolicyAction("Participants discussed the outlook. No action.")).toBeNull();
  });
});
