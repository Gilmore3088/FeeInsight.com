# 2026-10-20: four ISR pages still read the database during `next build`

**What happened:** On #2483's preview build (2026-10-20 09:50 UTC), `/methodology`,
`/research/data-sources`, `/about` and `/for-institutions` hit Next's 60-second per-page limit
while the database was busy. They recovered on retry, but three failed attempts on one page end
the whole build, as the sitemap's did (`2026-10-20-sitemap-build-time-db-reads.md`, #2480).

**Cause:** All four are ISR pages (`revalidate`), so `next build` prerenders each once and its
reads run against the database at build time. Each read had a fallback for an error, but a read
queued behind a busy pool fails only when its own deadline passes, so a slow pool could still
push a render past 60 seconds.

**Fix:** The pages stay ISR, so visitors are still served a cached page. During `next build`
(`NEXT_PHASE` is `phase-production-build`) each page still tries its real reads, but
`readOnRequest` in `src/lib/build-phase.ts` races them against a 15-second deadline
(`BUILD_READ_DEADLINE_MS`, well under the 60-second page limit). A read in time gives the live
page, so a healthy database ships `/for-institutions` with its competitor board, market ladder,
price tester and sample report. A read that throws or passes the deadline gives the page's
failed-read fallback, which calls `shortenPageLife`: that build copy lives one minute and the
first request after the deploy regenerates it in the background from the cached public reads
(`cachedPublicRead`, which keeps the last good value). The losing read is not awaited; its result
and any later error are dropped, so it cannot hold the render or raise an unhandled rejection.
`/for-institutions` makes a second read that needs the first (the market ladder needs the
sample), so its ladder read gets only what is left of a 30-second page budget
(`BUILD_PAGE_BUDGET_MS`, `startBuildBudget`); a late ladder hides the ladder and shortens the
page's life. On request nothing changed. `/methodology` gained the explicit hourly `revalidate` and the
`shortenPageLife` call the other three already had. They did not become `force-dynamic`: the
homepage left per-request rendering because cached reads that missed made p75 TTFB 3.8 s (#1168).

A first version skipped the reads during the build entirely. Review blocked it: every deploy then
served the fallback to the first visitor of each page, which on `/for-institutions`, the main
conversion page, drops every live exhibit.

**Trade-off:** Only when the database is slow or down at build time, these pages show their
figures as unavailable for about a minute after the deploy, as they would after a failed read.
The build waits at most 15 seconds per page for it.

**Lesson:** A page that reads the database and is prerendered at build gives those reads a
deadline well under Next's page limit (`readOnRequest`) and renders its short-lived fallback past
it, or renders on request; the database's load must never decide whether a deploy succeeds.

**Guard:** `src/lib/build-phase.test.ts` (the deadline, a late or failing read gives the
fallback, a late rejection is dropped, the request path is unchanged) and
`src/app/build-time-reads.test.ts` (with `NEXT_PHASE` set to the build phase each page renders
live data from fast reads, and falls back and shortens its life when its reads never finish;
`/for-institutions` with a fast sample and a hung ladder read finishes within the page budget).
