import { sql } from "@/lib/data-store/connection";
import { groupExpression, MIN_GROUP, type CallItemGroup } from "./call-report-items";

/**
 * Reads over sec_market_value_facts (public float and shares outstanding for listed bank holding
 * companies, loaded by the Magellan step sec-market-value). Server only.
 *
 * Public float is the market value of common equity held by non-affiliates on one date a year
 * (the end of the filer's second fiscal quarter). It is a market-value proxy, not a daily market
 * capitalisation; every figure below says its as-of date. Float-to-equity divides that float by
 * the holding company's stockholders' equity at the nearest quarter end on or before the float
 * date (holding_company_financials, same CIK) and is labelled as a proxy for price-to-book.
 * Every median carries its filer count; a group under MIN_GROUP filers gets none.
 */

export const PUBLIC_FLOAT = "dei:EntityPublicFloat";
export const SHARES_OUTSTANDING = "dei:EntityCommonStockSharesOutstanding";

export interface DatedValue {
  period_end: string;
  value: number;
}

export interface ValueChange {
  latest: DatedValue | null;
  prior: DatedValue | null;
  /** Percent change latest vs prior; null without both, or when prior is zero. */
  change_pct: number | null;
}

/** Pure: newest value vs the newest one at least `minDays` older (a year back for float, ~a year for shares). */
export function changeOver(newestFirst: DatedValue[], minDays: number): ValueChange {
  const latest = newestFirst[0] ?? null;
  if (!latest) return { latest: null, prior: null, change_pct: null };
  const cutoff = new Date(Date.parse(`${latest.period_end}T00:00:00Z`) - minDays * 86_400_000).toISOString().slice(0, 10);
  const prior = newestFirst.find((r) => r.period_end <= cutoff) ?? null;
  const change_pct = prior && prior.value !== 0 ? Number((((latest.value - prior.value) / prior.value) * 100).toFixed(2)) : null;
  return { latest, prior, change_pct };
}

export interface InstitutionMarketValue {
  cik: string | null;
  public_float: ValueChange;
  shares_outstanding: ValueChange;
  /** Equity the float is compared with, and its date; null when not loaded. */
  equity: DatedValue | null;
  /** Public float / stockholders' equity: a price-to-book proxy (float excludes affiliates). */
  float_to_equity: number | null;
}

/** Pure: float-to-equity, only with both values and positive equity. */
export function floatToEquity(publicFloat: DatedValue | null, equity: DatedValue | null): number | null {
  if (!publicFloat || !equity || equity.value <= 0) return null;
  return Number((publicFloat.value / equity.value).toFixed(3));
}

/** An institution's holding-company market-value figures, by its own CIK or the CIK its facts were matched to. */
export async function getInstitutionMarketValue(institutionId: number): Promise<InstitutionMarketValue> {
  const rows = await sql<Array<{ cik: string; concept: string; period_end: string; value: number }>>`
    WITH me AS (
      SELECT COALESCE(
        (SELECT sec_cik FROM institution_sources WHERE id = ${institutionId}),
        (SELECT cik FROM sec_market_value_facts WHERE institution_id = ${institutionId} ORDER BY period_end DESC LIMIT 1)
      ) AS cik
    )
    SELECT f.cik, f.concept, f.period_end::text AS period_end, f.value::float8 AS value
      FROM sec_market_value_facts f, me
     WHERE f.cik = me.cik
     ORDER BY f.period_end DESC
  `;
  const list = [...rows];
  const cik = list[0]?.cik ?? null;
  const series = (concept: string) => list.filter((r) => r.concept === concept).map((r) => ({ period_end: r.period_end, value: Number(r.value) }));
  const publicFloat = changeOver(series(PUBLIC_FLOAT), 300);
  const shares = changeOver(series(SHARES_OUTSTANDING), 300);
  let equity: DatedValue | null = null;
  if (cik && publicFloat.latest) {
    const [e] = await sql<Array<{ period_end: string; value: number }>>`
      SELECT period_end::text AS period_end, stockholders_equity::float8 AS value
        FROM holding_company_financials
       WHERE cik = ${cik} AND stockholders_equity IS NOT NULL AND period_end <= ${publicFloat.latest.period_end}::date
       ORDER BY period_end DESC LIMIT 1
    `;
    equity = e ? { period_end: e.period_end, value: Number(e.value) } : null;
  }
  return { cik, public_float: publicFloat, shares_outstanding: shares, equity, float_to_equity: floatToEquity(publicFloat.latest, equity) };
}

/**
 * Median latest public float per group (state, district, asset tier, charter, metro or national),
 * each filer counted once through the institution its facts were matched to, latest float dated
 * within the last `maxAgeYears` years.
 */
export async function getPublicFloatByGroup(groupBy: CallItemGroup, maxAgeYears = 2) {
  const group = sql.unsafe(groupExpression(groupBy));
  return sql<Array<{ group_value: string | null; filers: number; median_public_float: number | null; latest_as_of: string | null }>>`
    WITH latest AS (
      SELECT DISTINCT ON (cik) cik, institution_id, period_end, value
        FROM sec_market_value_facts
       WHERE concept = ${PUBLIC_FLOAT} AND period_end >= (CURRENT_DATE - make_interval(years => ${maxAgeYears}))
       ORDER BY cik, period_end DESC
    )
    SELECT ${group} AS group_value,
           COUNT(*)::int AS filers,
           CASE WHEN COUNT(*) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY l.value)::float8 END AS median_public_float,
           MAX(l.period_end)::text AS latest_as_of
      FROM latest l
      JOIN institution_sources s ON s.id = l.institution_id
     GROUP BY 1
     ORDER BY 1 NULLS LAST
  `;
}
