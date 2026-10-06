import { describe, expect, it } from "vitest";
import { sameQuarterYoy } from "./service-charge-context";

describe("sameQuarterYoy", () => {
  it("compares the newest quarter with the same quarter a year earlier", () => {
    const rows = [
      { quarter: "2026-Q2", value: 110 },
      { quarter: "2026-Q1", value: 90 },
      { quarter: "2025-Q4", value: 95 },
      { quarter: "2025-Q3", value: 99 },
      { quarter: "2025-Q2", value: 100 },
    ];
    expect(sameQuarterYoy(rows)).toBe(10);
  });

  it("is null when the year-earlier quarter is missing or empty", () => {
    expect(sameQuarterYoy([{ quarter: "2026-Q2", value: 110 }, { quarter: "2026-Q1", value: 90 }])).toBeNull();
    expect(sameQuarterYoy([{ quarter: "2026-Q2", value: 110 }, { quarter: "2025-Q2", value: null }])).toBeNull();
    expect(sameQuarterYoy([{ quarter: "2026-Q2", value: null }, { quarter: "2025-Q2", value: 5 }])).toBeNull();
  });
});
