# 2026-11-02: where the 4,466 institutions without a live fee stop, and re-searches that stop short

**What happened:** On Nov 2, 4,466 of 8,516 active institutions (52%) had no fee in
`published_fee_catalog`. A read-only pass on prod placed each at the furthest pipeline stage it
reached (mutually exclusive, furthest first):

| Stage | Institutions | Top-500 by assets |
|---|---:|---:|
| No website on file | 503 | 13 |
| No fee link, no document fetched (discovery) | 1,491 | 16 |
| Link but no successful fetch | 13 | 1 |
| Fetched, Rosetta ruled every copy out (wrong document, failed) | 336 | 7 |
| Read, Knox found 0 fees | 98 | 3 |
| Knox fees, none sent to Darwin (held, or legacy rows only) | 385 | 11 |
| Darwin rejected every fee | 7 | 0 |
| Verified, fewer than 3 fee types (the catalog's bar) | 1,130 | 41 |
| Published, then rolled back or under 3 live types | 503 | 25 |

Inside discovery's 1,491: 668 no candidate found, 367 homepage refused us (HTTP 403 / bot wall),
253 every candidate refused, 174 homepage unreachable, 49 found then cleared, 21 never searched.
Across all no-live institutions, Knox held 5,173 raw rows at 1,173 of them as
`knox_review:unclassified` (the subject of #2888).

**Cause found (the fixable process bug):** the barren-link search (fix plan step 3) gives each
barren bank one search per version, and a search stops at the first page that passes the fee-page
check. The page that replaces the link must then list more fee lines than the old page. Of the 398
banks searched at v1, 112 stopped on a page that could not do that. For 70 of them the page was
the bank's own link under a print address, reached through the known-link finder. That finder runs
second, so the crawl, hub and path finders never ran for those banks. The re-search's "never accept
the link you replace" rule (#1326) compared addresses with their query string kept, so
`/checking/?print=1&output=amp` and `?hsLang=en` copies counted as new pages. Since Oct 14, 143
product-page, freshness and barren re-searches had stopped on the link under another spelling. In a
sample of 20 stopped barren searches (stored trail and text), all 20 stopped on a page unable to
replace the link, and 14 of the 20 on the link's own page.

**Fix:** `pageIdentity` (finders.ts) drops presentation and tracking parameters, and the re-search
compares the link it replaces by it. A barren search passes `replaceFeeLines`, so a page with no
more fee lines than the link's text is logged `not_more_fee_lines`, followed for its links, and the
search goes on. `BARREN_LINK_SEARCH_VERSION` 2 re-selects only the banks whose v1 search stopped
short (103 still qualify). Barren banks have no live fee, so no live fee changes.

**Not measured:** the session's network policy refused bank hosts, so no live page was fetched. At
v1, 40 of the 286 searches that ran to their end replaced the link (14%). That rate suggests about
15 of the 103 would get a better page, but it is a projection, not a count.

**Agent lesson:** magellan/coverage-2026-11-02-a-re-search-never-stops-on-a-page-that-cannot-replace

**Guard:** `src/lib/agents/magellan/finders.test.ts`, `src/lib/agents/magellan/discovery.test.ts`
