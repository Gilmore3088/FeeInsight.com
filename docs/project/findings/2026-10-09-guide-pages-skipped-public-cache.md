# 2026-10-09: Guide pages read the catalog directly instead of the public cache
**What happened:** pg_stat_statements on prod, 02:49-02:51 UTC Oct 9: data freshness ran about 6 times a minute while the cached public snapshot ran about once a minute. The guide sidebar's cheapest/most-expensive pair ran about 280 times an hour (13,312 to 13,452 calls between 02:21 and 02:51).
**Cause:** `/guides/[slug]` called the uncached `getDataFreshness`, `getFeeCategoryDetail` and `getCheapestAndMostExpensive`. Each rebuild of a guide page (every takedown refreshes the public cache tag) ran its own catalog reads instead of sharing them with the fee pages.
**Fix:** this PR. Guides read the same cached reads as `/fees/[category]` (`public-cached-reads.ts`), on the same tag, so takedowns still show at once.
**Lesson:** a public page reads catalog aggregates through `public-cached-reads.ts`, never the uncached data-store functions.
