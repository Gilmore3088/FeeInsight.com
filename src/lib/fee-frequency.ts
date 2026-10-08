/**
 * How often a fee is charged, read from the words right after its own price on its schedule
 * line. Shared by Darwin's release review (a stated frequency that contradicts the line), Knox
 * (writing frequency at extraction) and Hamilton's frequency fill (a blank frequency on a live
 * fee). Only wording that points one way counts; anything else stays unknown.
 */

export const PER_ITEM_WORDING = /\b(each|per (item|check|transaction|occurrence|request|copy|page|withdrawal|debit|deposit)|\/\s?(item|check|transaction))\b/i;
export const PERIODIC_WORDING = /\b(per (month|year|quarter)|monthly|annual(ly)?|quarterly|\/\s?(mo|month|yr|year)\b|a month|a year)/i;

const MONTHLY_WORDING = /\b(per (month|statement cycle|cycle)|monthly|a month)\b|\/\s?(mo|month)\b/i;
const ANNUAL_WORDING = /\b(per year|annual(ly)?|yearly|a year)\b|\/\s?(yr|year)\b/i;
const QUARTERLY_WORDING = /\b(per quarter|quarterly)\b/i;
/** Wording that makes the price something other than a flat charge per event or period. */
const OTHER_BASIS = /(\bper (day|hour|dollar|hundred|thousand)\b|\bper\s*\$|\bdaily\b|\bhourly\b|\bper\s+\d|\bminimum\b|\bmaximum\b|\bmax\b)/i;
/** Per-event wording beyond the shared set, for filling a blank frequency. */
const MORE_PER_ITEM = /\bper (presentment|transfer|wire|card|key|inquiry|document|piece|sheet|occasion|money order|notary)\b|\/\s?(item|check|transaction|each|copy|page|request|transfer|wire)\b/i;
/** A cell after the price ("| $6.00 | Per Item") is read when it is this short. */
const NEXT_CELL_MAX = 25;
const PRICE = /\$\s?(\d[\d,]*(?:\.\d+)?)/g;

export type FilledFrequency = "per_item" | "monthly" | "annual" | "quarterly";

/** The words right after the fee's own price on its line ("$5.00 each after 6"), else the whole line. */
export function wordsAfterPrice(sourceLine: string, amount: number | null): string {
  return priceWords(sourceLine, amount, false) ?? sourceLine;
}

/**
 * The words after the price that equals `amount`, up to the next cell. With `nextCell`, an
 * empty rest of cell reads the next short cell instead ("Overdraft | $6.00 | Per Day"). Null
 * when the line does not print that price.
 */
function priceWords(sourceLine: string, amount: number | null, nextCell: boolean): string | null {
  if (amount == null) return null;
  for (const match of sourceLine.matchAll(PRICE)) {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) >= 0.005) continue;
    const start = (match.index ?? 0) + match[0].length;
    const cells = sourceLine.slice(start, start + 60).split(/[|;]/);
    if (nextCell && cells[0].trim() === "" && cells.length > 1 && cells[1].trim().length <= NEXT_CELL_MAX) return cells[1];
    return cells[0].slice(0, 40);
  }
  return null;
}

/**
 * The frequency the line states for the fee's own price, or null when it states none, states
 * more than one, or prices the fee by something else (per day, per hour, per $100, a minimum).
 * The line must print the fee's price: a frequency is never borrowed from a neighbouring fee.
 */
export function frequencyFromLine(sourceLine: string | null | undefined, amount: number | null): FilledFrequency | null {
  if (!sourceLine) return null;
  const words = priceWords(sourceLine, amount, true);
  if (words == null || OTHER_BASIS.test(words)) return null;
  const after = statedFrequency(words);
  if (after !== "none") return after;
  // Nothing after the price: the fee's own name may carry it ("Lost Key (each) | $15.00",
  // "Inactive Fee (Quarterly) | $10.00"), read from the start of its row to the price.
  const before = nameWords(sourceLine, amount);
  if (before == null || OTHER_BASIS.test(before)) return null;
  const named = statedFrequency(before);
  return named === "none" ? null : named;
}

/** One frequency, "none" when the words state none, null when they state several. */
function statedFrequency(words: string): FilledFrequency | "none" | null {
  const found: FilledFrequency[] = [];
  if (PER_ITEM_WORDING.test(words) || MORE_PER_ITEM.test(words)) found.push("per_item");
  if (MONTHLY_WORDING.test(words)) found.push("monthly");
  if (ANNUAL_WORDING.test(words)) found.push("annual");
  if (QUARTERLY_WORDING.test(words)) found.push("quarterly");
  if (found.length === 0) return "none";
  return found.length === 1 ? found[0] : null;
}

/** The fee's own row before its price: from the previous price (or the line's start) to it. */
function nameWords(sourceLine: string, amount: number | null): string | null {
  if (amount == null) return null;
  let previousEnd = 0;
  for (const match of sourceLine.matchAll(PRICE)) {
    const start = match.index ?? 0;
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) < 0.005) return sourceLine.slice(previousEnd, start);
    previousEnd = start + match[0].length;
  }
  return null;
}
