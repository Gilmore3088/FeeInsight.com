import { describe, expect, it, vi } from "vitest";
import { matchedPercent, readSourceCheckWeek, sourceCheckParagraphs } from "./source-check-stats";

const week = { checks: 662_747, matched: 659_869, takenDown: 6_542, through: "2026-10-09" };

describe("matchedPercent", () => {
  it("rounds down to one decimal so a near-total share never reads 100%", () => {
    expect(matchedPercent({ checks: 10_000, matched: 9_999 })).toBe("99.9");
    expect(matchedPercent({ checks: 3, matched: 2 })).toBe("66.6");
  });
});

describe("sourceCheckParagraphs", () => {
  it("says exactly what was measured, with the count, the window and the takedowns", () => {
    const [measured, takedowns, scope] = sourceCheckParagraphs(week)!;
    expect(measured).toContain("In the 7 days through October 9, 2026, 99.5% of 662,747 fee checks");
    expect(measured).toContain("name and amount stated in the bank's own published schedule");
    expect(takedowns).toContain("6,542 fees were taken off");
    expect(takedowns).toContain("describes the check, not a share of all fees");
    expect(scope).toContain("does not confirm how often a fee is charged");
  });

  it("never claims accuracy", () => {
    expect(sourceCheckParagraphs(week)!.join(" ").toLowerCase()).not.toContain("accura");
  });

  it("shows nothing without a measurement", () => {
    expect(sourceCheckParagraphs(null)).toBeNull();
    expect(sourceCheckParagraphs({ ...week, checks: 0 })).toBeNull();
  });

  it("uses the singular for one takedown", () => {
    expect(sourceCheckParagraphs({ ...week, takenDown: 1 })![1]).toContain("1 fee was taken off");
  });
});

describe("readSourceCheckWeek", () => {
  it("reads the totals from the publish steps' events", async () => {
    const db = vi.fn(async () => [{ checks: "662747", matched: "659869", taken_down: "6542", through: "2026-10-09" }]);
    expect(await readSourceCheckWeek(db as never)).toEqual(week);
  });

  it("returns null when no check ran or the read fails", async () => {
    const empty = vi.fn(async () => [{ checks: null, matched: null, taken_down: null, through: null }]);
    expect(await readSourceCheckWeek(empty as never)).toBeNull();
    const broken = vi.fn(async () => {
      throw new Error("down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readSourceCheckWeek(broken as never)).toBeNull();
  });
});
