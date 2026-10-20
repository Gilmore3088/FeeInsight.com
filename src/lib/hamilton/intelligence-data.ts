/**
 * Read models for the Hamilton intelligence workspace (Overview and Research). Every figure comes
 * from a governed reader: published_fee_catalog under the statistics contract (fee-index), FDIC Call
 * Reports and NCUA 5300 filings (call-reports), BLS, BEA and Fed Board series and the Beige Book
 * (economic-context), and CFPB complaint records matched to institutions. Thin cohorts are withheld,
 * never filled; a reader that fails returns null so its exhibit says so instead of showing zeros.
 */
import { getSql } from "@/lib/data-store/connection";
import { STRUCK_REG_ARTICLE_SOURCES } from "@/lib/data-store/struck-sources";
import { getPeerFeeValues, getSegmentFeeValues, type PeerFilterSet } from "@/lib/data-store/fee-index";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { computeStats } from "@/lib/data-store/fees";
import { countedAmounts } from "@/lib/data-store/counted-amounts";
import { feeScheduleUrls, type SeveralFees } from "@/lib/own-fee";
import { feeComplaintFilterSql } from "@/lib/data-store/complaints";
import type { LandingResearchHandoff } from "./landing-research-handoff";

export type Charter = LandingResearchHandoff["charter"];

export interface StateMedian {
  stateCode: string;
  median: number | null;
  institutions: number;
}

export interface FeeMap {
  category: string;
  states: StateMedian[];
  nationalMedian: number | null;
  nationalInstitutions: number;
  /** How the amounts in the page's scope (a state, or the nation) are spread; null under the cohort floor. */
  spread: FeeSpread | null;
}

/** The fee index's own median (computeStats), so the map, the landscape and the price bands agree. */
export function median(values: number[]): number | null {
  return computeStats(values).median;
}

/**
 * Each state's median of one fee, one value per institution; states under the cohort floor are
 * withheld. Charters that share one fee schedule count once, at the lower middle of their values
 * (statistics rule 7, countedAmounts), so the map's count and median are the landscape table's.
 */
export function buildFeeMap(category: string, rows: Array<{ institution_id?: number; state_code: string | null; amount: number; counted_as?: number }>, scopeState: string | null = null): FeeMap {
  const values = rows.filter((row) => Number.isFinite(row.amount)).map((row, i) => ({
    institutionId: row.institution_id ?? -(i + 1),
    amount: row.amount,
    countedAs: row.counted_as,
    state: row.state_code,
  }));
  const statesOf = new Map<string, typeof values>();
  for (const value of values) {
    if (!value.state) continue;
    const list = statesOf.get(value.state) ?? [];
    list.push(value);
    statesOf.set(value.state, list);
  }
  const byState = new Map([...statesOf].map(([state, list]) => [state, countedAmounts(list)] as const));
  const states = [...byState].map(([stateCode, amounts]) => ({
    stateCode,
    institutions: amounts.length,
    median: amounts.length >= MIN_INSTITUTIONS_FOR_MEDIAN ? median(amounts) : null,
  }));
  const all = countedAmounts(values);
  return {
    category,
    states,
    nationalMedian: all.length >= MIN_INSTITUTIONS_FOR_MEDIAN ? median(all) : null,
    nationalInstitutions: all.length,
    spread: buildFeeSpread(scopeState ? byState.get(scopeState) ?? [] : all),
  };
}

/**
 * The state map and the price spread for one fee. Both read the same values as the fee index
 * (approved published fees, one value per institution, same filters), so the scope's median here
 * matches the landscape table's.
 */
export async function loadFeeMap(category: string, charter: Charter, scopeState: string | null = null, assetTiers: readonly string[] | null = null): Promise<FeeMap | null> {
  try {
    const filters: PeerFilterSet = {
      ...(charter === "all" ? {} : { charter_type: charter }),
      ...(assetTiers?.length ? { asset_tiers: [...assetTiers] } : {}),
    };
    const [byCategory] = await getPeerFeeValues([filters], [category]);
    return buildFeeMap(category, byCategory.get(category) ?? [], scopeState);
  } catch {
    return null;
  }
}

export interface PeerRow {
  institutionId: number;
  name: string;
  charter: string | null;
  totalAssets: number | null;
  amount: number;
  documentUrl: string | null;
  documentUrls?: string[];
  several?: SeveralFees;
  publishedAt: string | null;
}

export interface FeeSpread {
  count: number;
  low: number;
  p25: number;
  median: number;
  p75: number;
  high: number;
  bins: Array<{ from: number; to: number; count: number }>;
}

export interface PeerTable {
  category: string;
  institutionsInScope: number;
  rows: PeerRow[];
}

const STEPS = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 250, 500];

/** How one fee's published amounts are spread: the fee index's own quartiles (computeStats) and at most ten even-width bins. */
export function buildFeeSpread(amounts: number[]): FeeSpread | null {
  const sorted = amounts.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < MIN_INSTITUTIONS_FOR_MEDIAN) return null;
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const step = STEPS.find(s => (Math.floor(high / s) - Math.floor(low / s) + 1) <= 10) ?? (Math.ceil((high - low) / 9) || 1);
  const start = Math.floor(low / step) * step;
  const bins = Array.from({ length: Math.floor((high - start) / step) + 1 }, (_, i) => ({ from: start + i * step, to: start + (i + 1) * step, count: 0 }));
  for (const value of sorted) bins[Math.min(bins.length - 1, Math.floor((value - start) / step))].count += 1;
  const stats = computeStats(sorted);
  return { count: sorted.length, low, p25: stats.p25!, median: stats.median!, p75: stats.p75!, high, bins };
}

/** The largest institutions in a state (or the nation), optionally within an asset range (thousands), with a published value for one fee, each linked to its schedule. */
export async function loadPeerTable(
  stateCode: string | null, charter: Charter, category: string, limit = 25,
  size: { minAssets: number | null; maxAssets: number | null } | null = null,
): Promise<PeerTable | null> {
  try {
    const segment = await getSegmentFeeValues(
      { minAssets: size?.minAssets ?? null, maxAssets: size?.maxAssets ?? null, charterType: charter === "all" ? null : charter, stateCode, largest: null },
      category,
      null,
    );
    const rows = [...segment.values]
      .sort((a, b) => (b.total_assets ?? -1) - (a.total_assets ?? -1))
      .slice(0, limit)
      .map(v => ({
        institutionId: v.institution_id,
        name: v.institution_name,
        charter: v.charter_type,
        totalAssets: v.total_assets,
        amount: v.amount,
        documentUrl: v.document_urls.length === 1 ? v.document_urls[0] : null,
        documentUrls: feeScheduleUrls(v.document_urls),
        ...(v.several ? { several: v.several } : {}),
        publishedAt: v.published_at,
      }));
    return { category, institutionsInScope: segment.institutionsInSegment, rows };
  } catch {
    return null;
  }
}

export interface ComplaintYear {
  year: string;
  total: number;
  feeRelated: number;
  institutions: number;
}

export interface ComplaintTrend {
  years: ComplaintYear[];
  products: Array<{ product: string; count: number }>;
}

/**
 * CFPB complaints matched to institutions headquartered in a state (or all), per report year, with
 * the fee-related share (src/lib/complaints/fee-issues.ts). Counts follow reporting coverage; they
 * do not rank institutions.
 */
export async function loadComplaintTrend(stateCode: string | null): Promise<ComplaintTrend | null> {
  try {
    const sql = getSql();
    const where = stateCode ? "AND ct.state_code = $1" : "";
    const params = stateCode ? [stateCode] : [];
    const years = await sql.unsafe(
      `SELECT ic.report_period,
              COALESCE(SUM(ic.complaint_count) FILTER (WHERE ic.issue = '_total'), 0)::int AS total,
              COALESCE(SUM(ic.complaint_count) FILTER (WHERE ${feeComplaintFilterSql("ic")}), 0)::int AS fee_related,
              COUNT(DISTINCT ic.institution_id)::int AS institutions
         FROM institution_complaint_records ic
         JOIN institution_sources ct ON ct.id = ic.institution_id
        WHERE TRUE ${where}
        GROUP BY ic.report_period
        ORDER BY ic.report_period`,
      params,
    ) as Array<{ report_period: string; total: number | string; fee_related: number | string; institutions: number | string }>;
    const latest = years.length ? String(years[years.length - 1].report_period) : null;
    const products = latest ? await sql.unsafe(
      `SELECT ic.product, SUM(ic.complaint_count)::int AS count
         FROM institution_complaint_records ic
         JOIN institution_sources ct ON ct.id = ic.institution_id
        WHERE ic.issue = '_total' AND ic.report_period = $${params.length + 1} ${where}
        GROUP BY ic.product
        ORDER BY count DESC
        LIMIT 6`,
      [...params, latest],
    ) as Array<{ product: string; count: number | string }> : [];
    return {
      years: years.map(r => ({ year: String(r.report_period), total: Number(r.total), feeRelated: Number(r.fee_related), institutions: Number(r.institutions) })),
      products: products.map(r => ({ product: r.product, count: Number(r.count) })),
    };
  } catch {
    return null;
  }
}

/** Percent change between two values, or null when the base is missing or zero. */
export function percentChange(current: number | null | undefined, prior: number | null | undefined): number | null {
  if (current == null || prior == null || !Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export interface StatePost {
  title: string;
  link: string;
  publishedAt: string | null;
}

/** A state regulator's own posts (Regulatory Wire source "state:XX"), newest first. Never cited as federal releases. */
export async function loadStatePosts(stateCode: string, limit = 6): Promise<StatePost[] | null> {
  // Struck states' posts (non-commercial site terms; DECISIONS.md "No non-commercial data") are never read.
  if (STRUCK_REG_ARTICLE_SOURCES.includes(`state:${stateCode.toUpperCase()}`)) return [];
  try {
    const rows = await getSql().unsafe(
      `SELECT title, link, published_at
         FROM reg_articles
        WHERE source = $1
        ORDER BY published_at DESC NULLS LAST, created_at DESC
        LIMIT $2`,
      [`state:${stateCode}`, limit],
    ) as Array<{ title: string; link: string; published_at: unknown }>;
    return rows.map(r => ({
      title: r.title,
      link: r.link,
      publishedAt: r.published_at instanceof Date ? r.published_at.toISOString().slice(0, 10) : r.published_at ? String(r.published_at).slice(0, 10) : null,
    }));
  } catch {
    return null;
  }
}

/** Twelve-month percent change at each point of a monthly series, when the month a year earlier exists. */
export function yearOverYear(history: Array<{ date: string; value: number }>): Array<{ date: string; value: number }> {
  const byMonth = new Map(history.map(p => [p.date.slice(0, 7), p.value]));
  const out: Array<{ date: string; value: number }> = [];
  for (const point of history) {
    const [y, m] = point.date.slice(0, 7).split("-");
    const prior = byMonth.get(`${Number(y) - 1}-${m}`);
    const change = percentChange(point.value, prior);
    if (change !== null) out.push({ date: point.date, value: change });
  }
  return out;
}

/** Join series on their date into chart rows, oldest first; a series without a point leaves a gap. */
export function joinSeries(series: Record<string, Array<{ date: string; value: number }> | null | undefined>, since?: string): Array<Record<string, string | number | null>> {
  const dates = new Set<string>();
  for (const points of Object.values(series)) for (const p of points ?? []) if (!since || p.date >= since) dates.add(p.date);
  const lookup = Object.fromEntries(Object.entries(series).map(([key, points]) => [key, new Map((points ?? []).map(p => [p.date, p.value]))]));
  return [...dates].sort().map(date => {
    const row: Record<string, string | number | null> = { period: date.slice(0, 7) };
    for (const key of Object.keys(series)) row[key] = lookup[key].get(date) ?? null;
    return row;
  });
}
