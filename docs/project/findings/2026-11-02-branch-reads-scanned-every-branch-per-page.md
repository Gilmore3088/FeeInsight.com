# 2026-11-02: two per-page branch reads scanned every branch row in the country

**Lesson:** A per-page query must reach its rows through an index. It must not compute a
catalog-wide total, or build a lookup over a whole table, just to use one slice of it. Put the
wide part in one shared cached read, and look up the page's own rows by key.

**What happened:** after #2849, the next slowest reads behind institution and city pages were
both over `institution_branch_deposits` (1.47 million rows). Figures are from `pg_stat_statements`
since the Oct 5 reset, read at 14:37 UTC on Nov 2.

- **The deposit and branch trend** (`loadDepositYears`, `src/lib/data-store/city-market.ts`):
  77,447 calls at 2.2 s on average. One query returned the area's yearly sums, plus the state's and
  the whole country's, so every call aggregated every branch row since ten years back.
- **A credit union's home metro** (`getHomeMarket`, `src/lib/data-store/peer-markets.ts`):
  346,561 calls at 0.57 s. To find the metro of each city where the credit union has a branch, it
  first built a city-to-metro list from every bank branch of the year (`DISTINCT ON`), then joined
  it to the credit union's handful of cities.

**Fix:**
- **The trend.** The state and national totals are one shared cached read
  (`deposit-totals-by-state-v1`: deposits and branches by year and state, about 560 rows). The
  area's own years come from the metro or the state-and-city index, and `combineDepositYears`
  joins the two. Checked on prod data, Tallahassee FL from 2016: the old and new results match
  on all 11 years. The area query now takes 13 ms for two Florida cities and 46 ms for the
  Washington metro.
- **The home metro.** Each branch city's metro is now looked up on its own, through the
  `(state, upper(city), year)` index (`LATERAL ... ORDER BY msa_code LIMIT 1`). This is the same
  choice as before: the lowest metro code for the city. For the credit union with the most
  branches (281 cities), it takes 40 ms instead of about 0.6 s, with the same top three metros.

**Guard:** `src/lib/data-store/city-market.test.ts`, `combineDepositYears`: the state and national
totals come from the shared rows, and a year with no area branches reads as zero, as before.

**Still open:** the state city directory (`getStateMarketCities`, cached per state, about 3.3 s on a
miss) still reads the published-fee catalog for its fee publishers. Re-measure page times after
deploy.
