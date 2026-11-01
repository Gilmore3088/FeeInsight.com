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
 * Version 2: a page image is turned the way the page shows it (the image's placement
 * matrix and the page's /Rotate; scanners often store a page flipped or sideways and let
 * the matrix turn it back), and a page that still reads poorly is tried at a quarter,
 * half and three-quarter turn for a page that was fed into the scanner sideways.
 *
 * English language data ships with the app (`@tesseract.js-data/eng`, the 2.9 MB
 * `4.0.0_best_int` LSTM model) so OCR never depends on a CDN at run time; set
 * ROSETTA_OCR_LANG_PATH to override. If the package cannot be resolved, tesseract.js
 * falls back to the same files on cdn.jsdelivr.net, cached in the temp dir.
 */

import { ROSETTA_OCR_VERSION } from "./reader-versions";
// The number lives in reader-versions.ts (bump it there); the history stays above.
export { ROSETTA_OCR_VERSION };
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
/** Turns are probed on a copy at most this many pixels on the long side, to keep them quick. */
const OCR_PROBE_IMAGE_SIDE = 1700;
/** A turn replaces the page as drawn only when its probe is this much more confident. */
const OCR_TURN_MIN_GAIN = 10;

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

/** A PDF matrix [a b c d e f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** The matrix that applies `inner` first, then `outer`. */
export function composeMatrix(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer;
  const [ia, ib, ic, id, ie, iff] = inner;
  return [a * ia + c * ib, b * ia + d * ib, a * ic + c * id, b * ic + d * id, a * ie + c * iff + e, b * ie + d * iff + f];
}

type Axis = [number, number];

function dominantAxis(x: number, y: number): Axis | null {
  if (Math.abs(x) > Math.abs(y) * 4) return [Math.sign(x), 0];
  if (Math.abs(y) > Math.abs(x) * 4) return [0, Math.sign(y)];
  return null;
}

/**
 * Turns and flips an image so it looks as it does on screen. `deviceMatrix` maps the
 * image's unit square to device space (y down, the page's /Rotate applied): the image's
 * columns run along (a, b), and its rows, stored top first, run along -(c, d).
 * Skewed placements are left as stored.
 */
export function orientAsDrawn(image: GrayImage, deviceMatrix: Matrix): GrayImage {
  const [a, b, c, d] = deviceMatrix;
  const u = dominantAxis(a, b);
  const v = dominantAxis(-c, -d);
  if (!u || !v || u[0] * v[0] + u[1] * v[1] !== 0) return image;
  if (u[0] === 1 && v[1] === 1) return image;
  const { width, height } = image;
  const outWidth = u[0] !== 0 ? width : height;
  const outHeight = u[0] !== 0 ? height : width;
  const offsetX = u[0] < 0 || v[0] < 0 ? outWidth - 1 : 0;
  const offsetY = u[1] < 0 || v[1] < 0 ? outHeight - 1 : 0;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const outX = offsetX + x * u[0] + y * v[0];
      const outY = offsetY + x * u[1] + y * v[1];
      data[outY * outWidth + outX] = image.data[y * width + x];
    }
  }
  return { width: outWidth, height: outHeight, data };
}

/** The image turned clockwise by `quarterTurns` quarter turns. */
export function turnImage(image: GrayImage, quarterTurns: number): GrayImage {
  const turns = ((quarterTurns % 4) + 4) % 4;
  // Clockwise quarter turn in device space: columns go down, rows go left.
  const matrices: Record<number, Matrix> = {
    0: [1, 0, 0, -1, 0, 0],
    1: [0, 1, 1, 0, 0, 0],
    2: [-1, 0, 0, 1, 0, 0],
    3: [0, -1, -1, 0, 0, 0],
  };
  return turns === 0 ? image : orientAsDrawn(image, matrices[turns]);
}

/** Box-filter downscale by an integer factor so the long side fits `maxSide`. */
function downscale(image: GrayImage, maxSide: number): GrayImage {
  const factor = Math.ceil(Math.max(image.width, image.height) / maxSide);
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

/** Box-filter downscale by an integer factor so the long side fits OCR_MAX_IMAGE_SIDE. */
export function fitForOcr(image: GrayImage): GrayImage {
  return downscale(image, OCR_MAX_IMAGE_SIDE);
}

/** A page whose long side is below this is upscaled before the cleaned read (about 200 dpi). */
const OCR_CLEAN_MIN_SIDE = 2200;
/** A scan stops trying cleaned copies after this many that read no better. */
const OCR_CLEAN_MAX_MISSES = 2;
/** Skew is searched within this many degrees either way, in OCR_SKEW_STEP steps. */
const OCR_SKEW_MAX_DEGREES = 5;
const OCR_SKEW_STEP = 0.5;
/** Skew is measured on a copy at most this many pixels on the long side. */
const OCR_SKEW_IMAGE_SIDE = 900;

/**
 * Bilinear upscale by an integer factor until the long side reaches `minSide` (at most 3x, and
 * never past OCR_MAX_IMAGE_SIDE, so `fitForOcr` never undoes it).
 */
export function upscaleForOcr(image: GrayImage, minSide = OCR_CLEAN_MIN_SIDE): GrayImage {
  const longSide = Math.max(1, image.width, image.height);
  const factor = Math.min(3, Math.ceil(minSide / longSide), Math.floor(OCR_MAX_IMAGE_SIDE / longSide));
  if (factor <= 1) return image;
  const width = image.width * factor;
  const height = image.height * factor;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, (y + 0.5) / factor - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, (x + 0.5) / factor - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      const top = image.data[y0 * image.width + x0] * (1 - fx) + image.data[y0 * image.width + x1] * fx;
      const bottom = image.data[y1 * image.width + x0] * (1 - fx) + image.data[y1 * image.width + x1] * fx;
      data[y * width + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return { width, height, data };
}

/** Otsu's threshold: the gray level that best splits ink from paper. */
export function otsuThreshold(image: GrayImage): number {
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < image.data.length; i += 1) histogram[image.data[i]] += 1;
  const total = image.data.length;
  let sumAll = 0;
  for (let level = 0; level < 256; level += 1) sumAll += level * histogram[level];
  let sumBelow = 0;
  let countBelow = 0;
  let best = 127;
  let bestVariance = -1;
  for (let level = 0; level < 256; level += 1) {
    countBelow += histogram[level];
    if (countBelow === 0) continue;
    const countAbove = total - countBelow;
    if (countAbove === 0) break;
    sumBelow += level * histogram[level];
    const meanBelow = sumBelow / countBelow;
    const meanAbove = (sumAll - sumBelow) / countAbove;
    const variance = countBelow * countAbove * (meanBelow - meanAbove) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = level;
    }
  }
  return best;
}

/** Pure black ink on white paper, split at Otsu's threshold (grey scans, faint toner). */
export function binarizeForOcr(image: GrayImage): GrayImage {
  const threshold = otsuThreshold(image);
  const data = new Uint8Array(image.data.length);
  for (let i = 0; i < data.length; i += 1) data[i] = image.data[i] <= threshold ? 0 : 255;
  return { width: image.width, height: image.height, data };
}

/**
 * The page's tilt in degrees (positive: lines fall to the right), found as the angle whose
 * ink rows are sharpest: dark pixels are projected onto rows along each candidate angle and
 * the angle with the most uneven row counts wins. 0 when no angle beats level by 5%.
 */
export function estimateSkewDegrees(image: GrayImage): number {
  const small = binarizeForOcr(downscale(image, OCR_SKEW_IMAGE_SIDE));
  const ink: Array<[number, number]> = [];
  for (let y = 0; y < small.height; y += 1) {
    for (let x = 0; x < small.width; x += 1) if (small.data[y * small.width + x] === 0) ink.push([x, y]);
  }
  if (ink.length < 50 || ink.length > small.data.length * 0.6) return 0;
  const spread = (degrees: number) => {
    const slope = Math.tan((degrees * Math.PI) / 180);
    const offset = Math.ceil(Math.abs(slope) * small.width) + 1;
    const rows = new Array<number>(small.height + 2 * offset).fill(0);
    for (const [x, y] of ink) rows[Math.round(y - x * slope) + offset] += 1;
    let sumSquares = 0;
    for (const count of rows) sumSquares += count * count;
    return sumSquares;
  };
  const level = spread(0);
  let best = 0;
  let bestSpread = level;
  for (let degrees = -OCR_SKEW_MAX_DEGREES; degrees <= OCR_SKEW_MAX_DEGREES + 1e-9; degrees += OCR_SKEW_STEP) {
    if (Math.abs(degrees) < 1e-9) continue;
    const value = spread(degrees);
    if (value > bestSpread) {
      bestSpread = value;
      best = Math.round(degrees * 10) / 10;
    }
  }
  return bestSpread > level * 1.05 ? best : 0;
}

/** Turns the page about its centre so a skew of `degrees` (as `estimateSkewDegrees`) is level (bilinear; uncovered corners are white paper). */
export function straightenForOcr(image: GrayImage, degrees: number): GrayImage {
  if (degrees === 0) return image;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = (image.width - 1) / 2;
  const cy = (image.height - 1) / 2;
  const data = new Uint8Array(image.data.length).fill(255);
  const at = (x: number, y: number) => image.data[y * image.width + x];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      // The source pixel this output pixel came from.
      const sx = cos * (x - cx) - sin * (y - cy) + cx;
      const sy = sin * (x - cx) + cos * (y - cy) + cy;
      if (sx < 0 || sy < 0 || sx > image.width - 1 || sy > image.height - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(image.width - 1, x0 + 1);
      const y1 = Math.min(image.height - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
      const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
      data[y * image.width + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return { width: image.width, height: image.height, data };
}

/**
 * The cleaned copy a poor read gets one more try on (fix plan step 7, Oct 27: free OCR came
 * back empty on 113 of 380 scans in 30 days): upscaled when small, straightened, then split
 * into black ink on white paper.
 */
export function cleanForOcr(image: GrayImage): { image: GrayImage; skewDegrees: number } {
  // Sized for OCR first, so the black-and-white copy is what Tesseract reads.
  const larger = upscaleForOcr(fitForOcr(image));
  const skewDegrees = estimateSkewDegrees(larger);
  return { image: binarizeForOcr(straightenForOcr(larger, skewDegrees)), skewDegrees };
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
  getViewport?(options: { scale: number }): { transform: number[] };
  objs: { get(key: string, callback: (value: unknown) => void): void };
  commonObjs: { get(key: string, callback: (value: unknown) => void): void };
}

function asMatrix(value: unknown): Matrix | null {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
  const numbers = Array.from(value as ArrayLike<number>).map(Number);
  return numbers.length === 6 && numbers.every(Number.isFinite) ? (numbers as Matrix) : null;
}

/**
 * The page's largest image, turned the way the page shows it. The placement matrix is
 * followed through save/restore, cm and form XObjects; the page's /Rotate comes in
 * through the viewport transform.
 */
async function pageImage(page: PageLike, ops: Record<string, number>): Promise<GrayImage | null> {
  const list = await page.getOperatorList();
  const viewport = asMatrix(page.getViewport?.({ scale: 1 }).transform) ?? IDENTITY;
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  let best: { image: GrayImage; matrix: Matrix } | null = null;
  for (let index = 0; index < list.fnArray.length; index += 1) {
    const op = list.fnArray[index];
    const args = list.argsArray[index] ?? [];
    if (op === ops.save) {
      stack.push(ctm);
      continue;
    }
    if (op === ops.restore) {
      ctm = stack.pop() ?? ctm;
      continue;
    }
    if (op === ops.transform) {
      const matrix = asMatrix(args);
      if (matrix) ctm = composeMatrix(ctm, matrix);
      continue;
    }
    if (op === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = asMatrix(args[0]);
      if (matrix) ctm = composeMatrix(ctm, matrix);
      continue;
    }
    if (op === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ctm;
      continue;
    }
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
    if (!best || image.width * image.height > best.image.width * best.image.height) {
      best = { image, matrix: composeMatrix(viewport, ctm) };
    }
  }
  return best ? orientAsDrawn(best.image, best.matrix) : null;
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

function pageReadsWell(page: OcrPage): boolean {
  const chars = page.words.reduce((sum, word) => sum + word.text.trim().length, 0);
  return chars >= OCR_MIN_CHARS_PER_PAGE && meanConfidence(page.words) >= OCR_MIN_CONFIDENCE;
}

/** How well a probe read: confidence, with near-empty reads scored as nothing. */
function probeScore(page: OcrPage): number {
  const chars = page.words.reduce((sum, word) => sum + word.text.trim().length, 0);
  return chars >= OCR_MIN_CHARS_PER_PAGE ? meanConfidence(page.words) : 0;
}

/**
 * Reads a page the way it is drawn, starting with `preferredTurns`. When that reads
 * poorly (too few characters or low confidence), the other quarter turns are probed on a
 * smaller copy, and the page is read again at full size in the turn that probed clearly
 * best. A page that reads well is never turned. A page that still reads poorly is read once
 * more from a cleaned copy (`cleanForOcr`), kept only when it reads better.
 */
export async function recognizeUpright(
  engine: OcrEngine,
  image: GrayImage,
  preferredTurns = 0,
  stopped: () => boolean = () => false,
  clean = true,
): Promise<{ page: OcrPage; height: number; turns: number; cleaned?: boolean; triedClean?: boolean }> {
  const read = await recognizeTurned(engine, image, preferredTurns, stopped);
  if (!clean || pageReadsWell(read.page) || stopped()) return read;
  // One more try on a cleaned copy before the page counts as unreadable (and the paid read).
  const cleaned = cleanForOcr(turnImage(image, read.turns)).image;
  const again = await engine.recognize(cleaned);
  if (probeScore(again) <= probeScore(read.page)) return { ...read, triedClean: true };
  return { page: again, height: cleaned.height, turns: read.turns, cleaned: true, triedClean: true };
}

async function recognizeTurned(
  engine: OcrEngine,
  image: GrayImage,
  preferredTurns: number,
  stopped: () => boolean,
): Promise<{ page: OcrPage; height: number; turns: number }> {
  const first = fitForOcr(turnImage(image, preferredTurns));
  const page = await engine.recognize(first);
  if (pageReadsWell(page) || stopped()) return { page, height: first.height, turns: preferredTurns };
  const small = downscale(image, OCR_PROBE_IMAGE_SIDE);
  let bestTurns = preferredTurns;
  let bestScore = -1;
  let baseScore = 0;
  for (let offset = 0; offset < 4; offset += 1) {
    if (stopped()) break;
    const turns = (preferredTurns + offset) % 4;
    const score = probeScore(await engine.recognize(turnImage(small, turns)));
    if (offset === 0) baseScore = score;
    if (score > bestScore) {
      bestScore = score;
      bestTurns = turns;
    }
  }
  if (bestTurns === preferredTurns || bestScore < baseScore + OCR_TURN_MIN_GAIN || stopped()) {
    return { page, height: first.height, turns: preferredTurns };
  }
  const turned = fitForOcr(turnImage(image, bestTurns));
  const again = await engine.recognize(turned);
  // Keep the turned read only when it really is better at full size.
  if (probeScore(again) <= probeScore(page)) return { page, height: first.height, turns: preferredTurns };
  return { page: again, height: turned.height, turns: bestTurns };
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
        // A scan's pages are usually all turned the same way: try the last page's turn first.
        let turnsSoFar = 0;
        // A cleaned copy that did not help twice will not help this scan: stop paying for it,
        // so a long poor scan stays inside the document's time.
        let cleanMisses = 0;
        for (const image of images) {
          if (timedOut) break;
          if (!image) {
            pages.push("");
            continue;
          }
          const read = await recognizeUpright(engine, image, turnsSoFar, () => timedOut, cleanMisses < OCR_CLEAN_MAX_MISSES);
          turnsSoFar = read.turns;
          if (read.triedClean && !read.cleaned) cleanMisses += 1;
          words.push(...read.page.words);
          pages.push(
            read.page.words.length > 0
              ? layoutOcrWords(read.page.words, read.height)
              : read.page.text.split("\n").map(cleanOcrLine).filter(Boolean).join("\n"),
          );
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
