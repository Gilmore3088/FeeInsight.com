/**
 * v100: a relationship-tier fee table, one header row naming the tiers ("PLATINUM GOLD SILVER+
 * SILVER COLLEGE") over fee rows that print one price cell per tier on the same line ("Stop
 * Payment FREE $25 $25 $25 $25", State key 7450). Knox read only a row's first cell: a row whose
 * first tier is free gave an untraced $0 and lost the price the other tiers pay, and a second
 * price in a row ("Courtesy Pay $20 $30 $30 $30 $30") was never read.
 *
 * Each such row becomes one "name | price" line per distinct priced cell, in the tiers' order.
 * A free cell beside priced ones is one tier's perk, not the bank's price (Darwin's tier-perk
 * rule, #1397), so it gives no $0 line; a row free in every tier gives one "name | Free" line. A
 * row with one price in every tier is left as printed: Knox already reads it.
 *
 * The header is narrow (review of ad17538): its labels must include two relationship-tier words
 * (metals, gems, ranks), so "PERSONAL BUSINESS COMMERCIAL" or "SAFE DEPOSIT BOX" never arm it, and
 * it covers only the contiguous table under it. The table runs while each line is a section title
 * or a row with at least one cell per tier; a blank line, a sentence or any other line ends it.
 * Only rows whose trailing cells number exactly the header's tiers split, and only when the table
 * holds at least three of them. Pure.
 */
const TIER_LABEL = /^[A-Z][A-Z0-9'’&-]*\+?$/;
const TIER_WORDS = new Set([
  "PLATINUM", "GOLD", "SILVER", "BRONZE", "COPPER", "TITANIUM", "DIAMOND", "SAPPHIRE", "EMERALD",
  "RUBY", "PEARL", "ONYX", "JADE", "ELITE", "PRESTIGE", "PREFERRED", "PREMIER",
]);
const MIN_TIER_WORDS = 2;
const TIER_CELL = /^(?:\$\s?\d[\d,]*(?:\.\d{1,2})?|free|n\/a)$/i;
const TABLE_CELL = /^(?:\$\s?\d[\d,]*(?:\.\d{1,2})?|free|n\/a|varies)$/i;
const PRICED_CELL = /^\$/;
const FREE_CELL = /^free$/i;
const MIN_TIERS = 3;
const MAX_TIERS = 8;
const MIN_TIER_ROWS = 3;
const MAX_TITLE_WORDS = 10;

/** The number of tiers a header row names, or null when the line is not one. */
export function tierHeaderCount(line: string): number | null {
  const labels = line.trim().split(/\s+/).filter(Boolean);
  if (labels.length < MIN_TIERS || labels.length > MAX_TIERS) return null;
  if (!labels.every((label) => TIER_LABEL.test(label))) return null;
  if (new Set(labels).size !== labels.length) return null;
  const tierWords = new Set(labels.map((label) => label.replace(/\+$/, "")).filter((label) => TIER_WORDS.has(label)));
  return tierWords.size >= MIN_TIER_WORDS ? labels.length : null;
}

function cents(cell: string): number {
  return Math.round(Number(cell.replace(/[$,\s]/g, "")) * 100);
}

/** A section title inside the table ("GENERAL FEES", "SHARE DRAFT (Checking)"): no figure, no sentence. */
function isSectionTitle(line: string): boolean {
  const words = line.trim().split(/\s+/);
  return words.length <= MAX_TITLE_WORDS && !/[$\d]/.test(line) && !/[.;:]\s*\S/.test(line.trim());
}

/** A row of the table: at least one cell per tier anywhere on it ("Cashier Checks 3 Free " $5 ..."). */
function isTableRow(line: string, tiers: number): boolean {
  return line.trim().split(/\s+/).filter((token) => TABLE_CELL.test(token)).length >= tiers;
}

/** A tier row's own lines, or null when the line is not a row of exactly `tiers` trailing cells. */
function tierRowLines(line: string, tiers: number): string[] | null {
  const tokens = line.trim().split(/\s+/);
  let run = 0;
  while (run < tokens.length && TIER_CELL.test(tokens[tokens.length - 1 - run])) run += 1;
  if (run !== tiers) return null;
  const name = tokens.slice(0, tokens.length - run).join(" ");
  if (!/[a-z]{2}/i.test(name) || /[$|]/.test(name)) return null;
  const cells = tokens.slice(tokens.length - run);
  const priced = cells.filter((cell) => PRICED_CELL.test(cell));
  const distinct = [...new Map(priced.map((cell) => [cents(cell), cell.replace(/\s+/g, "")])).values()];
  if (distinct.length === 0) return cells.some((cell) => FREE_CELL.test(cell)) ? [`${name} | Free`] : null;
  if (distinct.length === 1 && priced.length === cells.length) return null;
  return distinct.map((cell) => `${name} | ${cell}`);
}

/** The table under a header: the contiguous titles and rows, ended by any other line. */
function tableEnd(lines: string[], start: number, tiers: number): number {
  let end = start;
  while (end < lines.length) {
    const line = lines[end];
    if (!line.trim() || tierHeaderCount(line) != null) break;
    if (!isTableRow(line, tiers) && !isSectionTitle(line)) break;
    end += 1;
  }
  return end;
}

export function withTierColumnRows(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let at = 0;
  while (at < lines.length) {
    const tiers = tierHeaderCount(lines[at]);
    out.push(lines[at]);
    at += 1;
    if (tiers == null) continue;
    const end = tableEnd(lines, at, tiers);
    const table = lines.slice(at, end);
    const split = table.map((line) => tierRowLines(line, tiers));
    const rows = split.filter((row) => row != null).length + table.filter((line) => isUniformTierRow(line, tiers)).length;
    if (rows >= MIN_TIER_ROWS) table.forEach((line, index) => out.push(...(split[index] ?? [line])));
    else out.push(...table);
    at = end;
  }
  return out.join("\n");
}

/** A row priced the same in every tier: left as printed, but it still counts as a tier row. */
function isUniformTierRow(line: string, tiers: number): boolean {
  const tokens = line.trim().split(/\s+/);
  const cells = tokens.slice(-tiers);
  return tokens.length > tiers && cells.every((cell) => PRICED_CELL.test(cell) && TIER_CELL.test(cell)) &&
    new Set(cells.map(cents)).size === 1 && !TIER_CELL.test(tokens[tokens.length - tiers - 1]);
}
