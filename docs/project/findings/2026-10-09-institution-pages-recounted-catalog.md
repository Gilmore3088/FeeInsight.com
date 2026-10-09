# Every institution page recounted the whole catalog

**Found 2026-10-09.** The busiest query on prod (pg_stat_statements -6514715042018917249) was the
report rule check behind the peer rank on public `/institution/[id]` pages. It counted live headline
categories for every institution in the catalog to rank one. The peer rank is cached per id, so
crawlers walking distinct ids missed the cache: 485 calls in 35 minutes (about 830 an hour) at about
1,030 ms each, against a 289 ms mean at 01:34. The views it reads (`published_fee_catalog` and the
rate catalog) now carry per-row takedown checks and the `deep` institution filter, which the planner
does not push down to an institution or peer filter, so each call scans everything.

**Fix.** The coverage rows (about 3,500 institutions, about 110 KB) are read once into the public read
cache and the rule is counted in code for each page. The cache shares the `public-fee-reads` tag, so
publishes and takedowns refresh it as they refresh every other public read. The paid report's quote
check still reads coverage live.

**Lesson.** A per-id cache in front of a whole-catalog aggregate does nothing under crawler traffic.
Cache the aggregate itself and derive each id from it.
