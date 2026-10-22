import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";
import { amountsIn, classifyFeeText } from "@/lib/agents/knox/rules";
import { cleanFeeName, composableTail, looksLikeHeading, ZERO_WORD } from "@/lib/agents/knox/layout";
import type { KnoxTableRow } from "@/lib/agents/knox/table-rows";

/**
 * v102: a two-column schedule flattened row by row prints two fees on one line, one per column
 * ("Garnishments and Levies | $100.00 | Domestic Outgoing (branch assisted) | $35.00"), and each
 * column's heading names the bare rows under it ("ACCOUNT ASSISTANCE | WIRE TRANSFERS"). The table
 * pass reads a line's first pair only, under the last single-cell heading, so a right-hand direction
 * ("Domestic Outgoing") or a customer type under a heading cell ("Cashier's Check | Stop Payment |
 * $35.00" over "Customer | $10.00 | ...") was never read (State keys 1338, 10193 and 8085).
 *
 * This keeps a heading per column and adds a row for a pair whose name only makes sense under its
 * column's heading. A column's heading comes from:
 *  - a line of two heading cells and no price ("WIRE TRANSFER | Notary Services"): both columns;
 *  - a heading cell that opens a line, before a pair or with none ("Cashier's Check | Stop Payment |
 *    $35.00", "Domestic | Customer | $3.00"): the left column. A bare direction or customer type
 *    there is a sub-heading of the left heading ("WIRE TRANSFER" / "Domestic"), replaced by the next;
 *  - a heading cell that ends a line after its last pair ("Incoming | $15.00 | Cashier's Check
 *    with Expedited Shipping"): the right column.
 * The first pair is the left column's only when it opens the line; any other pair is the right's.
 * A heading lasts while its page's lines are priced cell rows, and COLUMN_ROW_LINES lines past them.
 *
 * Only a bare name borrows it: one no rule files alone that, without its notes, is a direction, a
 * customer type or a size (`composableTail`), never only a unit or a sequence ("Each additional",
 * "Per item": the price beside a fee, not a column's row). The table pass then files the row only
 * when the heading and name together name a fee, and holds a range (`extractFromTableRows`).
 * Admit-only: these rows come after every row `tableRowsFromText` reads. Pure.
 */

const COLUMN_ROW_LINES = 8;
const PRICE_CELL_UNIT = /^\W*(?:per|each|a|an|item|month|monthly|year|annual|hour|page|check|request|occurrence|presentment)?\b/i;
/** A name made only of these is a unit or a sequence beside a price, not a column's row. */
const UNIT_WORDS = new Set(
  ("per each item items additional subsequent thereafter first fee fees amount charge charges cost price day month " +
    "presentment occurrence transaction transactions request").split(" "),
);
/**
 * A name with a service of its own is not a bare row of the heading beside it, even when no rule
 * files it alone: "Wire Transfers (VeraBank customers only) - Outgoing" under "Temporary Checks"
 * (Texas key 2414) is a wire, not a counter check.
 */
const SUBJECT_WORDS = new Set(["wire", "transfer", "transfers", "cash", "withdrawal", "withdrawals", "account", "accounts"]);
/** A price split over two cells ("$ | 17.00"). */
const SPLIT_DOLLAR = /^\$$/;
/** Only a figure with cents completes it: "$ | 2 | 5.00" (a footnote) or "$ | 1,000" (a count) is no price. */
const BARE_FIGURE = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;

interface ColumnHeading {
  heading: string;
  /** The heading a sub-heading ("Domestic") sits under ("WIRE TRANSFER"). */
  base: string;
  line: number;
}

interface Pair {
  name: string;
  value: string;
  at: number;
}

function hasPrice(cell: string): boolean {
  return amountsIn(cell).length > 0 || ZERO_WORD.test(cell.replace(/[*.]+$/, "").trim());
}

/** A price cell: a price with at most a unit beside it ("$35.00", "$2.00 per page", "Free"). */
function isValueCell(cell: string): boolean {
  if (!hasPrice(cell)) return false;
  const words = cell.replace(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g, " ").replace(PRICE_CELL_UNIT, " ");
  return (words.match(/[a-z]{3,}/gi) ?? []).length <= 2;
}

function isNameCell(cell: string): boolean {
  return /[a-z]/i.test(cell) && !hasPrice(cell);
}

function headingCell(cell: string): boolean {
  return /^[A-Z]/.test(cell) && cell.length <= 60 && !hasPrice(cell) && looksLikeHeading(cell);
}

/** The line's cells, with a price split over two cells ("$ | 17.00") joined again. */
function cellsOf(line: string): string[] {
  const cells: string[] = [];
  for (const cell of line.split(CELL_SEPARATOR).map((value) => value.trim()).filter(Boolean)) {
    if (BARE_FIGURE.test(cell) && SPLIT_DOLLAR.test(cells[cells.length - 1] ?? "")) cells[cells.length - 1] = `$${cell}`;
    else cells.push(cell);
  }
  return cells;
}

/** The line's name and price pairs, left to right. */
function pairsOf(cells: string[]): Pair[] {
  const pairs: Pair[] = [];
  for (let index = 0; index + 1 < cells.length; index += 1) {
    if (isNameCell(cells[index]) && isValueCell(cells[index + 1])) {
      pairs.push({ name: cells[index], value: cells[index + 1], at: index });
      index += 1;
    }
  }
  return pairs;
}

/** A name that needs its column's heading: no rule files it alone and it is a direction, customer type or size. */
function needsHeading(rawName: string): string | null {
  const name = cleanFeeName(rawName);
  if (!name || classifyFeeText(name)) return null;
  const noteless = name.replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!noteless || !composableTail(noteless)) return null;
  const words = noteless.toLowerCase().split(/[\s\-–:,()&/.*]+/).filter((word) => word.length > 1);
  if (words.some((word) => SUBJECT_WORDS.has(word))) return null;
  return words.every((word) => UNIT_WORDS.has(word)) ? null : name;
}

/** A heading cell's words, without a trailing colon or footnote number ("SAFE DEPOSIT BOX3"). */
function headingOf(cell: string, index: number): ColumnHeading | null {
  const heading = cleanFeeName(cell.replace(/:\s*$/, ""));
  return heading ? { heading, base: heading, line: index } : null;
}

/** The left column's heading after an opening cell: a bare direction nests under the heading above. */
function leftHeading(cell: string, prior: ColumnHeading | null, index: number): ColumnHeading | null {
  const sub = needsHeading(cell);
  if (sub && prior) return { heading: `${prior.base} ${sub}`, base: prior.base, line: index };
  return headingOf(cell, index);
}

function open(column: ColumnHeading | null, index: number): column is ColumnHeading {
  return column != null && index - column.line <= COLUMN_ROW_LINES;
}

/** Rows for the bare pairs a column heading names on a two-column page. */
export function columnHeadingRows(lines: readonly string[]): KnoxTableRow[] {
  const rows: KnoxTableRow[] = [];
  let left: ColumnHeading | null = null;
  let right: ColumnHeading | null = null;

  lines.forEach((line, index) => {
    // Review of 081765f: a line of words with no cells ("COLLECTION ITEMS", "Money Orders", a
    // sentence) spans the page, so it ends both columns' headings; a bare price line does not.
    if (!line.includes(CELL_SEPARATOR)) {
      if (/[a-z]/i.test(line)) left = right = null;
      return;
    }
    const cells = cellsOf(line);
    if (!cells.some(hasPrice)) {
      const twoHeadings = cells.length === 2 && cells.every(headingCell);
      left = twoHeadings ? headingOf(cells[0], index) : null;
      right = twoHeadings ? headingOf(cells[1], index) : null;
      return;
    }
    const pairs = pairsOf(cells);
    const columns = { left: open(left, index) ? left : null, right: open(right, index) ? right : null };
    if (pairs[0]?.at !== 0 && headingCell(cells[0])) {
      // Before a pair, the cell heads the left column's rows; a cell with its own price beside it
      // ("Temporary Checks | 4 personalized checks for $5.00") is a row, and ends the heading above
      // unless it is a bare sub-heading ("International | Temporary Check (3 for $1.00)").
      const nests = needsHeading(cells[0]) != null && columns.left != null;
      left = pairs[0]?.at === 1 || nests ? leftHeading(cells[0], columns.left, index) : null;
    }
    pairs.forEach((pair, order) => {
      const column = order === 0 && pair.at === 0 ? columns.left : columns.right;
      const name = column ? needsHeading(pair.name) : null;
      if (column && name) rows.push({ cells: [name, pair.value], heading: column.heading, layout: "cells", headingNames: true });
    });
    const last = pairs[pairs.length - 1];
    if (last && last.at + 2 === cells.length - 1 && headingCell(cells[cells.length - 1])) right = headingOf(cells[cells.length - 1], index);
    // A priced cell row keeps its page's columns open.
    if (left) left = { ...left, line: index };
    if (right) right = { ...right, line: index };
  });
  return rows;
}
