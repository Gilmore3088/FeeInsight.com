import type { IndexEntry } from "@/lib/data-store/fee-index";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { HeadlineValue } from "./profile-data";

/**
 * Pure shaping for the institution page's research-brief layout: each published fee beside the
 * state, Fed district and U.S. medians the state and district pages quote (the same index reads),
 * the one finding the hero leads with, and the empty-cell notes the city page uses. Nothing here
 * invents a value: a geography without enough institutions for a median shows none.
 */

/** "$36", "$2.50", "$1,250": the city and state pages' format, with a thousands separator. */
export function money(n: number): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "Overdraft (OD)" reads as "overdraft" inside a sentence; acronyms such as ATM and NSF keep their case. */
export function lowerLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)/g, "").replace(/\b[A-Z][a-z]+/g, (w) => w.toLowerCase());
}

/** A gap within 1% of the benchmark reads as about the same, as on the state and district pages. */
export function aboutSame(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.abs(b) * 0.01;
}

/** The city page's wording for an empty cell, so the two pages explain a gap the same way. */
export const NO_SCHEDULE = "No fee schedule found yet";
export const EXTRACTION_PENDING = "Schedule found; extraction pending.";
export const NOT_IDENTIFIED = "Fee not identified in the reviewed schedule.";
export const ACCOUNT_NOT_IDENTIFIED = "Account not identified";

export type ScheduleState = "none" | "found" | "reviewed";

export function scheduleState(input: { publishedFees: number; hasSchedule: boolean }): ScheduleState {
  if (input.publishedFees > 0) return "reviewed";
  return input.hasSchedule ? "found" : "none";
}

export function missingNote(state: ScheduleState): string {
  return state === "none" ? NO_SCHEDULE : state === "found" ? EXTRACTION_PENDING : NOT_IDENTIFIED;
}

export interface Median {
  median: number;
  institutions: number;
}

/** An index entry's median, only when enough institutions stand behind it. */
export function medianOf(entry: IndexEntry | undefined): Median | null {
  if (!entry || entry.median_amount == null || entry.institution_count < MIN_INSTITUTIONS_FOR_MEDIAN) return null;
  return { median: entry.median_amount, institutions: entry.institution_count };
}

export interface CompareRow {
  key: string;
  label: string;
  /** The index's value for this institution; null when the fee was not found (see `missing`). */
  amount: number | null;
  /** How many of its published amounts the value comes from, and their spread. */
  count: number;
  low: number | null;
  high: number | null;
  sourceUrl: string | null;
  account: string | null;
  state: Median | null;
  district: Median | null;
  us: Median | null;
  missing: string | null;
}

export interface MarketIndexes {
  state: IndexEntry[];
  district: IndexEntry[];
  us: IndexEntry[];
}

/** The everyday fees a reader looks for first; a missing one gets a row that says why. */
export const EVERYDAY_FEES = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network"] as const;

/**
 * One row per fee it publishes, then a row for each everyday fee it does not, with the city
 * page's note for why the cell is empty. A published fee with no median anywhere still shows.
 */
export function compareRows(
  values: HeadlineValue[],
  markets: MarketIndexes,
  schedule: ScheduleState,
  fallbackSource: string | null,
): CompareRow[] {
  const by = (list: IndexEntry[]) => new Map(list.map((e) => [e.fee_category, e]));
  const state = by(markets.state);
  const district = by(markets.district);
  const us = by(markets.us);
  const medians = (key: string) => ({
    state: medianOf(state.get(key)),
    district: medianOf(district.get(key)),
    us: medianOf(us.get(key)),
  });
  const present: CompareRow[] = values.map((v) => ({
    key: v.category,
    label: getDisplayName(v.category),
    amount: v.amount,
    count: v.count,
    low: v.low,
    high: v.high,
    sourceUrl: v.sourceUrl ?? fallbackSource,
    account: v.account,
    ...medians(v.category),
    missing: null,
  }));
  const have = new Set(values.map((v) => v.category));
  const missing: CompareRow[] = EVERYDAY_FEES.filter((key) => !have.has(key)).map((key) => ({
    key,
    label: getDisplayName(key),
    amount: null,
    count: 0,
    low: null,
    high: null,
    sourceUrl: null,
    account: null,
    ...medians(key),
    missing: missingNote(schedule),
  }));
  return [...present, ...missing];
}

/** The median a row is read against first: its state's, else the U.S. */
export function reference(row: CompareRow): { median: Median; level: "state" | "us" } | null {
  if (row.state) return { median: row.state, level: "state" };
  if (row.us) return { median: row.us, level: "us" };
  return null;
}

/** Share gap from the reference median; null when nothing to compare. */
function shareGap(row: CompareRow): number | null {
  const ref = reference(row);
  if (row.amount == null || !ref || ref.median.median <= 0) return null;
  if (aboutSame(row.amount, ref.median.median)) return 0;
  return Math.abs(row.amount - ref.median.median) / ref.median.median;
}

/**
 * The headline fees readers look up (overdraft, NSF, maintenance and the like) before the rest;
 * within each, differences first, widest share gap first; then fees about the same as the
 * median; then fees with no median to compare. The everyday fees it does not publish come last.
 */
export function orderRows(rows: CompareRow[], headline: readonly string[] = []): CompareRow[] {
  const lead = new Set(headline);
  const rank = (r: CompareRow) => {
    if (r.amount == null) return 9;
    const gap = shareGap(r);
    return (lead.has(r.key) ? 0 : 3) + (gap == null ? 2 : gap === 0 ? 1 : 0);
  };
  return [...rows].sort((a, b) => rank(a) - rank(b) || (shareGap(b) ?? 0) - (shareGap(a) ?? 0) || a.label.localeCompare(b.label));
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

function listAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The fee furthest from its reference median, when one sits outside the 1% tolerance. */
export function leadRow(rows: CompareRow[], headline: readonly string[] = []): CompareRow | null {
  const differs = (r: CompareRow) => r.amount != null && r.amount > 0 && (shareGap(r) ?? 0) > 0;
  // The everyday fees (overdraft, NSF, maintenance, out-of-network ATM) lead when one differs.
  const everyday = orderRows(rows.filter((r) => (EVERYDAY_FEES as readonly string[]).includes(r.key)));
  return everyday.find(differs) ?? orderRows(rows, headline).find(differs) ?? null;
}

/**
 * The hero's one line. A full profile leads with its widest gap from the state (or U.S.) median;
 * a sparse one leads with the fees it has and says once how few there are; an empty one says why.
 */
export function heroFinding(input: {
  rows: CompareRow[];
  /** Named in the sentence, so the line stands on its own when quoted. Defaults to "Its". */
  name?: string;
  /** The fees the finding may lead with first, in the index's headline order. */
  headline?: readonly string[];
  stateName: string | null;
  sparse: boolean;
  /** Published fee rows on its schedule (the count the fee list shows); defaults to the rows compared. */
  publishedCount?: number;
  schedule: ScheduleState;
  underReview: number;
}): string {
  const { rows, stateName, sparse, schedule, underReview, headline = [], publishedCount, name } = input;
  const owner = name ? `${name}’s` : "Its";
  const published = rows.filter((r) => r.amount != null);
  if (published.length === 0) {
    if (underReview > 0) return "Fees from its schedule are under review and appear here once review is done.";
    return schedule === "found" ? EXTRACTION_PENDING : `${NO_SCHEDULE}.`;
  }
  if (sparse) {
    const total = Math.max(publishedCount ?? published.length, published.length);
    const n = WORDS[total] ?? String(total);
    const shown = published.slice(0, 4).map((r) => `${lowerLabel(r.label)} ${money(r.amount as number)}`);
    const rest = total - shown.length;
    const list = rest > 0 ? `${shown.join(", ")} and ${rest} more` : listAnd(shown);
    return `${n} ${total === 1 ? "fee" : "fees"} from its schedule ${total === 1 ? "is" : "are"} published so far: ${list}.`;
  }
  const lead = leadRow(rows, headline);
  if (lead && lead.amount != null) {
    const ref = reference(lead)!;
    const place = ref.level === "state" && stateName ? stateName : "U.S.";
    const diff = lead.amount - ref.median.median;
    return `${owner} ${lowerLabel(lead.label)} fee is ${money(lead.amount)}, ${money(Math.abs(diff))} ${diff > 0 ? "above" : "below"} the ${money(ref.median.median)} ${place} median.`;
  }
  const compared = published.filter((r) => reference(r));
  if (compared.length > 0) {
    const place = compared.some((r) => r.state) && stateName ? stateName : "U.S.";
    return `${owner} ${compared.length} compared ${compared.length === 1 ? "fee is" : "fees are"} about the same as the ${place} median.`;
  }
  return `${published.length} published ${published.length === 1 ? "fee" : "fees"}; none has a market median to compare yet.`;
}

export interface CompareCounts {
  above: number;
  below: number;
  same: number;
  compared: number;
  level: "state" | "us";
}

/** How its fees sit against the state median (or the U.S. median when the state has none). */
export function compareCounts(rows: CompareRow[]): CompareCounts | null {
  const priced = rows.filter((r) => r.amount != null);
  const level: "state" | "us" = priced.some((r) => r.state) ? "state" : "us";
  const pairs = priced.flatMap((r) => {
    const m = level === "state" ? r.state : r.us;
    return m ? [{ amount: r.amount as number, median: m.median }] : [];
  });
  if (pairs.length === 0) return null;
  const same = pairs.filter((p) => aboutSame(p.amount, p.median)).length;
  const above = pairs.filter((p) => !aboutSame(p.amount, p.median) && p.amount > p.median).length;
  return { above, below: pairs.length - same - above, same, compared: pairs.length, level };
}

/** "Above the Florida median on 4 of 11 fees, below on 5 and about the same on 2." */
export function compareFinding(counts: CompareCounts, stateName: string | null): string {
  const place = counts.level === "state" && stateName ? stateName : "U.S.";
  const { above, below, same, compared } = counts;
  if (same === compared) return `About the same as the ${place} median on all ${compared} compared ${compared === 1 ? "fee" : "fees"}.`;
  const parts = [
    above > 0 ? `above the ${place} median on ${above} of ${compared} ${compared === 1 ? "fee" : "fees"}` : null,
    below > 0 ? (above > 0 ? `below on ${below}` : `below the ${place} median on ${below} of ${compared} ${compared === 1 ? "fee" : "fees"}`) : null,
    same > 0 ? `about the same on ${same}` : null,
  ].filter((p): p is string => p !== null);
  const sentence = listAnd(parts);
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
