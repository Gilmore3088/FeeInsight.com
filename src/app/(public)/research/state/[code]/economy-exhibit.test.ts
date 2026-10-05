import { describe, expect, it } from "vitest";
import { isStale, leadSentences, yoyAt, yoyPct } from "./economy-exhibit";

describe("leadSentences", () => {
  it("splits off the lead and keeps the rest", () => {
    expect(leadSentences("One. Two. Three.", 2)).toEqual({ lead: "One. Two.", rest: "Three." });
    expect(leadSentences("Only one.", 3)).toEqual({ lead: "Only one.", rest: "" });
  });
});

describe("yoyPct", () => {
  it("needs a year-ago point", () => {
    const point = { date: "2026-08-01", value: 110 };
    expect(yoyPct({ series_id: "x", latest: point, year_ago: { date: "2025-08-01", value: 100 }, history: [] })).toBeCloseTo(10);
    expect(yoyPct({ series_id: "x", latest: point, year_ago: null, history: [] })).toBeNull();
    expect(yoyPct(null)).toBeNull();
  });
});

describe("yoyAt and isStale", () => {
  const history = [
    { date: "2024-12-01", value: 100 },
    { date: "2025-12-01", value: 103 },
    { date: "2026-08-01", value: 105 },
  ];
  it("measures the 12 months ending on the given date", () => {
    expect(yoyAt({ series_id: "x", latest: history[2], year_ago: null, history }, "2025-12-01")).toBeCloseTo(3);
    expect(yoyAt({ series_id: "x", latest: history[2], year_ago: null, history }, "2026-08-01")).toBeNull();
  });
  it("flags monthly data more than four months old", () => {
    const now = new Date(Date.UTC(2026, 9, 5));
    expect(isStale("2025-12-01", now)).toBe(true);
    expect(isStale("2026-08-01", now)).toBe(false);
  });
});
