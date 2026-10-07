import { assetBand, peerGroupLabel, type Charter, type SqlTag } from "./common";
import { median, midRankPercentile, quartileOf, round } from "./stats";
import type { Placement, StudyRecord } from "./store";

/**
 * Inferred items paid: reported overdraft/NSF income divided by the published fee.
 *
 * Always labeled inferred, never reported. Income is net of waivers and refunds, so the
 * quotient counts paid items. It is a range: items_low divides by the highest published
 * amount, items_high by the lowest (tiered or account-specific fees). Caps, fees that
 * changed during the year and a schedule newer than the income all move it further.
 *
 *   credit unions  overdraft (IS0048) and NSF (IS0049) separately, December year to
 *                  date. NCUA collected these only through 2024.
 *   banks          overdraft and NSF together (RIAD H032, $1B+ banks), four quarters
 *                  ending at the newest quarter with all four, divided by the bank's
 *                  overdraft and NSF fees together.
 */

export const INFERRED_VOLUME_KEY = "inferred_items_paid";
export const INFERRED_VOLUME_VERSION = 1;

export interface IncomeFeeRow {
  institutionId: number;
  charter: Charter;
  assetsThousands: number | null;
  /** Quarter end, YYYY-MM-DD. Income covers the four quarters ending here. */
  period: string;
  feeCategory: "overdraft" | "nsf" | "overdraft_nsf";
  incomeDollars: number;
  feeLow: number;
  feeHigh: number;
}

export async function readIncomeAndFees(db: SqlTag): Promise<IncomeFeeRow[]> {
  const rows = await db`
    WITH fees AS (
      SELECT institution_id, canonical_fee_key AS k, MIN(amount)::float8 AS lo, MAX(amount)::float8 AS hi
        FROM published_fee_catalog
       WHERE canonical_fee_key IN ('overdraft', 'nsf') AND amount > 0
         AND COALESCE(is_fee_cap, false) = false AND COALESCE(amount_kind, 'dollar') <> 'rate'
       GROUP BY 1, 2
    ), both_fees AS (
      SELECT institution_id, MIN(lo) AS lo, MAX(hi) AS hi FROM fees GROUP BY 1
    ), cu_latest AS (
      SELECT DISTINCT ON (institution_id) institution_id, report_date, overdraft_revenue, nsf_revenue, total_assets
        FROM institution_financial_records
       WHERE source = 'ncua' AND institution_id IS NOT NULL AND report_date LIKE '%-12-31'
         AND (overdraft_revenue IS NOT NULL OR nsf_revenue IS NOT NULL)
       ORDER BY institution_id, report_date DESC
    ), cu AS (
      SELECT c.institution_id, 'credit_union' AS charter, c.total_assets AS assets, c.report_date AS period,
             'overdraft' AS cat, c.overdraft_revenue::float8 * 1000 AS income, f.lo, f.hi
        FROM cu_latest c JOIN fees f ON f.institution_id = c.institution_id AND f.k = 'overdraft'
       WHERE c.overdraft_revenue > 0
      UNION ALL
      SELECT c.institution_id, 'credit_union', c.total_assets, c.report_date,
             'nsf', c.nsf_revenue::float8 * 1000, f.lo, f.hi
        FROM cu_latest c JOIN fees f ON f.institution_id = c.institution_id AND f.k = 'nsf'
       WHERE c.nsf_revenue > 0
    ), bank_latest AS (
      SELECT institution_id, MAX(report_date) AS period
        FROM institution_financial_records
       WHERE source = 'fdic' AND institution_id IS NOT NULL AND overdraft_revenue IS NOT NULL
       GROUP BY 1
    ), bank AS (
      SELECT b.institution_id, 'bank' AS charter,
             MAX(f.total_assets) FILTER (WHERE f.report_date = b.period) AS assets,
             b.period, 'overdraft_nsf' AS cat,
             SUM(f.overdraft_revenue)::float8 * 1000 AS income, COUNT(*) AS quarters
        FROM bank_latest b
        JOIN institution_financial_records f
          ON f.institution_id = b.institution_id AND f.source = 'fdic' AND f.overdraft_revenue IS NOT NULL
         AND f.report_date::date > b.period::date - INTERVAL '1 year' AND f.report_date::date <= b.period::date
       GROUP BY b.institution_id, b.period
    )
    SELECT institution_id, charter, assets, period, cat, income, lo, hi FROM cu
    UNION ALL
    SELECT b.institution_id, b.charter, b.assets, b.period, b.cat, b.income, f.lo, f.hi
      FROM bank b JOIN both_fees f ON f.institution_id = b.institution_id
     WHERE b.quarters = 4 AND b.income > 0
  `;
  return [...(rows as unknown as Array<Record<string, unknown>>)].map((r) => ({
    institutionId: Number(r.institution_id),
    charter: r.charter as Charter,
    assetsThousands: r.assets === null || r.assets === undefined ? null : Number(r.assets),
    period: String(r.period).slice(0, 10),
    feeCategory: r.cat as IncomeFeeRow["feeCategory"],
    incomeDollars: Number(r.income),
    feeLow: Number(r.lo),
    feeHigh: Number(r.hi),
  }));
}

export interface InferredVolumeRow {
  institutionId: number;
  period: string;
  feeCategory: IncomeFeeRow["feeCategory"];
  reportedIncome: number;
  publishedFeeLow: number;
  publishedFeeHigh: number;
  itemsLow: number;
  itemsHigh: number;
  peerGroup: string;
  peerN: number;
  peerMedianItems: number | null;
  peerMedianIncome: number | null;
  basis: string;
}

const BASIS: Record<IncomeFeeRow["feeCategory"], string> = {
  overdraft: "NCUA overdraft fee income (IS0048), December year to date, divided by the published overdraft fee",
  nsf: "NCUA NSF fee income (IS0049), December year to date, divided by the published NSF fee",
  overdraft_nsf: "Call report overdraft and NSF income together (RIAD H032), four quarters, divided by the published overdraft and NSF fees",
};

export interface InferredVolumeResult {
  rows: InferredVolumeRow[];
  record: StudyRecord;
  placements: Placement[];
}

export function buildInferredVolume(input: IncomeFeeRow[]): InferredVolumeResult {
  const midpoint = (r: IncomeFeeRow) => (r.incomeDollars / r.feeHigh + r.incomeDollars / r.feeLow) / 2;
  const peerKey = (r: IncomeFeeRow) => `${r.feeCategory}|${r.charter}|${assetBand(r.assetsThousands)}`;
  const groups = new Map<string, IncomeFeeRow[]>();
  for (const r of input) {
    const list = groups.get(peerKey(r)) ?? [];
    list.push(r);
    groups.set(peerKey(r), list);
  }
  const rows: InferredVolumeRow[] = [];
  const placements: Placement[] = [];
  for (const r of input) {
    const group = groups.get(peerKey(r)) ?? [];
    const peerItems = group.map(midpoint);
    const peerGroup = peerGroupLabel(r.charter, assetBand(r.assetsThousands));
    const itemsLow = Math.round(r.incomeDollars / r.feeHigh);
    const itemsHigh = Math.round(r.incomeDollars / r.feeLow);
    rows.push({
      institutionId: r.institutionId,
      period: r.period,
      feeCategory: r.feeCategory,
      reportedIncome: Math.round(r.incomeDollars),
      publishedFeeLow: r.feeLow,
      publishedFeeHigh: r.feeHigh,
      itemsLow,
      itemsHigh,
      peerGroup,
      peerN: group.length,
      peerMedianItems: round(median(peerItems), 0),
      peerMedianIncome: round(median(group.map((g) => g.incomeDollars)), 0),
      basis: BASIS[r.feeCategory],
    });
    const percentile = midRankPercentile(midpoint(r), peerItems);
    placements.push({
      institutionId: r.institutionId,
      metric: `inferred_${r.feeCategory}_items`,
      value: round(midpoint(r), 0),
      peerGroup,
      peerN: group.length,
      peerMedian: round(median(peerItems), 0),
      percentile,
      quartile: quartileOf(percentile),
      detail: { label: "inferred", period: r.period, items_low: itemsLow, items_high: itemsHigh, income: Math.round(r.incomeDollars), fee_low: r.feeLow, fee_high: r.feeHigh },
    });
  }

  const summary = (["overdraft", "nsf", "overdraft_nsf"] as const).map((cat) => {
    const own = input.filter((r) => r.feeCategory === cat);
    return {
      fee_category: cat,
      institutions: own.length,
      periods: [...new Set(own.map((r) => r.period))].sort(),
      median_items: round(median(own.map(midpoint)), 0),
      median_income: round(median(own.map((r) => r.incomeDollars)), 0),
    };
  });
  const asOf = input.length ? [...input.map((r) => r.period)].sort().at(-1)! : "none";
  const cu = summary.find((s) => s.fee_category === "overdraft");
  const headline = cu && cu.institutions > 0
    ? `Inferred: the typical credit union with a published overdraft fee was paid about ${cu.median_items?.toLocaleString("en-US")} overdraft items in ${cu.periods.at(-1)?.slice(0, 4)}.`
    : "No institution has both reported overdraft income and a published fee yet.";
  return {
    rows,
    placements,
    record: {
      studyKey: INFERRED_VOLUME_KEY,
      methodVersion: INFERRED_VOLUME_VERSION,
      title: "Inferred overdraft and NSF items paid",
      asOf,
      metric: "inferred_items_paid",
      n: input.length,
      sources: [
        { name: "NCUA 5300 overdraft and NSF fee income (IS0048, IS0049)", asOf: "2024" },
        { name: "FFIEC call report RIAD H032 (banks over $1B)", asOf: input.some((r) => r.charter === "bank") ? asOf : null },
        { name: "Bank Fee Index live published fees (published_fee_catalog)", asOf: null },
      ],
      findings: {
        headline,
        label: "inferred",
        by_category: summary,
        method: "Reported income (net of waivers and refunds) divided by the published fee. Range: highest published amount gives the low count, lowest gives the high count. The schedule is current while the income is from the period shown.",
      },
    },
  };
}

export async function saveInferredVolume(db: SqlTag, rows: InferredVolumeRow[], studyId: number): Promise<void> {
  for (let i = 0; i < rows.length; i += 2000) {
    const payload = JSON.stringify(rows.slice(i, i + 2000));
    await db`
      INSERT INTO inferred_fee_volume
        (institution_id, period, fee_category, reported_income, published_fee_low, published_fee_high,
         items_low, items_high, peer_group, peer_n, peer_median_items, peer_median_income, label, basis, study_id, computed_at)
      SELECT x."institutionId", x.period::date, x."feeCategory", x."reportedIncome", x."publishedFeeLow", x."publishedFeeHigh",
             x."itemsLow", x."itemsHigh", x."peerGroup", x."peerN", x."peerMedianItems", x."peerMedianIncome", 'inferred', x.basis,
             ${studyId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          "institutionId" bigint, period text, "feeCategory" text, "reportedIncome" numeric, "publishedFeeLow" numeric,
          "publishedFeeHigh" numeric, "itemsLow" numeric, "itemsHigh" numeric, "peerGroup" text, "peerN" int,
          "peerMedianItems" numeric, "peerMedianIncome" numeric, basis text)
      ON CONFLICT (institution_id, period, fee_category) DO UPDATE SET
        reported_income = EXCLUDED.reported_income,
        published_fee_low = EXCLUDED.published_fee_low,
        published_fee_high = EXCLUDED.published_fee_high,
        items_low = EXCLUDED.items_low,
        items_high = EXCLUDED.items_high,
        peer_group = EXCLUDED.peer_group,
        peer_n = EXCLUDED.peer_n,
        peer_median_items = EXCLUDED.peer_median_items,
        peer_median_income = EXCLUDED.peer_median_income,
        basis = EXCLUDED.basis,
        study_id = EXCLUDED.study_id,
        computed_at = NOW()
    `;
  }
}
