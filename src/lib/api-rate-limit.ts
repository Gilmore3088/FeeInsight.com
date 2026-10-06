import { sql } from "@/lib/data-store/connection";

const TIER_LIMITS: Record<string, number> = {
  free: 100,
  pro: 10_000,
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

async function reserveMonthlyRateLimit({
  routeId,
  organizationId,
  anonymousId,
  limit,
}: {
  routeId: string;
  organizationId: number | null;
  anonymousId: string | null;
  limit: number;
}): Promise<RateLimitResult> {
  const monthStart = getMonthStart();
  const reset = getMonthReset();
  const subject = getSubject(organizationId, anonymousId);
  const rows = await sql`
    INSERT INTO public.api_rate_limit_events
      (route_id, subject_type, subject_key, window_start, window_end,
       request_count, limit_count, event_type)
    VALUES
      (${routeId}, ${subject.subjectType}, ${subject.subjectKey},
       ${monthStart.toISOString()}, ${reset.toISOString()}, 1, ${limit}, 'reservation')
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
    return await reserveMonthlyRateLimit({
      routeId,
      organizationId,
      anonymousId,
      limit,
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
