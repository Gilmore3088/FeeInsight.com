/**
 * A relationship-tier fee table, read the same way by Knox, the shared source check and the wire
 * scope review (#1092; DECISIONS 2026-11-04). One header row names the tiers ("PLATINUM GOLD SILVER+
 * SILVER COLLEGE", State key 7450) over fee rows that print one cell per tier on the row's line
 * ("Stop Payment FREE $25 $25 $25 $25"). The header is narrow: 3 to 8 capitals labels, distinct,
 * two of them relationship-tier words (metals, gems, ranks), so "PERSONAL BUSINESS COMMERCIAL" never
 * arms it. The table is the contiguous run of section titles and rows with a cell per tier under it.
 *
 * James's decisions (2026-11-04): a tier table is one fee per tier, each named with its tier in title
 * case from the header ("Courtesy Pay (Platinum)", "(Silver+)"), $0 tiers included; a row with the same
 * price in every tier is one fee; a free allowance ("1 Free → $5") is a condition on the priced fee,
 * not a $0 fee of its own.
 *
 * `TIER_COLUMN_FEES_LIVE` (off) holds Knox's per-tier read, the source check's tier-cell trace and the
 * wire scope's equal-price row together, so a tier fee Knox writes is traced the way Darwin traces it.
 * Read through `tierColumnFeesLive()`; the lab, the switch gate and the dry run hold it with
 * `withTierColumnFees`. Pure.
 */
export const TIER_COLUMN_FEES_LIVE: boolean = false;

let tierColumnFeesOn = TIER_COLUMN_FEES_LIVE;

/** Whether the per-tier read is on: `TIER_COLUMN_FEES_LIVE`, unless `withTierColumnFees` holds it. */
export function tierColumnFeesLive(): boolean {
  return tierColumnFeesOn;
}

/** Runs `read` with the per-tier read on or off (the lab, the switch gate, the dry run). Synchronous reads only. */
export function withTierColumnFees<T>(on: boolean, read: () => T): T {
  const before = tierColumnFeesOn;
  tierColumnFeesOn = on;
  try {
    return read();
  } finally {
    tierColumnFeesOn = before;
  }
}

const TIER_LABEL = /^[A-Z][A-Z0-9'’&-]*\+?$/;
const TIER_WORDS = new Set([
  "PLATINUM", "GOLD", "SILVER", "BRONZE", "COPPER", "TITANIUM", "DIAMOND", "SAPPHIRE", "EMERALD",
  "RUBY", "PEARL", "ONYX", "JADE", "ELITE", "PRESTIGE", "PREFERRED", "PREMIER",
]);
const MIN_TIER_WORDS = 2;
export const MIN_TIERS = 3;
const MAX_TIERS = 8;
export const MIN_TIER_ROWS = 3;
const MAX_TITLE_WORDS = 10;
/** One token cell of a row ("$25", "FREE", "N/A"); "Varies" is a table cell no tier fee reads. */
export const TIER_CELL = /^(?:\$\s?\d[\d,]*(?:\.\d{1,2})?|free|n\/a)$/i;
const TABLE_CELL = /^(?:\$\s?\d[\d,]*(?:\.\d{1,2})?|free|n\/a|varies)$/i;
const PRICE_TOKEN = /^\$\s?\d[\d,]*(?:\.\d{1,2})?$/;
/** The mark a PDF prints between an allowance and its price: an arrow, or a quote the arrow became. */
const ALLOWANCE_MARK = /^(?:→|->|➔|➜|"|”|“|»)$/;
const MAX_ALLOWANCE = 99;

/** The header's labels, or null when the line is not a tier header. */
export function tierHeaderLabels(line: string): string[] | null {
  const labels = line.trim().split(/\s+/).filter(Boolean);
  if (labels.length < MIN_TIERS || labels.length > MAX_TIERS) return null;
  if (!labels.every((label) => TIER_LABEL.test(label))) return null;
  if (new Set(labels).size !== labels.length) return null;
  const tierWords = new Set(labels.map((label) => label.replace(/\+$/, "")).filter((label) => TIER_WORDS.has(label)));
  return tierWords.size >= MIN_TIER_WORDS ? labels : null;
}

/** A header label in title case, as a tier fee's name carries it: "SILVER+" is "Silver+". */
export function tierTitle(label: string): string {
  return label.toLowerCase().replace(/(^|[\s'’&-])([a-z])/g, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

/** A section title inside the table ("GENERAL FEES", "SHARE DRAFT (Checking)"): no figure, no sentence. */
export function isTierSectionTitle(line: string): boolean {
  const words = line.trim().split(/\s+/);
  return words.length <= MAX_TITLE_WORDS && !/[$\d]/.test(line) && !/[.;:]\s*\S/.test(line.trim());
}

/** A row of the table: at least one cell per tier anywhere on it ("Cashier Checks 3 Free " $5 ..."). */
export function isTierTableRow(line: string, tiers: number): boolean {
  return line.trim().split(/\s+/).filter((token) => TABLE_CELL.test(token)).length >= tiers;
}

/** The end (exclusive) of the table that starts at `start`: titles and rows, ended by any other line. */
export function tierTableEnd(lines: readonly string[], start: number, tiers: number): number {
  let end = start;
  while (end < lines.length) {
    const line = lines[end];
    if (!line.trim() || tierHeaderLabels(line) != null) break;
    if (!isTierTableRow(line, tiers) && !isTierSectionTitle(line)) break;
    end += 1;
  }
  return end;
}

/** One tier's cell: a price, free, not offered, or a price after a free allowance ("1 Free → $5"). */
export type TierCell =
  | { kind: "price"; cents: number; text: string }
  | { kind: "free" }
  | { kind: "na" }
  | { kind: "allowance"; free: number; cents: number; text: string };

function cents(token: string): number {
  return Math.round(Number(token.replace(/[$,\s]/g, "")) * 100);
}

/**
 * A row's name and one cell per tier, read from the end of the line, or null when its trailing cells
 * are not exactly `tiers` cells. An allowance cell is "N Free", an optional arrow mark, then a price.
 */
export function tierRowCells(line: string, tiers: number): { name: string; cells: TierCell[] } | null {
  const tokens = line.trim().split(/\s+/);
  const cells: TierCell[] = [];
  let at = tokens.length;
  while (at > 0 && cells.length < tiers) {
    const token = tokens[at - 1];
    if (PRICE_TOKEN.test(token)) {
      const marked = at >= 4 && ALLOWANCE_MARK.test(tokens[at - 2]) && /^free$/i.test(tokens[at - 3]) && /^\d{1,2}$/.test(tokens[at - 4]);
      const bare = !marked && at >= 3 && /^free$/i.test(tokens[at - 2]) && /^\d{1,2}$/.test(tokens[at - 3]);
      if (marked || bare) {
        const free = Number(tokens[at - (marked ? 4 : 3)]);
        if (free < 1 || free > MAX_ALLOWANCE) return null;
        cells.unshift({ kind: "allowance", free, cents: cents(token), text: token.replace(/\s+/g, "") });
        at -= marked ? 4 : 3;
        continue;
      }
      cells.unshift({ kind: "price", cents: cents(token), text: token.replace(/\s+/g, "") });
    } else if (/^free$/i.test(token)) cells.unshift({ kind: "free" });
    else if (/^n\/a$/i.test(token)) cells.unshift({ kind: "na" });
    else break;
    at -= 1;
  }
  if (cells.length !== tiers) return null;
  // A cell before the run would make it one cell too many: the row does not line up with the tiers.
  if (at > 0 && TIER_CELL.test(tokens[at - 1])) return null;
  const name = tokens.slice(0, at).join(" ");
  if (!/[a-z]{2}/i.test(name) || /[$|]/.test(name)) return null;
  return { name, cells };
}

/** True when every tier's cell is the same price, free in every tier, or the same allowance. */
export function uniformTierCells(cells: readonly TierCell[]): boolean {
  const key = (cell: TierCell) => (cell.kind === "price" || cell.kind === "allowance" ? `${cell.kind}:${cell.cents}:${cell.kind === "allowance" ? cell.free : ""}` : cell.kind);
  return new Set(cells.map(key)).size === 1;
}

export interface TierRow {
  lineIndex: number;
  line: string;
  name: string;
  cells: TierCell[];
  labels: string[];
}

/** Every tier table's rows in a text, with the header labels over them. Tables with fewer than three rows read none. */
export function tierTableRows(text: string): TierRow[] {
  const lines = text.split("\n");
  const rows: TierRow[] = [];
  let at = 0;
  while (at < lines.length) {
    const labels = tierHeaderLabels(lines[at]);
    at += 1;
    if (labels == null) continue;
    const end = tierTableEnd(lines, at, labels.length);
    const table: TierRow[] = [];
    for (let index = at; index < end; index += 1) {
      const row = tierRowCells(lines[index], labels.length);
      if (row) table.push({ lineIndex: index, line: lines[index].trim(), name: row.name, cells: row.cells, labels });
    }
    if (table.length >= MIN_TIER_ROWS) rows.push(...table);
    at = end;
  }
  return rows;
}

/** A tier fee's name: the row's name with its tier in title case ("Courtesy Pay (Platinum)"). */
export function tierFeeName(name: string, label: string): string {
  return `${name} (${tierTitle(label)})`;
}

/** The allowance a cell states, as the fee's condition: "first 3 free". */
export function allowanceCondition(free: number): string {
  return `first ${free} free`;
}

const labelKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();

/**
 * The tier row and column a tier fee's name names: the name is a row's name with one of its table's
 * labels in brackets. Null when no tier row carries that name and label.
 */
export function tierFeeCell(rows: readonly TierRow[], feeName: string): { row: TierRow; cell: TierCell; label: string } | null {
  const match = feeName.trim().match(/^(.*\S)\s*\(([^()]+)\)$/);
  if (!match) return null;
  const base = labelKey(match[1]);
  const tier = labelKey(match[2]);
  for (const row of rows) {
    if (labelKey(row.name) !== base) continue;
    const column = row.labels.findIndex((label) => labelKey(label) === tier);
    if (column >= 0) return { row, cell: row.cells[column], label: row.labels[column] };
  }
  return null;
}

/** True when two names share a base and name different brackets ("Courtesy Pay (Gold)", "Courtesy Pay (Silver)"); the text decides if they are tiers. */
export function tierSiblingNames(nameA: string | null | undefined, nameB: string | null | undefined): boolean {
  const a = (nameA ?? "").trim().match(/^(.*\S)\s*\(([^()]+)\)$/);
  const b = (nameB ?? "").trim().match(/^(.*\S)\s*\(([^()]+)\)$/);
  return a != null && b != null && labelKey(a[1]) === labelKey(b[1]) && labelKey(a[2]) !== labelKey(b[2]);
}

/**
 * True when two names are two tiers of one tier table row ("Courtesy Pay (Gold)" and "Courtesy Pay
 * (Silver)"): one fee per tier, so the same price on both is two fees, not one line read twice.
 */
export function differentTierFees(text: string, nameA: string, nameB: string): boolean {
  if (!/\)\s*$/.test(nameA) || !/\)\s*$/.test(nameB)) return false;
  const rows = tierTableRows(text);
  const a = tierFeeCell(rows, nameA);
  const b = tierFeeCell(rows, nameB);
  return a != null && b != null && a.row.lineIndex === b.row.lineIndex && a.label !== b.label;
}

/** True when the name is one tier of a tier table row and that tier's own cell is free ("Stop Payment (Platinum)"). */
export function freeTierCell(text: string, feeName: string): boolean {
  if (!/\)\s*$/.test(feeName)) return false;
  return tierFeeCell(tierTableRows(text), feeName)?.cell.kind === "free";
}

/** The amount a tier cell charges in dollars: free is $0, an allowance its price after the free ones, not offered none. */
export function tierCellAmount(cell: TierCell): number | null {
  if (cell.kind === "free") return 0;
  if (cell.kind === "na") return null;
  return cell.cents / 100;
}
