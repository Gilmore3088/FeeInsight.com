import { describe, expect, it } from "vitest";
import { FOLDED_CACHE_MAX_CHARS, locateQuote, parseSourceLineTrace, sourceLineTrace, SOURCE_TRACE_QUOTE_MAX, textSha256 } from "./source-line-trace";

// Invented schedule text for tests only.
const TEXT = [
  "Deposit Account Fee Schedule",
  "Stop Payment   |   $35.00",
  "Returned Item (NSF) | $32.00 per item",
  "Wire Transfer – Domestic Outgoing | $25.00",
].join("\n");

describe("locateQuote", () => {
  it("finds a line through collapsed spaces and dash variants, in code points", () => {
    const span = locateQuote(TEXT, "Wire Transfer - Domestic Outgoing | $25.00");
    expect(span?.segment).toBe("Wire Transfer – Domestic Outgoing | $25.00");
    expect(Array.from(TEXT).slice(span!.start, span!.end).join("")).toBe(span!.segment);
  });

  it("skips a partial-token hit and finds the whole one later, counting astral characters as one", () => {
    const text = "🏦 Fee | $35.00\nFee | $3\nÉCHÉANCE Fee | $3";
    const first = locateQuote(text, "Fee | $3");
    expect(first).toMatchObject({ segment: "Fee | $3", start: Array.from(text).indexOf("\n") + 1 });
    // The same text again (cached fold) finds the same span; a non-ASCII quote folds as before.
    expect(locateQuote(text, "fee | $3")).toEqual(first);
    expect(locateQuote(text, "échéance fee | $3")?.segment).toBe("ÉCHÉANCE Fee | $3");
    expect(sourceLineTrace(text, 1, "ÉCHÉANCE Fee | $3")?.line_number).toBe(3);
  });

  it("finds a line in a text too long to cache, the same way each time", () => {
    const text = `${"Filler line | none\n".repeat(Math.ceil(FOLDED_CACHE_MAX_CHARS / 19) + 10)}Stop Payment | $35.00`;
    expect(text.length).toBeGreaterThan(FOLDED_CACHE_MAX_CHARS);
    const first = sourceLineTrace(text, 3, "Stop Payment | $35.00");
    expect(first?.quote).toBe("Stop Payment | $35.00");
    expect(sourceLineTrace(text, 3, "Stop Payment | $35.00")).toEqual(first);
  });

  it("matches whole tokens only", () => {
    expect(locateQuote("Fee | $35.00", "Fee | $3")).toBeNull();
    expect(locateQuote("Monthly fee $5", "")).toBeNull();
  });
});

describe("sourceLineTrace", () => {
  it("keeps the text id, the text's digest, the quoted line and where it sits", () => {
    const trace = sourceLineTrace(TEXT, 812, "Stop Payment | $35.00");
    expect(trace).toEqual({
      version: 1,
      text_id: 812,
      text_sha256: textSha256(TEXT),
      quote: "Stop Payment | $35.00",
      char_start: TEXT.indexOf("Stop Payment"),
      char_end: TEXT.indexOf("$35.00") + "$35.00".length,
      line_number: 2,
    });
  });

  it("keeps a line the check rebuilt from several lines without a span", () => {
    const trace = sourceLineTrace(TEXT, 812, "Stop Payment | $32.00 per item");
    expect(trace).toMatchObject({ quote: "Stop Payment | $32.00 per item", char_start: null, char_end: null, line_number: null });
  });

  it("names no text id it was not given, and caps the quote", () => {
    const long = `Overdraft fee ${"x".repeat(400)}`;
    const trace = sourceLineTrace(long, null, long);
    expect(trace?.text_id).toBeNull();
    expect(Array.from(trace!.quote)).toHaveLength(SOURCE_TRACE_QUOTE_MAX);
    expect(sourceLineTrace(TEXT, 1, "   ")).toBeNull();
    expect(sourceLineTrace("", 1, "Stop Payment")).toBeNull();
  });

  it("reads a stored trace back and refuses anything else", () => {
    const trace = sourceLineTrace(TEXT, 812, "Stop Payment | $35.00");
    expect(parseSourceLineTrace(JSON.parse(JSON.stringify(trace)))).toEqual(trace);
    expect(parseSourceLineTrace("Stop Payment")).toBeNull();
    expect(parseSourceLineTrace({ quote: "x" })).toBeNull();
  });
});
