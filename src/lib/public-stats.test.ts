import { describe, expect, it } from "vitest";
import {
  UNAVAILABLE_LABEL,
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
    expect(formatAbsoluteDate("2026-08-12T00:00:00.000Z")).toMatch(/Aug 1[12], 2026/);
    expect(formatAbsoluteDate(null)).toBeNull();
    expect(formatAbsoluteDate("not a date")).toBeNull();
  });

  it("uses one freshness sentence sitewide", () => {
    expect(formatFreshness("2026-08-12T12:00:00.000Z")).toMatch(/^Data refreshed Aug 12, 2026$/);
    expect(formatFreshness(null)).toBe("Data refresh pending");
  });
});
