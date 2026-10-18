import { describe, expect, it } from "vitest";
import {
  UNAVAILABLE_LABEL,
  benchmarkBasis,
  formatAbsoluteDate,
  formatCount,
  formatCountOrUnavailable,
  formatFreshness,
} from "./public-stats";

describe("public stats formatting", () => {
  it("formats counts with thousands separators", () => {
    expect(formatCount(1183)).toBe("1,183");
    expect(formatCount(0)).toBe("0");
  });

  it("shows a failed count as unavailable, never as 0", () => {
    expect(formatCountOrUnavailable(null)).toBe(UNAVAILABLE_LABEL);
    expect(formatCountOrUnavailable(null)).not.toBe("0");
    expect(formatCountOrUnavailable(58)).toBe("58");
  });

  it("formats absolute dates and tolerates bad input", () => {
    // A calendar date keeps its own day.
    expect(formatAbsoluteDate("2026-08-12T00:00:00.000Z")).toBe("Aug 12, 2026");
    expect(formatAbsoluteDate("2026-08-12")).toBe("Aug 12, 2026");
    // A U.S. evening publish (01:00 UTC) keeps the U.S. date.
    expect(formatAbsoluteDate("2026-10-18T01:00:00.000Z")).toBe("Oct 17, 2026");
    expect(formatAbsoluteDate(null)).toBeNull();
    // Read in U.S. Eastern time: 02:00 UTC on Oct 18 is still Oct 17 there.
    expect(formatAbsoluteDate("2026-10-18T02:00:00.000Z")).toBe("Oct 17, 2026");
    expect(formatAbsoluteDate("not a date")).toBeNull();
  });

  it("uses one freshness sentence sitewide", () => {
    expect(formatFreshness("2026-08-12T12:00:00.000Z")).toMatch(/^Data refreshed Aug 12, 2026$/);
    expect(formatFreshness(null)).toBe("Data refresh pending");
  });
});

describe("benchmarkBasis", () => {
  it("states the measure, sample, unit and date beside a benchmark", () => {
    expect(
      benchmarkBasis({ median_amount: 30, institution_count: 798, total_observations: 945 }, "Oct 5, 2026"),
    ).toBe("Median $30 · 798 institutions · 945 published fee entries · updated Oct 5, 2026");
    expect(benchmarkBasis({ median_amount: null, institution_count: 1, total_observations: 1 }, null)).toBe(
      "1 institution · 1 published fee entry",
    );
  });
});
