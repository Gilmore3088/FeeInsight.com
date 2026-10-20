import { sql } from "@/lib/data-store/connection";

type SqlClient = typeof sql;

/**
 * The reports an account already has, read-only, with or without a subscription (James,
 * 2026-10-20; #1999). Every query is scoped to the signed-in user's own id: no published
 * (user 0) reports, no cron jobs, nobody else's. Downloads go through the existing owner-checked
 * routes: `/api/reports/[id]/download` for a job, `/api/pro/report-pdf` for a saved report.
 */

const LIST_LIMIT = 50;

/** A finished report job (`report_jobs`) with a stored PDF. */
export interface AccountReportJob {
  id: string;
  reportType: string;
  completedAt: string | null;
  downloadHref: string;
}

/** A saved Hamilton report (`hamilton_reports`) the account generated. */
export interface AccountSavedReport {
  id: string;
  title: string;
  reportType: string;
  createdAt: string | null;
}

export interface AccountReportLibrary {
  jobs: AccountReportJob[];
  saved: AccountSavedReport[];
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : null;
}

export async function loadOwnReportJobs(userId: number, db: SqlClient = sql): Promise<AccountReportJob[]> {
  const rows = await db<Array<{ id: string; report_type: string; completed_at: unknown }>>`
    SELECT id, report_type, completed_at
      FROM report_jobs
     WHERE user_id = ${userId}
       AND status = 'complete'
       AND artifact_key IS NOT NULL
     ORDER BY completed_at DESC NULLS LAST
     LIMIT ${LIST_LIMIT}
  `;
  return rows.map((row) => ({
    id: String(row.id),
    reportType: String(row.report_type),
    completedAt: isoOrNull(row.completed_at),
    downloadHref: `/api/reports/${encodeURIComponent(String(row.id))}/download`,
  }));
}

export async function loadOwnSavedReports(userId: number, db: SqlClient = sql): Promise<AccountSavedReport[]> {
  const rows = await db<Array<{ id: string; title: string | null; report_type: string; created_at: unknown }>>`
    SELECT id, report_json->>'title' AS title, report_type, created_at
      FROM hamilton_reports
     WHERE user_id = ${userId}
       AND status = 'generated'
       AND coalesce(nullif(trim(report_json->>'title'), ''), '') != ''
     ORDER BY created_at DESC
     LIMIT ${LIST_LIMIT}
  `;
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title ?? "").trim(),
    reportType: String(row.report_type),
    createdAt: isoOrNull(row.created_at),
  }));
}

/**
 * Both lists for the signed-in account. A list that can't be read comes back empty and logged,
 * so one failing table doesn't hide the other.
 */
export async function loadOwnReportLibrary(userId: number, db: SqlClient = sql): Promise<AccountReportLibrary> {
  const [jobs, saved] = await Promise.all([
    loadOwnReportJobs(userId, db).catch((error) => {
      console.error(`[account-reports] report jobs read failed for user ${userId}:`, error);
      return [];
    }),
    loadOwnSavedReports(userId, db).catch((error) => {
      console.error(`[account-reports] saved reports read failed for user ${userId}:`, error);
      return [];
    }),
  ]);
  return { jobs, saved };
}
