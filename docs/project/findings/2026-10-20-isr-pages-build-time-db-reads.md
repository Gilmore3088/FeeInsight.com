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
(`NEXT_PHASE` is `phase-production-build`) each page skips its reads (`readOnRequest` in
`src/lib/build-phase.ts`) and renders its failed-read fallback, which calls `shortenPageLife`. The
build copy therefore lives one minute; the first request after a deploy is served that copy
while the page regenerates in the background from the cached public reads (`cachedPublicRead`,
which keeps the last good value). `/methodology` gained the explicit hourly `revalidate` and the
`shortenPageLife` call the other three already had. A local `next build` with no `DATABASE_URL`
lists the four as `○ ... 1m 1y` and logs no read from them. They did not become `force-dynamic`:
the homepage left per-request rendering because cached reads that missed made p75 TTFB 3.8 s
(#1168).

**Trade-off:** For about a minute after each deploy, until the first regeneration, these pages
show their figures as unavailable, as they would after a failed read.

**Lesson:** A page that reads the database and is prerendered at build must skip those reads
during the build (`readOnRequest`) or render on request; the database's load must never decide
whether a deploy succeeds.

**Guard:** `src/app/build-time-reads.test.ts` (each page makes no read with `NEXT_PHASE` set to
the build phase, shortens its life, and reads on request).
