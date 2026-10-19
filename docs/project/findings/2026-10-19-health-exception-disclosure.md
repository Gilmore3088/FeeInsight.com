# 2026-10-19: Public health failures returned database exception text

**What happened:** The residual security audit found `GET /api/health` returning
`message: String(e)` when its database ping or cached live-fee-count read failed. The active
database-outage runbook also records a historical public 503 containing database
authentication/user exception text. This establishes an internal failure-message disclosure
path and documented historical response; it does not establish a plaintext password leak or
a current exploit. No production request was made for this change.

**Cause:** The handler used an arbitrary thrown value as public response content. Database
errors can carry infrastructure/query details, and coercing unusual values can itself throw.

**Fix:** Foundation issue [#2152](https://github.com/Gilmore3088/FeeInsight.com/issues/2152)
replaces both failure phases with a fixed
`503 {"status":"error","message":"Service temporarily unavailable"}`. The server diagnostic
is one fixed event with `database_ping` or `live_fee_count` and a machine code of 1–32 ASCII
uppercase letters/digits/underscores, otherwise `unknown`. It contains no arbitrary exception,
message, stack, cause, query or connection URI. A code getter/proxy or logger that throws cannot
change the generic failure response. No object/string coercion is used to inspect an error.

The public `api.health` route-policy wrapper, a one-row ping per request and the shared
`health-live-fee-count` cache remain unchanged. Successful 200 responses still return `status`,
numeric `fee_count` (including zero) and ISO `timestamp`; the aggregate retains the existing
one-hour ceiling/public-cache tag behavior. A failed ping remains unhealthy even with a cached
count. A failed count is not cached as a successful response. The Markdown and HTML outage
runbooks preserve their historical evidence and describe the new public/log contract.

Verification uses injected SQL, audit/rate-limit and Next cache boundaries while exercising the
real route-policy/public-cache wrappers. Tests cover both SQL phases, synthetic sensitive
exception contents, validated/invalid/oversized codes (including trailing control characters),
non-Error values, proxy/getter/toString traps, logging failure, cached count/ping behavior,
recovery and the success response. Shared cache/policy tests and repository gates accompany the
PR. No production database/network/provider request, credential/settings change or migration
is part of this work. Hamilton alert/incident gate #1921 and accuracy issues #1862/#2061 remain
outstanding; no additional checking or confirmation from James is introduced.

**Lesson:** A public health endpoint needs a stable failure contract. Keep operational details
in bounded server diagnostics and never serialize arbitrary exceptions into the response.
