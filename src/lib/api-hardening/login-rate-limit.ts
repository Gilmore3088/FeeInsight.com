import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { withTransaction } from "@/lib/data-store/connection";
import { getCookieSecret } from "@/lib/session-cookie";

export const LOGIN_IDENTIFIER_MAX_LENGTH = 320;
export const LOGIN_ATTEMPT_LIMITS = { identifier: 10, client: 50, windowMinutes: 15 } as const;
export const LOGIN_ATTEMPT_ROUTE = "action.login";
const RESERVATION_REASON = "login_attempt_reserved";
export type LoginAttemptReservation = "allowed" | "limited" | "unavailable";

/** Scope privacy and case/whitespace aliases share one allowance, including unknown accounts. */
export function loginLimitSubjects(identifier: string, requestHeaders: Pick<Headers, "get">) {
  if (identifier.length > LOGIN_IDENTIFIER_MAX_LENGTH || identifier.includes("\u0000")) throw new Error("Invalid login identifier");
  const normalized = identifier.trim().toLowerCase();
  if (!normalized || normalized.length > LOGIN_IDENTIFIER_MAX_LENGTH) throw new Error("Invalid login identifier");
  const hash = (kind: string, value: string) => createHmac("sha256", getCookieSecret())
    .update(`login-attempt-v1:${kind}:${value}`).digest("hex");
  const subjects: Array<{ key: string; max: number }> = [{ key: hash("identifier", normalized), max: LOGIN_ATTEMPT_LIMITS.identifier }];
  // Vercel overwrites x-forwarded-for; retain the application's first-IP / x-real-ip contract.
  // Treat malformed or absent client identity as unknown, keeping the identifier limit intact.
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const client = [forwarded, requestHeaders.get("x-real-ip")?.trim()]
    .find((value): value is string => Boolean(value && value.length <= 45 && isIP(value)));
  if (client) subjects.push({ key: hash("client", client.toLowerCase()), max: LOGIN_ATTEMPT_LIMITS.client });
  return subjects.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Commit the attempt before any password check or session write. Transaction-scoped locks
 * serialize overlapping identifier/client scopes across instances; the count runs AFTER the
 * locks in a separate READ COMMITTED statement, so it sees the preceding reservation.
 * Denied attempts do not extend the rolling window. No raw identifier or IP is persisted.
 */
export async function reserveLoginAttempt(
  identifier: string,
  requestHeaders: Pick<Headers, "get">,
  transact: typeof withTransaction = withTransaction,
): Promise<LoginAttemptReservation> {
  try {
    const subjects = loginLimitSubjects(identifier, requestHeaders);
    return await transact(async (tx) => {
      await tx`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`;
      await tx`SET LOCAL lock_timeout = '2s'`;
      await tx`SET LOCAL statement_timeout = '5s'`;
      // Consistent ordering avoids deadlocks when requests share different pairs of scopes.
      for (const subject of subjects) {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${subject.key}, 0))`;
      }
      const keys = subjects.map((subject) => subject.key);
      const counts = await tx<{ subject_key: string; attempts: number }[]>`
        SELECT subject_key, COUNT(*)::int AS attempts
          FROM api_route_audit_events
         WHERE route_id = ${LOGIN_ATTEMPT_ROUTE}
           AND reason_code = ${RESERVATION_REASON}
           AND subject_key = ANY(${keys}::text[])
           AND created_at > statement_timestamp() - make_interval(mins => ${LOGIN_ATTEMPT_LIMITS.windowMinutes})
         GROUP BY subject_key
      `;
      if (subjects.some((subject) => Number(counts.find((row) => row.subject_key === subject.key)?.attempts ?? 0) >= subject.max)) {
        return "limited";
      }
      const reserved = await tx<{ subject_key: string }[]>`
        INSERT INTO api_route_audit_events
          (route_id, method, path, surface, status_code, outcome, subject_key,
           auth_policy, rate_limit_policy, cost_policy, reason_code, metadata, created_at)
        SELECT ${LOGIN_ATTEMPT_ROUTE}, 'POST', '/login', 'auth', 202, 'success', subject_key,
               'public', 'account-login', 'none', ${RESERVATION_REASON}, '{}'::jsonb, statement_timestamp()
          FROM unnest(${keys}::text[]) AS subjects(subject_key)
        RETURNING subject_key
      `;
      if (reserved.length !== subjects.length) throw new Error("Login reservation was not stored");
      return "allowed";
    });
  } catch {
    // Enforcement is mandatory. Avoid logging database errors that can carry bound inputs.
    console.error("Login attempt reservation unavailable");
    return "unavailable";
  }
}
