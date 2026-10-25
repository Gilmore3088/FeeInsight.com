import { describe, expect, it } from "vitest";
import type { OcrWord } from "./ocr";
import { applyUnicodeWordRepairs, pdfWordRuns, proposeUnicodeWords, repairPattern, type PdfWordRun, type UnicodeWordRepair } from "./pdf-unicode-words";

const run = (text = "Wire Interna�onal outgoing", x0 = 0): PdfWordRun => ({ text, font: "Calibri", x0, x1: x0 + 400, y0: 0, y1: 20, em: 16 });
const word = (text = "International", confidence = 95, x0 = 50): OcrWord => ({ text, confidence, x0, x1: x0 + 100, y0: 1, y1: 19, baseline: 17, lineHeight: 20 });
const proposal = (first: OcrWord[], second = first, text = "Wire Interna�onal outgoing", runs = [run(text)]) =>
  proposeUnicodeWords(text, [{ runs, words: first }, { runs, words: second }]);
const repair: UnicodeWordRepair = { from: "Interna�onal", to: "International", occurrences: 1, confidence: [95, 94] };

describe("source-cell Unicode letter witnesses", () => {
  it("requires two agreeing visual spellings, retaining known letters", () => {
    expect(proposal([word()]).repairs).toEqual([{ ...repair, confidence: [95, 95] }]);
    expect(proposal([word()], [word("Internaxonal")]).unresolved).toEqual(["Interna�onal"]);
    expect(proposal([word("Intermational")]).repairs).toEqual([]);
  });
  it("recovers different missing pairs rather than replacing every U+FFFD with ti", () => {
    expect(proposal([word("overdrafts")], undefined, "overdra�s").repairs[0]).toMatchObject({ from: "overdra�s", to: "overdrafts" });
  });
  it("refuses weak evidence at either scale and requires one stronger scale", () => {
    expect(proposal([word()], [word("International", 84)]).repairs).toEqual([]);
    expect(proposal([word("International", 89)]).repairs).toEqual([]);
    expect(proposal([word("International", 85)], [word("International", 90)]).repairs).toHaveLength(1);
    expect(proposal([word("International", NaN)]).repairs).toEqual([]);
    expect(proposal([word("International", 101)]).repairs).toEqual([]);
  });
  it("never borrows a word from a different source cell", () => {
    expect(proposal([word("International", 99, 500)]).repairs).toEqual([]);
  });
  it("refuses ambiguous spellings in one source cell", () => {
    expect(proposal([word(), word("Internaxonal", 99, 180)]).repairs).toEqual([]);
  });
  it("needs distinct evidence for each damaged and intact occurrence", () => {
    const text = "Interna�onal Interna�onal International";
    expect(proposal([word()], undefined, text).repairs).toEqual([]);
    const all = [word(), word("International", 94, 160), word("International", 93, 280)];
    expect(proposal(all, all, text).repairs[0]?.occurrences).toBe(2);
    expect(proposal([...all.slice(0, 2), word("International", 40, 280)], undefined, text).repairs).toEqual([]);
  });
  it("requires witnesses for occurrences in all source cells", () => {
    const text = "Interna�onal\nInterna�onal";
    expect(proposal([word()], undefined, text, [run("Interna�onal")]).repairs).toEqual([]);
  });
  it("refuses unknown prefixes/suffixes, short guesses and damaged numbers", () => {
    for (const text of ["�onal", "Interna�", "a�b", "7�00", "�"]) expect(repairPattern(text)).toBeNull();
    expect(repairPattern("Interna�onal")?.test("Interna123onal")).toBe(false);
    expect(repairPattern("Interna�onal")?.test("Internationall")).toBe(false);
  });
  it("preserves all prices, punctuation, qualifiers, whitespace and cell ordering", () => {
    const text = "Wire Interna�onal Transfer-Remote Outgoing  |  $70.00*\nDomestic | $40\n* tax, per item\n";
    expect(applyUnicodeWordRepairs(text, [repair])).toBe(text.replace("Interna�onal", "International"));
    expect(applyUnicodeWordRepairs(text, [{ ...repair, to: "Domestic" }])).toBeNull();
    expect(applyUnicodeWordRepairs(text, [{ ...repair, to: "International $40" }])).toBeNull();
  });
  it("refuses excess incumbent occurrences and conflicting document-wide maps", () => {
    expect(applyUnicodeWordRepairs("Interna�onal Interna�onal", [repair])).toBeNull();
    expect(applyUnicodeWordRepairs("Interna�onal", [repair, { ...repair, to: "Internaxonal" }])).toBeNull();
    expect(applyUnicodeWordRepairs("Interna�onal Interna�onal", [repair, repair])).toBe("International International");
  });
  it("does not replace substrings in another word", () => {
    expect(applyUnicodeWordRepairs("xInterna�onal Interna�onal", [repair])).toBe("xInterna�onal International");
  });
  it("joins only contiguous horizontal items of the same font", () => {
    const item = (str: string, x: number, fontName = "f1") => ({ str, transform: [10, 0, 0, 10, x, 10], width: 20, height: 10, fontName });
    const matrix = [2, 0, 0, -2, 0, 100];
    const runs = pdfWordRuns([item("Interna", 0), item("�onal", 20), item("other", 100), item("font", 120, "f2")], matrix);
    expect(runs.map(r => r.text)).toEqual(["Interna�onal", "other", "font"]);
    expect(runs[0]).toMatchObject({ x0: 0, x1: 80, y0: 61, y1: 85 });
  });
  it("refuses vertical, reversed and nonfinite geometry", () => {
    const item = { str: "Interna�onal", transform: [0, 10, -10, 0, 20, 20], width: 30, height: 10 };
    expect(pdfWordRuns([item], [1, 0, 0, -1, 0, 100])).toEqual([]);
    expect(pdfWordRuns([{ ...item, transform: [NaN, 0, 0, 10, 20, 20] }], [1, 0, 0, -1, 0, 100])).toEqual([]);
  });
});
