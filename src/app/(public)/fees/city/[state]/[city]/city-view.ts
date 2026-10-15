import type { CityInstitution, IndexEntry } from "@/lib/data-store";

/** The four fees every city page compares, in the order a checking customer meets them. */
export const HEADLINE_FEES = [
  { key: "overdraft", label: "Overdraft" },
  { key: "monthly_maintenance", label: "Monthly fee" },
  { key: "nsf", label: "NSF" },
  { key: "atm_non_network", label: "Out-of-network ATM" },
] as const;

export type HeadlineFee = (typeof HEADLINE_FEES)[number]["key"];

/** One local institution's published amount for a fee. */
export interface StripBank {
  id: number;
  name: string;
  charter: "bank" | "credit_union";
  amount: number;
}

/** The national middle half and median for a fee, from the national index. */
export interface NationBand {
  p25: number;
  median: number;
  p75: number;
}

/** One headline fee in one city: each local institution as a dot, the nation behind it. */
export interface CityStrip {
  key: HeadlineFee;
  label: string;
  banks: StripBank[];
  /** The local median, once enough institutions publish the fee to make one. */
  cityMedian: number | null;
  nation: NationBand | null;
}

/** A local median needs this many institutions, the same floor the state pages use. */
export const MIN_FOR_CITY_MEDIAN = 3;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function nationBand(entry: IndexEntry | undefined): NationBand | null {
  if (!entry || entry.p25_amount == null || entry.median_amount == null || entry.p75_amount == null) return null;
  return { p25: entry.p25_amount, median: entry.median_amount, p75: entry.p75_amount };
}

/** Each headline fee's local dots, cheapest first, with the nation's band behind them. */
export function cityStrips(institutions: CityInstitution[], national: IndexEntry[]): CityStrip[] {
  const byCategory = new Map(national.map((e) => [e.fee_category, e]));
  return HEADLINE_FEES.map(({ key, label }) => {
    const banks: StripBank[] = [];
    for (const inst of institutions) {
      const amount = inst[key];
      if (amount == null || !Number.isFinite(amount) || amount < 0) continue;
      banks.push({
        id: inst.id,
        name: inst.institution_name,
        charter: inst.charter_type === "credit_union" ? "credit_union" : "bank",
        amount,
      });
    }
    banks.sort((a, b) => a.amount - b.amount || a.name.localeCompare(b.name));
    const amounts = banks.map((b) => b.amount);
    return {
      key,
      label,
      banks,
      cityMedian: banks.length >= MIN_FOR_CITY_MEDIAN ? median(amounts) : null,
      nation: nationBand(byCategory.get(key)),
    };
  });
}

/** The low end of a strip's axis: just under the cheapest dot or the nation's middle half. */
export function stripFloor(strip: Pick<CityStrip, "banks" | "nation">): number {
  const values = strip.banks.map((b) => b.amount);
  if (strip.nation) values.push(strip.nation.p25);
  const lo = Math.min(...values);
  const hi = Math.max(...values, strip.nation?.p75 ?? 0);
  return Math.max(0, Math.floor(lo - Math.max((hi - lo) * 0.15, 1)));
}

/** One axis per strip, spread over the amounts actually charged so close fees stay apart. */
export function stripScale(strip: Pick<CityStrip, "banks" | "nation">): (v: number) => number {
  const values = strip.banks.map((b) => b.amount);
  if (strip.nation) values.push(strip.nation.p75, strip.nation.p25);
  if (values.length === 0) return () => 0;
  const min = stripFloor(strip);
  const hi = Math.max(...values);
  const max = hi + Math.max((hi - min) * 0.08, 1);
  return (v: number) => Math.min(Math.max(((v - min) / (max - min)) * 100, 0), 100);
}

/** Local institutions that publish the fee and charge strictly less than this amount. */
export function chargingLess(strip: CityStrip, amount: number): number {
  return strip.banks.filter((b) => b.amount < amount).length;
}

/**
 * The few things a reader in this city should know, from the strips alone: who charges least
 * for overdraft, and how many charge no monthly fee. Each sentence names its own count.
 */
export function cityFindings(strips: CityStrip[], cityName: string): string[] {
  const findings: string[] = [];
  const od = strips.find((s) => s.key === "overdraft");
  if (od && od.banks.length >= 2) {
    const low = od.banks[0];
    const tied = od.banks.filter((b) => b.amount === low.amount).length;
    if (tied > 1) {
      findings.push(
        `${tied} of ${od.banks.length} ${cityName} institutions charge ${low.amount === 0 ? "no overdraft fee" : `${money(low.amount)} for overdraft`}, the lowest here.`,
      );
    } else {
      findings.push(
        low.amount === 0
          ? `${low.name} is the only one of ${od.banks.length} ${cityName} institutions with no overdraft fee.`
          : `${low.name} has the lowest overdraft fee of ${od.banks.length} in ${cityName}: ${money(low.amount)}.`,
      );
    }
  }
  const monthly = strips.find((s) => s.key === "monthly_maintenance");
  if (monthly && monthly.banks.length >= 2) {
    const free = monthly.banks.filter((b) => b.amount === 0).length;
    if (free > 0) findings.push(`${free} of ${monthly.banks.length} have a typical monthly account fee of $0.`);
  }
  if (od?.cityMedian != null && od.nation) {
    const diff = od.cityMedian - od.nation.median;
    if (Math.abs(diff) >= 1) {
      findings.push(
        `The local overdraft median is ${money(Math.abs(diff))} ${diff > 0 ? "above" : "below"} the U.S. median of ${money(od.nation.median)}.`,
      );
    }
  }
  return findings;
}

export function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}
