/**
 * A safe deposit box row named only by its size (W43 live audit, #2064). Pure, no imports, so
 * Knox's name tidy (`tidyFeeName`), the shared source check (`checkFeeAgainstSource`) and Hamilton's
 * same-line check read the same rule without an import cycle.
 *
 * A box table prints its sizes under a heading ("Safe Deposit Box Annual Rental", "Self Storage
 * Lease Boxes"): "10x10 Annual Fee: $80.00", "3 x 10: $70.00", 'Large (10"x10") $75.00'. Knox read
 * each row's own words, so 26 of the 30 wrong names the live audit's replay found were boxes live
 * under their size alone. The name is "Safe Deposit Box" and the row's own words. Only a fee filed
 * as a safe deposit box is renamed, and only such a fee is traced by its row's own words, on a row
 * that is the size itself (`leadsBoxRow`), never another product's row that prints a size.
 */

export const BOX_CATEGORY = "safe_deposit_box";
export const BOX_NAME_PREFIX = "Safe Deposit Box";

/** One box size, two or three sides with optional inch marks ("10x10", "3” x 10” x 22”", '5"x5"'). */
const BOX_SIZE =
  /\d{1,2}(?:\.\d)?\s?["”″]?\s?[x×]\s?\d{1,2}(?:\.\d)?\s?["”″]?(?:\s?[x×]\s?\d{1,2}(?:\.\d)?\s?["”″]?)?/gi;
/** The only other words a bare box size's row carries: its size word, rent period, or "box". */
const BOX_SIZE_WORDS =
  /^(?:small|medium|large|x-?large|extra|jumbo|standard|size|annual(?:ly)?|yearly|fee|rent(?:al)?|box|per|year)$/i;
const BOX_SIZE_PUNCTUATION = /[\s()[\]:,.\-–—]+/g;
/** Letter, legal and ledger paper (photocopies, printing): never a box. Sides sorted, smaller first. */
const PAPER_SIZES = new Set(["8x11", "8.5x11", "8.5x14", "11x17"]);
/** Words of a box heading or label that may sit before a size on its own row. */
const BOX_LEAD_WORDS =
  /^(?:safe|safety|deposit|box|boxes|lock|vault|self|storage|lease|annual|annually|yearly|rent|rental|rentals|fee|fees|size|sizes|type|types|small|medium|large|extra|jumbo|standard|per|year|and|the)$/;

function isPaperSize(size: string): boolean {
  const sides = (size.match(/\d+(?:\.\d)?/g) ?? []).map(Number).sort((a, b) => a - b);
  return sides.length === 2 && PAPER_SIZES.has(`${sides[0]}x${sides[1]}`);
}

/** Whether a name is one box size and nothing else but size, rent and box words. */
function isBareBoxSize(name: string): boolean {
  const sizes = name.match(BOX_SIZE);
  if (sizes?.length !== 1 || isPaperSize(sizes[0])) return false;
  return name.replace(BOX_SIZE, " ").split(BOX_SIZE_PUNCTUATION).filter(Boolean).every((word) => BOX_SIZE_WORDS.test(word));
}

/**
 * "10x10 Annual Fee" is "Safe Deposit Box 10x10 Annual Fee"; "3” x 10” x 22” Box" is "Safe Deposit
 * Box 3” x 10” x 22”" (its "Box" is the prefix's). A name with any other word, a paper size, or a
 * figure besides the size (a footnote number, "3x10” 8"), is returned as it is.
 */
export function boxSizeNamed(name: string): string {
  if (!isBareBoxSize(name)) return name;
  const own = name.replace(/^box\s+/i, "").replace(/\s+box$/i, "").replace(/[\s:;,]+$/, "").trim();
  return `${BOX_NAME_PREFIX} ${own}`;
}

/** The row's own words of a name `boxSizeNamed` built, whatever the category; otherwise null. For name comparison only. */
export function boxNameRowWords(name: string): string | null {
  const prefix = `${BOX_NAME_PREFIX} `;
  if (!name.startsWith(prefix)) return null;
  const own = name.slice(prefix.length).trim();
  return isBareBoxSize(own) ? own : null;
}

/** The row's own words of a safe deposit box's name `boxSizeNamed` built ("3 x 10"); null for any other fee. */
export function asReadBoxName(name: string, canonicalKey: string | null | undefined): string | null {
  return canonicalKey === BOX_CATEGORY ? boxNameRowWords(name) : null;
}

function lineWords(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9.×x]+/g, " ").replace(/(?<!\d)\.|\.(?!\d)/g, " ").trim().split(/\s+/).filter(Boolean);
}

/**
 * The traced line prints the size as a box row: before the size on its line there are only box
 * heading words ("Safe Deposit Box Annual Fees 3X5"), the previous cell's price or size ("$25.00 |
 * 3X10"), or nothing. "Night Deposit Bag 10x12" and "Wire Transfer 3x5" are other products' rows.
 */
export function leadsBoxRow(sourceLine: string, ownName: string, fullText?: string | null): boolean {
  const verdict = boxRowVerdict(sourceLine, ownName);
  // The traced line is a window that can stop short of the size (a schedule flattened to one long
  // line): then the size must lead a box row somewhere on the page.
  return verdict === "box" || (verdict === "absent" && fullText != null && boxRowVerdict(fullText, ownName) === "box");
}

function boxRowVerdict(text: string, ownName: string): "box" | "other" | "absent" {
  const name = lineWords(ownName);
  if (name.length === 0) return "absent";
  let found = false;
  // A table cell, a line, a bullet or the end of a sentence starts a new row.
  for (const cell of text.split(CELL_BREAK)) {
    const line = lineWords(cell);
    for (let at = 0; at + name.length <= line.length; at += 1) {
      if (!name.every((word, offset) => line[at + offset] === word)) continue;
      found = true;
      let lead = at - 1;
      while (lead >= 0 && !/\d/.test(line[lead]) && BOX_LEAD_WORDS.test(line[lead])) lead -= 1;
      if (lead < 0 || /\d/.test(line[lead])) return "box";
    }
  }
  return found ? "other" : "absent";
}

const CELL_BREAK = /\s*\|\s*|\r?\n|[•●▪■]|(?<=[a-z)])[.;]\s+/i;
