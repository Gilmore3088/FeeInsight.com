# 2026-10-26: a crawler walking the /fees explorer's filter links starved the institution pages

**Lesson:** A public page whose query string makes new views (filters, bars, searches, pages) is an
endless crawl space. If each view renders fresh, any crawler that follows links turns it into a
steady load, and on Vercel's shared instances that load slows every other page. Keep filter views
out of robots.txt and mark them noindex, nofollow, and keep a firewall rate limit on public data
routes, so a crawler that ignores robots.txt is stopped too.

**What happened:** from about 12:00 UTC on Oct 25, institution pages slowed from a ~4 s median
render to 8-19 s. Their optional reads (national, state and district index, sample report, peer
explorer, financial history and the rest) began missing the page's shared 15-second read budget
together, about 2,700 errors across the last six production deploys by Oct 26 02:30 UTC.

- The database was not the bottleneck. On Oct 26 at 02:40 UTC it had 6 active backends and no
  waits, and a primary-key read ran in 0.2 ms.
- Requests from one TLS fingerprint (`t13d1516h2_8daaf6152771_d8a2da3f94cd`, a headless Chrome
  in the same family as the Oct 18 scraper) went from none before 12:00 UTC to about 6,000 on
  `/fees`, 4,900 on `/fees/city/...` and 2,150 on `/institution/[id]` over the next 14 hours.
  Vercel did not identify it as a known bot.
- `/fees` is `force-dynamic`, so every hit was a cache MISS (about 22 a minute, steadily) and a
  full render: up to 5 s of CPU and about 1 GB peak memory on the instances that also render the
  institution pages.
- The Oct 18 rate-limit rule was never published, so the project had no firewall rule at all
  (the firewall config API returns 404).

**Fix:** robots.txt disallows `/fees?` (every filtered view; `/fees` and the guide pages stay
crawlable), and a filtered `/fees` view returns `noindex, nofollow`. A Vercel firewall rate limit
for crawlers that ignore robots.txt is a security setting, so it waits for James's yes.

**Still open:** `/fees` renders per request because it reads the session for one closing band, and
its per-view reads (`getFeeRowDetails`) are uncached. Making the explorer cacheable is the next
step, so even a crawler that obeys no rule costs a cache read.

**Guard:** `src/app/robots.test.ts`.
