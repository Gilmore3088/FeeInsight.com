/**
 * Spotting new layouts. Knox's rules are written for the layouts it has seen: one fee
 * per line, `name | price` table rows, dot leaders, fee sentences, and PDFs flattened to
 * long lines. A schedule laid out some other way reads thin, and nothing said which
 * layout it was, so a new layout looked like a handful of unrelated bad documents.
 *
 * `layoutSignature` names a text's shape from cheap counts: how its prices sit (in table
 * cells, after leaders, inside sentences, or loose on their own lines) and how long its
 * lines are. Every extract attempt records the signature, and the step reports which
 * signatures read thin, so a layout the rules miss shows up as one group. Pure.
 */

export const KNOX_LAYOUT_SIGNATURE_VERSION = 1;

/** Fewer fees than this from a text with prices is a thin read. */
export const THIN_READ_FEES = 5;

const PRICE = /\$\s?\d[\d,]*(?:\.\d{2})?/g;
const LEADER = /(?:\.\s?){3,}|…|_{3,}/;
const SENTENCE = /\b(?:fee|charge)\s+(?:of|is)\b|\b(?:we|you)\s+(?:will\s+)?(?:charge|pay|be charged)\b/i;
const LONE_PRICE = /^\s*\(?\$\s?\d[\d,]*(?:\.\d{2})?\)?\s*(?:per\s+\w+|each)?\s*$/i;

export interface LayoutSignature {
  /** e.g. `table/short`, `leaders/short`, `sentences/long`, `split/short`. */
  signature: string;
  priceLines: number;
}

export function layoutSignature(text: string | null | undefined): LayoutSignature {
  const lines = (text ?? "").split(/\n+/).filter((line) => line.trim());
  const counts = { table: 0, leaders: 0, sentences: 0, split: 0, plain: 0 };
  let priceLines = 0;
  let longLines = 0;
  for (const line of lines) {
    if (line.length > 300) longLines += 1;
    const prices = line.match(PRICE)?.length ?? 0;
    if (prices === 0) continue;
    priceLines += 1;
    if (LONE_PRICE.test(line)) counts.split += 1;
    else if (line.includes("|")) counts.table += 1;
    else if (LEADER.test(line)) counts.leaders += 1;
    else if (SENTENCE.test(line)) counts.sentences += 1;
    else counts.plain += 1;
  }
  if (priceLines === 0) return { signature: "no_prices", priceLines };
  const shape = (Object.entries(counts) as Array<[keyof typeof counts, number]>).sort((a, b) => b[1] - a[1])[0][0];
  const length = longLines > 0 && longLines * 4 >= lines.length ? "long" : "short";
  return { signature: `${shape}/${length}`, priceLines };
}

export interface LayoutYield {
  documents: number;
  thin: number;
}

/** Signatures by how many texts with prices read thin, most first. */
export function thinLayouts(reads: Array<{ signature: string; priceLines: number; found: number }>): Record<string, LayoutYield> {
  const bySignature = new Map<string, LayoutYield>();
  for (const read of reads) {
    if (read.priceLines === 0) continue;
    const entry = bySignature.get(read.signature) ?? { documents: 0, thin: 0 };
    entry.documents += 1;
    if (read.found < THIN_READ_FEES && read.priceLines >= THIN_READ_FEES) entry.thin += 1;
    bySignature.set(read.signature, entry);
  }
  return Object.fromEntries([...bySignature].sort((a, b) => b[1].thin - a[1].thin || b[1].documents - a[1].documents));
}
