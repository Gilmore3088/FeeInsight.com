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
 * row with one price in every tier is left as printed: Knox already reads it. Rows whose trailing
 * cells do not number exactly the header's tiers ("3 Free " $5", "Varies") are left alone. Pure.
 */
const TIER_LABEL = /^[A-Z][A-Z0-9'’&-]*\+?$/;
const NOT_A_TIER = new Set(["OF", "AND", "THE", "FOR", "FEE", "FEES", "CHARGE", "CHARGES", "SCHEDULE", "SERVICE", "SERVICES"]);
const TIER_CELL = /^(?:\$\s?\d[\d,]*(?:\.\d{1,2})?|free|n\/a)$/i;
const PRICED_CELL = /^\$/;
const FREE_CELL = /^free$/i;
const MIN_TIERS = 3;
const MAX_TIERS = 8;

/** The number of tiers a header row names, or null when the line is not one. */
export function tierHeaderCount(line: string): number | null {
  const labels = line.trim().split(/\s+/).filter(Boolean);
  if (labels.length < MIN_TIERS || labels.length > MAX_TIERS) return null;
  if (!labels.every((label) => TIER_LABEL.test(label) && !NOT_A_TIER.has(label.replace(/\+$/, "")))) return null;
  return new Set(labels).size === labels.length ? labels.length : null;
}

function cents(cell: string): number {
  return Math.round(Number(cell.replace(/[$,\s]/g, "")) * 100);
}

/** A tier row's own lines, or null when the line is not a row of exactly `tiers` cells. */
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

export function withTierColumnRows(text: string): string {
  let tiers: number | null = null;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const header = tierHeaderCount(line);
    if (header != null) {
      tiers = header;
      out.push(line);
      continue;
    }
    const rows = tiers == null ? null : tierRowLines(line, tiers);
    if (rows) out.push(...rows);
    else out.push(line);
  }
  return out.join("\n");
}
