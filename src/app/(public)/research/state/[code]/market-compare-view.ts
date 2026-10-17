import { cityMedian } from "@/lib/city-median";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import type { BoardFee } from "./state-view";

/**
 * Pure shaping for the state page's market comparison: a local market's median for a fee, read
 * against the state, the state's Fed district and the U.S. Nothing here invents a value: a rung
 * without enough institutions for a median says so, and the one sentence under the ladder only
 * states the gaps the medians show.
 */

/** "SANDY SPRINGS" reads as "Sandy Springs". */
export function cityName(city: string): string {
  return city
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => (w.trim() && w !== "-" ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join("");
}

export function cityHref(stateCode: string, city: string): string {
  return `/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(city.toLowerCase())}`;
}

/** One geography on the ladder, with who it counts. */
export interface Rung {
  level: "city" | "state" | "district" | "us";
  place: string;
  /** Who the median counts, in a reader's words. */
  population: string;
  median: number | null;
  institutions: number;
}

export interface MarketFee {
  key: string;
  label: string;
  rungs: Rung[];
  /** The lowest and highest value among local institutions, when any publish the fee. */
  low: number | null;
  high: number | null;
  takeaway: string;
}

export interface MarketPanel {
  city: string;
  name: string;
  href: string;
  institutions: number;
  withFees: number;
  branches: number;
  fees: MarketFee[];
}

export interface MarketInput {
  city: string;
  institutions: number;
  with_fees: number;
  branches: number;
  fees: Partial<Record<string, number[]>>;
}

export function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** A gap under 1% of the benchmark reads as the same median. */
function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.abs(b) * 0.01;
}

/** The one sentence under the ladder: only what the medians show. */
export function marketTakeaway(name: string, label: string, rungs: Rung[]): string {
  const city = rungs.find((r) => r.level === "city")!;
  const state = rungs.find((r) => r.level === "state");
  const us = rungs.find((r) => r.level === "us");
  const fee = label.replace(/\b[A-Z][a-z]+/g, (w) => w.toLowerCase());
  if (city.median == null) {
    return city.institutions === 0
      ? `No institution with a branch in ${name} has a published ${fee} fee yet.`
      : `${city.institutions} ${city.institutions === 1 ? "institution" : "institutions"} with a branch in ${name} ${
          city.institutions === 1 ? "publishes" : "publish"
        } ${/^[aeiou]/i.test(fee) ? "an" : "a"} ${fee} fee, too few for a local median (${MIN_INSTITUTIONS_FOR_MEDIAN} needed).`;
  }
  // "Atlanta's ATM median is $2.50; Georgia's is $1." The U.S. figure stays in the exhibit.
  const lead = `${name}'s ${fee} median is ${money(city.median)}`;
  if (state?.median != null) return `${lead}; ${state.place}'s is ${money(state.median)}.`;
  if (us?.median != null) return `${lead}; the U.S. median is ${money(us.median)}.`;
  return `${lead}.`;
}

export interface Benchmarks {
  stateName: string;
  districtName: string | null;
  /** The fees the reader may see, with the state and district figures. */
  fees: BoardFee[];
  /** U.S. institutions behind each U.S. median. */
  usInstitutions: Map<string, number>;
}

/** One panel per market, offering the city page's fees that the state board shows. */
export function marketPanels(
  stateCode: string,
  markets: MarketInput[],
  feeOrder: readonly { key: string; label: string }[],
  b: Benchmarks,
): MarketPanel[] {
  const board = new Map(b.fees.map((f) => [f.key, f]));
  const offered = feeOrder.filter((f) => board.has(f.key));
  return markets.map((m) => {
    const name = cityName(m.city);
    const fees = offered.map(({ key, label }) => {
      const f = board.get(key)!;
      const values = m.fees[key] ?? [];
      const rungs: Rung[] = [
        { level: "city", place: name, population: `With a branch in ${name}, wherever headquartered`, median: cityMedian(values), institutions: values.length },
        { level: "state", place: b.stateName, population: `Headquartered in ${b.stateName}`, median: f.median, institutions: f.institutions },
        ...(b.districtName
          ? [
              {
                level: "district" as const,
                place: `${b.districtName} Fed district`,
                population: `Headquartered in the ${b.districtName} Fed district`,
                median: f.district?.median ?? null,
                institutions: f.district?.institutions ?? 0,
              },
            ]
          : []),
        { level: "us", place: "U.S.", population: "Every institution in the index", median: f.us?.median ?? null, institutions: b.usInstitutions.get(key) ?? 0 },
      ];
      return {
        key,
        label,
        rungs,
        low: values.length ? Math.min(...values) : null,
        high: values.length ? Math.max(...values) : null,
        takeaway: marketTakeaway(name, label, rungs),
      };
    });
    return {
      city: m.city,
      name,
      href: cityHref(stateCode, m.city),
      institutions: m.institutions,
      withFees: m.with_fees,
      branches: m.branches,
      fees,
    };
  });
}

/**
 * The fee a panel opens on: the one whose local median sits furthest, in share terms, from the
 * state median; else the first with a local median; else the first offered.
 */
export function openingFee(panel: MarketPanel): string | null {
  const gaps = panel.fees.flatMap((f) => {
    const city = f.rungs.find((r) => r.level === "city")?.median;
    const state = f.rungs.find((r) => r.level === "state")?.median;
    return city != null && state != null && state > 0 ? [{ key: f.key, gap: Math.abs(city - state) / state }] : [];
  });
  const widest = gaps.sort((a, b) => b.gap - a.gap)[0];
  return widest?.key ?? (panel.fees.find((f) => f.rungs[0].median != null) ?? panel.fees[0])?.key ?? null;
}

export interface DistrictRow {
  key: string;
  name: string;
  state: number;
  stateInstitutions: number;
  district: number;
  districtInstitutions: number;
  /** State median minus district median, in dollars. */
  diff: number;
}

export interface DistrictComparison {
  rows: DistrictRow[];
  above: number;
  below: number;
  same: number;
}

/** The state's medians against its Fed district's, for every fee with both; null when none has both. */
export function districtComparison(fees: BoardFee[]): DistrictComparison | null {
  const rows = fees
    .filter((f) => f.district)
    .map((f) => ({
      key: f.key,
      name: f.name,
      state: f.median,
      stateInstitutions: f.institutions,
      district: f.district!.median,
      districtInstitutions: f.district!.institutions,
      diff: f.median - f.district!.median,
    }));
  if (rows.length === 0) return null;
  const same = rows.filter((r) => sameAmount(r.state, r.district)).length;
  const above = rows.filter((r) => !sameAmount(r.state, r.district) && r.diff > 0).length;
  return { rows, above, below: rows.length - same - above, same };
}

/** True when the state and district medians read as the same. */
export function sameMedian(r: DistrictRow): boolean {
  return sameAmount(r.state, r.district);
}

/** "Same" when the medians match, "About the same" when they sit within the 1% tolerance. */
export function sameLabel(r: DistrictRow): string {
  return r.state === r.district ? "Same" : "About the same";
}

// "Overdraft (OD)" reads as "overdraft" inside a sentence; the table keeps the full name.
const lowerName = (name: string) => name.replace(/\s*\([^)]*\)/g, "").replace(/\b[A-Z][a-z]+/g, (w) => w.toLowerCase());

function listFees(rows: DistrictRow[]): string {
  // A no-break space and word joiner keep each fee's sign and amount on one line.
  const shown = rows.slice(0, 3).map((r) => `${lowerName(r.name)}\u00a0${r.diff > 0 ? "+" : "−"}\u2060${money(Math.abs(r.diff))}`);
  const rest = rows.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

/** The fees where the state and district medians differ, largest gap first. */
export function districtDifferences(rows: DistrictRow[]): DistrictRow[] {
  return rows.filter((r) => !sameMedian(r)).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

/** The line under the district layer's plain title: the specific differences, then the rest. */
export function districtFinding(c: DistrictComparison, stateName: string): string {
  const n = c.rows.length;
  if (c.same === n) return `The ${stateName} and district medians are about the same on all ${n} fees.`;
  const diffs = districtDifferences(c.rows);
  const higher = diffs.filter((r) => r.diff > 0);
  const lower = diffs.filter((r) => r.diff < 0);
  const parts = [
    ...(higher.length ? [`Higher in ${stateName}: ${listFees(higher)}.`] : []),
    ...(lower.length ? [`Lower in ${stateName}: ${listFees(lower)}.`] : []),
    ...(c.same ? [c.same === 1 ? "The other fee is about the same." : `The other ${c.same} fees are about the same.`] : []),
  ];
  return parts.join(" ");
}
