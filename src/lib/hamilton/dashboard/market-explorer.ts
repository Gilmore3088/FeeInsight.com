/**
 * The Research market explorer (Hamilton dashboard redesign, Nov 2026, Research.dc.html): one fee
 * across a market (a state, a Fed district or the nation), cut by institution type and asset size.
 * Pure: it shapes values the server already read (getPeerFeeValues on published_fee_catalog, one
 * dollar value per institution) into headline figures, a price histogram, a state map and a table.
 *
 * Rules it keeps:
 *   - a median and middle half need MIN_PEERS_FOR_POSITION (10) institutions; with fewer the page
 *     shows the spread and says too few, never a median;
 *   - sister charters on one schedule count once (countedAmounts), as the fee index counts them;
 *   - names the site never shows (neverNamed) are left out of the named table, still counted;
 *   - the subject institution's own price is read from the same values, never typed or estimated.
 */

import { countedAmounts } from "@/lib/data-store/counted-amounts";
import { computePercentile, medianAmount, roundCents } from "@/lib/fee-institution-value";
import { neverNamed } from "@/lib/never-named";
import { hrefWithInstitutionContext } from "../context-link";
import { encodeLandingResearch, RESEARCH_STATE_CODES, type LandingResearchHandoff, type ResearchStateCode } from "../landing-research-handoff";
import { MIN_PEERS_FOR_POSITION } from "../workspace/scenario";
import { feePosition, type FeePosition } from "@/components/hamilton/dashboard/format";

export type ExplorerCharter = "bank" | "credit_union" | null;

/** One institution's value for the fee, as the server read it. */
export interface ExplorerValue {
  id: number;
  name: string;
  stateCode: string | null;
  /** Total assets in thousands of dollars. */
  assets: number | null;
  charter: ExplorerCharter;
  amount: number;
  /** The sister charter it counts as under statistics rule 7, when not itself. */
  countedAs?: number;
  /** The schedule this value was read from, when one is linked. */
  documentUrl: string | null;
  /** True when the schedule states several prices in the fee and `amount` is their middle. */
  several?: boolean;
}

export type ExplorerRegion =
  | { kind: "state"; stateCode: string; label: string }
  | { kind: "district"; district: number; label: string }
  | { kind: "national"; label: string };

export interface ExplorerStats {
  /** Institutions counted (sister charters on one schedule count once). */
  n: number;
  min: number | null;
  max: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
}

export interface ExplorerBin {
  from: number;
  /** Upper bound (exclusive); null for the open last band ("and up"). */
  to: number | null;
  count: number;
}

export interface ExplorerSubject {
  id: number;
  name: string;
  stateCode: string | null;
  /** Its published price for the fee; null when it publishes none. */
  price: number | null;
  /** Whether the current scope's filters take it in. */
  inScope: boolean;
  /** Against the scope's middle half; too_few below the minimum. */
  position: FeePosition | null;
  /** Other institutions in scope priced below it, level with it, and their total. */
  below: number;
  level: number;
  others: number;
}

export interface ExplorerStateCell {
  code: string;
  n: number;
  median: number | null;
}

export interface ExplorerRow {
  id: number;
  name: string;
  stateCode: string | null;
  assets: number | null;
  charter: ExplorerCharter;
  amount: number;
  several: boolean;
  documentUrl: string | null;
  position: FeePosition;
  subject: boolean;
}

export interface MarketExplorerData {
  category: string;
  feeName: string;
  region: ExplorerRegion;
  stats: ExplorerStats;
  histogram: { step: number; bins: ExplorerBin[]; subjectBin: number | null };
  subject: ExplorerSubject | null;
  /** Every state and DC, for the current type and size filters (nationally, whatever the region). */
  states: ExplorerStateCell[];
  /** Institutions in a state or district scope; null for the national view, which lists states. */
  rows: ExplorerRow[] | null;
  /** Institutions counted but not named in the table. */
  unnamed: number;
  minForMedian: number;
}

const STEPS = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 250, 500, 1000];
export const HISTOGRAM_BINS = 20;

/** The fee index's statistics (computeStats) for amounts already one per counted institution. */
export function explorerStats(amounts: number[], minForMedian = MIN_PEERS_FOR_POSITION): ExplorerStats {
  const sorted = amounts.filter(Number.isFinite).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { n, min: null, max: null, p25: null, median: null, p75: null };
  const enough = n >= minForMedian;
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    p25: enough ? roundCents(computePercentile(sorted, 25)) : null,
    median: enough ? medianAmount(sorted) : null,
    p75: enough ? roundCents(computePercentile(sorted, 75)) : null,
  };
}

/**
 * Twenty even price bands from $0. The band width is the smallest round step that holds the 95th
 * percentile (and the subject's price); everything above sits in the last, open band.
 */
export function histogramBins(amounts: number[], subjectPrice: number | null): { step: number; bins: ExplorerBin[]; subjectBin: number | null } {
  const sorted = amounts.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { step: 0, bins: [], subjectBin: null };
  const p95 = computePercentile(sorted, 95);
  const top = Math.max(p95, subjectPrice ?? 0, 0.01);
  const step = STEPS.find((s) => s * (HISTOGRAM_BINS - 1) > top) ?? Math.ceil(top / (HISTOGRAM_BINS - 1));
  const binOf = (v: number) => Math.max(0, Math.min(HISTOGRAM_BINS - 1, Math.floor(v / step + 1e-9)));
  const bins: ExplorerBin[] = Array.from({ length: HISTOGRAM_BINS }, (_, i) => ({
    from: i * step,
    to: i === HISTOGRAM_BINS - 1 ? null : (i + 1) * step,
    count: 0,
  }));
  for (const v of sorted) bins[binOf(v)].count += 1;
  return { step, bins, subjectBin: subjectPrice === null ? null : binOf(subjectPrice) };
}

function counted(values: ExplorerValue[]): number[] {
  return countedAmounts(values.map((v) => ({ institutionId: v.id, amount: v.amount, countedAs: v.countedAs })));
}

/** Each state's count and median (a median only at the minimum), for every state and DC. */
export function stateCells(values: ExplorerValue[], minForMedian = MIN_PEERS_FOR_POSITION): ExplorerStateCell[] {
  const byState = new Map<string, ExplorerValue[]>();
  for (const v of values) {
    if (!v.stateCode) continue;
    const list = byState.get(v.stateCode) ?? [];
    list.push(v);
    byState.set(v.stateCode, list);
  }
  return RESEARCH_STATE_CODES.map((code) => {
    const stats = explorerStats(counted(byState.get(code) ?? []), minForMedian);
    return { code, n: stats.n, median: stats.median };
  });
}

/**
 * Shapes one fee's values into the explorer. `values` are every institution in the nation that
 * passes the type and size filters; `inRegion` says which of them the region takes in; `subject`
 * carries the subject's own value, read without those filters so its price shows even when the
 * filters leave it out.
 */
export function buildMarketExplorer(input: {
  category: string;
  feeName: string;
  region: ExplorerRegion;
  values: ExplorerValue[];
  inRegion: (value: ExplorerValue) => boolean;
  subject: { id: number; name: string; stateCode: string | null; value: ExplorerValue | null } | null;
  minForMedian?: number;
}): MarketExplorerData {
  const min = input.minForMedian ?? MIN_PEERS_FOR_POSITION;
  const scope = input.values.filter(input.inRegion);
  const stats = explorerStats(counted(scope), min);
  const subjectId = input.subject?.id ?? null;
  const subjectPrice = input.subject?.value?.amount ?? null;

  let subject: ExplorerSubject | null = null;
  if (input.subject) {
    const inScope = scope.some((v) => v.id === subjectId);
    const others = counted(scope.filter((v) => v.id !== subjectId));
    subject = {
      id: input.subject.id,
      name: input.subject.name,
      stateCode: input.subject.stateCode,
      price: subjectPrice,
      inScope,
      position: subjectPrice === null ? null : feePosition(subjectPrice, stats),
      below: subjectPrice === null ? 0 : others.filter((a) => a < subjectPrice - 0.005).length,
      level: subjectPrice === null ? 0 : others.filter((a) => Math.abs(a - subjectPrice) <= 0.005).length,
      others: others.length,
    };
  }

  const named = input.region.kind === "national" ? [] : scope.filter((v) => v.id === subjectId || !neverNamed(v.name));
  const rows: ExplorerRow[] | null = input.region.kind === "national" ? null : named.map((v) => ({
    id: v.id,
    name: v.name,
    stateCode: v.stateCode,
    assets: v.assets,
    charter: v.charter,
    amount: v.amount,
    several: Boolean(v.several),
    documentUrl: v.documentUrl,
    position: feePosition(v.amount, stats),
    subject: v.id === subjectId,
  }));
  // The subject's own row shows even when the filters leave it out, marked as outside them.
  if (rows && subject && !subject.inScope && input.subject?.value) {
    const v = input.subject.value;
    rows.push({ id: v.id, name: v.name, stateCode: v.stateCode, assets: v.assets, charter: v.charter, amount: v.amount, several: Boolean(v.several), documentUrl: v.documentUrl, position: feePosition(v.amount, stats), subject: true });
  }

  return {
    category: input.category,
    feeName: input.feeName,
    region: input.region,
    stats,
    histogram: histogramBins(counted(scope), subjectPrice),
    subject,
    states: stateCells(input.values, min),
    rows,
    unnamed: input.region.kind === "national" ? 0 : scope.length - named.length,
    minForMedian: min,
  };
}

/** The Fed district asked for in the URL (`district=6`), 1 to 12; null otherwise. */
export function parseDistrict(value: string | null | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

/** What the explorer's links start from: the page's selection, size, district and institution. */
export interface ExplorerLinkBase {
  selection: LandingResearchHandoff;
  size: string;
  district: number | null;
  instId: string | null;
}

/**
 * A Research link on the fees lens with one thing changed. It keeps the page's own parameters
 * (`research`, `lens`, `size`, `instId`) and adds `district` only for a Fed district view, so every
 * older link still opens as before.
 */
export function explorerHref(base: ExplorerLinkBase, change: {
  category?: string;
  /** A state code, "national", or a district number. */
  region?: ResearchStateCode | "national" | { district: number };
  charter?: LandingResearchHandoff["charter"];
  size?: string;
}): string {
  let selection = base.selection;
  let district = base.district;
  if (change.category) {
    selection = { ...selection, categories: [change.category, ...selection.categories.filter((c) => c !== change.category)].slice(0, 5) };
  }
  if (change.region !== undefined) {
    if (typeof change.region === "object") {
      selection = { ...selection, scope: { kind: "national" } };
      district = change.region.district;
    } else {
      selection = { ...selection, scope: change.region === "national" ? { kind: "national" } : { kind: "state", stateCode: change.region } };
      district = null;
    }
  }
  if (change.charter) selection = { ...selection, charter: change.charter };
  const size = change.size ?? base.size;
  const params = new URLSearchParams({ research: encodeLandingResearch({ ...selection, task: "compare" }), lens: "fees" });
  if (size !== "all") params.set("size", size);
  if (district !== null && selection.scope.kind === "national") params.set("district", String(district));
  return hrefWithInstitutionContext(`/pro/intelligence?${params}`, base.instId);
}
