import { createRequire } from "module";
import { tmpdir } from "os";
import path from "path";

import { layoutPageText, type PdfTextItem } from "./pdf-layout";

/**
 * `read.ocr_tesseract`: free OCR for scanned PDFs (pass 2).
 *
 * A scan is almost always one image per page (JPEG, CCITT/JBIG2 1-bit, or raw). pdf.js
 * decodes those images while building each page's operator list, so the largest image
 * on a page is taken as the page, converted to 8-bit grayscale and read with
 * tesseract.js (open-source Tesseract compiled to WebAssembly; no service, no key).
 * Recognized words keep their positions and go through the same layout as PDF text,
 * so a fee name and its amount column share a line, cells joined by " | ".
 *
 * English language data ships with the app (`@tesseract.js-data/eng`, the 2.9 MB
 * `4.0.0_best_int` LSTM model) so OCR never depends on a CDN at run time; set
 * ROSETTA_OCR_LANG_PATH to override. If the package cannot be resolved, tesseract.js
 * falls back to the same files on cdn.jsdelivr.net, cached in the temp dir.
 */

export const ROSETTA_OCR_VERSION = 1;
export const OCR_STRATEGY = "read.ocr_tesseract";
/** Longer scans go to the paid pass; a 10-page schedule is a few seconds of OCR. */
export const OCR_MAX_PAGES = 10;
/** Wall-clock bound for one document; the worker is stopped when it is reached. */
export const OCR_DOCUMENT_TIMEOUT_MS = 60_000;
/** Mean word confidence below this is too unreliable to hand to Knox. */
export const OCR_MIN_CONFIDENCE = 55;
/** Fewer recognized characters than this per page is not a readable schedule. */
export const OCR_MIN_CHARS_PER_PAGE = 40;
/** Pages are scaled down to at most this many pixels on the long side (about 300 dpi). */
const OCR_MAX_IMAGE_SIDE = 3400;
/** Images smaller than this on both sides are logos or icons, not pages. */
const MIN_PAGE_IMAGE_SIDE = 200;

export interface GrayImage {
  width: number;
  height: number;
  /** One byte per pixel, 0 black to 255 white. */
  data: Uint8Array;
}

export interface OcrWord {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Baseline of the line the word sits on (image pixels, y grows downward). */
  baseline: number;
  /** Height of that line, used as the font size for column-gap detection. */
  lineHeight: number;
}

export interface OcrPage {
  text: string;
  words: OcrWord[];
  confidence: number;
}

export interface OcrEngine {
  recognize(image: GrayImage): Promise<OcrPage>;
  terminate(): Promise<void>;
}

export interface ScannedPdfOcr {
  /** Page texts joined by a blank line, cleaned, one line per baseline. */
  text: string;
  pages: string[];
  pageCount: number;
  /** Pages that had a page image to read. */
  imagePages: number;
  /** Mean word confidence across the document, 0-100. */
  confidence: number;
}

export interface ScannedPdfReader {
  read(bytes: Uint8Array, options?: { maxPages?: number; timeoutMs?: number }): Promise<ScannedPdfOcr>;
  close(): Promise<void>;
}

/** Errors with a typed reason, so the attempt log gets the right outcome. */
export class OcrError extends Error {
  constructor(
    readonly reason: "too_many_pages" | "no_page_images" | "timeout" | "engine",
    message: string,
  ) {
    super(message);
    this.name = "OcrError";
  }
}

// pdf.js ImageKind values.
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

interface PdfImageObject {
  width?: number;
  height?: number;
  data?: Uint8Array | Uint8ClampedArray;
  kind?: number;
}

/** Any decoded pdf.js image as 8-bit gray. Returns null for shapes it does not know. */
export function toGray(image: PdfImageObject, mask = false): GrayImage | null {
  const { width = 0, height = 0, data } = image;
  if (!data || width <= 0 || height <= 0) return null;
  const pixels = width * height;
  const gray = new Uint8Array(pixels);
  const rowBytes = (width + 7) >> 3;
  if (image.kind === GRAYSCALE_1BPP || data.length === rowBytes * height) {
    // Packed bits, rows padded to a byte. A set bit is white in images; in image masks a
    // set bit is the painted (dark) sample.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        gray[y * width + x] = (bit === 1) !== mask ? 255 : 0;
      }
    }
  } else if (data.length === pixels) {
    gray.set(data);
  } else if (image.kind === RGB_24BPP || data.length === pixels * 3) {
    for (let i = 0; i < pixels; i += 1) {
      gray[i] = (data[i * 3] * 299 + data[i * 3 + 1] * 587 + data[i * 3 + 2] * 114) / 1000;
    }
  } else if (image.kind === RGBA_32BPP || data.length === pixels * 4) {
    for (let i = 0; i < pixels; i += 1) {
      const alpha = data[i * 4 + 3] / 255;
      const luma = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
      gray[i] = luma * alpha + 255 * (1 - alpha);
    }
  } else {
    return null;
  }
  return normalizePolarity({ width, height, data: gray });
}

/** Paper is light: an image that is mostly dark is inverted (negative scans, masks). */
function normalizePolarity(image: GrayImage): GrayImage {
  let sum = 0;
  const step = Math.max(1, Math.floor(image.data.length / 50_000));
  let count = 0;
  for (let i = 0; i < image.data.length; i += step) {
    sum += image.data[i];
    count += 1;
  }
  if (count > 0 && sum / count < 110) {
    for (let i = 0; i < image.data.length; i += 1) image.data[i] = 255 - image.data[i];
  }
  return image;
}

/** Box-filter downscale by an integer factor so the long side fits OCR_MAX_IMAGE_SIDE. */
export function fitForOcr(image: GrayImage): GrayImage {
  const factor = Math.ceil(Math.max(image.width, image.height) / OCR_MAX_IMAGE_SIDE);
  if (factor <= 1) return image;
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const data = new Uint8Array(width * height);
  const area = factor * factor;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        const row = (y * factor + dy) * image.width + x * factor;
        for (let dx = 0; dx < factor; dx += 1) sum += image.data[row + dx];
      }
      data[y * width + x] = sum / area;
    }
  }
  return { width, height, data };
}

/** A binary PGM (P5): the simplest format Tesseract's image reader accepts. */
export function encodePgm(image: GrayImage): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${image.width} ${image.height}\n255\n`);
  const out = new Uint8Array(header.length + image.data.length);
  out.set(header, 0);
  out.set(image.data, header.length);
  return out;
}

/**
 * Typical Tesseract confusions on money, fixed only where the shape is unambiguous:
 * "#35.00", "§35.00" or "S35.00" standing alone is "$35.00".
 */
export function cleanOcrLine(line: string): string {
  return line
    .replace(/(^|[\s|(:])[#§S](\d{1,3}(?:,\d{3})*\.\d{2})(?=$|[\s|),;])/g, "$1$$$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recognized words laid out like PDF text: one line per baseline, " | " at column gaps. */
export function layoutOcrWords(words: OcrWord[], imageHeight: number): string {
  const items: PdfTextItem[] = words
    .filter((word) => word.text.trim().length > 0)
    .map((word) => {
      const size = Math.max(1, word.lineHeight);
      return {
        str: word.text,
        transform: [size, 0, 0, size, word.x0, imageHeight - word.baseline],
        width: Math.max(0, word.x1 - word.x0),
        height: size,
      };
    });
  return layoutPageText(items)
    .split("\n")
    .map(cleanOcrLine)
    .filter((line) => line.length > 0)
    .join("\n");
}

interface OperatorListLike {
  fnArray: number[];
  argsArray: unknown[][];
}

interface PageLike {
  getOperatorList(): Promise<OperatorListLike>;
  objs: { get(key: string, callback: (value: unknown) => void): void };
  commonObjs: { get(key: string, callback: (value: unknown) => void): void };
}

async function pageImage(page: PageLike, ops: Record<string, number>): Promise<GrayImage | null> {
  const list = await page.getOperatorList();
  let best: GrayImage | null = null;
  for (let index = 0; index < list.fnArray.length; index += 1) {
    const op = list.fnArray[index];
    const args = list.argsArray[index] ?? [];
    let image: GrayImage | null = null;
    if (op === ops.paintImageXObject && typeof args[0] === "string") {
      const key = args[0];
      const store = key.startsWith("g_") ? page.commonObjs : page.objs;
      const object = await new Promise<unknown>((resolve) => store.get(key, resolve));
      image = toGray((object ?? {}) as PdfImageObject);
    } else if (op === ops.paintInlineImageXObject && args[0] && typeof args[0] === "object") {
      image = toGray(args[0] as PdfImageObject);
    } else if (op === ops.paintImageMaskXObject && args[0] && typeof args[0] === "object") {
      image = toGray(args[0] as PdfImageObject, true);
    }
    if (!image || (image.width < MIN_PAGE_IMAGE_SIDE && image.height < MIN_PAGE_IMAGE_SIDE)) continue;
    if (!best || image.width * image.height > best.width * best.height) best = image;
  }
  return best;
}

/** The page images of a scanned PDF, at most `maxPages` pages. */
export async function extractPdfPageImages(
  bytes: Uint8Array,
  maxPages = OCR_MAX_PAGES,
): Promise<{ pageCount: number; images: Array<GrayImage | null> }> {
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  // pdf.js may detach the buffer it is given; keep the caller's bytes intact.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: 64 * 1024 * 1024 });
  try {
    const pageCount = Number(pdf.numPages ?? 0);
    if (pageCount > maxPages) {
      throw new OcrError("too_many_pages", `Scanned PDF has ${pageCount} pages; free OCR reads at most ${maxPages}`);
    }
    const { OPS } = await getResolvedPDFJS();
    const images: Array<GrayImage | null> = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = (await pdf.getPage(pageNumber)) as unknown as PageLike;
      images.push(await pageImage(page, OPS as unknown as Record<string, number>));
    }
    return { pageCount, images };
  } finally {
    await pdf.destroy?.();
  }
}

/** Where the English model lives: env override, the bundled package, else the CDN. */
export function tesseractLangPath(): { langPath: string; local: boolean } {
  const override = process.env.ROSETTA_OCR_LANG_PATH?.trim();
  if (override) return { langPath: override, local: !/^https?:/i.test(override) };
  try {
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const pkg = require.resolve("@tesseract.js-data/eng/package.json");
    return { langPath: path.join(path.dirname(pkg), "4.0.0_best_int"), local: true };
  } catch {
    return { langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int", local: false };
  }
}

interface TesseractLine {
  baseline?: { y0: number; y1: number };
  bbox: { y0: number; y1: number };
  words?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
}

/** The tesseract.js engine: one worker, created on first use, LSTM model only. */
export function createTesseractEngine(): OcrEngine {
  type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
  let worker: Promise<TesseractWorker> | null = null;
  const start = async (): Promise<TesseractWorker> => {
    const { createWorker } = await import("tesseract.js");
    const { langPath, local } = tesseractLangPath();
    // OEM 1 = LSTM only, the model the bundled data contains.
    return createWorker("eng", 1, {
      langPath,
      gzip: true,
      cacheMethod: local ? "none" : "write",
      cachePath: tmpdir(),
    });
  };
  return {
    async recognize(image) {
      worker ??= start();
      const active = await worker;
      const result = await active.recognize(Buffer.from(encodePgm(image)), {}, { text: true, blocks: true });
      const words: OcrWord[] = [];
      for (const block of result.data.blocks ?? []) {
        for (const paragraph of block.paragraphs ?? []) {
          for (const line of (paragraph.lines ?? []) as TesseractLine[]) {
            const baseline = line.baseline ? (line.baseline.y0 + line.baseline.y1) / 2 : line.bbox.y1;
            const lineHeight = Math.max(1, line.bbox.y1 - line.bbox.y0);
            for (const word of line.words ?? []) {
              words.push({ text: word.text, confidence: word.confidence, ...word.bbox, baseline, lineHeight });
            }
          }
        }
      }
      return { text: result.data.text ?? "", words, confidence: Number(result.data.confidence ?? 0) };
    },
    async terminate() {
      const active = worker;
      worker = null;
      if (active) await (await active.catch(() => null))?.terminate();
    },
  };
}

function meanConfidence(words: OcrWord[]): number {
  let weighted = 0;
  let chars = 0;
  for (const word of words) {
    const length = word.text.trim().length;
    weighted += word.confidence * length;
    chars += length;
  }
  return chars > 0 ? weighted / chars : 0;
}

/**
 * Reads scanned PDFs page by page with one OCR engine. Bounded per document: when the
 * time is up the engine is stopped (the next document starts a fresh one) and the
 * document fails with `timeout`.
 */
export function createScannedPdfReader(engineFactory: () => OcrEngine = createTesseractEngine): ScannedPdfReader {
  let engine: OcrEngine | null = null;
  return {
    async read(bytes, options = {}) {
      const maxPages = options.maxPages ?? OCR_MAX_PAGES;
      const timeoutMs = options.timeoutMs ?? OCR_DOCUMENT_TIMEOUT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const work = (async () => {
        const { pageCount, images } = await extractPdfPageImages(bytes, maxPages);
        const imagePages = images.filter(Boolean).length;
        if (imagePages === 0) {
          throw new OcrError("no_page_images", `No page images found across ${pageCount} pages; nothing for OCR to read`);
        }
        engine ??= engineFactory();
        const pages: string[] = [];
        const words: OcrWord[] = [];
        for (const image of images) {
          if (timedOut) break;
          if (!image) {
            pages.push("");
            continue;
          }
          const fitted = fitForOcr(image);
          const page = await engine.recognize(fitted);
          words.push(...page.words);
          pages.push(page.words.length > 0 ? layoutOcrWords(page.words, fitted.height) : page.text.split("\n").map(cleanOcrLine).filter(Boolean).join("\n"));
        }
        return { text: pages.filter(Boolean).join("\n\n"), pages, pageCount, imagePages, confidence: meanConfidence(words) };
      })();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new OcrError("timeout", `OCR timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      try {
        return await Promise.race([work, timeout]);
      } catch (error) {
        if (timedOut && engine) {
          // Stop the stuck recognition; the next document gets a new worker.
          const stuck = engine;
          engine = null;
          await stuck.terminate().catch(() => undefined);
        }
        work.catch(() => undefined);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async close() {
      const active = engine;
      engine = null;
      await active?.terminate();
    },
  };
}
