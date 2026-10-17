import type { CityFeeKey, CityMarket, CityMarketInstitution, DepositYear, IndexEntry } from "@/lib/data-store";
import { CITY_FEES } from "@/lib/data-store/city-market";
import { cityMedian } from "@/lib/city-median";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { lowerLabel, money } from "./format";

export { lowerLabel, money };

/** One fee across the institutions serving the area. */
export interface LocalFee {
  key: CityFeeKey;
  label: string;
  /** Institutions with branches here that publish this fee. */
  n: number;
  min: number | null;
  max: number | null;
  /** Only once MIN_INSTITUTIONS_FOR_MEDIAN institutions publish it. */
  median: number | null;
  /** Institutions headquartered in the state behind its median. */
  state_median: number | null;
  state_n: number | null;
  /** Every institution in the index behind the U.S. median. */
  us_median: number | null;
  us_n: number | null;
}

function withArticle(label: string): string {
  const l = lowerLabel(label);
  return `${/^([aeiou]|NSF|ATM)/i.test(l) ? "an" : "a"} ${l}`;
}

export function localFees(market: CityMarket, stateIndex: IndexEntry[], nationalIndex: IndexEntry[]): LocalFee[] {
  const stateBy = new Map(stateIndex.map((e) => [e.fee_category, e]));
  const usBy = new Map(nationalIndex.map((e) => [e.fee_category, e]));
  return CITY_FEES.map(({ key, label }) => {
    const amounts = market.institutions.flatMap((i) => (i.fees[key] ? [i.fees[key]!.amount] : []));
    return {
      key,
      label,
      n: amounts.length,
      min: amounts.length ? Math.min(...amounts) : null,
      max: amounts.length ? Math.max(...amounts) : null,
      median: cityMedian(amounts),
      state_median: stateBy.get(key)?.median_amount ?? null,
      state_n: stateBy.get(key)?.institution_count ?? null,
      us_median: usBy.get(key)?.median_amount ?? null,
      us_n: usBy.get(key)?.institution_count ?? null,
    };
  });
}

export interface Coverage {
  institutions: number;
  banks: number;
  credit_unions: number;
  with_fees: number;
  branches: number;
}

export function coverage(market: CityMarket): Coverage {
  const list = market.institutions;
  return {
    institutions: list.length,
    banks: list.filter((i) => i.charter === "bank").length,
    credit_unions: list.filter((i) => i.charter === "credit_union").length,
    with_fees: list.filter((i) => i.schedule === "published").length,
    branches: market.bank_branches + market.cu_branches,
  };
}

/** A local median this far from the state's is worth a sentence. */
const NOTABLE_GAP = 0.1;

/**
 * The page's opening finding: the fee whose local median (once enough institutions here publish
 * it) sits furthest from the state median, by share of the state median. Null when no fee is at
 * least NOTABLE_GAP away.
 */
export function leadFinding(fees: LocalFee[]): LocalFee | null {
  const gaps = fees
    .filter((f) => f.median != null && f.state_median != null && f.state_median > 0)
    .map((f) => ({ f, gap: (f.median! - f.state_median!) / f.state_median! }))
    .filter((g) => Math.abs(g.gap) >= NOTABLE_GAP)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  return gaps[0]?.f ?? null;
}

/**
 * Up to three things this market's published fees show, each with its own count: the fee
 * whose local median sits furthest from the state's, the fee with the widest local range,
 * and where coverage is too thin for a local median. No "cheapest in town" claims.
 */
export function marketFindings(fees: LocalFee[], placeName: string, stateName: string): string[] {
  const findings: string[] = [];
  const leadFee = leadFinding(fees);
  const lead = leadFee ? { f: leadFee } : null;
  if (lead) {
    const d = lead.f.median! - lead.f.state_median!;
    findings.push(
      `Among the ${lead.f.n} institutions here that publish ${withArticle(lead.f.label)} fee, the median is ${money(lead.f.median!)}, ${money(Math.abs(d))} ${d > 0 ? "above" : "below"} the ${stateName} median of ${money(lead.f.state_median!)}.`,
    );
  }
  const spread = fees
    .filter((f) => f.key !== lead?.f.key && f.n >= 3 && f.min != null && f.max != null && f.max > f.min)
    .sort((a, b) => b.n - a.n)[0];
  if (spread) {
    findings.push(`Published ${lowerLabel(spread.label)} fees here run from ${money(spread.min!)} to ${money(spread.max!)} across ${spread.n} institutions.`);
  }
  const thin = fees.find((f) => f.median == null && (f.key === "monthly_maintenance" || f.key === "overdraft"));
  if (thin) {
    findings.push(
      thin.n === 0
        ? `No institution here has a published ${lowerLabel(thin.label)} fee in the Bank Fee Index yet, so ${placeName} has no local median for it.`
        : `Only ${thin.n} ${thin.n === 1 ? "institution here has" : "institutions here have"} ${withArticle(thin.label)} fee in the Bank Fee Index, too few for a local median (${MIN_INSTITUTIONS_FOR_MEDIAN} needed).`,
    );
  }
  return findings;
}

export interface DepositLeader {
  id: number;
  name: string;
  branches: number;
  deposits: number;
  share: number;
}

/** The banks holding the most deposits at their branches here, with their share of all bank deposits here. */
export function depositLeaders(market: CityMarket, limit = 5): DepositLeader[] {
  const total = market.deposit_years.at(-1)?.area_deposits ?? 0;
  if (total <= 0) return [];
  return market.institutions
    .filter((i): i is CityMarketInstitution & { deposits: number } => i.charter === "bank" && (i.deposits ?? 0) > 0)
    .sort((a, b) => b.deposits - a.deposits)
    .slice(0, limit)
    .map((i) => ({ id: i.id, name: i.name, branches: i.branches, deposits: i.deposits, share: i.deposits / total }));
}

/** Percent change from `back` years before the latest year, for the area, the state and the U.S. */
export function trend(
  years: DepositYear[],
  back: number,
  pick: (y: DepositYear) => [number, number, number],
): { from: number; to: number; area: number | null; state: number | null; us: number | null } | null {
  const last = years.at(-1);
  const first = last ? years.find((y) => y.year === last.year - back) : undefined;
  if (!last || !first) return null;
  const [a1, s1, u1] = pick(first);
  const [a2, s2, u2] = pick(last);
  const pct = (a: number, b: number) => (a > 0 ? (b - a) / a : null);
  return { from: first.year, to: last.year, area: pct(a1, a2), state: pct(s1, s2), us: pct(u1, u2) };
}

/** Thousands of dollars (Summary of Deposits units) as $1.2 billion or $340 million. */
export function depositsLabel(thousands: number): string {
  const dollars = thousands * 1000;
  if (dollars >= 1e9) return `$${(dollars / 1e9).toFixed(1)} billion`;
  return `$${Math.round(dollars / 1e6)} million`;
}

export function pctLabel(p: number | null, digits = 0): string {
  if (p == null) return "n/a";
  const v = (p * 100).toFixed(digits);
  return `${p > 0 ? "+" : ""}${v}%`;
}
