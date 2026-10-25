import type { PdfTextItem } from "./pdf-layout";
import type { OcrWord } from "./ocr";

export interface WordBox { x0: number; y0: number; x1: number; y1: number }
export interface PdfWordRun extends WordBox { text: string; font: string; em: number }
export interface UnicodeWordRepair {
  from: string;
  to: string;
  occurrences: number;
  /** Minimum confidence at each raster scale, not a calibrated accuracy probability. */
  confidence: [number, number];
}

const WORD = /[\p{L}\uFFFD]+/gu;
const words = (text: string) => text.match(WORD) ?? [];
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cleanWord = (text: string) => text.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");

/** Only missing internal Latin letters may be filled; prices and known letters cannot change. */
export function repairPattern(word: string): RegExp | null {
  if (!word.includes("\uFFFD") || !/^\p{L}/u.test(word) || !/\p{L}$/u.test(word)
    || word.replace(/\uFFFD/g, "").length < 3 || word.length > 60) return null;
  return new RegExp(`^${word.split(/(\uFFFD+)/u).map((part) => part.startsWith("\uFFFD")
    ? `[A-Za-z]{${part.length},${part.length * 3}}` : escaped(part)).join("")}$`, "u");
}

/**
 * Page items in rendered pixel coordinates. Adjacent pieces of a split word join;
 * column gaps, font changes and nonhorizontal text never borrow an OCR word.
 */
export function pdfWordRuns(items: PdfTextItem[], matrix: number[]): PdfWordRun[] {
  const point = (x: number, y: number) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] });
  const positioned: Array<PdfWordRun & { baseline: number }> = [];
  for (const item of items) {
    if (!item.str || !item.transform || item.width <= 0) continue;
    const [a, b, c, d, x, y] = item.transform;
    if (![a,b,c,d,x,y,item.width].every(Number.isFinite)) continue;
    const size = Math.hypot(a, b);
    if (size <= 0) continue;
    const start = point(x, y), end = point(x + item.width * a / size, y + item.width * b / size);
    if (end.x <= start.x || Math.abs(end.y - start.y) > Math.max(1, (end.x - start.x) * 0.02)) continue;
    const corners = [-0.25, 0.95].flatMap((height) => [
      point(x + c * height, y + d * height),
      point(x + item.width * a / size + c * height, y + item.width * b / size + d * height),
    ]);
    const box = { x0: Math.min(...corners.map(p => p.x)), x1: Math.max(...corners.map(p => p.x)),
      y0: Math.min(...corners.map(p => p.y)), y1: Math.max(...corners.map(p => p.y)) };
    if (![box.x0,box.x1,box.y0,box.y1].every(Number.isFinite) || box.y1 <= box.y0) continue;
    positioned.push({ ...box, text: item.str, font: item.fontName ?? "", baseline: start.y, em: (box.y1 - box.y0) / 1.2 });
  }
  positioned.sort((a,b) => a.baseline - b.baseline || a.x0 - b.x0);
  const runs: Array<PdfWordRun & { baseline: number }> = [];
  for (const item of positioned) {
    const last = runs[runs.length - 1];
    const em = Math.max(item.em, last?.em ?? 0);
    if (last && last.font === item.font && Math.abs(last.baseline - item.baseline) <= em * 0.2
      && item.x0 - last.x1 >= -em * 0.05 && item.x0 - last.x1 <= em * 0.15) {
      last.text += item.text;
      last.x1 = Math.max(last.x1, item.x1); last.y0 = Math.min(last.y0, item.y0); last.y1 = Math.max(last.y1, item.y1);
    } else runs.push({ ...item });
  }
  return runs;
}

function inside(word: WordBox, run: PdfWordRun): boolean {
  if (![word.x0, word.x1, word.y0, word.y1].every(Number.isFinite) || word.x1 <= word.x0 || word.y1 <= word.y0) return false;
  const x = (word.x0 + word.x1) / 2, y = (word.y0 + word.y1) / 2;
  const margin = run.em * 0.25;
  return x >= run.x0 - margin && x <= run.x1 + margin && y >= run.y0 - margin && y <= run.y1 + margin;
}

/**
 * Two complete page renderings at different scales must agree inside the original
 * text cell. Every occurrence needs its own visual witness; one good word cannot
 * repair a second low-confidence occurrence. No spelling dictionary is consulted.
 */
export function proposeUnicodeWords(
  text: string,
  passes: [{ runs: PdfWordRun[]; words: OcrWord[] }, { runs: PdfWordRun[]; words: OcrWord[] }],
): { repairs: UnicodeWordRepair[]; unresolved: string[] } {
  const damaged = [...new Set(words(text).filter(w => w.includes("\uFFFD")))];
  const repairs: UnicodeWordRepair[] = [], unresolved: string[] = [];
  for (const from of damaged) {
    const pattern = repairPattern(from);
    const expected = words(text).filter(w => w === from).length;
    if (!pattern) { unresolved.push(from); continue; }
    const observations = passes.map((pass) => {
      let occurrences = 0, confidence = 100;
      const targets = new Set<string>();
      for (const run of pass.runs) {
        const tokens = words(run.text), count = tokens.filter(w => w === from).length;
        if (!count) continue;
        const matches = pass.words.filter(w => inside(w, run) && pattern.test(cleanWord(w.text)));
        const values = new Set(matches.map(w => cleanWord(w.text)));
        if (values.size !== 1) return null;
        const to = [...values][0];
        // An intact copy in the same cell must also be seen, not reused as the
        // evidence for a damaged occurrence elsewhere in that cell.
        if (matches.length !== count + tokens.filter(w => w === to).length
          || matches.some(w => !Number.isFinite(w.confidence) || w.confidence < 85 || w.confidence > 100)) return null;
        targets.add(to); occurrences += count;
        confidence = Math.min(confidence, ...matches.map(w => w.confidence));
      }
      return targets.size === 1 && occurrences === expected ? { to: [...targets][0], confidence } : null;
    });
    const [first, second] = observations;
    if (!first || !second || first.to !== second.to || Math.max(first.confidence, second.confidence) < 90) unresolved.push(from);
    else repairs.push({ from, to: first.to, occurrences: expected, confidence: [first.confidence, second.confidence] });
  }
  return { repairs, unresolved };
}

/** Literal repair only: never replace known characters, whitespace, prices or layout. */
export function applyUnicodeWordRepairs(text: string, repairs: UnicodeWordRepair[]): string | null {
  const map = new Map<string, UnicodeWordRepair>();
  for (const repair of repairs) {
    if (!repairPattern(repair.from)?.test(repair.to) || !Number.isSafeInteger(repair.occurrences) || repair.occurrences < 1
      || (map.has(repair.from) && map.get(repair.from)?.to !== repair.to)) return null;
    const prior = map.get(repair.from);
    map.set(repair.from, { ...repair, occurrences: (prior?.occurrences ?? 0) + repair.occurrences });
  }
  const counts = new Map<string, number>();
  let refused = false;
  const result = text.replace(WORD, word => {
    const repair = map.get(word);
    if (!repair) return word;
    const count = (counts.get(word) ?? 0) + 1; counts.set(word, count);
    if (count > repair.occurrences) { refused = true; return word; }
    return repair.to;
  });
  return refused ? null : result;
}
