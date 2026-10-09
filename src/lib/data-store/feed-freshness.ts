import { sql } from "./connection";

/**
 * Read-only freshness of every data feed coming in and every report going out:
 * the latest period each regulator feed holds, when it was last pulled, and when
 * each report was last produced. Every value comes from a table; nothing is
 * estimated.
 */

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v ? String(v) : null;
const day = (v: unknown): string | null => {
  const s = iso(v);
  return s ? s.slice(0, 10) : null;
};

export interface RegistryFeedFreshness {
  source: string;
  /** Newest partition that loaded rows (e.g. 2026Q2, 2026, 202608, current). */
  latestPeriod: string | null;
  lastSuccessAt: string | null;
  nextAttemptAt: string | null;
  failed: number;
  scheduled: number;
  lastError: string | null;
}

export interface CallReportFreshness {
  source: string;
  /** Newest report date (quarter end) held for this source. */
  latestPeriod: string | null;
  lastFetchedAt: string | null;
  /** True when another call-report source already holds a newer quarter. */
  behind: boolean;
}

export interface ReportFreshness {
  key: string;
  /** Files or rows produced; null for scheduled runs, where only the last run is read. */
  count: number | null;
  lastAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface FeedFreshness {
  readAt: string;
  feeds: RegistryFeedFreshness[];
  callReports: CallReportFreshness[];
  reports: ReportFreshness[];
}

export const SCHEDULED_REPORT_TRIGGERS = [
  "atlas.daily_brief",
  "atlas.fee_alerts",
  "atlas.lead_watch",
  "atlas.scoreboard",
  // Growth's marketing runs keep the triggered_by they had under Hamilton.
  "hamilton.content",
  "hamilton.marketing",
  "growth.score",
  "growth.contacts",
  "growth.outreach",
  "growth.learning",
] as const;

export async function getRegistryFeedFreshness(): Promise<RegistryFeedFreshness[]> {
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT source,
           (ARRAY_AGG(partition_key ORDER BY partition_key DESC) FILTER (WHERE status = 'succeeded'))[1] AS latest_period,
           MAX(fetched_at) FILTER (WHERE status IN ('succeeded', 'empty')) AS last_success_at,
           MIN(next_attempt_after) FILTER (WHERE status IN ('scheduled', 'failed')) AS next_attempt_at,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
           COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
           (ARRAY_AGG(last_error ORDER BY updated_at DESC) FILTER (WHERE status = 'failed' AND last_error IS NOT NULL))[1] AS last_error
      FROM registry_ingest_partitions
     GROUP BY source
     ORDER BY source`;
  return rows.map((r) => ({
    source: String(r.source),
    latestPeriod: r.latest_period ? String(r.latest_period) : null,
    lastSuccessAt: iso(r.last_success_at),
    nextAttemptAt: iso(r.next_attempt_at),
    failed: Number(r.failed),
    scheduled: Number(r.scheduled),
    lastError: r.last_error ? String(r.last_error) : null,
  }));
}

export async function getCallReportFreshness(): Promise<CallReportFreshness[]> {
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT source, MAX(report_date) AS latest_period, MAX(fetched_at) AS last_fetched_at
      FROM institution_financial_records
     WHERE source IN ('fdic', 'ncua')
     GROUP BY source
     ORDER BY source`;
  const mapped = rows.map((r) => ({
    source: String(r.source),
    latestPeriod: day(r.latest_period),
    lastFetchedAt: iso(r.last_fetched_at),
  }));
  const newest = mapped.reduce<string | null>(
    (max, r) => (r.latestPeriod && (!max || r.latestPeriod > max) ? r.latestPeriod : max),
    null,
  );
  return mapped.map((r) => ({ ...r, behind: Boolean(newest && r.latestPeriod && r.latestPeriod < newest) }));
}

export async function getReportFreshness(): Promise<ReportFreshness[]> {
  const [jobs, published, hamilton, scheduled] = await Promise.all([
    sql<Array<Record<string, unknown>>>`
      SELECT report_type,
             COUNT(*) FILTER (WHERE status = 'complete')::int AS complete,
             MAX(completed_at) FILTER (WHERE status = 'complete') AS last_complete_at,
             (ARRAY_AGG(status ORDER BY created_at DESC))[1] AS last_status,
             (ARRAY_AGG(error ORDER BY created_at DESC))[1] AS last_error
        FROM report_jobs
       GROUP BY report_type
       ORDER BY report_type`,
    sql<Array<Record<string, unknown>>>`
      SELECT COUNT(*)::int AS n, MAX(published_at) AS last_at FROM published_reports`,
    sql<Array<Record<string, unknown>>>`
      SELECT COUNT(*)::int AS n, MAX(created_at) AS last_at FROM hamilton_reports`,
    sql<Array<Record<string, unknown>>>`
      SELECT DISTINCT ON (triggered_by) triggered_by, status, COALESCE(completed_at, started_at) AS last_at, error_summary
        FROM agent_runs
       WHERE triggered_by IN ${sql([...SCHEDULED_REPORT_TRIGGERS])}
       ORDER BY triggered_by, started_at DESC`,
  ]);

  const reports: ReportFreshness[] = jobs.map((r) => ({
    key: `report_jobs:${String(r.report_type)}`,
    count: Number(r.complete),
    lastAt: iso(r.last_complete_at),
    lastStatus: r.last_status ? String(r.last_status) : null,
    lastError: r.last_error ? String(r.last_error) : null,
  }));
  const one = (key: string, row: Record<string, unknown> | undefined): ReportFreshness => ({
    key,
    count: Number(row?.n ?? 0),
    lastAt: iso(row?.last_at),
    lastStatus: null,
    lastError: null,
  });
  reports.push(one("published_reports", published[0]), one("hamilton_reports", hamilton[0]));
  for (const trigger of SCHEDULED_REPORT_TRIGGERS) {
    const row = scheduled.find((r) => r.triggered_by === trigger);
    reports.push({
      key: `run:${trigger}`,
      count: null,
      lastAt: iso(row?.last_at),
      lastStatus: row?.status ? String(row.status) : null,
      lastError: row?.error_summary ? String(row.error_summary) : null,
    });
  }
  return reports;
}

export async function getFeedFreshness(): Promise<FeedFreshness> {
  const [feeds, callReports, reports] = await Promise.all([
    getRegistryFeedFreshness(),
    getCallReportFreshness(),
    getReportFreshness(),
  ]);
  return { readAt: new Date().toISOString(), feeds, callReports, reports };
}
