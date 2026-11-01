import { sql } from "@/lib/data-store/connection";
import { apiError } from "@/lib/api-v1";
import type { RateLimitResult } from "@/lib/api-rate-limit";
import type { V1Caller } from "@/lib/api-v1-auth";

/**
 * The cleaned fee database is never downloadable in bulk (business rule; security review
 * 2026-11-01). A Pro key or a signed-in Pro session reads fees one institution at a time, for
 * at most PRO_INSTITUTIONS_PER_MONTH different institutions a calendar month (UTC), and a fee
 * ranking only to its first PRO_RANK_DEPTH rows. Fee rows across every institution (the sync
 * feed: /institutions?view=fees and /rate-fees without institution_id) are for Enterprise
 * partner keys only, which James issues by hand.
 */
export const PRO_INSTITUTIONS_PER_MONTH = 250;
export const PRO_RANK_DEPTH = 50;

/** Usage events whose institution_id is an institution whose fees the caller read. */
export const INSTITUTION_READ_EVENTS = [
  "api.v1.institutions.detail",
  "api.v1.institutions.benchmark",
  "api.v1.institutions.regulatory_watch",
  "api.v1.institutions.fees",
  "api.v1.rate_fees",
  "api.v1.peers",
] as const;

type Caller = Pick<V1Caller, "auth" | "organizationId" | "anonymousId">;

/** An Enterprise partner key: the only caller that may read fee rows across every institution. */
export function isEnterpriseCaller(caller: Pick<V1Caller, "auth">): boolean {
  return caller.auth.valid && caller.auth.tier === "enterprise";
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Whether the caller may read one more institution's fees this month: always for Enterprise, for
 * an institution already read this month, or while under PRO_INSTITUTIONS_PER_MONTH distinct
 * institutions. Counted per organization (the whole team's keys) or, for a signed-in session
 * with no key, per anonymous caller id, from the usage ledger.
 */
export async function institutionReadAllowed(
  caller: Caller,
  institutionId: number,
  now: Date = new Date(),
): Promise<boolean> {
  if (isEnterpriseCaller(caller)) return true;
  const subject = caller.organizationId !== null
    ? sql`organization_id = ${caller.organizationId}`
    : sql`organization_id IS NULL AND anonymous_id = ${caller.anonymousId ?? "anonymous"}`;
  const rows = await sql`
    SELECT COUNT(DISTINCT metadata->>'institution_id')::int AS institutions,
           COALESCE(BOOL_OR(metadata->>'institution_id' = ${String(institutionId)}), false) AS seen
      FROM usage_events
     WHERE ${subject}
       AND event_type IN ${sql([...INSTITUTION_READ_EVENTS])}
       AND created_at >= ${monthStart(now).toISOString()}
       AND metadata->>'status' = '200'
       AND metadata->>'institution_id' IS NOT NULL
  `;
  const row = rows[0] as { institutions?: number; seen?: boolean } | undefined;
  if (row?.seen) return true;
  return Number(row?.institutions ?? 0) < PRO_INSTITUTIONS_PER_MONTH;
}

export function institutionCapError(rateLimit: RateLimitResult): Response {
  return apiError(
    429,
    "institution_limit",
    `This plan reads fees for up to ${PRO_INSTITUTIONS_PER_MONTH} different institutions a month. Institutions already read this month stay available; email us for an Enterprise key.`,
    { rateLimit },
  );
}

export function enterpriseOnlyError(rateLimit: RateLimitResult, what: string): Response {
  return apiError(
    403,
    "enterprise_required",
    `${what} across every institution needs an Enterprise key. Pass institution_id to read one institution.`,
    { rateLimit },
  );
}
