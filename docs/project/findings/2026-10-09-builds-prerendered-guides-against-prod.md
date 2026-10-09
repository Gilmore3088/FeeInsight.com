# Every deploy prerendered the ten guides against the production database

**Found 2026-10-09.** The guide sidebar read (cheapest and most expensive institutions,
pg_stat_statements -6800940344903451725 and -4107950533437947272) kept running about 280 times an
hour each after PR 815 put it behind the public read cache. It came in bursts of exactly ten, one
per consumer guide, and the count of build-time slug lookups (`hasData`, -1613785227176979327)
rose by one per burst: 70 sidebar reads and 7 slug lookups from 05:10 to 05:26. Each deploy,
preview builds included, ran `generateStaticParams` and prerendered all ten guides with a cold
data cache, so the cache never helped.

**Fix.** `generateStaticParams` returns nothing, as `/reports/[slug]` already does. Each guide
renders on its first request, reads through the warm public cache, and is then served from the
ISR cache.

**Lesson.** A prerendered page's reads run once per build, and builds run per push on every
branch. Prerender only pages that read nothing from the database.
