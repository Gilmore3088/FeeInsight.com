# 2026-10-19: non-v1 audit tasks outlived their request without retention

**What happened:** A read-only Oct 19 17:49:53 UTC snapshot grouped two aged active
ClientRead backends on the `api_route_audit_events` INSERT, with the oldest transaction
836 seconds old. This is evidence of a client-protocol wait, not proof of the exact
request owner or the complete cause of pool saturation.

**Cause:** #2321 records the concrete lifecycle defect in `withApiRoutePolicy`.
Successful and throwing handlers start the existing audit task, but only v1 policies
retained it with the existing Next `after` helper. Admin/public policies returned or
threw without that retention. The audit writer already awaits its SQL and logs errors.

**Fix:** Retain each existing success/error audit task through the same helper for all
policy surfaces. The write still starts once, and the response or original handler
error proceeds immediately. The 429 path still awaits its one audit; the cookieless
no-database path still skips the rate-limit and audit work. Policy/auth/rate-limit
behavior, SQL, existing error logging and the helper's outside-request fallback are
unchanged. No production session was terminated or database setting changed.

**Lesson:** Background bookkeeping needs an explicit serverless request lifetime even
when its promise has an error handler. A catch alone does not keep a function running.

**Guard:** `route-wrapper-retention.test.ts` exercises the actual existing helper's
Next `after` boundary for admin/public/v1 success, non-v1 failure, one awaited 429 audit,
and a cookieless early response. Existing route policy tests retain their assertions.
