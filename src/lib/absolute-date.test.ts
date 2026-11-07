import { describe, expect, it } from "vitest";
import { formatAbsoluteDate } from "./absolute-date";

describe("formatAbsoluteDate", () => {
  it("should_not_date_a_us_evening_render_tomorrow", () => {
    // 9:30pm Eastern on Nov 6 is already Nov 7 in UTC.
    expect(formatAbsoluteDate(new Date("2026-11-07T02:30:00Z"), "long")).toBe("November 6, 2026");
  });

  it("should_keep_a_calendar_date_on_its_own_day", () => {
    expect(formatAbsoluteDate(new Date("2026-11-07T00:00:00Z"), "long")).toBe("November 7, 2026");
    expect(formatAbsoluteDate("2026-11-07")).toBe("Nov 7, 2026");
  });

  it("should_return_null_for_a_missing_or_bad_value", () => {
    expect(formatAbsoluteDate(null)).toBeNull();
    expect(formatAbsoluteDate("not a date")).toBeNull();
  });
});
