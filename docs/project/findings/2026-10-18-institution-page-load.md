# 2026-10-18: institution pages waited 300 seconds on a saturated connection pool

**What happened:** James's live check (Oct 18, about 06:30 to 07:45 UTC) saw every
`/institution/[id]` page and `/institutions` sit on the loading skeleton for minutes, and
`/institution/82` (WaFd) show "Application error: a client-side exception has occurred" (#1919).
Vercel runtime logs for production: 531 "Task timed out after 300 seconds" errors on deployment
`dpl_9DxitNuX` between 06:45 and 07:12, almost all on `/institution/<id>` (hundreds of different
ids, requested from many regions at once), plus `/fees/city/...`, `/api/admin/flow` and
`/api/admin/agents/tick`. From about 06:44 to 07:10 the logs repeat the pooler notice "No server
connection available in postgres backend, client being queued" on `/`, `/methodology`,
`/for-institutions`, `/institutions`, `/api/session` and many institution pages. Admin reads in
the same window hit `canceling statement due to statement timeout`. The timeouts stopped after the
07:08 and 07:10 deploys replaced the running instances. No render error was logged for any
institution page.

**Cause:** Supabase's transaction pooler had no free server connection, so it queued every
query. Nothing in the app bounded that wait. The institution page is fully dynamic (no cache)
and each render issues about 15 reads, starting with an existence check in its layout that runs
before anything streams. Each request therefore held its function until Vercel killed it at 300
seconds. A full page load showed nothing, a client-side navigation showed the loading skeleton,
and a response cut off after the root payload but before the page's metadata failed at the root
with `Error: Connection closed.`, which Next shows as "Application error". That last case was
reproduced by replaying WaFd's production HTML, cut at that point, in Chromium against a local
build of the same commit. The same replay of 41 complete institution pages (big banks, small
banks, credit unions, pages with and without fees, branches or call reports) hydrated with no
client error, so the WaFd page's data was not the cause.

**Fix:** #1919's PR gives each render one read deadline (`src/lib/read-deadline.ts`): the
institution layout's existence check (10 s), the page's metadata (8 s, then a plain noindex
title), the page (15 s; the institution and its fees are required, every other section falls
back to empty) and the directory (15 s). Past a deadline the public error boundary answers in
seconds. A root `global-error.tsx` replaces Next's bare "Application error" screen. Against a
local Postgres stand-in that accepts connections and never answers, `/institution/82` went from
no first byte after 60 s to the error screen in about 20 s.

**Lesson:** a page that reads the database on every request needs a deadline shorter than the
function limit, or a pool stall turns into minutes of skeleton and cut-off responses. What filled
the pool (a crawl of hundreds of institution pages while back-fill and admin queries ran) is not
fixed here: caching the institution pages (#1811) is what takes that load off the database.

**Guard:** `src/app/(public)/institution/[id]/page-deadline.test.tsx:131` (against a database that never answers, the layout's existence check gives up at its deadline; line 139 does the same for the institution read, so the error boundary answers)
