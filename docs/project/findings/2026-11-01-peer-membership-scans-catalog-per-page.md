# 2026-11-01: the peer explorer's membership rule scanned the whole fee catalog on every institution page

**Lesson:** A per-institution query must not carry a catalog-wide subquery. Caching the page
does not help when a crawler visits each institution once, because every visit is a first
render. Read the catalog-wide part once as a shared cached list and pass it in, as #2694 did
for nearest peers.

**What happened:** after #2847 asked Amazonbot to stay off institution pages, first-time renders
still missed their 15-second read budget. On Nov 1 between 22:14 and 22:24 UTC, five
institution pages fell back on 7 to 14 optional sections each. Small single-row reads also
missed the budget: holding company, regulator info and enforcement actions. So the page's
connections were held up, not slow in themselves.

- **What held them.** `explorerMemberSql` (`src/lib/data-store/peer-explorer.ts`) put
  `s.id IN (SELECT DISTINCT institution_id FROM published_fee_catalog WHERE review_status = 'approved')`
  inside each peer query. `published_fee_catalog` is a view over the fee tiers, takedowns and
  corrections. On an idle database the subquery alone takes 0.93 s and touches about 990,000
  buffers, even for 5 ids.
- **How often.** Each first-time institution render runs it in `explorerMemberIds` (nearest, home
  metro and regulator sets) and in `getPeerExplorerSet`. Since the Oct 5 stats reset
  (`pg_stat_statements`):
  - the `s.id IN (WITH eligible ...)` form: 157,651 calls at 2.3 s on average;
  - the facts read: 147,204 calls at 2.1 s;
  - the older `EXISTS` form: 123,598 calls at 3.1 s.
- **Why it hurt the whole page.** Each server holds 5 database connections
  (`DATABASE_POOL_MAX`). A render makes about 20 reads, and a few of them each held a
  connection for 1-3 s. Every other read of that render, and of the renders sharing the server,
  waited in line.

**Fix:**
- `explorerMemberIds` and `getPeerExplorerSet` now keep only the ids in the cached
  fee-publishing list (`getFeePublishingInstitutionIds` in `peer-sets.ts`, the same SELECT,
  invalidated with the other public reads).
- Their queries apply only the active-institution rule.
- The membership is unchanged: an id counts when it publishes at least one approved fee.

**Guard:** `src/lib/data-store/peer-explorer.test.ts`:
- membership never sends `published_fee_catalog` to the database;
- an id list with no fee publisher makes no query.

`src/lib/data-store/public-peer-sets.test.ts` still checks that each set's count is the
explorer's.

**Still open:** the branch-deposit and credit-union branch reads behind market position
(76,632 calls at 2.2 s and 335,288 calls at 0.6 s) are per institution and come next.
