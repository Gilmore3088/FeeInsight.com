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
  /**
   * The published amount the row is compared on: its one amount, or the highest of several
   * (a real amount on its schedule, never a computed one). Null when the fee was not found.
   */
  amount: number | null;
  /** How many published amounts it lists in the category, and their spread. */
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

/** True when it publishes more than one amount in the category: the cell shows the range. */
export function isRange(row: CompareRow): boolean {
  return row.count > 1 && row.low != null && row.high != null && row.high > row.low;
}

/** "$0 to $5", "$35", or "No fee" for a published $0. */
export function amountText(row: CompareRow): string {
  if (row.amount == null) return row.missing ?? "";
  if (isRange(row)) return `${money(row.low as number)} to ${money(row.high as number)}`;
  return row.amount === 0 ? "No fee" : money(row.amount);
}

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
    // Several amounts compare on the highest, a real amount; one amount compares on itself.
    amount: v.count > 1 ? v.high : v.amount,
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

/** Dollar gap from the reference median; null when nothing to compare. */
function dollarGap(row: CompareRow): number | null {
  const ref = reference(row);
  if (row.amount == null || !ref) return null;
  return Math.abs(row.amount - ref.median.median);
}

/**
 * The hero's lead fee first, then the other headline fees in the index's headline order (a $0
 * NSF stays near the top as a real finding), then the rest by dollar gap from the median, fees
 * with no median after them, and the everyday fees it does not publish last.
 */
export function orderRows(rows: CompareRow[], headline: readonly string[] = [], leadKey: string | null = null): CompareRow[] {
  const position = new Map(headline.map((k, i) => [k, i]));
  const rank = (r: CompareRow) =>
    r.key === leadKey && r.amount != null ? 0 : r.amount == null ? 4 : position.has(r.key) ? 1 : dollarGap(r) == null ? 3 : 2;
  return [...rows].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) return (position.get(a.key) as number) - (position.get(b.key) as number);
    if (ra === 2) return (dollarGap(b) as number) - (dollarGap(a) as number) || a.label.localeCompare(b.label);
    return a.label.localeCompare(b.label);
  });
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

function listAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The fee the hero leads with: the everyday fee (overdraft, NSF, maintenance, out-of-network ATM)
 * furthest from its median in share terms, else the widest headline fee, else any. A $0 or a fee
 * within 1% of the median never leads.
 */
export function leadRow(rows: CompareRow[], headline: readonly string[] = []): CompareRow | null {
  const differs = (r: CompareRow) => r.amount != null && r.amount > 0 && (shareGap(r) ?? 0) > 0;
  const widest = (list: CompareRow[]) => [...list].filter(differs).sort((a, b) => (shareGap(b) ?? 0) - (shareGap(a) ?? 0))[0] ?? null;
  const everyday = new Set<string>(EVERYDAY_FEES);
  const lead = new Set(headline);
  return widest(rows.filter((r) => everyday.has(r.key))) ?? widest(rows.filter((r) => lead.has(r.key))) ?? widest(rows);
}

/**
 * The hero's one line. A full profile leads with its widest gap from the state (or U.S.) median;
 * a sparse one leads with the fees it has and says once how few there are; an empty one says why.
 * The amount quoted is always one printed on its schedule.
 */
export function heroFinding(input: {
  rows: CompareRow[];
  /** Named in the sentence, so the line stands on its own when quoted. Defaults to "Its". */
  name?: string;
  /** The fees the finding may lead with first, in the index's headline order. */
  headline?: readonly string[];
  stateName: string | null;
  sparse: boolean;
  /** Published personal fee rows (the count the Personal list shows); defaults to the rows compared. */
  publishedCount?: number;
  /** Published business-only fee rows, shown apart under Business and named once in the sentence. */
  businessCount?: number;
  schedule: ScheduleState;
  underReview: number;
}): string {
  const { rows, stateName, sparse, schedule, underReview, headline = [], publishedCount, businessCount = 0, name } = input;
  const owner = name ? `${name}\u2019s` : "Its";
  const published = rows.filter((r) => r.amount != null);
  if (published.length === 0) {
    if (underReview > 0) return "Fees from its schedule are under review and appear here once review is done.";
    return schedule === "found" ? EXTRACTION_PENDING : `${NO_SCHEDULE}.`;
  }
  if (sparse) {
    const total = Math.max(publishedCount ?? published.length, published.length);
    const n = WORDS[total] ?? String(total);
    const shown = published.slice(0, 4).map((r) => `${lowerLabel(r.label)} ${amountText(r).replace("No fee", "$0")}`);
    const rest = total - shown.length;
    const list = rest > 0 ? `${shown.join(", ")} and ${rest} more` : listAnd(shown);
    const business =
      businessCount > 0
        ? ` Its schedule also lists ${businessCount} business ${businessCount === 1 ? "fee" : "fees"}, shown under Business.`
        : "";
    return `${n} ${total === 1 ? "fee" : "fees"} from its schedule ${total === 1 ? "is" : "are"} published so far: ${list}.${business}`;
  }
  const lead = leadRow(rows, headline);
  if (lead && lead.amount != null) {
    const ref = reference(lead)!;
    const place = ref.level === "state" && stateName ? stateName : "U.S.";
    const diff = lead.amount - ref.median.median;
    const gap = `${money(Math.abs(diff))} ${diff > 0 ? "above" : "below"} the ${money(ref.median.median)} ${place} median`;
    return isRange(lead)
      ? `${owner} highest published ${lowerLabel(lead.label)} fee is ${money(lead.amount)}, ${gap}.`
      : `${owner} ${lowerLabel(lead.label)} fee is ${money(lead.amount)}, ${gap}.`;
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

/** "Above the Florida median on 4 of 11 compared fees, below on 5 and about the same on 2." */
export function compareFinding(counts: CompareCounts, stateName: string | null): string {
  const place = counts.level === "state" && stateName ? stateName : "U.S.";
  const { above, below, same, compared } = counts;
  const of = `${compared} compared ${compared === 1 ? "fee" : "fees"}`;
  if (same === compared) return `About the same as the ${place} median on all ${of}.`;
  const parts = [
    above > 0 ? `above the ${place} median on ${above} of ${of}` : null,
    below > 0 ? (above > 0 ? `below on ${below}` : `below the ${place} median on ${below} of ${of}`) : null,
    same > 0 ? `about the same on ${same}` : null,
  ].filter((p): p is string => p !== null);
  const sentence = listAnd(parts);
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** "9 of its 27 benchmarked fees sit above the U.S. middle 50%, 12 inside and 6 below." Zero parts are left out. */
export function positionFinding(counts: { below: number; within: number; above: number }): string | null {
  const { below, within, above } = counts;
  const total = below + within + above;
  if (total === 0) return null;
  const of = `of its ${total} benchmarked ${total === 1 ? "fee" : "fees"}`;
  const lead = above > 0 ? `${above} ${of} ${above === 1 ? "sits" : "sit"} above the U.S. middle 50%` : `None ${of} sits above the U.S. middle 50%`;
  const rest = [within > 0 ? `${within} inside` : null, below > 0 ? `${below} below` : null].filter((p): p is string => p !== null);
  return rest.length > 0 ? `${lead}${above > 0 ? "," : ";"} ${listAnd(rest)}.` : `${lead}.`;
}
