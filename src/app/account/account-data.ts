import { sql } from "@/lib/data-store/connection";
import { getRecentHamiltonReports } from "@/lib/hamilton/pro-tables";

import { createReportToken, reportPath } from "@/lib/custom-report/link";
import type { AccountReport, OwnInstitution, PaidReport } from "./account-types";

/** The user's own recent Hamilton reports, newest first. Empty when none or unreadable. */
export async function getAccountReports(userId: number, limit = 5): Promise<AccountReport[]> {
  const reports = await getRecentHamiltonReports(userId, limit).catch(() => []);
  return reports.map((report) => ({
    id: report.id,
    title: report.title,
    createdAt: report.created_at,
    href: `/pro/reports?report_id=${encodeURIComponent(report.id)}`,
  }));
}

/**
 * The user's own bank or credit union and how many fees we publish for it. Pro users: the
 * bank their Hamilton workspace is on. Free users: the institution their profile names, when
 * the name and state match exactly one institution (onboarding copies both from the pick).
 * Null when there is no such bank or it can't be read.
 */
export async function getOwnInstitution(params: {
  institutionId: number | null;
  profileName: string | null;
  profileState: string | null;
}): Promise<OwnInstitution | null> {
  try {
    let id = params.institutionId;
    if (!id && params.profileName && params.profileState) {
      const matches = await sql<{ id: number | string }[]>`
        SELECT id FROM institution_sources
         WHERE institution_name = ${params.profileName} AND state_code = ${params.profileState}
         LIMIT 2`;
      id = matches.length === 1 ? Number(matches[0].id) : null;
    }
    if (!id) return null;
    const rows = await sql<{ id: number | string; institution_name: string; fees: number | string }[]>`
      SELECT inst.id, inst.institution_name,
             (SELECT COUNT(*) FROM published_fee_catalog c WHERE c.institution_id = inst.id) AS fees
        FROM institution_sources inst
       WHERE inst.id = ${id}`;
    const row = rows[0];
    return row ? { id: Number(row.id), name: row.institution_name, publishedFeeCount: Number(row.fees) } : null;
  } catch {
    return null;
  }
}

/**
 * Market reports paid for with this email, newest first. Call it only for a confirmed email:
 * the private link opens the report, so it goes only to someone who proved the inbox.
 */
export async function getPaidReports(email: string): Promise<PaidReport[]> {
  try {
    const rows = await sql<{ id: number | string; institution_name: string | null; paid_at: string; institution_id: number | string }[]>`
      SELECT l.id, inst.institution_name,
             to_jsonb(l.*) ->> 'paid_at' AS paid_at,
             to_jsonb(l.*) ->> 'quote_institution_id' AS institution_id
        FROM leads l
        LEFT JOIN institution_sources inst ON inst.id = (to_jsonb(l.*) ->> 'quote_institution_id')::bigint
       WHERE lower(l.email) = ${email.trim().toLowerCase()}
         AND to_jsonb(l.*) ->> 'paid_at' IS NOT NULL
         AND to_jsonb(l.*) ->> 'refunded_at' IS NULL
         AND to_jsonb(l.*) ->> 'quote_institution_id' IS NOT NULL
       ORDER BY (to_jsonb(l.*) ->> 'paid_at') DESC
       LIMIT 10`;
    return rows.map((row) => {
      const token = createReportToken(Number(row.institution_id));
      return {
        leadId: Number(row.id),
        institutionName: row.institution_name ?? "Your institution",
        paidAt: row.paid_at,
        href: token ? reportPath(token) : null,
      };
    });
  } catch {
    return [];
  }
}
