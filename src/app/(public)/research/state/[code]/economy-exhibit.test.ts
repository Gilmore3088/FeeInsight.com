import { describe, expect, it } from "vitest";
import { leadSentences, yoyPct } from "./economy-exhibit";

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
