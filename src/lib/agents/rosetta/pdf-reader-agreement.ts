/**
 * `read.pdf_reader_agreement`: a second, independent reading of every PDF, compared with the
 * layout reading Rosetta stores.
 *
 * `pdf-layout.ts` rebuilds each page from item positions, and each layout version added a
 * detector for one more way a page can be set (prose columns, a dot-leader list beside a table,
 * stacked bullet lists). A page set in a way no detector knows can still pair a fee's name with
 * another column's price: before layout version 5, Oakwood's two stacked lists read
 * "Account Reconciliation | • $15.00 per wire" and its outgoing wire at $35 an hour (#2219).
 *
 * The second reading is the PDF's own drawing order: pdf.js items in content-stream order, with
 * the line breaks the file itself marks. It uses no positions, so it does not share the layout
 * reader's mistakes (a plain text tool, pypdf, read Oakwood's pairs correctly this way). Drawing
 * order has its own failure, a table drawn column by column puts every name before every price,
 * so this module pairs a name with a price only where the reading leaves no doubt:
 *   - a line that holds a name and then a price ("Stop Payment Fee | $35.00"), or
 *   - a name line directly followed by a price line, where the line before the name is not
 *     itself a bare name (a run of names is a column of labels whose prices come later).
 * A name both readings pair, with no price in common, is a disagreement: one of the two
 * readings has moved a price. The check does not decide which; it records the pairs so the
 * page can be looked at, and it never changes the stored text.
 */

import type { PdfTextItem } from "./pdf-layout";
import { PDF_READER_AGREEMENT_VERSION } from "./reader-versions";
// The number lives in reader-versions.ts (bump it there).
export { PDF_READER_AGREEMENT_VERSION };

/**
 * Amounts from this up are balances and deposit minimums ("$25,000 combined minimum"), not fee
 * prices; they are left out of the pairs.
 */
const MAX_FEE_PRICE = 1000;
/** At most this many disagreements are kept on the receipt; the count is always exact. */
const MAX_SAMPLES = 10;

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\.\d{1,2})/;
const MONEY_ALL = new RegExp(MONEY.source, "g");
const CELL = /\s\|\s/;
/** Bullets, dashes and cell separators at the start of a price line. */
const LEADING_MARKS = /^[\s•*·\-–—|]+/;

export interface ReaderPair {
  /** Normalized fee name: lower case, letters and digits, single spaces. */
  name: string;
  /** The name as printed on the first line it was paired on. */
  label: string;
  prices: number[];
}

export interface ReaderDisagreement {
  page: number;
  label: string;
  layout: number[];
  stream: number[];
}

export interface PdfReaderAgreement {
  version: number;
  /** Names both readings paired with a price. */
  compared: number;
  disagreementCount: number;
  disagreements: ReaderDisagreement[];
}

/** Page text in the PDF's drawing order, with the line breaks the file marks. */
export function streamPageText(items: PdfTextItem[]): string {
  let text = "";
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text;
}

function normalizeName(label: string): string {
  return label
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function prices(text: string): number[] {
  return [...text.matchAll(MONEY_ALL)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((price) => price < MAX_FEE_PRICE);
}

/**
 * A name opens with a capital or a digit; a line that opens in lower case continues the
 * sentence or cell above it ("deposit in all personal accounts").
 */
const NAME_START = /^[A-Z0-9]/;

/** A line that is only a name: letters, no price, no second cell, not a sentence. */
function bareName(line: string): boolean {
  return NAME_START.test(line) && /[A-Za-z]{3}/.test(line) && !MONEY.test(line) && !CELL.test(line) && line.length <= 80 && !/[.!?;]$/.test(line);
}

/** A line that opens with a price, after any bullet or cell mark. */
function priceLine(line: string): boolean {
  return MONEY.test(line) && MONEY.exec(line.replace(LEADING_MARKS, ""))?.index === 0;
}

/** The fee names a reading pairs with a price, and the prices each is paired with. */
export function readerPairs(text: string): Map<string, ReaderPair> {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const pairs = new Map<string, ReaderPair>();
  const add = (label: string, found: number[]) => {
    const cleaned = label.replace(LEADING_MARKS, "").replace(/[\s|:•*·\-–—.]+$/, "").trim();
    const name = normalizeName(cleaned);
    if (found.length === 0 || !NAME_START.test(cleaned) || name.replace(/[^a-z]/g, "").length < 3 || name.split(" ").length > 10) return;
    const pair = pairs.get(name) ?? { name, label: cleaned, prices: [] };
    for (const price of found) if (!pair.prices.includes(price)) pair.prices.push(price);
    pairs.set(name, pair);
  };
  lines.forEach((line, index) => {
    const match = MONEY.exec(line);
    if (match && match.index > 0) {
      // A name and its price on one line. Only the cell the name sits in counts, so a row of
      // two cells ("Overdraft Fee | Stop Payment Fee") never pairs either name.
      const before = line.slice(0, match.index);
      const cells = before.split(CELL);
      if (cells.length <= 2 && cells.slice(1).every((cell) => cell.replace(LEADING_MARKS, "").trim() === "")) {
        add(cells[0], prices(line.slice(match.index).split(CELL)[0]));
      }
      return;
    }
    if (!bareName(line)) return;
    const next = lines[index + 1];
    const previous = lines[index - 1];
    if (next && priceLine(next) && !(previous && bareName(previous))) add(line, prices(next.split(CELL)[0]));
  });
  return pairs;
}

/** Disagreements between the stored layout reading and the drawing-order reading of each page. */
export function compareReadings(layoutPages: string[], streamPages: string[]): PdfReaderAgreement {
  let compared = 0;
  const all: ReaderDisagreement[] = [];
  layoutPages.forEach((layoutText, index) => {
    const layout = readerPairs(layoutText);
    const stream = readerPairs(streamPages[index] ?? "");
    for (const [name, pair] of layout) {
      const other = stream.get(name);
      if (!other) continue;
      compared += 1;
      if (pair.prices.some((price) => other.prices.includes(price))) continue;
      all.push({ page: index + 1, label: pair.label, layout: pair.prices, stream: other.prices });
    }
  });
  return {
    version: PDF_READER_AGREEMENT_VERSION,
    compared,
    disagreementCount: all.length,
    disagreements: all.slice(0, MAX_SAMPLES),
  };
}
