/**
 * Read models for the Hamilton intelligence workspace (Overview and Research). Every figure comes
 * from a governed reader: published_fee_catalog under the statistics contract (fee-index), FDIC Call
 * Reports and NCUA 5300 filings (call-reports), BLS/FRED series and the Beige Book
 * (economic-context), and CFPB complaint records matched to institutions. Thin cohorts are withheld,
 * never filled; a reader that fails returns null so its exhibit says so instead of showing zeros.
 */
import { getSql } from "@/lib/data-store/connection";
import { getPeerFeeValues, getSegmentFeeValues, type PeerFilterSet } from "@/lib/data-store/fee-index";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
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
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Each state's median of one fee, one value per institution; states under the cohort floor are withheld. */
export function buildFeeMap(category: string, values: Array<{ state_code: string | null; amount: number }>): FeeMap {
  const byState = new Map<string, number[]>();
  for (const value of values) {
    if (!value.state_code || !Number.isFinite(value.amount)) continue;
    const list = byState.get(value.state_code) ?? [];
    list.push(value.amount);
    byState.set(value.state_code, list);
  }
  const states = [...byState].map(([stateCode, amounts]) => ({
    stateCode,
    institutions: amounts.length,
    median: amounts.length >= MIN_INSTITUTIONS_FOR_MEDIAN ? median(amounts) : null,
  }));
  const all = values.filter(v => Number.isFinite(v.amount)).map(v => v.amount);
  return {
    category,
    states,
    nationalMedian: all.length >= MIN_INSTITUTIONS_FOR_MEDIAN ? median(all) : null,
    nationalInstitutions: all.length,
  };
}

export async function loadFeeMap(category: string, charter: Charter): Promise<FeeMap | null> {
  try {
    const filters: PeerFilterSet = charter === "all" ? {} : { charter_type: charter };
    const [byCategory] = await getPeerFeeValues([filters], [category]);
    return buildFeeMap(category, byCategory.get(category) ?? []);
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
  publishedAt: string | null;
}

export interface PeerTable {
  category: string;
  institutionsInScope: number;
  rows: PeerRow[];
}

/** The largest institutions in a state (or the nation) with a published value for one fee, each linked to its schedule. */
export async function loadPeerTable(stateCode: string | null, charter: Charter, category: string, limit = 25): Promise<PeerTable | null> {
  try {
    const segment = await getSegmentFeeValues(
      { minAssets: null, maxAssets: null, charterType: charter === "all" ? null : charter, stateCode, largest: null },
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
        documentUrl: v.document_urls[0] ?? null,
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
