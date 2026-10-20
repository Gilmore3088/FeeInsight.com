import { sql } from "@/lib/data-store/connection";
import { WINDOW_QUARTER_INCOME } from "@/lib/data-store/call-report-sql";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Hoovie registry step `registry-call-report-summaries`: precomputes each call-report filing's
 * standalone quarter into call_report_quarterly_income, once per load, so the call-report
 * readers stop recomputing it from institution_financial_records on every request (James,
 * 2026-10-20). The raw filings stay as they are.
 *
 * Filings are grouped by (source, calendar year), the window the NCUA year-to-date split looks
 * back in. Each group's count and order-free hash of the columns the readers use is kept in
 * call_report_summary_groups; a run rebuilds only the groups whose filings changed (a new
 * quarter, an amended filing, an unmatched filing later matched to an institution) and drops the
 * groups whose filings are gone, all in the step's one transaction, so a reader sees either the
 * old summary or the new one, never half. A dry run reports the changed groups and writes nothing.
 *
 * It runs after every FDIC or NCUA call-report load and FDIC universe sync (markCallReportSummariesDue)
 * and otherwise re-checks daily. Deterministic: no fetch, no provider call.
 */

export const CALL_REPORT_SUMMARIES_SOURCE = "call-report-summaries";
export const CALL_REPORT_SUMMARIES_PARTITION = "current";
/** The daily re-check; a load makes the step due at once. */
export const CALL_REPORT_SUMMARIES_REFRESH_HOURS = 24;
/** Sources whose successful runs change the filings the summary is built from. */
export const CALL_REPORT_SUMMARY_TRIGGER_SOURCES: ReadonlySet<string> = new Set([
  "fdic-financials",
  "ncua-financials",
  "fdic-universe",
]);
/** Room for the first, full build (about 800,000 filings); later runs rebuild a year or two. */
const BUILD_STATEMENT_TIMEOUT = "240s";
const BUILD_WORK_MEM = "64MB";

export interface CallReportSummaryGroup {
  source: string;
  reportYear: number;
  filingCount: number;
  filingsHash: string;
}

export interface RegistryCallReportSummariesOptions {
  runId?: number | null;
  dryRun?: boolean;
  db?: RegistryDb;
}

export interface RegistryCallReportSummariesResult {
  source: string;
  partitionKey: string;
  dryRun: boolean;
  groupsChecked: number;
  /** "ncua 2026" style labels of the groups rebuilt (or, in a dry run, that would be). */
  groupsChanged: string[];
  groupsRemoved: string[];
  filings: number;
  rowsRemoved: number;
  rowsWritten: number;
  summaryRows: number;
}

/**
 * Each (source, year) group's filing count and hash, over the columns the summary copies. The
 * hash is a sum of per-row hashes, so it does not depend on row order.
 */
const FILING_GROUPS_SQL = `SELECT inf.source,
         EXTRACT(YEAR FROM inf.report_date::date)::int AS report_year,
         COUNT(*)::bigint AS filing_count,
         COALESCE(SUM(hashtextextended(ROW(inf.id, inf.institution_id, inf.report_date,
           inf.service_charge_income, inf.total_assets, inf.total_deposits,
           inf.other_noninterest_income, inf.fee_income_ratio)::text, 0)::numeric), 0)::text AS filings_hash
    FROM institution_financial_records inf
   WHERE inf.source IN ('fdic', 'ncua')
   GROUP BY 1, 2`;

const STORED_GROUPS_SQL = `SELECT source, report_year, filing_count, filings_hash::text AS filings_hash
    FROM call_report_summary_groups`;

/**
 * The standalone quarter of every filing in the picked groups ($1 sources, $2 years, $3 run).
 * quarter_income is the window rule the trend readers used (WINDOW_QUARTER_INCOME);
 * prior_quarter_end_income is the exact prior-quarter-end rule the single-date readers used
 * (QUARTER_SC with PRIOR_QUARTER_JOIN). Unmatched filings are stored for the latest-date read
 * but get no quarter: no reader joins them to an institution.
 */
const BUILD_GROUPS_SQL = `WITH picked AS (
       SELECT * FROM unnest($1::text[], $2::int[]) AS g(source, report_year)
     ),
     filed AS (
       SELECT inf.id, inf.institution_id, inf.source, inf.report_date,
              inf.report_date::date AS rd,
              inf.service_charge_income AS amount,
              inf.total_assets, inf.total_deposits, inf.other_noninterest_income, inf.fee_income_ratio,
              LAG(inf.service_charge_income) OVER w AS prior_amount,
              LAG(inf.report_date::date) OVER w AS prior_rd
         FROM institution_financial_records inf
         JOIN picked g ON g.source = inf.source
                      AND g.report_year = EXTRACT(YEAR FROM inf.report_date::date)
        WHERE inf.source IN ('fdic', 'ncua')
       WINDOW w AS (PARTITION BY inf.institution_id, inf.source, EXTRACT(YEAR FROM inf.report_date::date)
                    ORDER BY inf.report_date::date)
     ),
     split AS (
       SELECT filed.*, (${WINDOW_QUARTER_INCOME}) AS window_income FROM filed
     )
     INSERT INTO call_report_quarterly_income (
       record_id, institution_id, source, report_date, report_day, report_year, quarter_start,
       filed_service_charge_income, prior_report_day, quarter_income, prior_quarter_end_income,
       total_assets, total_deposits, other_noninterest_income, fee_income_ratio, agent_run_id, built_at
     )
     SELECT s.id, s.institution_id, s.source, s.report_date, s.rd,
            EXTRACT(YEAR FROM s.rd)::int, DATE_TRUNC('quarter', s.rd)::date,
            s.amount, s.prior_rd,
            CASE WHEN s.institution_id IS NULL THEN NULL ELSE s.window_income END,
            CASE
              WHEN s.institution_id IS NULL THEN NULL
              WHEN s.source <> 'ncua' OR EXTRACT(QUARTER FROM s.rd) = 1 THEN s.amount
              WHEN prev.service_charge_income IS NOT NULL THEN s.amount - prev.service_charge_income
            END,
            s.total_assets, s.total_deposits, s.other_noninterest_income, s.fee_income_ratio,
            $3::bigint, NOW()
       FROM split s
       LEFT JOIN institution_financial_records prev
         ON s.source = 'ncua'
        AND prev.institution_id = s.institution_id
        AND prev.source = s.source
        AND EXTRACT(QUARTER FROM s.rd) > 1
        AND prev.report_date = TO_CHAR(DATE_TRUNC('quarter', s.rd)::date - 1, 'YYYY-MM-DD')`;

const label = (group: { source: string; reportYear: number }) => `${group.source} ${group.reportYear}`;

function toGroups(rows: Iterable<Record<string, unknown>>): CallReportSummaryGroup[] {
  return [...rows].map((row) => ({
    source: String(row.source),
    reportYear: Number(row.report_year),
    filingCount: Number(row.filing_count),
    filingsHash: String(row.filings_hash),
  }));
}

/** The groups to rebuild (new or changed) and to drop (no filings left), given both sides. */
export function diffSummaryGroups(
  filings: CallReportSummaryGroup[],
  stored: CallReportSummaryGroup[],
): { changed: CallReportSummaryGroup[]; removed: CallReportSummaryGroup[] } {
  const key = (g: { source: string; reportYear: number }) => `${g.source}:${g.reportYear}`;
  const storedByKey = new Map(stored.map((g) => [key(g), g]));
  const filingKeys = new Set(filings.map(key));
  const changed = filings.filter((g) => {
    const before = storedByKey.get(key(g));
    return !before || before.filingCount !== g.filingCount || before.filingsHash !== g.filingsHash;
  });
  const removed = stored.filter((g) => !filingKeys.has(key(g)));
  return { changed, removed };
}

/** True when `db` is already a transaction (the run step's), so the build joins it. */
function inTransaction(db: RegistryDb): boolean {
  return typeof (db as unknown as { savepoint?: unknown }).savepoint === "function";
}

async function rebuild(
  tx: RegistryDb,
  changed: CallReportSummaryGroup[],
  removed: CallReportSummaryGroup[],
  runId: number | null,
): Promise<{ rowsRemoved: number; rowsWritten: number }> {
  await tx.unsafe(`SET LOCAL statement_timeout = '${BUILD_STATEMENT_TIMEOUT}'`);
  await tx.unsafe(`SET LOCAL work_mem = '${BUILD_WORK_MEM}'`);
  const drop = [...changed, ...removed];
  const deleted = await tx.unsafe(
    `DELETE FROM call_report_quarterly_income c
      USING unnest($1::text[], $2::int[]) AS g(source, report_year)
      WHERE c.source = g.source AND c.report_year = g.report_year`,
    [drop.map((g) => g.source), drop.map((g) => g.reportYear)],
  );
  await tx.unsafe(
    `DELETE FROM call_report_summary_groups s
      USING unnest($1::text[], $2::int[]) AS g(source, report_year)
      WHERE s.source = g.source AND s.report_year = g.report_year`,
    [removed.map((g) => g.source), removed.map((g) => g.reportYear)],
  );
  let rowsWritten = 0;
  if (changed.length > 0) {
    const inserted = await tx.unsafe(BUILD_GROUPS_SQL, [
      changed.map((g) => g.source), changed.map((g) => g.reportYear), runId,
    ]);
    rowsWritten = Number((inserted as unknown as { count?: number }).count ?? 0);
    await tx.unsafe(
      `INSERT INTO call_report_summary_groups (source, report_year, filing_count, filings_hash, agent_run_id, built_at)
       SELECT g.source, g.report_year, g.filing_count, g.filings_hash::numeric, $5::bigint, NOW()
         FROM unnest($1::text[], $2::int[], $3::bigint[], $4::text[]) AS g(source, report_year, filing_count, filings_hash)
       ON CONFLICT (source, report_year) DO UPDATE SET
         filing_count = EXCLUDED.filing_count,
         filings_hash = EXCLUDED.filings_hash,
         agent_run_id = EXCLUDED.agent_run_id,
         built_at = EXCLUDED.built_at`,
      [
        changed.map((g) => g.source), changed.map((g) => g.reportYear),
        changed.map((g) => g.filingCount), changed.map((g) => g.filingsHash), runId,
      ],
    );
  }
  return { rowsRemoved: Number((deleted as unknown as { count?: number }).count ?? 0), rowsWritten };
}

export async function runRegistryCallReportSummaries(
  options: RegistryCallReportSummariesOptions = {},
): Promise<RegistryCallReportSummariesResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const runId = options.runId ?? null;
  const filings = toGroups(await db.unsafe(FILING_GROUPS_SQL) as Iterable<Record<string, unknown>>);
  const stored = toGroups(await db.unsafe(STORED_GROUPS_SQL) as Iterable<Record<string, unknown>>);
  const { changed, removed } = diffSummaryGroups(filings, stored);
  const base: RegistryCallReportSummariesResult = {
    source: CALL_REPORT_SUMMARIES_SOURCE,
    partitionKey: CALL_REPORT_SUMMARIES_PARTITION,
    dryRun,
    groupsChecked: filings.length,
    groupsChanged: changed.map(label),
    groupsRemoved: removed.map(label),
    filings: filings.reduce((sum, g) => sum + g.filingCount, 0),
    rowsRemoved: 0,
    rowsWritten: 0,
    summaryRows: 0,
  };
  if (dryRun) return base;

  const build = (tx: RegistryDb) => rebuild(tx, changed, removed, runId);
  const counts = changed.length + removed.length === 0
    ? { rowsRemoved: 0, rowsWritten: 0 }
    : inTransaction(db)
      ? await build(db)
      : await (db.begin((tx) => build(tx as unknown as RegistryDb)) as Promise<{ rowsRemoved: number; rowsWritten: number }>);
  const [total] = await db.unsafe(`SELECT COUNT(*)::bigint AS rows FROM call_report_quarterly_income`) as unknown as Array<{ rows: string }>;
  const result = { ...base, ...counts, summaryRows: Number(total?.rows ?? 0) };

  await recordRegistryPartition(db, {
    source: CALL_REPORT_SUMMARIES_SOURCE,
    partitionKey: CALL_REPORT_SUMMARIES_PARTITION,
    status: "succeeded",
    rowCount: result.summaryRows,
    insertedCount: result.rowsWritten,
    runId,
    nextAttemptAfterHours: CALL_REPORT_SUMMARIES_REFRESH_HOURS,
    detail: {
      groups_checked: result.groupsChecked,
      groups_changed: result.groupsChanged,
      groups_removed: result.groupsRemoved,
      filings: result.filings,
      rows_removed: result.rowsRemoved,
      rows_written: result.rowsWritten,
      summary_rows: result.summaryRows,
    },
  });
  return result;
}

/**
 * After a load that changes the filings, make the summary step due now, so the registry tick
 * rebuilds it next (its source runs ahead of the backfill, PRIORITY_REGISTRY_SOURCES). Before
 * its first run there is no partition row, which already counts as due.
 */
export async function markCallReportSummariesDue(db: RegistryDb): Promise<void> {
  await db`
    UPDATE registry_ingest_partitions
       SET next_attempt_after = NOW(), updated_at = NOW()
     WHERE source = ${CALL_REPORT_SUMMARIES_SOURCE}
       AND partition_key = ${CALL_REPORT_SUMMARIES_PARTITION}
       AND next_attempt_after > NOW()
  `;
}
