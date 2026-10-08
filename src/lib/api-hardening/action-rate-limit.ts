import { headers } from "next/headers";
import { sql } from "@/lib/data-store/connection";
import { hashAuditSubject, recordApiRouteAuditEvent } from "./audit";
import type { ApiRoutePolicy } from "./policies";
import { RATE_LIMITS } from "./rate-limit";

/**
 * Server actions are not API routes, so they are not in API_ROUTE_POLICIES. Each limited
 * action has its own policy here; every attempt writes one api_route_audit_events row
 * (hashed client IP as subject_key) and the count of those rows is the limit, the same
 * durable counting the lead forms use.
 */
export const REGISTER_ACTION_POLICY: ApiRoutePolicy = {
  routeId: "action.register",
  routeTemplate: "/register",
  file: "src/app/(auth)/register/actions.ts",
  surface: "auth",
  allowedMethods: ["POST"],
  authRequirement: "public",
  rateLimitBucket: "account-register",
  costPolicy: "none",
  telemetryEvent: "action.register",
  failBehavior: "fail_open_audit_only",
  auditPriority: "medium",
};

export const PASSWORD_RESET_ACTION_POLICY: ApiRoutePolicy = {
  routeId: "action.password_reset",
  routeTemplate: "/forgot-password",
  file: "src/app/(auth)/forgot-password/actions.ts",
  surface: "auth",
  allowedMethods: ["POST"],
  authRequirement: "public",
  rateLimitBucket: "account-password-reset",
  costPolicy: "none",
  telemetryEvent: "action.password_reset",
  failBehavior: "fail_open_audit_only",
  auditPriority: "medium",
};

async function clientSubjectKey(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return hashAuditSubject(forwarded || h.get("x-real-ip")?.trim() || null);
}

/** Records this attempt and says whether it is over the limit. A failed count never blocks. */
export async function isServerActionRateLimited(policy: ApiRoutePolicy): Promise<boolean> {
  const limit = RATE_LIMITS[policy.rateLimitBucket];
  const subjectKey = await clientSubjectKey();
  if (!limit || !subjectKey) return false;
  let limited = false;
  try {
    const [row] = await sql<{ attempts: number }[]>`
      SELECT COUNT(*)::int AS attempts
      FROM api_route_audit_events
      WHERE route_id = ${policy.routeId}
        AND created_at > now() - make_interval(mins => ${limit.windowMinutes})
        AND subject_key = ${subjectKey}
        AND outcome <> 'rate_limited'`;
    limited = Number(row?.attempts ?? 0) >= limit.max;
  } catch (error) {
    console.error("Server action rate limit check failed", error);
  }
  await recordApiRouteAuditEvent({
    policy,
    subjectKey,
    method: "POST",
    path: policy.routeTemplate,
    outcome: limited ? "rate_limited" : "success",
    statusCode: limited ? 429 : 200,
  });
  return limited;
}
