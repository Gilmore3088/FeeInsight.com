import { getSql } from "./connection";
import { callReportQuartersReady, CALL_REPORT_QUARTERS_TABLE } from "./call-report-quarters";
import { COMPARABLE_CHARTER_SOURCE, PRIOR_QUARTER_JOIN, QUARTER_SC, SAME_SCALE_SOURCES } from "./call-report-sql";
import type { FiledQuarterRow, PeerQuarterRow } from "@/lib/hamilton/financial-quarters";

/**
 * Reads behind Hamilton's financial performance view (#1892). Read-only selects.
 *
 * - getInstitutionFiledQuarters: one institution's own fdic or ncua filings in
 *   institution_financial_records (thousands of dollars as stored), newest quarter end first,
 *   one record per quarter end, with the same variables as they sit in the stored filing
 *   (raw_json) so the view can check each figure against the filing.
 * - getFinancialPeerMedians: per quarter end, the median standalone fee income, deposits and
 *   assets of the other filers with the same charter and asset-size tier (institution_sources),
 *   and how many reported each. The subject is left out. NCUA year to date is split with the exact
 *   prior-quarter-end rule (call_report_quarterly_income.prior_quarter_end_income, or QUARTER_SC on
 *   the per-request path while that table is empty).
 */

/** Twelve shown quarters, plus a year back for the oldest one's change and one more to split it. */
export const FILED_QUARTER_READ_LIMIT = 20;

type RawFiledRow = {
  record_id: number | string;
  report_date: string;
  source: string;
  institution_name: string | null;
  cert_number: string | null;
  fee_income: number | string | null;
  total_deposits: number | string | null;
  total_assets: number | string | null;
  raw_fee: string | null;
  raw_deposits: string | null;
  raw_assets: string | null;
  source_url: string | null;
  retrieved_at: string | null;
};

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function toFiledQuarterRow(row: RawFiledRow): FiledQuarterRow | null {
  if (row.source !== "fdic" && row.source !== "ncua") return null;
  const recordId = num(row.record_id);
  if (recordId === null) return null;
  return {
    recordId,
    reportDate: String(row.report_date).slice(0, 10),
    source: row.source,
    institutionName: row.institution_name ?? "This institution",
    certNumber: row.cert_number,
    feeIncome: num(row.fee_income),
    totalDeposits: num(row.total_deposits),
    totalAssets: num(row.total_assets),
    rawFeeIncome: num(row.raw_fee),
    rawDeposits: num(row.raw_deposits),
    rawAssets: num(row.raw_assets),
    sourceUrl: row.source_url,
    retrievedAt: row.retrieved_at,
  };
}

export const FILED_QUARTERS_SQL = `SELECT DISTINCT ON (inf.report_date)
         inf.id AS record_id, inf.report_date, inf.source,
         ct.institution_name,
         COALESCE(NULLIF(inf.source_cert_number, ''), ct.cert_number) AS cert_number,
         inf.service_charge_income AS fee_income,
         inf.total_deposits, inf.total_assets,
         CASE inf.source WHEN 'fdic' THEN inf.raw_json->>'ISERCHGQ' ELSE inf.raw_json->>'ACCT_131' END AS raw_fee,
         CASE inf.source WHEN 'fdic' THEN inf.raw_json->>'DEP' ELSE inf.raw_json->>'ACCT_018' END AS raw_deposits,
         CASE inf.source WHEN 'fdic' THEN inf.raw_json->>'ASSET' ELSE inf.raw_json->>'ACCT_010' END AS raw_assets,
         inf.source_url,
         TO_CHAR(inf.fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS retrieved_at
    FROM institution_financial_records inf
    JOIN institution_sources ct ON ct.id = inf.institution_id
   WHERE inf.institution_id = $1
     AND ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE}
     AND inf.report_date ~ '^[0-9]{4}-(03-31|06-30|09-30|12-31)$'
   ORDER BY inf.report_date DESC, inf.id DESC
   LIMIT $2`;

export async function getInstitutionFiledQuarters(institutionId: number): Promise<FiledQuarterRow[]> {
  const sql = getSql();
  const rows = (await sql.unsafe(FILED_QUARTERS_SQL, [institutionId, FILED_QUARTER_READ_LIMIT])) as unknown as RawFiledRow[];
  return rows.map(toFiledQuarterRow).filter((r): r is FiledQuarterRow => r !== null);
}

const PEER_SUBJECT = `subject AS (
       SELECT id, charter_type, asset_size_tier FROM institution_sources
        WHERE id = $1 AND charter_type IN ('bank', 'credit_union') AND asset_size_tier IS NOT NULL
     )`;

const PEER_AGGREGATE = `SELECT report_date,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fee) FILTER (WHERE fee > 0) AS fee_median,
            (COUNT(*) FILTER (WHERE fee > 0))::int AS fee_peers,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY deposits) FILTER (WHERE deposits > 0) AS deposits_median,
            (COUNT(*) FILTER (WHERE deposits > 0))::int AS deposits_peers,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY assets) FILTER (WHERE assets > 0) AS assets_median,
            (COUNT(*) FILTER (WHERE assets > 0))::int AS assets_peers
       FROM peers
      GROUP BY report_date
      ORDER BY report_date DESC`;

/** Over call_report_quarterly_income, where each filing's standalone quarter is stored. */
export const PEER_MEDIANS_SUMMARY_SQL = `WITH ${PEER_SUBJECT},
     peers AS (
       SELECT DISTINCT ON (inf.institution_id, inf.report_date)
              inf.report_date, inf.prior_quarter_end_income AS fee,
              inf.total_deposits AS deposits, inf.total_assets AS assets
         FROM ${CALL_REPORT_QUARTERS_TABLE} inf
         JOIN institution_sources ct ON ct.id = inf.institution_id
         JOIN subject s ON ct.charter_type = s.charter_type AND ct.asset_size_tier = s.asset_size_tier
        WHERE ct.id <> s.id
          AND inf.report_date = ANY($2::text[])
          AND ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE}
        ORDER BY inf.institution_id, inf.report_date, inf.record_id DESC
     )
     ${PEER_AGGREGATE}`;

/** The same figures from institution_financial_records, while the summary table is empty. */
export const PEER_MEDIANS_LEGACY_SQL = `WITH ${PEER_SUBJECT},
     peers AS (
       SELECT DISTINCT ON (inf.institution_id, inf.report_date)
              inf.report_date, ${QUARTER_SC} AS fee,
              inf.total_deposits AS deposits, inf.total_assets AS assets
         FROM institution_financial_records inf
         ${PRIOR_QUARTER_JOIN}
         JOIN institution_sources ct ON ct.id = inf.institution_id
         JOIN subject s ON ct.charter_type = s.charter_type AND ct.asset_size_tier = s.asset_size_tier
        WHERE ct.id <> s.id
          AND inf.report_date = ANY($2::text[])
          AND ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE}
        ORDER BY inf.institution_id, inf.report_date, inf.id DESC, prev.id DESC NULLS LAST
     )
     ${PEER_AGGREGATE}`;

type RawPeerRow = {
  report_date: string;
  fee_median: number | string | null;
  fee_peers: number | string;
  deposits_median: number | string | null;
  deposits_peers: number | string;
  assets_median: number | string | null;
  assets_peers: number | string;
};

export function toPeerQuarterRow(row: RawPeerRow): PeerQuarterRow {
  return {
    reportDate: String(row.report_date).slice(0, 10),
    feeMedian: num(row.fee_median),
    feePeers: num(row.fee_peers) ?? 0,
    depositsMedian: num(row.deposits_median),
    depositsPeers: num(row.deposits_peers) ?? 0,
    assetsMedian: num(row.assets_median),
    assetsPeers: num(row.assets_peers) ?? 0,
  };
}

export async function getFinancialPeerMedians(institutionId: number, quarterEnds: readonly string[]): Promise<PeerQuarterRow[]> {
  if (quarterEnds.length === 0) return [];
  const sql = getSql();
  const ready = await callReportQuartersReady(sql as never);
  const rows = (await sql.unsafe(
    ready ? PEER_MEDIANS_SUMMARY_SQL : PEER_MEDIANS_LEGACY_SQL,
    [institutionId, [...quarterEnds]] as never[],
  )) as unknown as RawPeerRow[];
  return rows.map(toPeerQuarterRow);
}
