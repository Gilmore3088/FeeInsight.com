# Magellan's hub and crawl finders accepted product pages as fee schedules (#1051)

**What happened.** 1,422 banks have only 1 or 2 verified fee categories. In the 7 days to
2026-10-20, 526 of them had a hub-page or site-crawl find logged 'ok'. 523 of those finds were a
page Magellan opened for its links and then accepted as the schedule itself, and 478 of the found
addresses are product pages. 351 of them were later rejected by Rosetta as "An account or product
page (N fee lines, no schedule title)". Those banks went back to Magellan, which found the same
kind of page again: 824 'ok' attempts in 7 days, and 177 banks were given two or more different
"found" product pages. About 35 more banks kept an address that redirects to a page Rosetta had
already rejected. Counted read-only on prod.

**Cause.**
- **The self-accept skipped the candidate check.** When a hub page or crawled page listed 3 or
  more fee lines, `findViaHubPages` and `findBySiteCrawl` accepted it through `pageIsFeeSchedule`
  (`magellan/finders.ts`). That function scored the whole HTML, nav and footer included, with
  no address. So it never ran the checks every candidate link goes through in
  `checkFeeCandidate` (`magellan/find-validate.ts`): the product-page rule (#1150), the
  business-only, rate-page, foreign, article and error-page checks, and the other-host check
  (#1033). A checking page quoting four fees passed.
- **Redirects slipped past the rejected list.** Rosetta records a rejection under the address it
  landed on. The finders compared only the address they asked for, so an alias that redirects to
  a rejected page passed and was saved again.

**Fix.**
- **One check for every page.** A page a finder opened is accepted as the schedule only if it
  also passes the candidate check (`checkOpenedFeePage`, the HTML half of `checkFeeCandidate`
  plus its address and host checks). A page that fails is still followed for its links, so the
  crawl moves on from a product page to its "Fees" link.
- **Redirects are checked.** The finders record where an address redirected to and never accept
  one that lands on a rejected page or on the link a re-search is replacing. Every candidate link
  (free finders, paid find, schedule search, second document) is now judged by the address it
  landed on, so "/fee-schedule" redirecting to a checking page is a product page.
- `discover.hub_pages` and `discover.site_crawl` are now version 2.
- No stored data changes. The 351 banks already sent back are pending and get the fixed finders
  on their next search.

**Guard:** `src/lib/agents/magellan/discovery.test.ts` ("#1051"):
- a product page with four fee lines that links to the schedule yields the schedule (fails on
  the old self-accept);
- an opened page or a candidate link that redirects to a ruled-out page is never accepted (each
  fails without its redirect check);
- `find-validate.test.ts`: a fee-schedule address that lands on a checking page is a product page.

**Lesson (Magellan).** A page Magellan opens for its links has to pass the same check as a link
before it is accepted as the schedule. A page listing a few fees is a product page until its
address and content prove it is the schedule, and Magellan judges a page by where it landed, not
by the address it asked for.
