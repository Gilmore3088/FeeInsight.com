/**
 * Study observations: where the bank sits in Hamilton's stored studies (hamilton_studies,
 * refreshed by the studies run), so every Briefing places it in at least one study when it
 * has a placement. Pure. Every figure comes from a stored placement; nothing is computed or
 * estimated here, and an inferred figure always says so.
 *
 * - fee_dependence: deposit service charges (banks) or fee income (credit unions) as a share
 *   of revenue, against the same charter and size.
 * - local_income, market_concentration, fee_income_share: the bank's price for one study fee
 *   against institutions in the same fifth of the market driver.
 * - inferred_items_paid: reported overdraft/NSF income divided by the published fee.
 */

import { getDisplayName } from "@/lib/fee-taxonomy";
import type { Observation, SourceRef } from "./types";

/** One stored placement of the bank, joined to its current study. */
export interface StudyPlacementRow {
  studyKey: string;
  title: string;
  asOf: string;
  studyN: number;
  /** The study's own one-line finding, when it stored one. */
  studyHeadline: string | null;
  metric: string;
  value: number | null;
  peerGroup: string;
  peerN: number;
  peerMedian: number | null;
  percentile: number | null;
  detail: Record<string, unknown>;
}

/** Fewer institutions than this in a comparison group and the placement isn't shown. */
export const MIN_STUDY_PEERS = 5;

const PRICE_DRIVERS: Record<string, { group: string; driver: (institutionName?: string) => string; format: (v: number) => string }> = {
  local_income: {
    group: "institutions whose markets have similar household income",
    driver: (name) => `Median household income across ${name ? `${name}'s` : "your"} markets`,
    format: (v) => `$${Math.round(v).toLocaleString("en-US")}`,
  },
  market_concentration: {
    group: "institutions in similarly concentrated deposit markets",
    driver: (name) => `Deposit concentration (HHI) across ${name ? `${name}'s` : "your"} markets`,
    format: (v) => Math.round(v).toLocaleString("en-US"),
  },
  fee_income_share: {
    group: "institutions with a similar ratio of fee income to deposits",
    driver: (name) => `${name ? `${name}'s` : "Your"} fee income as a share of deposits`,
    format: (v) => `${(v * 100).toFixed(2)}%`,
  },
};

/** "Monthly Maintenance" reads "monthly maintenance fee" mid-sentence; acronyms keep their case. */
function feeInProse(fee: string): string {
  const words = getDisplayName(fee)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .split(" ")
    .map((w) => (/^[A-Z0-9]{2,5}$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
  return /fee/i.test(words) ? words : `${words} fee`;
}

function studySource(row: StudyPlacementRow): SourceRef {
  return { label: `Hamilton study: ${row.title}`, table: "hamilton_studies", asOf: row.asOf };
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} million`;
  return Math.round(n).toLocaleString("en-US");
}

function dollars(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1000).toLocaleString("en-US")}K`;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function compare(own: number, median: number, tolerance: number): "higher than" | "lower than" | "about the same as" {
  if (Math.abs(own - median) <= tolerance) return "about the same as";
  return own > median ? "higher than" : "lower than";
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "higher than 72%" above the middle, "lower than 83%" below it. */
function placeAmong(percentile: number): string {
  return percentile >= 50 ? `higher than ${Math.round(percentile)}%` : `lower than ${Math.round(100 - percentile)}%`;
}

/** How far from the middle a percentile sits, 0 to 1. */
function spread(percentile: number | null): number {
  return percentile === null ? 0 : Math.min(1, Math.abs(percentile - 50) / 50);
}

function dependenceObservation(row: StudyPlacementRow, institutionName?: string): Observation | null {
  if (row.value === null || row.peerMedian === null || row.peerN < MIN_STUDY_PEERS) return null;
  const bank = row.detail.charter !== "credit_union";
  const measure = bank ? "Deposit service charges were" : "Fee income was";
  const year = typeof row.detail.year === "number" ? row.detail.year : row.asOf;
  const source = studySource(row);
  const facts = [
    {
      text: `${capitalize(row.peerGroup)}: median ${row.peerMedian.toFixed(2)}% across ${row.peerN.toLocaleString("en-US")} institutions${row.percentile !== null ? `; ${institutionName ? `${institutionName} is` : "you are"} at the ${ordinal(Math.round(row.percentile))} percentile` : ""}.`,
      source,
    },
  ];
  const firstYear = row.detail.first_year;
  const firstValue = num(row.detail.first_year_value);
  if (typeof firstYear === "number" && firstYear !== year && firstValue !== null) {
    facts.push({ text: `In ${firstYear} the share was ${firstValue.toFixed(2)}%.`, source });
  }
  return {
    id: "study:fee_dependence",
    kind: "study",
    feeCategory: null,
    headline: `${measure} ${row.value.toFixed(2)}% of ${institutionName ? `${institutionName}'s` : "your"} revenue in ${year}, ${compare(row.value, row.peerMedian, 0.05)} the ${row.peerMedian.toFixed(2)}% median for ${row.peerGroup}.`,
    facts,
    actions: ["ask"],
    salience: 0.3 + 0.5 * spread(row.percentile),
  };
}

interface FifthPrice {
  fee: string;
  price: number;
  median: number;
  n: number;
  percentile: number | null;
}

function fifthPrices(detail: Record<string, unknown>): FifthPrice[] {
  const fees = detail.fees;
  if (!fees || typeof fees !== "object") return [];
  return Object.entries(fees as Record<string, Record<string, unknown>>).flatMap(([fee, v]) => {
    const price = num(v?.price);
    const median = num(v?.fifth_median);
    const n = num(v?.fifth_n);
    if (price === null || median === null || n === null || n < MIN_STUDY_PEERS) return [];
    return [{ fee, price, median, n, percentile: num(v?.price_percentile_in_fifth) }];
  });
}

function priceStudyObservation(row: StudyPlacementRow, usedFees: Set<string>, institutionName?: string): Observation | null {
  const driver = PRICE_DRIVERS[row.studyKey];
  if (!driver || row.value === null) return null;
  // The study fee furthest from the middle of its comparison group, overdraft first on a tie; a fee
  // another study already showed gives way to the next one, so the studies cover different fees.
  const ranked = fifthPrices(row.detail).sort(
    (a, b) => spread(b.percentile) - spread(a.percentile) || Number(b.fee === "overdraft") - Number(a.fee === "overdraft"),
  );
  const pick = ranked.find((p) => !usedFees.has(p.fee)) ?? ranked[0];
  if (!pick) return null;
  const name = feeInProse(pick.fee);
  const source = studySource(row);
  const facts = [
    {
      text: `${driver.driver(institutionName)}: ${driver.format(row.value)}${row.percentile !== null ? `, ${placeAmong(row.percentile)} of the ${row.peerN.toLocaleString("en-US")} institutions in the study` : ""}.`,
      source,
    },
  ];
  return {
    id: `study:${row.studyKey}`,
    kind: "study",
    feeCategory: pick.fee,
    headline: `${institutionName ? `${institutionName}'s` : "Your"} ${name} of ${money(pick.price)} is ${compare(pick.price, pick.median, 0.005)} the ${money(pick.median)} median of ${pick.n.toLocaleString("en-US")} ${driver.group}.`,
    facts,
    actions: ["research_fee", "ask"],
    salience: 0.25 + 0.5 * spread(pick.percentile),
  };
}

const INFERRED_ORDER = ["inferred_overdraft_nsf_items", "inferred_overdraft_items", "inferred_nsf_items"];
const INFERRED_FEES: Record<string, string> = {
  inferred_overdraft_nsf_items: "overdraft and NSF",
  inferred_overdraft_items: "overdraft",
  inferred_nsf_items: "NSF",
};

function inferredObservation(row: StudyPlacementRow, institutionName?: string): Observation | null {
  const fees = INFERRED_FEES[row.metric];
  const low = num(row.detail.items_low);
  const high = num(row.detail.items_high);
  const income = num(row.detail.income);
  const feeLow = num(row.detail.fee_low);
  const feeHigh = num(row.detail.fee_high);
  const period = typeof row.detail.period === "string" ? row.detail.period : row.asOf;
  if (!fees || low === null || high === null || income === null || feeLow === null || feeHigh === null) return null;
  const source = studySource(row);
  const range = low === high ? `about ${count(low)}` : `about ${count(low)} to ${count(high)}`;
  const fee = feeLow === feeHigh ? money(feeLow) : `${money(feeLow)} to ${money(feeHigh)}`;
  const facts = [
    { text: `Inferred, not reported: ${dollars(income)} of reported ${fees} income (net of waivers and refunds) divided by ${institutionName ? `${institutionName}'s` : "your"} published ${fee} fee.`, source },
  ];
  if (row.peerMedian !== null && row.peerN >= MIN_STUDY_PEERS) {
    facts.push({ text: `${capitalize(row.peerGroup)}: median about ${count(row.peerMedian)} items across ${row.peerN.toLocaleString("en-US")} institutions.`, source });
  }
  return {
    id: "study:inferred_items_paid",
    kind: "study",
    feeCategory: null,
    headline: `${institutionName ? `${institutionName}'s` : "Your"} ${fees} income implies ${range} ${fees} items paid in the four quarters to ${period}.`,
    facts,
    actions: ["ask"],
    salience: 0.25 + 0.5 * spread(row.percentile),
  };
}

/** One observation per study the bank is placed in, best supported first within each study. */
export function studyObservations(rows: StudyPlacementRow[], institutionName?: string): Observation[] {
  const out: Observation[] = [];
  const byStudy = new Map<string, StudyPlacementRow[]>();
  for (const r of rows) byStudy.set(r.studyKey, [...(byStudy.get(r.studyKey) ?? []), r]);
  const usedFees = new Set<string>();
  const order = ["fee_dependence", ...Object.keys(PRICE_DRIVERS), "inferred_items_paid"];
  const keys = [...byStudy.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const key of keys) {
    const list = byStudy.get(key)!;
    if (key === "fee_dependence") {
      const o = dependenceObservation(list[0], institutionName);
      if (o) out.push(o);
    } else if (key === "inferred_items_paid") {
      const ordered = [...list].sort((a, b) => INFERRED_ORDER.indexOf(a.metric) - INFERRED_ORDER.indexOf(b.metric));
      const o = ordered.map((row) => inferredObservation(row, institutionName)).find(Boolean);
      if (o) out.push(o);
    } else {
      const o = priceStudyObservation(list[0], usedFees, institutionName);
      if (o) {
        out.push(o);
        if (o.feeCategory) usedFees.add(o.feeCategory);
      }
    }
  }
  return out;
}

/**
 * The ranked Briefing list with one place kept for a study: when none of the bank's study
 * observations made the cut, the most notable one takes the last place.
 */
export function withStudyPlace(ranked: Observation[], studies: Observation[], limit: number): Observation[] {
  if (studies.length === 0 || ranked.some((o) => o.kind === "study")) return ranked;
  const best = [...studies].sort((a, b) => b.salience - a.salience || a.id.localeCompare(b.id))[0];
  return [...ranked.slice(0, Math.max(0, limit - 1)), best];
}

/** One year of the fee dependence study for a charter: the median and middle half, in percent. */
export interface DependenceYear {
  year: number;
  median: number;
  p25: number;
  p75: number;
}

/** The fee dependence chart: every bank (or credit union) since 2010, with the institution's own share marked. */
export interface DependenceChart {
  /** "banks" or "credit unions": whose median and middle half the band shows. */
  groupLabel: string;
  series: DependenceYear[];
  /** The institution's own share in its first and latest study years. */
  own: { year: number; value: number }[];
  peerGroup: string;
  peerMedian: number | null;
  asOf: string;
}

/** The chart for the bank's fee dependence placement; null without a placement or a series for its charter. */
export function dependenceChart(rows: StudyPlacementRow[], seriesByCharter: Record<string, DependenceYear[]>): DependenceChart | null {
  const row = rows.find((r) => r.studyKey === "fee_dependence");
  if (!row || row.value === null) return null;
  const charter = row.detail.charter === "credit_union" ? "credit_union" : "bank";
  const series = (seriesByCharter[charter] ?? []).filter((p) => [p.year, p.median, p.p25, p.p75].every((v) => typeof v === "number" && Number.isFinite(v)));
  if (series.length < 2) return null;
  const year = typeof row.detail.year === "number" ? row.detail.year : series[series.length - 1].year;
  const own = [{ year, value: row.value }];
  const firstYear = row.detail.first_year;
  const firstValue = num(row.detail.first_year_value);
  if (typeof firstYear === "number" && firstYear !== year && firstValue !== null) own.unshift({ year: firstYear, value: firstValue });
  return {
    groupLabel: charter === "credit_union" ? "credit unions" : "banks",
    series,
    own,
    peerGroup: row.peerGroup,
    peerMedian: row.peerMedian,
    asOf: row.asOf,
  };
}
