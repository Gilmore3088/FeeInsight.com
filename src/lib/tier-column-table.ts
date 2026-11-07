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
/** Metals and gems: each names a relationship tier on its own. */
const METAL_WORDS = new Set([
  "PLATINUM", "GOLD", "SILVER", "BRONZE", "COPPER", "TITANIUM", "DIAMOND", "SAPPHIRE", "EMERALD",
  "RUBY", "PEARL", "ONYX", "JADE",
]);
/** Rank words: a tier only beside a metal or gem ("PREFERRED PREMIER CHECKING" is three products). */
const RANK_WORDS = new Set(["ELITE", "PRESTIGE", "PREFERRED", "PREMIER"]);
const MIN_TIER_WORDS = 2;
/** At most one header label may be no tier word (Schools FCU's "COLLEGE" beside four metals). */
const MAX_OTHER_LABELS = 1;
export const MIN_TIERS = 3;
const MAX_TIERS = 8;
export const MIN_TIER_ROWS = 3;
const MAX_TITLE_WORDS = 10;
/** One token cell of a row ("$25", "FREE", "N/A"); "Varies" is a table cell no tier fee reads. */
export const TIER_CELL = /^(?:\$\s?\d[\d,]*(?:\.\d{1,2})?|free|n\/a)$/i;
const TABLE_CELL = /^(?:\$\s?\d[\d,]*(?:\.\d{1,2})?|free|n\/a|varies)$/i;
const PRICE_TOKEN = /^\$\s?\d[\d,]*(?:\.\d{1,2})?$/;
/** A cell token no tier fee reads, but still a cell: one before the run makes the row one cell too many. */
const NO_PRICE_CELL = /^(?:—|–|-|varies|n\/c|nc|none|waived|included|\*)$/i;
/** The mark a PDF prints between an allowance and its price: an arrow, or a quote the arrow became. */
const ALLOWANCE_MARK = /^(?:→|->|➔|➜|"|”|“|»)$/;
const MAX_ALLOWANCE = 99;

/** The header's labels, or null when the line is not a tier header. */
export function tierHeaderLabels(line: string): string[] | null {
  const labels = line.trim().split(/\s+/).filter(Boolean);
  if (labels.length < MIN_TIERS || labels.length > MAX_TIERS) return null;
  if (!labels.every((label) => TIER_LABEL.test(label))) return null;
  if (new Set(labels).size !== labels.length) return null;
  // Positive evidence only (review of #2993): most labels are tier words, and a rank word counts only beside a metal or gem.
  const words = labels.map((label) => label.replace(/\+$/, ""));
  const metals = words.some((word) => METAL_WORDS.has(word));
  const isTier = (word: string) => METAL_WORDS.has(word) || (metals && RANK_WORDS.has(word));
  const tierWords = new Set(words.filter(isTier));
  const others = words.filter((word) => !isTier(word)).length;
  return tierWords.size >= MIN_TIER_WORDS && others <= MAX_OTHER_LABELS ? labels : null;
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
  if (at > 0 && (TIER_CELL.test(tokens[at - 1]) || NO_PRICE_CELL.test(tokens[at - 1]))) return null;
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
const cellsKey = (row: TierRow) => JSON.stringify(row.cells);

/**
 * The tier rows a row name names. When two rows of the text carry the name with different cells (a
 * fee printed in two tier tables, "Courtesy Pay" under general fees and under loan fees), the name
 * alone does not say which row is the fee's: `ambiguous`, and no row is returned.
 */
export function tierRowsNamed(rows: readonly TierRow[], name: string): { row: TierRow | null; ambiguous: boolean } {
  const key = labelKey(name);
  const named = rows.filter((row) => labelKey(row.name) === key);
  if (named.length === 0) return { row: null, ambiguous: false };
  if (new Set(named.map(cellsKey)).size > 1) return { row: null, ambiguous: true };
  return { row: named[0], ambiguous: false };
}

/** A tier fee name's base and bracket ("Courtesy Pay (Gold)" is "Courtesy Pay" and "Gold"), or null. */
function tierNameParts(feeName: string): { base: string; tier: string } | null {
  const match = feeName.trim().match(/^(.*\S)\s*\(([^()]+)\)$/);
  return match ? { base: match[1], tier: labelKey(match[2]) } : null;
}

/**
 * The tier row and column a tier fee's name names: the name is a row's name with one of its table's
 * labels in brackets. Null when no tier row carries that name and label, or when two rows carry the
 * name with different cells (`tierFeeCellAmbiguous`).
 */
export function tierFeeCell(rows: readonly TierRow[], feeName: string): { row: TierRow; cell: TierCell; label: string } | null {
  const parts = tierNameParts(feeName);
  if (!parts) return null;
  const { row } = tierRowsNamed(rows, parts.base);
  if (!row) return null;
  const column = row.labels.findIndex((label) => labelKey(label) === parts.tier);
  return column >= 0 ? { row, cell: row.cells[column], label: row.labels[column] } : null;
}

/** True when the name is a tier fee's name ("Courtesy Pay (Gold)") whose row name two tier rows carry with different cells. */
export function tierFeeCellAmbiguous(rows: readonly TierRow[], feeName: string): boolean {
  const parts = tierNameParts(feeName);
  if (!parts) return false;
  const named = rows.filter((row) => labelKey(row.name) === labelKey(parts.base));
  return new Set(named.map(cellsKey)).size > 1 && named.some((row) => row.labels.some((label) => labelKey(label) === parts.tier));
}

/**
 * True when a stored line is the tier row's own: the row as printed, or v100's split line of it,
 * "<row name> | <price or Free>" at a price one of its cells charges.
 */
export function isTierRowLine(row: TierRow, line: string | null | undefined, text: string): boolean {
  if (!line) return false;
  const flat = (value: string) => value.replace(/\s+/g, " ").trim();
  const own = flat(line);
  const canon = canonicalLine(line);
  if (!canon) return false;
  if (canon === canonicalLine(row.line)) return true;
  // Re-review of #2993: a cut or split form proves the row only when no other line of the page prints it
  // (v100's split lines are Knox's rewrite, never stored text): "Courtesy Pay $20" or "Stop Payment | $25"
  // printed in a business section is that section's own row, in whatever case, spacing, pipes, colons,
  // leaders or price form the page prints it ("Stop Payment|$25", "STOP PAYMENT ..... $25.00"). Both sides
  // are compared in one canonical form. What cannot be proved is refused.
  const startsWith = (whole: string) => whole === canon || whole.startsWith(`${canon} `);
  const elsewhere = text.split("\n").some((other, index) => index !== row.lineIndex && startsWith(canonicalLine(other)));
  if (elsewhere) return false;
  // A cut of the row's own line from its start must reach past its first cell: a cut that stops there
  // reads the same as a one-price line of its own.
  if (startsWith(canonicalLine(row.line))) return labelKey(line).startsWith(labelKey(row.name)) && cutPassesFirstCell(row, own);
  const split = own.match(/^(.*\S)\s*\|\s*(\$\s?\d[\d,]*(?:\.\d{1,2})?|free)$/i);
  if (!split || labelKey(split[1]) !== labelKey(row.name)) return false;
  const amount = /^free$/i.test(split[2]) ? 0 : Number(split[2].replace(/[$,\s]/g, ""));
  return row.cells.some((cell) => {
    const charged = tierCellAmount(cell);
    return charged != null && Math.abs(charged - amount) < 0.005;
  });
}

/**
 * One canonical form of a line for comparing a stored excerpt with the page's lines: each price as its
 * cents ("$25.00" and "$25" are both `p2500`), then `labelKey` (lower case, every run of anything but
 * letters, digits and "+" — spaces, pipes, colons, dot leaders, dashes — one space).
 */
function canonicalLine(value: string): string {
  return labelKey(value.replace(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g, (_, figure: string) => ` p${Math.round(Number(figure.replace(/,/g, "")) * 100)} `));
}

/** True when a cut of the row's line has more tokens than the row's name and its first cell. */
function cutPassesFirstCell(row: TierRow, cut: string): boolean {
  const tokens = row.line.trim().split(/\s+/);
  const nameTokens = row.name.trim().split(/\s+/).length;
  const first = row.cells[0];
  const width = first.kind !== "allowance" ? 1 : ALLOWANCE_MARK.test(tokens[nameTokens + 2] ?? "") ? 4 : 3;
  return cut.split(/\s+/).length > nameTokens + width;
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
