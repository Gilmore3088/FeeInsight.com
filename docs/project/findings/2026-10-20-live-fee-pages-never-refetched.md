# 2026-10-20: the pages live fees come from are never fetched again once the bank's address moves
**What happened:** #1200 (Oct 13) found 38 banks whose live fees came from documents last checked
before July. On prod (read-only, Oct 20), 20 active banks' live fees (391) still cite only
documents last checked more than 90 days ago. Fifteen have a recent copy with the same text, so only
the lineage date is old. Five (Partner Colorado CU, Railway FCU, Bank of Ontario, Self-Reliance,
Synergy FCU; 108 live fees) are the same five flagged on Oct 13: their fees still come from February
and March documents. Counted by page: 101 pages that live fees cite (101 banks, 1,219 live fees) had
no successful copy in 30 days, 99 of them in 90.
**Cause:** Magellan's plain fetch asks for one address per bank (`profile.canonical_source_url ??
fee_schedule_url`, `magellan/fetch.ts`) and judges the bank due by its own last crawl. It never asks
which document the live fees cite. When the remembered address moved to another page, or the old
fee PDF answered 403 once in April (legacy crawler rows, never retried), the page the fees were read
from was never fetched again. Superseding works only within one address (`markCurrentCopy`), so the
old copy stayed current and no check saw it age: Deming's `stale` rate is catalog-wide (0.5% passes),
and Darwin's and Hamilton's re-checks compare the stored text with itself.
**Fix:** this PR. `magellan/live-source-refetch.ts` fetches, after the saved-link pass in each fetch
step, up to 10 pages live fees cite that no fetch has stored in 30 days, oldest first, as a side copy
under the page's own address, and retries a failure after 1, 3, 7 and then every 30 days. A copy with
the same bytes moves the cited documents' check date forward. Switched on: it fetches only pages live
fees already come from.
**Still open (on #1200):** Hamilton skips a fee found again on a newer document as "Identical fee
already published" and leaves the live fee citing the old document (`decidePriorFee`,
`hamilton/publish.ts`), so Synergy's newer schedule never took over; and its retired-document check
keys on `fee_schedule_url`, which can still name the old page.
**Lesson:** a freshness check has to start from what is live. Fetching "the bank's fee page" is not
the same as re-checking the pages the bank's live fees came from.

**Agent lesson:** magellan/issue-1200-refetch-live-fee-pages
