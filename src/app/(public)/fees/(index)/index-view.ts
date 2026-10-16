import type { IndexRow } from "@/lib/data-store";
import { HIGHEST_TIER_CATEGORIES, summarizeFees, valuePerInstitution, type FeeStatistics } from "@/lib/data-store/fee-stats";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { buildHistogramBuckets, type HistogramBucket } from "@/lib/fee-histogram-buckets";
import { STATE_NAMES } from "@/lib/us-states";

/**
 * The Bank Fee Index explorer's numbers, all from one read (the category's published rows)
 * and one rule (summarizeFees, one value per institution). The headline count, the median,
 * the histogram and the institution list share a population, so they can't disagree.
 */

export type Charter = "all" | "bank" | "credit_union";

export interface Selection {
  fee: string;
  /** Two-letter state code, or null for the U.S. */
  state: string | null;
  charter: Charter;
}

export const CHARTER_LABELS: Record<Charter, string> = {
  all: "Banks and credit unions",
  bank: "Banks",
  credit_union: "Credit unions",
};

/** Reads the explorer's query string; anything unknown falls back to the default. */
export function parseSelection(
  params: Record<string, string | string[] | undefined>,
  knownFees: ReadonlySet<string>,
  fallbackFee: string,
): Selection & { bin: number | null } {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const fee = one("fee");
  const state = one("state")?.toUpperCase();
  const charter = one("charter");
  const bin = Number(one("bin"));
  return {
    fee: fee && knownFees.has(fee) ? fee : fallbackFee,
    state: state && STATE_NAMES[state] ? state : null,
    charter: charter === "bank" || charter === "credit_union" ? charter : "all",
    bin: Number.isInteger(bin) && bin >= 0 ? bin : null,
  };
}

/** Institutions shown under the chart at first, and per page once the reader asks for all of them. */
export const LIST_FIRST = 8;
export const LIST_ALL = 50;

/** The list's own state: a name search, a page, and whether the reader asked for every match. */
export interface ListState {
  q: string;
  page: number;
  all: boolean;
}

export function parseListState(params: Record<string, string | string[] | undefined>): ListState {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const page = Number(one("page"));
  return {
    q: (one("q") ?? "").trim().slice(0, 80),
    page: Number.isInteger(page) && page > 1 ? page : 1,
    all: one("view") === "all",
  };
}

/** The institutions matching the search, A to Z, and the page of them to show. */
export function listPage<T extends { name: string }>(
  listed: T[],
  list: ListState,
): { matching: number; rows: T[]; page: number; pages: number; perPage: number } {
  const q = list.q.toLowerCase();
  const matches = [...listed].filter((i) => !q || i.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  const perPage = list.all ? LIST_ALL : LIST_FIRST;
  const pages = Math.max(1, Math.ceil(matches.length / perPage));
  const page = Math.min(list.page, pages);
  return { matching: matches.length, rows: matches.slice((page - 1) * perPage, page * perPage), page, pages, perPage };
}

/** An account name worth printing: a product's name, not a heading the reader caught ("Account Fees: A"). */
export function accountName(raw: string | null): string | null {
  const name = raw?.replace(/\s+/g, " ").trim();
  if (!name || name.length > 60) return null;
  if (/^account\b/i.test(name) || /[:]/.test(name)) return null;
  return /\b(checking|savings|account|money market|share|club|draft)\b/i.test(name) ? name : null;
}

const FREQUENCY: Record<string, string> = {
  monthly: "a month",
  annual: "a year",
  quarterly: "a quarter",
  daily: "a day",
  hourly: "an hour",
  per_item: "per item",
  per_occurrence: "each time",
  per_transaction: "per transaction",
  one_time: "once",
};

/** How often the fee is charged, as words, or null when the schedule line does not say. */
export function chargedWhen(frequency: string | null): string | null {
  return frequency ? (FREQUENCY[frequency] ?? null) : null;
}

export function selectionHref(sel: Selection, extra: Record<string, string> = {}, hash = "explorer"): string {
  const q = new URLSearchParams({ fee: sel.fee });
  if (sel.state) q.set("state", sel.state);
  if (sel.charter !== "all") q.set("charter", sel.charter);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `/fees?${q.toString()}#${hash}`;
}

export function placeName(state: string | null): string {
  return state ? STATE_NAMES[state] : "the U.S.";
}

function matches(row: IndexRow, state: string | null, charter: Charter): boolean {
  if (state && row.state_code !== state) return false;
  if (charter !== "all" && row.charter_type !== charter) return false;
  return true;
}

/** One institution as the list shows it: its counted value and the schedule line nearest it. */
export interface IndexInstitution {
  id: number;
  name: string;
  state: string | null;
  charter: string;
  value: number;
  row: IndexRow;
}

export function institutionsFor(rows: IndexRow[], fee: string, state: string | null, charter: Charter): IndexInstitution[] {
  const picked = rows.filter((r) => matches(r, state, charter));
  const values = valuePerInstitution(picked.map((r) => ({ ...r, fee_category: fee })));
  const byId = new Map<number, IndexRow[]>();
  for (const r of picked) {
    const list = byId.get(r.institution_id) ?? [];
    list.push(r);
    byId.set(r.institution_id, list);
  }
  const out: IndexInstitution[] = [];
  for (const [id, value] of values) {
    const list = byId.get(id) ?? [];
    const row = [...list].sort((a, b) => Math.abs(a.amount - value) - Math.abs(b.amount - value) || a.id - b.id)[0];
    if (!row) continue;
    out.push({ id, name: row.institution_name, state: row.state_code, charter: row.charter_type, value, row });
  }
  return out.sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));
}

export function statsFor(rows: IndexRow[], fee: string, state: string | null, charter: Charter): FeeStatistics {
  return summarizeFees(rows.filter((r) => matches(r, state, charter)).map((r) => ({ ...r, fee_category: fee })));
}

export function histogram(institutions: IndexInstitution[]): HistogramBucket[] {
  return buildHistogramBuckets(institutions.map((i) => ({ value: i.value, isBank: i.charter === "bank" })));
}

export function inBucket(b: HistogramBucket, value: number): boolean {
  return (b.min === null || value >= b.min) && (b.max === null || value < b.max + 0.01);
}

/** One group in the companion comparison: its median and middle half, or too few for either. */
export interface CompareGroup {
  label: string;
  /** How a sentence names the group: "Florida", "the U.S.", "credit unions". */
  phrase: string;
  /** The group as a sentence's subject: "Florida's", "The bank". */
  owner: string;
  /** The other side as a comparison names it: "the national median", "the credit union median". */
  against: string;
  stats: FeeStatistics;
}

/**
 * The comparison that adds the most to the selection: a chosen state against the U.S., or,
 * for the U.S., banks against credit unions. Both use the same charter choice and rule.
 */
export function companion(rows: IndexRow[], sel: Selection): { title: string; groups: CompareGroup[] } {
  if (sel.state) {
    return {
      title: `${STATE_NAMES[sel.state]} against the U.S.`,
      groups: [
        { label: STATE_NAMES[sel.state], phrase: STATE_NAMES[sel.state], owner: `${STATE_NAMES[sel.state]}'s`, against: `the ${STATE_NAMES[sel.state]} median`, stats: statsFor(rows, sel.fee, sel.state, sel.charter) },
        { label: "U.S.", phrase: "the U.S.", owner: "The national", against: "the national median", stats: statsFor(rows, sel.fee, null, sel.charter) },
      ],
    };
  }
  return {
    title: "Banks against credit unions",
    groups: [
      { label: "Banks", phrase: "banks", owner: "The bank", against: "the bank median", stats: statsFor(rows, sel.fee, null, "bank") },
      { label: "Credit unions", phrase: "credit unions", owner: "The credit union", against: "the credit union median", stats: statsFor(rows, sel.fee, null, "credit_union") },
    ],
  };
}

/**
 * What the Index counts for one institution, in words: the median of the prices it publishes for
 * the fee, or the highest for overdraft. An institution median is a calculation, so the page never
 * says an institution "charges" it (James, Oct 16: "Use 'institution median' consistently").
 */
export function countedAs(fee: string): {
  /** Short label for one institution's counted value. */
  label: string;
  /** The same, plural. */
  labels: string;
  /** What the value is, for sentences: "median published price". */
  measure: string;
  /** The verb phrase for how it is taken from the prices: "the median". */
  of: string;
  headline: string;
} {
  return HIGHEST_TIER_CATEGORIES.has(fee)
    ? {
        label: "highest published price",
        labels: "highest published prices",
        measure: "highest published price",
        of: "the highest",
        headline: "Median of each institution's highest published price",
      }
    : {
        label: "institution median",
        labels: "institution medians",
        measure: "median published price",
        of: "the median",
        headline: "Median of each institution's median published price",
      };
}

export function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** Codes in STATE_NAMES that aren't states: the coverage finding counts the 50 states only. */
const NOT_STATES = new Set(["DC", "PR", "VI", "GU", "AS"]);

/** The most common price is called out when this share of institutions charge it. */
const CONCENTRATED = 0.2;

/**
 * Up to three findings for the current selection, each with its count: the comparison's gap
 * (or that there is none), how concentrated the prices are, and where coverage is too thin.
 * No claims about prices changing over time.
 */
export function findings(rows: IndexRow[], sel: Selection, institutions: IndexInstitution[]): string[] {
  const out: string[] = [];
  const { groups } = companion(rows, sel);
  const [a, b] = groups;
  if (a.stats.median_amount != null && b.stats.median_amount != null) {
    // The result, stated without judging whether the gap matters (James, Oct 16: "Florida's
    // median is $7.50, $0.55 above the national median").
    const am = a.stats.median_amount;
    const bm = b.stats.median_amount;
    if (am === bm) {
      out.push(`${a.owner} median matches ${b.against} at ${money(am)}.`);
    } else {
      out.push(`${a.owner} median is ${money(am)}, ${money(Math.round(Math.abs(am - bm) * 100) / 100)} ${am > bm ? "above" : "below"} ${b.against}.`);
    }
  }

  if (institutions.length >= MIN_INSTITUTIONS_FOR_MEDIAN) {
    const counts = new Map<number, number>();
    for (const i of institutions) counts.set(i.value, (counts.get(i.value) ?? 0) + 1);
    const [price, n] = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
    const share = n / institutions.length;
    // Counted per institution, so the share is of institution medians (or highest prices), not of prices charged.
    const { label, measure } = countedAs(sel.fee);
    if (share >= CONCENTRATED) {
      out.push(`${Math.round(share * 100)}% of the ${institutions.length.toLocaleString()} institutions have a ${measure} of exactly ${money(price)}.`);
    } else {
      out.push(`No single ${label} dominates: the most common, ${money(price)}, is the ${measure} for ${Math.round(share * 100)}% of the ${institutions.length.toLocaleString()} institutions.`);
    }
  }

  if (sel.state) {
    if (institutions.length < MIN_INSTITUTIONS_FOR_MEDIAN) {
      out.push(
        institutions.length === 0
          ? `No institution headquartered in ${STATE_NAMES[sel.state]} publishes this fee in a schedule we hold yet.`
          : `Only ${institutions.length} ${institutions.length === 1 ? "institution" : "institutions"} headquartered in ${STATE_NAMES[sel.state]} ${institutions.length === 1 ? "publishes" : "publish"} this fee, too few for a median (${MIN_INSTITUTIONS_FOR_MEDIAN} needed).`,
      );
    }
  } else {
    const perState = new Map<string, Set<number>>();
    for (const r of rows) {
      if (!r.state_code || (sel.charter !== "all" && r.charter_type !== sel.charter)) continue;
      const set = perState.get(r.state_code) ?? new Set<number>();
      set.add(r.institution_id);
      perState.set(r.state_code, set);
    }
    const thin = Object.keys(STATE_NAMES).filter((s) => !NOT_STATES.has(s)).filter((s) => (perState.get(s)?.size ?? 0) < MIN_INSTITUTIONS_FOR_MEDIAN);
    if (thin.length > 0) {
      out.push(
        `In ${thin.length} of the 50 states, fewer than ${MIN_INSTITUTIONS_FOR_MEDIAN} institutions headquartered there publish this fee, so ${thin.length === 1 ? "it gets" : "they get"} no state median yet.`,
      );
    }
  }
  return out.slice(0, 3);
}
