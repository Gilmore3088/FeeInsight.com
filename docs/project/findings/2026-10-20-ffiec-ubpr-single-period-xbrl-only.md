# 2026-10-20: FFIEC serves the single-period UBPR ratio file only as XBRL
**What happened:** `ubpr-peer-groups` failed on every run. The Oct 20 pipeline audit counted 425
failed Hoovie runs against 813 completed in 30 days, mostly this source. #1934 (#1806) had added
diagnostics; they named the page but not the cause.
**Cause:** FFIEC answers a tab-delimited "UBPR Ratio -- Single Period" Download with its own form
page (product, period and TSV radio still selected, no message) for every quarter tried
(06/30/2026, 03/31/2026, 12/31/2025). The same request in XBRL downloads at once, and the same flow
downloads "Call Reports -- Single Period" tab-delimited, so the form handling is right. Read from a
Mac, not only production. The four-period UBPR products still download tab-delimited but list
years, not quarter dates, and their yearly ratio file has no peer-group number column (#2473).
**Fix:** this PR. The silent form answer is `missing: "format_not_served"`; the partition is
recorded empty with `detail.missing_source` (host, page, issue) and retried weekly, and the Hoovie
contract names the gap. Any HTML answer that carries a message still fails loudly. Reading the XBRL
file is the follow-up on #2473.
**Lesson:** when a publisher's page answers silently with itself, try the other formats and products
the page offers before concluding the form is wrong: the answer may be that the format was withdrawn.
