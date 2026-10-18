# 2026-10-18: public API routes let an anonymous caller run database work cheaply

**What happened.** After the Oct 18 scrape exhausted the pool (`2026-10-18-institution-page-load.md`),
an audit of every route under `src/app/api/**`, `src/app/(public)/api/**` and the anonymous server
actions (prevention plan item 6) found five ways a caller with no account could make the database
work, or pull fee data in bulk, from code on `main` at 637acd431:

- `/api/institutions/[id]/evidence` needed no sign-in and returned one institution's every live fee,
  the pipeline's unpublished verified and raw rows, financials and peer ranking, in seven parallel
  reads (more than an instance's five pool connections). Walking ids 1..N pulled the cleaned
  database as JSON. Nothing in `src/` called it.
- `/api/institutions?q=` and `/api/locations?q=` put the typed term into a LIKE pattern unescaped.
  `q=%%` matched every row; for the institution autocomplete that also made its statistics CTE read
  the whole `published_fee_catalog` view. A punctuation-only term (`!!`) squashed to `%%` and did
  the same through the name-without-punctuation match. Neither capped the term's length, and
  `/api/locations` had no rate limit and no cache.
- `/api/health` counted `published_fee_catalog` on every call, and `/api/admin/job-health` (public,
  for uptime monitors) ran three queries at once on every call.
- Every route wrapped in `withApiRoutePolicy` writes one `api_route_audit_events` row per request.
  `/api/session` is asked once per page view by the site chrome, so every anonymous page view (a
  headless-Chrome crawler runs the JavaScript) cost an INSERT on the pool even with no session
  cookie.

**Fix.** One PR (`claude/public-route-caps`): the evidence route answers staff only (analyst or
admin); search terms are literal (`escapeLikePattern`) and bounded (`boundedSearchTerm`: 2+ letters
or digits, at most 100 characters, 64 for cities), with autocomplete rows capped at 25 and an edge
cache on both autocompletes; the health fee count is a cached public read and job health is cached
for 60 s; `/api/session` answers a cookieless request without a lookup or an audit row
(`answerWithoutDatabase` on the route wrapper).

**Not fixed here (proposals in the PR).** `/api/v1` counts a signed-in session caller without an
issued key by a hash of its IP (`getAnonymousId`), so a free account behind rotating proxies gets a
fresh 100-call monthly allowance per address; counting it by user id would close that. The
in-memory 60-a-minute limiter on `/api/institutions` is per serverless instance and per IP. The
whole site shares one database role and one `DATABASE_URL` (`src/lib/data-store/connection.ts`),
so a role-level `statement_timeout` also binds the agent pipeline.

**Lesson.** A public route that reads the database needs three bounds before it ships: who may call
it, how much one call may read (escaped, length-capped input and a row cap), and whether a repeat
call reaches the database at all (a cache).
