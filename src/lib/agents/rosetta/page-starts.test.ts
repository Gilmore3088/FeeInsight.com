import { describe, expect, it } from "vitest";
import { pageStartsFitText, pdfPageStarts } from "./page-starts";
import { locateFeeInText } from "@/lib/source-location";

const note = (excerpt: string) => `excerpt="${excerpt}"`;

describe("pdfPageStarts", () => {
  it("gives each page's code-point start when the pages join exactly to the text", () => {
    const pages = ["First Example Bank\nOverdraft Fee $32.00", "Wire Fees\nOutgoing Wire $25.00", "Stop Payment $30.00"];
    const text = pages.join("\n\n");
    expect(pdfPageStarts(text, pages, 3)).toEqual([0, pages[0].length + 2, pages[0].length + 2 + pages[1].length + 2]);
  });

  it("gives [0] for a single page", () => {
    expect(pdfPageStarts("Overdraft Fee $32.00", ["Overdraft Fee $32.00"], 1)).toEqual([0]);
  });

  it("records nothing when a page is empty", () => {
    // Two empty pages would share a start; a wrong page is never acceptable.
    expect(pdfPageStarts("Overdraft Fee $32.00\n\nWire $25.00", ["Overdraft Fee $32.00", "", "Wire $25.00"], 3)).toBeNull();
  });

  it("records nothing when the pages do not join exactly to the text", () => {
    expect(pdfPageStarts("Overdraft Fee $32.00\nWire $25.00", ["Overdraft Fee $32.00", "Wire $25.00"], 2)).toBeNull();
    expect(pdfPageStarts("Overdraft Fee $32.00\n\nWire $25.00 ", ["Overdraft Fee $32.00", "Wire $25.00"], 2)).toBeNull();
  });

  it("records nothing when the page count disagrees with the document", () => {
    expect(pdfPageStarts("A fee $1\n\nB fee $2", ["A fee $1", "B fee $2"], 3)).toBeNull();
    expect(pdfPageStarts("", [], 0)).toBeNull();
  });

  it("counts code points, not UTF-16 units, so astral characters move later pages by one", () => {
    const pages = ["Fees \u{1F4B3} card $5.00", "Wire $25.00"];
    const text = pages.join("\n\n");
    const starts = pdfPageStarts(text, pages, 2)!;
    expect(starts).toEqual([0, Array.from(pages[0]).length + 2]);
    expect(starts[1]).toBe(pages[0].length + 1);
    expect(Array.from(text).slice(starts[1]).join("")).toBe("Wire $25.00");
  });
});

describe("pageStartsFitText", () => {
  it("accepts page starts that begin at 0, increase and stay inside the text", () => {
    expect(pageStartsFitText("abc\n\ndef", [0, 5])).toBe(true);
  });

  it("rejects starts that run past the text, do not increase, or are missing", () => {
    expect(pageStartsFitText("abc", [0, 3])).toBe(false);
    expect(pageStartsFitText("abc\n\ndef", [0, 0])).toBe(false);
    expect(pageStartsFitText("abc\n\ndef", [1, 5])).toBe(false);
    expect(pageStartsFitText("abc\n\ndef", [0, 2.5])).toBe(false);
    expect(pageStartsFitText(null, [0])).toBe(false);
    expect(pageStartsFitText("abc", null)).toBe(false);
  });
});

describe("page starts name the page in a citation", () => {
  it("names page 2 for a fee printed on the second page, with no printed page numbers", () => {
    const pages = ["First Example Bank Schedule of Fees\nOverdraft Fee $32.00", "Wire Transfers\nOutgoing Domestic Wire $25.00"];
    const text = pages.join("\n\n");
    const pageStarts = pdfPageStarts(text, pages, 2);
    const found = locateFeeInText({ text, amount: 25, feeName: "Outgoing Domestic Wire", extraction_note: note("Outgoing Domestic Wire $25.00"), pageStarts });
    expect(found.location).toMatchObject({ page: 2, pageLine: 2, textLine: 5 });
    const withoutStarts = locateFeeInText({ text, amount: 25, feeName: "Outgoing Domestic Wire", extraction_note: note("Outgoing Domestic Wire $25.00") });
    expect(withoutStarts.location).toMatchObject({ page: null, textLine: 5 });
  });

  it("names the right page after an astral character on page 1", () => {
    const pages = ["Card Fees \u{1F4B3}\nReplacement Card $5.00", "Wire Transfers\nOutgoing Domestic Wire $25.00"];
    const text = pages.join("\n\n");
    const found = locateFeeInText({ text, amount: 25, feeName: "Outgoing Domestic Wire", extraction_note: note("Outgoing Domestic Wire $25.00"), pageStarts: pdfPageStarts(text, pages, 2) });
    expect(found.location).toMatchObject({ page: 2, pageLine: 2 });
  });
});
