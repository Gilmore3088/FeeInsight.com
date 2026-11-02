# 2026-11-02: a live-fee page that redirects was counted as checked, and waited 30 days to fail again
**What happened:** On prod (read-only, Nov 2) 8,603 source documents sit behind live fees
(`published_fee_catalog.source_document_id`). Aged by `COALESCE(last_checked_at, crawled_at)`:
1,436 within 7 days, 6,572 at 7-30 days, 43 at 30-90 and 552 over 90 days; median 20 days, so
8,008 (93.1%) were checked within 30 days. The 552 over 90 days, by cause (each counted once,
in this order):

| Cause | Documents | Live fees | Banks |
|---|---:|---:|---:|
| Superseded: the page was fetched again, the bank's bytes changed, a newer copy is stored, and the live fees still cite the old copy | 461 | 1,183 | 451 |
| Page moved: the live-source pass fetched it on Oct 20, it redirected elsewhere, the copy was stored under the new address (42 new bytes, 21 bytes matching another stored copy) | 63 | 657 | 63 |
| Duplicate: the cited copy's bytes are kept under another row (14 of those rows are themselves superseded) | 20 | 220 | 18 |
| Never tried by the live-source pass: the bank's remembered address, left to the plain fetch, whose answers landed under a new address (Alva State Bank now answers from wisdomheritage.bank) | 6 | 74 | 6 |
| Other (answered from the same address, document not stamped) | 2 | 46 | 2 |

None were on inactive, offline, manual-review or correction-locked banks, none had a failing last
try (404, 403, timeout or bot wall), and every bank had a fetch attempt in October, so lane rotation
and fetch budget were not the cause.

**Cause:** the live-source pass (`magellan/live-source-refetch.ts`, #1200) judged a page answered by
the attempt's outcome alone. A redirect stores its copy under the final address (`fetch.ts`
`insertSourceDocument` writes `finalUrl`), so the page key never shows a fresh copy and the cited
document never moves; an "ok" then waited the 30-day answer wait and the next try would land the
same way, for good. The pass also skipped the bank's remembered address on the assumption that the
plain fetch re-checks it monthly, which fails when that address itself now redirects.

**Fix (this PR):** an answer counts only when it came from the page's own address; a redirect
elsewhere is a failed try on the 1, 3, 7, 30-day wait. After 3 failed tries in a row the fetch step
reports the page (`live_sources.unreachable`, with where it landed) so the bank's current page is
found again. The remembered address is re-checked here once the plain fetch has had an answer since its
newest copy and stored none under it. Live fees are not touched. On Nov 2 this makes 67 stale pages
(78 documents, 736 live fees) due where the old selection had 1. The goal scorecard now shows
`goal.source_documents_checked_30d`: documents behind live fees checked within 30 days, with the
stale ones that are not their page's current copy split out.

**Still open:** the superseded and duplicate rows (481 documents, 1,403 live fees) are not a fetch
problem: their pages were re-checked, but the fees did not move to the current copy. The cause
named on #1200 (Hamilton's `decidePriorFee` keeps the old live fee when the same fee is found on a
newer document) is Hamilton's half. Moved pages are reported, but nothing yet acts on the report.

**Lesson:** a re-check counts only when the bank answered from the address the fees cite; a redirect
is the page moving, not the page answering.

**Agent lesson:** magellan/freshness-redirect-is-not-an-answer
