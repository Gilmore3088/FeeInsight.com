import { assetBand, peerGroupLabel, type Charter, type SqlTag, type StudySource } from "./common";
import { median, midRankPercentile, quartileOf, round } from "./stats";
import type { Placement, StudyRecord } from "./store";

/**
 * Fee dependence: the share of each institution's revenue that comes from fees, every
 * year since 2010, for every bank and credit union that filed (including those since
 * closed or merged, so the series has no survivor bias).
 *
 *   banks          service charges on deposit accounts / (net interest income +
 *                  noninterest income), four quarters summed (FDIC ISERCHGQ, NIMQ, NONIIQ)
 *   credit unions  fee income / (interest income + noninterest income), December year
 *                  to date (NCUA accounts 131, 115, 117)
 *
 * The two definitions differ (a credit union's line is all fee income and its
 * denominator is gross interest income), so banks and credit unions are reported side
 * by side and never pooled. Values come from each filing's raw fields, so rows for
 * institutions no longer in the registry count too.
 */

export const FEE_DEPENDENCE_KEY = "fee_dependence";
export const FEE_DEPENDENCE_VERSION = 1;
export const FIRST_YEAR = 2010;

export interface DependenceRow {
  institutionId: number | null;
  charter: Charter;
  year: number;
  assetsThousands: number | null;
  ratio: number;
}

export async function readDependencePanel(db: SqlTag): Promise<DependenceRow[]> {
  const rows = await db`
    WITH bank AS (
      SELECT COALESCE(institution_id::text, 'cert:' || source_cert_number) AS k,
             MAX(institution_id) AS institution_id,
             LEFT(report_date, 4)::int AS y,
             SUM(COALESCE((raw_json->>'ISERCHGQ')::float8, service_charge_income::float8)) AS sc,
             SUM(COALESCE((raw_json->>'NIMQ')::float8, net_interest_income::float8, 0)
               + COALESCE((raw_json->>'NONIIQ')::float8, other_noninterest_income::float8, 0)) AS rev,
             COUNT(*) AS q,
             MAX(total_assets) FILTER (WHERE report_date LIKE '%-12-31') AS assets
        FROM institution_financial_records
       WHERE source = 'fdic' AND LEFT(report_date, 4)::int >= ${FIRST_YEAR}
       GROUP BY 1, 3
    ), cu AS (
      SELECT institution_id, LEFT(report_date, 4)::int AS y,
             (raw_json->>'ACCT_131')::float8 AS sc,
             COALESCE((raw_json->>'ACCT_115')::float8, 0) + COALESCE((raw_json->>'ACCT_117')::float8, 0) AS rev,
             total_assets AS assets
        FROM institution_financial_records
       WHERE source = 'ncua' AND report_date LIKE '%-12-31' AND LEFT(report_date, 4)::int >= ${FIRST_YEAR}
    )
    SELECT institution_id, 'bank' AS charter, y, assets, sc / rev AS ratio
      FROM bank WHERE q = 4 AND rev > 0 AND sc IS NOT NULL AND sc >= 0
    UNION ALL
    SELECT institution_id, 'credit_union' AS charter, y, assets, sc / rev AS ratio
      FROM cu WHERE rev > 0 AND sc IS NOT NULL AND sc >= 0
  `;
  return [...(rows as unknown as Array<Record<string, unknown>>)].map((r) => ({
    institutionId: r.institution_id === null || r.institution_id === undefined ? null : Number(r.institution_id),
    charter: r.charter as Charter,
    year: Number(r.y),
    assetsThousands: r.assets === null || r.assets === undefined ? null : Number(r.assets),
    ratio: Number(r.ratio),
  }));
}

export interface YearPoint {
  year: number;
  n: number;
  /** Percent of revenue. */
  median: number | null;
  p25: number | null;
  p75: number | null;
}

export interface FeeDependenceResult {
  record: StudyRecord;
  placements: Placement[];
}

function pct(v: number | null): number | null {
  return v === null ? null : round(v * 100, 2);
}

function quantiles(values: number[]): { median: number | null; p25: number | null; p75: number | null } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  return { median: at(0.5), p25: at(0.25), p75: at(0.75) };
}

/**
 * Within-institution trend: each institution's ratio minus its own average, regressed
 * on the year minus its own average year (a fixed-effects slope). Says how the typical
 * institution's own dependence moved, separate from which institutions closed.
 */
export function withinTrend(rows: DependenceRow[]): { slopePerYear: number; se: number; ciLow: number; ciHigh: number; institutions: number } | null {
  const byInst = new Map<number, DependenceRow[]>();
  for (const r of rows) {
    if (r.institutionId === null) continue;
    const list = byInst.get(r.institutionId) ?? [];
    list.push(r);
    byInst.set(r.institutionId, list);
  }
  let sxy = 0;
  let sxx = 0;
  const pairs: Array<[number, number]> = [];
  let institutions = 0;
  for (const list of byInst.values()) {
    if (list.length < 3) continue;
    institutions++;
    const my = list.reduce((s, r) => s + r.ratio, 0) / list.length;
    const mx = list.reduce((s, r) => s + r.year, 0) / list.length;
    for (const r of list) {
      const x = r.year - mx;
      const y = r.ratio - my;
      sxy += x * y;
      sxx += x * x;
      pairs.push([x, y]);
    }
  }
  if (sxx === 0 || pairs.length < 10) return null;
  const slope = sxy / sxx;
  // Clustered by institution would be wider; this robust (HC0) error is a floor, so the
  // interval is labeled approximate.
  const meat = pairs.reduce((s, [x, y]) => s + x * x * (y - slope * x) ** 2, 0);
  const se = Math.sqrt(meat) / sxx;
  return { slopePerYear: slope, se, ciLow: slope - 1.96 * se, ciHigh: slope + 1.96 * se, institutions };
}

export function buildFeeDependence(rows: DependenceRow[]): FeeDependenceResult | null {
  if (rows.length === 0) return null;
  // A loop, not Math.max(...years): the panel has ~120k rows, past the argument limit.
  const latestYear = rows.reduce((max, r) => (r.year > max ? r.year : max), rows[0].year);
  const charters: Charter[] = ["bank", "credit_union"];
  const series: Record<string, YearPoint[]> = {};
  const trend: Record<string, unknown> = {};
  const byBandLatest: Record<string, unknown> = {};
  for (const charter of charters) {
    const own = rows.filter((r) => r.charter === charter);
    const years = [...new Set(own.map((r) => r.year))].sort((a, b) => a - b);
    series[charter] = years.map((year) => {
      const inYear = own.filter((r) => r.year === year).map((r) => r.ratio);
      const q = quantiles(inYear);
      return { year, n: inYear.length, median: pct(q.median), p25: pct(q.p25), p75: pct(q.p75) };
    });
    const t = withinTrend(own);
    trend[charter] = t
      ? { points_per_year: round(t.slopePerYear * 100, 3), ci_low: round(t.ciLow * 100, 3), ci_high: round(t.ciHigh * 100, 3), institutions: t.institutions, note: "approximate interval (not clustered)" }
      : null;
    const latest = own.filter((r) => r.year === latestYear);
    const bands = [...new Set(latest.map((r) => assetBand(r.assetsThousands)))];
    byBandLatest[charter] = bands.map((band) => {
      const values = latest.filter((r) => assetBand(r.assetsThousands) === band).map((r) => r.ratio);
      return { band, n: values.length, median: pct(median(values)) };
    });
  }

  const first = (c: Charter) => series[c].find((p) => p.year === FIRST_YEAR) ?? series[c][0];
  const last = (c: Charter) => series[c][series[c].length - 1];
  const headline = (() => {
    const b0 = first("bank");
    const b1 = last("bank");
    const c0 = first("credit_union");
    const c1 = last("credit_union");
    if (!b0 || !b1 || !c0 || !c1) return "Fee dependence could not be measured for both charters.";
    return `The typical bank earned ${b1.median}% of revenue from deposit service charges in ${b1.year}, down from ${b0.median}% in ${b0.year}; the typical credit union earned ${c1.median}% from fee income, down from ${c0.median}%.`;
  })();

  // Placements: each current institution's latest-year share against its charter and size peers.
  const latestRows = rows.filter((r) => r.year === latestYear && r.institutionId !== null);
  const firstByInst = new Map<number, DependenceRow>();
  for (const r of rows) {
    if (r.institutionId === null) continue;
    const prior = firstByInst.get(r.institutionId);
    if (!prior || r.year < prior.year) firstByInst.set(r.institutionId, r);
  }
  const peerKey = (r: DependenceRow) => `${r.charter}|${assetBand(r.assetsThousands)}`;
  const peers = new Map<string, number[]>();
  for (const r of latestRows) {
    const list = peers.get(peerKey(r)) ?? [];
    list.push(r.ratio);
    peers.set(peerKey(r), list);
  }
  const placements: Placement[] = latestRows.map((r) => {
    const group = peers.get(peerKey(r)) ?? [];
    const percentile = midRankPercentile(r.ratio, group);
    const start = firstByInst.get(r.institutionId!);
    return {
      institutionId: r.institutionId!,
      metric: "fee_share_of_revenue_pct",
      value: pct(r.ratio),
      peerGroup: peerGroupLabel(r.charter, assetBand(r.assetsThousands)),
      peerN: group.length,
      peerMedian: pct(median(group)),
      percentile,
      quartile: quartileOf(percentile),
      detail: {
        year: r.year,
        charter: r.charter,
        first_year: start?.year ?? null,
        first_year_value: start ? pct(start.ratio) : null,
        definition: r.charter === "bank" ? "service charges on deposit accounts / (net interest income + noninterest income)" : "fee income / (interest income + noninterest income)",
      },
    };
  });

  const sources: StudySource[] = [
    { name: "FDIC call reports (service charges, net interest income, noninterest income)", asOf: String(latestYear) },
    { name: "NCUA 5300 call reports (accounts 131, 115, 117)", asOf: String(latestYear) },
  ];
  return {
    record: {
      studyKey: FEE_DEPENDENCE_KEY,
      methodVersion: FEE_DEPENDENCE_VERSION,
      title: "Fee dependence since 2010",
      asOf: String(latestYear),
      metric: "fee_share_of_revenue_pct",
      n: rows.length,
      sources,
      findings: {
        headline,
        latest_year: latestYear,
        series,
        within_institution_trend: trend,
        latest_by_size: byBandLatest,
        definitions: {
          bank: "service charges on deposit accounts / (net interest income + noninterest income), four quarters",
          credit_union: "fee income / (interest income + noninterest income), December year to date",
          note: "Definitions differ by charter; banks and credit unions are never pooled.",
        },
      },
    },
    placements,
  };
}
