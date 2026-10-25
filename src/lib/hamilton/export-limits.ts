/**
 * Limits on Hamilton's data files (V5 T6, data rights). A file lets a client check the figures
 * Hamilton showed them; it is never a way to take the cleaned database away. Two bounds:
 *
 * - HAMILTON_EXPORT_MAX_ROWS: rows in one file. The nation-wide layer of a common fee holds
 *   thousands of institutions; the file lists the first HAMILTON_EXPORT_MAX_ROWS (lowest amount
 *   first, the screen's order) and says how many the screen counted.
 * - HAMILTON_EXPORT_DAILY_FILES: files one account downloads per UTC day, counted from
 *   api_route_audit_events (one row per served file, keyed by user id), so the limit holds across
 *   serverless instances. When the count cannot be read the file is refused (fail closed).
 *
 * Other Hamilton exports are already bounded: a peer list file by MAX_PEER_LIST_ROWS (peer-list.ts),
 * an Ask data query by QUERY_DATA_MAX_LIMIT (data-catalog/query-data.ts), and PDFs carry one saved
 * answer or report.
 */
import { sql } from "@/lib/data-store/connection";
import { recordApiRouteAuditEvent } from "@/lib/api-hardening/audit";
import type { ApiRoutePolicy } from "@/lib/api-hardening/policies";

export const HAMILTON_EXPORT_MAX_ROWS = 500;
export const HAMILTON_EXPORT_DAILY_FILES = 50;

/** The ledger entry for the peers CSV (/pro/research/peers). Not an /api route, so not in API_ROUTE_POLICIES. */
export const PEER_CSV_EXPORT_POLICY: ApiRoutePolicy = {
  routeId: "pro.research.peers.csv",
  routeTemplate: "/pro/research/peers",
  file: "src/app/pro/(hamilton)/research/peers/route.ts",
  surface: "pro",
  allowedMethods: ["GET"],
  authRequirement: "premium",
  rateLimitBucket: "hamilton-export-daily",
  costPolicy: "none",
  telemetryEvent: "pro.research.peers.csv",
  failBehavior: "fail_closed",
  auditPriority: "medium",
};

export const EXPORT_LIMIT_MESSAGE =
  `You've downloaded ${HAMILTON_EXPORT_DAILY_FILES} files today, the daily limit. It resets at midnight UTC.`;
export const EXPORT_UNAVAILABLE_MESSAGE = "Downloads are unavailable right now. Try again in a few minutes.";

/** The first `max` rows and whether any were left out. */
export function capExportRows<T>(rows: readonly T[], max = HAMILTON_EXPORT_MAX_ROWS): { rows: T[]; truncated: boolean } {
  return { rows: rows.slice(0, max), truncated: rows.length > max };
}

export type ExportAllowance = { allowed: true; used: number } | { allowed: false; reason: "limit" | "unreadable"; used: number };

/** Whether this account may download another file today. */
export async function checkExportAllowance(userId: number, now: Date = new Date()): Promise<ExportAllowance> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  try {
    const [row] = await sql<{ used: number }[]>`
      SELECT COUNT(*)::int AS used
        FROM api_route_audit_events
       WHERE route_id = ${PEER_CSV_EXPORT_POLICY.routeId}
         AND user_id = ${userId}
         AND outcome = 'success'
         AND created_at >= ${dayStart}::timestamptz`;
    const used = Number(row?.used ?? 0);
    return used < HAMILTON_EXPORT_DAILY_FILES ? { allowed: true, used } : { allowed: false, reason: "limit", used };
  } catch (error) {
    console.error("[hamilton-export] daily count failed", error);
    return { allowed: false, reason: "unreadable", used: 0 };
  }
}

/** Records one served (or refused) file in the ledger the daily count reads. */
export async function recordExport(input: {
  userId: number;
  request: Request;
  status: number;
  rows: number;
  truncated: boolean;
  reason?: string;
}): Promise<void> {
  await recordApiRouteAuditEvent({
    policy: PEER_CSV_EXPORT_POLICY,
    request: input.request,
    method: "GET",
    statusCode: input.status,
    outcome: input.status === 200 ? "success" : input.status === 429 ? "rate_limited" : "blocked",
    userId: input.userId,
    reasonCode: input.reason ?? null,
    metadata: { rows: input.rows, truncated: input.truncated },
  }).catch(() => {});
}
