import { sql } from "@/lib/data-store/connection";
import { API_MONTHLY_CALLS, BURST_CALLS_PER_MINUTE } from "@/lib/api-subscriber-access";

export { BURST_CALLS_PER_MINUTE };

/** The per-minute count lives beside the monthly one, under its own route id. */
export const API_V1_BURST_ROUTE = "api.v1.burst";

const TIER_LIMITS: Record<string, number> = {
  free: 100,
  pro: API_MONTHLY_CALLS,
  enterprise: Infinity,
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  reset: Date;
  /** True when the reservation itself failed (database down), not when the allowance is used up. */
  unavailable?: boolean;
}

function getMonthReset(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function getMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

type RateLimitSubject = {
  subjectType: "organization" | "anonymous";
  subjectKey: string;
};

function getSubject(
  organizationId: number | null,
  anonymousId: string | null,
): RateLimitSubject {
  if (organizationId) {
    return { subjectType: "organization", subjectKey: String(organizationId) };
  }
  return { subjectType: "anonymous", subjectKey: anonymousId || "anonymous" };
}

/** The UTC minute holding `now`: its start and the start of the next minute. */
export function getMinuteWindow(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  return { start, end: new Date(start.getTime() + 60_000) };
}

/**
 * One reservation in a fixed window: the row for (route, subject, window start) counts up
 * until it reaches the limit, and a reservation past the limit returns no row.
 */
async function reserveWindow({
  routeId,
  organizationId,
  anonymousId,
  limit,
  windowStart,
  reset,
}: {
  routeId: string;
  organizationId: number | null;
  anonymousId: string | null;
  limit: number;
  windowStart: Date;
  reset: Date;
}): Promise<RateLimitResult> {
  const subject = getSubject(organizationId, anonymousId);
  const rows = await sql`
    INSERT INTO public.api_rate_limit_events
      (route_id, subject_type, subject_key, window_start, window_end,
       request_count, limit_count, event_type)
    VALUES
      (${routeId}, ${subject.subjectType}, ${subject.subjectKey},
       ${windowStart.toISOString()}, ${reset.toISOString()}, 1, ${limit}, 'reservation')
    ON CONFLICT (route_id, subject_type, subject_key, window_start)
    DO UPDATE
       SET request_count = public.api_rate_limit_events.request_count + 1,
           limit_count = ${limit},
           event_type = 'reservation',
           updated_at = NOW()
     WHERE public.api_rate_limit_events.request_count < ${limit}
    RETURNING request_count
  `;

  if (!rows[0]) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      reset,
    };
  }

  const used = Number(rows[0].request_count ?? limit);
  return {
    allowed: true,
    remaining: Math.max(0, limit - used),
    limit,
    reset,
  };
}

export async function checkRateLimit(
  organizationId: number | null,
  anonymousId: string | null
): Promise<RateLimitResult> {
  // Determine tier from caller context (set by api-auth before this runs)
  // Enterprise has no limit
  const tier = organizationId ? "pro" : "free";
  return checkRateLimitWithTier(organizationId, anonymousId, tier, "api.v1.default");
}

export async function checkRateLimitWithTier(
  organizationId: number | null,
  anonymousId: string | null,
  tier: string,
  routeId = "api.v1.default"
): Promise<RateLimitResult> {
  const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.free;

  if (limit === Infinity) {
    return { allowed: true, remaining: Infinity, limit: Infinity, reset: getMonthReset() };
  }

  try {
    return await reserveWindow({
      routeId,
      organizationId,
      anonymousId,
      limit,
      windowStart: getMonthStart(),
      reset: getMonthReset(),
    });
  } catch (error) {
    console.error("API rate-limit reservation failed", error);
    return {
      allowed: false,
      remaining: 0,
      limit,
      reset: getMonthReset(),
      unavailable: true,
    };
  }
}

/**
 * The per-minute burst limit, checked before the monthly reservation so a refused burst
 * does not use up monthly allowance. Enterprise keys are exempt. A failed reservation
 * (database down) fails closed, like the monthly one.
 */
export async function checkBurstLimitWithTier(
  organizationId: number | null,
  anonymousId: string | null,
  tier: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const { start, end } = getMinuteWindow(now);
  if ((TIER_LIMITS[tier] ?? TIER_LIMITS.free) === Infinity) {
    return { allowed: true, remaining: Infinity, limit: Infinity, reset: end };
  }

  try {
    return await reserveWindow({
      routeId: API_V1_BURST_ROUTE,
      organizationId,
      anonymousId,
      limit: BURST_CALLS_PER_MINUTE,
      windowStart: start,
      reset: end,
    });
  } catch (error) {
    console.error("API burst-limit reservation failed", error);
    return {
      allowed: false,
      remaining: 0,
      limit: BURST_CALLS_PER_MINUTE,
      reset: end,
      unavailable: true,
    };
  }
}
