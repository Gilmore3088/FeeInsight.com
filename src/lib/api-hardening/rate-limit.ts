import { sql } from "@/lib/data-store/connection";
import { API_ROUTE_POLICIES, type ApiRoutePolicy } from "./policies";

/**
 * Durable per-visitor limits, counted from api_route_audit_events (every wrapped route
 * already writes one row per request with the hashed client IP as subject_key), so the
 * limit holds across serverless instances. Buckets not listed here are not limited.
 */
export const RATE_LIMITS: Record<string, { max: number; windowMinutes: number }> = {
  // Form posts that store a lead and send email: generous for a person, tight for a bot.
  "lead-write": { max: 8, windowMinutes: 10 },
  // Free account signups (a server action; see action-rate-limit.ts): the same limit.
  "account-register": { max: 8, windowMinutes: 10 },
  // Password-reset email requests (a server action): a person needs one or two.
  "account-password-reset": { max: 5, windowMinutes: 10 },
  // Tracked-link visits: one per browser session, so a person stays far below this.
  "touch-write": { max: 20, windowMinutes: 10 },
};

export async function isRateLimited(policy: ApiRoutePolicy, subjectKey: string | null): Promise<boolean> {
  const limit = RATE_LIMITS[policy.rateLimitBucket];
  if (!limit || !subjectKey) return false;
  const routeIds = API_ROUTE_POLICIES.filter((p) => p.rateLimitBucket === policy.rateLimitBucket).map((p) => p.routeId);
  try {
    const [row] = await sql<{ attempts: number }[]>`
      SELECT COUNT(*)::int AS attempts
      FROM api_route_audit_events
      WHERE route_id = ANY(${routeIds})
        AND created_at > now() - make_interval(mins => ${limit.windowMinutes})
        AND subject_key = ${subjectKey}
        AND outcome <> 'rate_limited'`;
    return Number(row?.attempts ?? 0) >= limit.max;
  } catch (error) {
    // A failed count never blocks a real visitor's request.
    console.error("Rate limit check failed", error);
    return false;
  }
}
