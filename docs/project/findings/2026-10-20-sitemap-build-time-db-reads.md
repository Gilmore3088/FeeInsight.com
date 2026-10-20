# 2026-10-20: the sitemap read the database during `next build`

**What happened:** Vercel deployment `HkbSwt1XXthUuZHUTr3zYvK573Rm` (PR #1779, 2026-10-20 08:59
UTC) failed with "Failed to build /sitemap.xml/route ... after 3 attempts ... exiting the build".
The log shows "No server connection available in postgres backend, client being queued" and many
`ReadDeadlineError` (15000 ms) during static generation. `/methodology` and
`/research/data-sources` also hit the 60-second per-page limit on their first attempt and
recovered on retry.

**Cause:** `src/app/sitemap.ts` was `force-static` with `revalidate = 3600`, so Next prerendered
it at build time. It makes dozens of reads (institutions, freshness, reports, articles, category
and state counts, one city directory per state). Its build-time fallback only covered a read that
failed fast; reads queued behind a busy pool each waited out the 15-second deadline, the render
passed 60 seconds three times, and Next ended the build.

**Fix:** The sitemap is `force-dynamic`, so `next build` never renders it. The finished sitemap is
cached with `unstable_cache` for an hour; a stale copy is served while it refreshes in the
background, and a failed refresh keeps the last good copy. A sitemap built with any failed read is
returned but not cached, and with no cached copy and a failed institution read, the request gets
the database-free sitemap (static and taxonomy URLs) uncached.

`/methodology` and `/research/data-sources` still prerender at build and read the database. Each
read has a `.catch` fallback, so they do not fail a build on an error, but slow reads can still
push them past the 60-second limit. Not changed here; noted on Foundation tracker #1048.

**Lesson:** A page or route that reads the database must not be prerendered at build; render it
on request and cache the data, so the database's load never decides whether a deploy succeeds.

**Guard:** `src/app/sitemap-cache.test.ts` (render on request, one-hour cache, failed reads never
cached) and `src/app/sitemap-content.test.ts` ("renders on request, never during next build").
