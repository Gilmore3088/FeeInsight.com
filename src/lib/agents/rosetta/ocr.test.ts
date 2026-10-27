// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  binarizeForOcr,
  cleanForOcr,
  cleanOcrLine,
  createScannedPdfReader,
  fitForOcr,
  layoutOcrWords,
  OcrError,
  orientAsDrawn,
  estimateSkewDegrees,
  otsuThreshold,
  recognizeUpright,
  straightenForOcr,
  toGray,
  turnImage,
  upscaleForOcr,
  type GrayImage,
  type OcrEngine,
  type OcrPage,
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

  it("turns an image the way its placement matrix and the page draw it", () => {
    // 2x1 image [a b]; columns run down the device and rows run left: a quarter turn clockwise.
    const image: GrayImage = { width: 2, height: 1, data: new Uint8Array([10, 20]) };
    expect(orientAsDrawn(image, [0, 1, 1, 0, 0, 0])).toEqual({ width: 1, height: 2, data: new Uint8Array([10, 20]) });
    // Stored bottom row first and flipped back by the matrix (a = 1, d = 1 in device space).
    const twoRows: GrayImage = { width: 1, height: 2, data: new Uint8Array([1, 2]) };
    expect(Array.from(orientAsDrawn(twoRows, [1, 0, 0, 1, 0, 0]).data)).toEqual([2, 1]);
    // Upright stays as stored; skewed placements are left alone.
    expect(orientAsDrawn(image, [1, 0, 0, -1, 0, 0])).toBe(image);
    expect(orientAsDrawn(image, [1, 1, 1, -1, 0, 0])).toBe(image);
    // Four quarter turns come back to the start.
    const square: GrayImage = { width: 2, height: 2, data: new Uint8Array([1, 2, 3, 4]) };
    expect(Array.from(turnImage(square, 1).data)).toEqual([3, 1, 4, 2]);
    expect(Array.from(turnImage(turnImage(turnImage(turnImage(square, 1), 1), 1), 1).data)).toEqual([1, 2, 3, 4]);
  });

  it("reads a page stored upside down the way the page shows it", async () => {
    const lines = ["SCHEDULE OF FEES", "OVERDRAFT FEE PER ITEM        $33.00", "STOP PAYMENT                  $31.00"];
    const reader = createScannedPdfReader();
    try {
      const ocr = await reader.read(imageOnlyPdf([rasterizeLines(lines)], { storedFlipped: true }));
      expect(ocr.confidence).toBeGreaterThan(70);
      expect(ocr.text).toContain("OVERDRAFT FEE PER ITEM | $33.00");
    } finally {
      await reader.close();
    }
  }, 30_000);

  it("turns a page that was scanned sideways and keeps the turn for the next page", async () => {
    const page = rasterizeLines(["SCHEDULE OF FEES", "OVERDRAFT FEE PER ITEM        $33.00", "STOP PAYMENT                  $31.00"]);
    const sideways = turnImage(page, 1);
    const reader = createScannedPdfReader();
    try {
      const ocr = await reader.read(imageOnlyPdf([sideways, sideways]));
      expect(ocr.confidence).toBeGreaterThan(70);
      expect(ocr.pages[0]).toContain("OVERDRAFT FEE PER ITEM | $33.00");
      expect(ocr.pages[1]).toContain("STOP PAYMENT | $31.00");
    } finally {
      await reader.close();
    }
  }, 60_000);

  it("never turns a page that reads well", async () => {
    const calls: number[] = [];
    const good: OcrPage = { text: "x", confidence: 90, words: [word("OVERDRAFT FEE PER ITEM $33.00 MONTHLY FEE $9.00", 0, 10, 10)] };
    const engine: OcrEngine = {
      recognize: async (image) => {
        calls.push(image.width);
        return good;
      },
      terminate: async () => undefined,
    };
    const result = await recognizeUpright(engine, { width: 300, height: 400, data: new Uint8Array(120_000).fill(255) });
    expect(result.turns).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("cleans a poor scan before giving up: upscale, straighten, black on white (fix plan step 7)", async () => {
    // Faint grey ink on grey paper.
    const faint: GrayImage = { width: 4, height: 2, data: Uint8Array.from([180, 180, 120, 120, 180, 120, 180, 120]) };
    expect(otsuThreshold(faint)).toBeGreaterThanOrEqual(120);
    expect(otsuThreshold(faint)).toBeLessThan(180);
    expect([...binarizeForOcr(faint).data]).toEqual([255, 255, 0, 0, 255, 0, 255, 0]);
    expect(upscaleForOcr({ width: 1000, height: 800, data: new Uint8Array(800_000) })).toMatchObject({ width: 3000, height: 2400 });
    expect(upscaleForOcr({ width: 2400, height: 3000, data: new Uint8Array(1) })).toMatchObject({ width: 2400 });

    // Ruled lines tilted by 3 degrees read as a 3 degree skew; level lines read as none.
    const lines = (degrees: number): GrayImage => {
      const width = 800;
      const height = 600;
      const data = new Uint8Array(width * height).fill(255);
      const slope = Math.tan((degrees * Math.PI) / 180);
      for (let row = 60; row < height - 60; row += 40) {
        for (let x = 40; x < width - 40; x += 1) {
          const y = Math.round(row + (x - width / 2) * slope);
          for (let t = 0; t < 3; t += 1) if (y + t >= 0 && y + t < height) data[(y + t) * width + x] = 0;
        }
      }
      return { width, height, data };
    };
    expect(estimateSkewDegrees(lines(0))).toBe(0);
    expect(Math.abs(estimateSkewDegrees(lines(3)) - 3)).toBeLessThanOrEqual(0.5);
    expect(estimateSkewDegrees(straightenForOcr(lines(3), 3))).toBe(0);
    expect(cleanForOcr(lines(3)).skewDegrees).not.toBe(0);
  });

  it("keeps the cleaned read only when it reads better, and never cleans a page that reads well", async () => {
    const poor: OcrPage = { text: "", confidence: 20, words: [word("FEE", 0, 10, 10)] };
    const good: OcrPage = { text: "x", confidence: 90, words: [word("OVERDRAFT FEE PER ITEM $33.00 MONTHLY FEE $9.00", 0, 10, 10)] };
    const seen: Array<Set<number>> = [];
    // Only a black-and-white copy reads well.
    const engine: OcrEngine = {
      recognize: async (image) => {
        const levels = new Set(image.data);
        seen.push(levels);
        return [...levels].every((level) => level === 0 || level === 255) ? good : poor;
      },
      terminate: async () => undefined,
    };
    const grey: GrayImage = { width: 300, height: 400, data: new Uint8Array(120_000).map((_, i) => (i % 7 === 0 ? 90 : 200)) };
    const result = await recognizeUpright(engine, grey);
    expect(result).toMatchObject({ cleaned: true, turns: 0 });
    expect(result.page).toBe(good);

    const never: OcrEngine = { recognize: async () => poor, terminate: async () => undefined };
    expect((await recognizeUpright(never, grey)).cleaned).toBeUndefined();
  }, 60_000);

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
