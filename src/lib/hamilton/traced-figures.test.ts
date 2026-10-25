import { describe, expect, it } from "vitest";
import { figuresTraceToRecords, tracedFigureLines } from "./traced-figures";

// Synthetic records: one saved $35 fee and one 12% share.
const records = [{ value: 35, unit: "usd" }, { value: 12, unit: "percent" }];

describe("a saved answer's figure lines print only when they trace to its records (#1899)", () => {
  it("keeps a line whose every number is a traced $ or % figure, and ignores dates", () => {
    expect(figuresTraceToRecords("$35", records)).toBe(true);
    expect(figuresTraceToRecords("Overdraft fee · $35 · Published schedule · 2026-06-30", records)).toBe(true);
    expect(figuresTraceToRecords("Share of income · 12% · As of Oct 5, 2026 (Q2 2026)", records)).toBe(true);
    expect(figuresTraceToRecords("Overdraft fee · $35 · Fee schedule, September 30, 2026; filed in 2025; FY 2026 through December 2026", records)).toBe(true);
  });

  it.each([
    ["an untraced figure", "$41"],
    ["a bare number beside a traced one", "$35 vs 41"],
    ["a number worded in a note", "$35 · peer median 41 dollars"],
    ["a currency code", "USD 41 / $35"],
    ["a comma-joined number", "$35,41"],
    ["a full-width dollar sign", "＄41 $35"],
    ["no $ or % figure at all", "38th percentile"],
    ["a count in the year range", "$35 across 2041 peers"],
    ["a count that looks like a year", "$35 · 1999 accounts"],
    ["a day no month has", "$35 · Oct 41, 2026"],
    ["a word that starts like a month", "$35 · Mayday 41, 2026"],
    ["an ISO date with no such month or day", "$35 · 2026-41-99"],
    ["a quarter in a year out of range", "$35 · Q2 2041"],
  ])("drops %s: %s", (_case, text) => {
    expect(figuresTraceToRecords(text, records)).toBe(false);
  });

  it("drops every line when no record was saved", () => {
    expect(figuresTraceToRecords("$35", [])).toBe(false);
  });

  it("checks the label and note as well as the value", () => {
    const lines = [
      { label: "Overdraft fee", value: "$35" },
      { label: "Overdraft fee", value: "$35", note: "peer median 41 dollars" },
      { label: "Fee across 41 peers", value: "$35" },
      { label: "Peer median", value: "$41" },
    ];
    expect(tracedFigureLines(lines, records)).toEqual([{ label: "Overdraft fee", value: "$35" }]);
  });
});
