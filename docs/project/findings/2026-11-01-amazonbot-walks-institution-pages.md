# 2026-11-01: Amazonbot's walk of uncached institution pages kept them past their read budget

**Lesson:** A verified crawler that spreads across many addresses gets past both Vercel's Attack
Challenge Mode (verified bots pass) and a per-IP rate limit. When a named crawler that sends no
search visitors walks the long tail of a costly page, name it in robots.txt. Remember that a named
group replaces the `*` group for that crawler, so it must repeat the shared disallows.

**What happened:** after the Oct 26 fixes (#2684, #2694), the institution page median render time
was about 5-6 s on Oct 26-27. Attack Challenge Mode lapsed on Oct 28, and the dashboard rate-limit
rule was never published. Unnamed crawlers returned, at up to 40k institution and `/fees` hits a day
on Oct 28-29, and the median rose to 10-15 s. By Nov 1 the unnamed ones had mostly stopped. The
steady load was then Amazonbot (JA4 `t13d450900_d524c25c267f_9da38b6fd1bc`): about 8,200 cache-MISS
institution renders that day, roughly 6 a minute. The median was still about 10 s, and pages missed
their 15 s read budget as late as 22:13 UTC.

**Fix:** `src/app/robots.ts` keeps Amazonbot off `/institution/` and repeats the shared disallows
for it. Attack Challenge Mode was turned back on for 24 hours for the unnamed crawlers.

**Still open:**
- A cold institution render must fit its budget under steady crawl load. Nothing outside our
  control should be able to slow it.
- The permanent rate-limit rule still has to be published in the Vercel dashboard (the API returns
  404 for this project).

**Guard:** `src/app/robots.test.ts` (Amazonbot is disallowed from `/institution/` and holds every
shared disallow).
