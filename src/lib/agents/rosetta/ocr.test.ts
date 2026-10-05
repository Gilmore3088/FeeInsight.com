// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  cleanOcrLine,
  createScannedPdfReader,
  fitForOcr,
  layoutOcrWords,
  OcrError,
  toGray,
  type OcrEngine,
  type OcrWord,
} from "./ocr";
import { imageOnlyPdf, rasterizeLines, scannedFeePdf } from "./test-fixtures/scanned-pdf";

function word(text: string, x0: number, x1: number, baseline: number): OcrWord {
  return { text, confidence: 90, x0, x1, y0: baseline - 20, y1: baseline, baseline, lineHeight: 24 };
}

describe("Rosetta free OCR", () => {
  it("converts pdf.js images of every kind to 8-bit gray on a light page", () => {
    // 1 bit per pixel, set bit = white: 8x2 with one black pixel.
    const bits = toGray({ width: 8, height: 2, kind: 1, data: new Uint8Array([0b01111111, 0xff]) });
    expect(Array.from(bits!.data.slice(0, 2))).toEqual([0, 255]);
    const rgb = toGray({ width: 2, height: 1, kind: 2, data: new Uint8Array([255, 255, 255, 0, 0, 0]) });
    expect(Array.from(rgb!.data)).toEqual([255, 0]);
    // A negative (mostly dark) image is inverted so the paper is white.
    const negative = toGray({ width: 4, height: 1, data: new Uint8Array([0, 0, 0, 255]) });
    expect(Array.from(negative!.data)).toEqual([255, 255, 255, 0]);
    expect(toGray({ width: 3, height: 3, data: new Uint8Array(5) })).toBeNull();
  });

  it("scales very large scans down to about 300 dpi", () => {
    const fitted = fitForOcr({ width: 6800, height: 8800, data: new Uint8Array(6800 * 8800).fill(200) });
    expect(fitted.width).toBeLessThanOrEqual(3400);
    expect(fitted.data[0]).toBe(200);
  });

  it("fixes dollar signs Tesseract misreads only where the amount is unambiguous", () => {
    expect(cleanOcrLine("OVERDRAFT FEE #35.00")).toBe("OVERDRAFT FEE $35.00");
    expect(cleanOcrLine("Wire | S25.00 | §1,250.00")).toBe("Wire | $25.00 | $1,250.00");
    expect(cleanOcrLine("Form #12 and S35")).toBe("Form #12 and S35");
  });

  it("lays recognized words out like PDF text, with a cell break at column gaps", () => {
    const text = layoutOcrWords(
      [word("Overdraft", 10, 120, 50), word("fee", 130, 165, 50), word("$35.00", 600, 680, 51), word("Stop", 10, 60, 90), word("payment", 70, 160, 90), word("$30.00", 600, 680, 90)],
      200,
    );
    expect(text).toBe("Overdraft fee | $35.00\nStop payment | $30.00");
  });

  it("reads an image-only PDF into fee lines Knox can pair, in seconds", async () => {
    const pdf = imageOnlyPdf([
      rasterizeLines([
        "SCHEDULE OF FEES",
        "OVERDRAFT FEE PER ITEM        $33.00",
        "MONTHLY MAINTENANCE FEE       $9.00",
        "STOP PAYMENT                  $31.00",
      ]),
    ]);
    const reader = createScannedPdfReader();
    const startedAt = Date.now();
    try {
      const ocr = await reader.read(pdf);
      expect(ocr).toMatchObject({ pageCount: 1, imagePages: 1 });
      expect(ocr.confidence).toBeGreaterThan(70);
      expect(ocr.text).toContain("OVERDRAFT FEE PER ITEM | $33.00");
      expect(ocr.text).toContain("STOP PAYMENT | $31.00");
    } finally {
      await reader.close();
    }
    expect(Date.now() - startedAt).toBeLessThan(20_000);
  }, 30_000);

  it("refuses scans longer than the free page limit and PDFs with no page images", async () => {
    const reader = createScannedPdfReader(() => {
      throw new Error("engine must not start");
    });
    const page = rasterizeLines(["PAGE"]);
    await expect(reader.read(imageOnlyPdf([page, page, page]), { maxPages: 2 })).rejects.toMatchObject({ reason: "too_many_pages" });
    const tiny = imageOnlyPdf([{ width: 20, height: 20, data: new Uint8Array(400).fill(255) }]);
    await expect(reader.read(tiny)).rejects.toMatchObject({ reason: "no_page_images" });
  });

  it("stops a stuck engine at the time limit and starts a fresh one for the next document", async () => {
    let started = 0;
    let terminated = 0;
    const reader = createScannedPdfReader((): OcrEngine => {
      started += 1;
      return {
        recognize: () => new Promise(() => undefined),
        terminate: async () => {
          terminated += 1;
        },
      };
    });
    const pdf = scannedFeePdf(["SCHEDULE OF FEES", "OVERDRAFT FEE PER ITEM $33.00"]);
    await expect(reader.read(pdf, { timeoutMs: 50 })).rejects.toBeInstanceOf(OcrError);
    expect(terminated).toBe(1);
    await expect(reader.read(pdf, { timeoutMs: 50 })).rejects.toMatchObject({ reason: "timeout" });
    expect(started).toBe(2);
  });
});
