import { describe, expect, it } from "vitest";

import { layoutDocumentText, layoutPageText, type PdfTextItem } from "./pdf-layout";

function item(str: string, x: number, y: number, width: number, height = 10): PdfTextItem {
  return { str, transform: [height, 0, 0, height, x, y], width, height };
}

describe("Rosetta read.pdf_layout", () => {
  it("puts a fee name and its amount column on one line", () => {
    // Drawing order is column by column, as many fee schedule PDFs are produced.
    const items = [
      item("Overdraft fee", 72, 700, 60),
      item("Stop payment", 72, 686, 58),
      item("$35.00", 400, 700, 30),
      item("$30.00", 400, 686.5, 30),
    ];

    expect(layoutPageText(items)).toBe("Overdraft fee | $35.00\nStop payment | $30.00");
  });

  it("joins items split inside a word and spaces items split between words", () => {
    const items = [item("Over", 72, 700, 20), item("draft", 92, 700, 25), item("fee", 119.5, 700, 15)];

    expect(layoutPageText(items)).toBe("Overdraft fee");
  });

  it("orders lines top to bottom, skips empty items, and separates pages", () => {
    const pageOne = [item("Second line", 72, 680, 50), item("", 10, 690, 0), item("First line", 72, 700, 45)];
    const pageTwo = [item("Page two", 72, 700, 40)];

    expect(layoutDocumentText([pageOne, pageTwo])).toBe("First line\nSecond line\n\nPage two");
  });
});
