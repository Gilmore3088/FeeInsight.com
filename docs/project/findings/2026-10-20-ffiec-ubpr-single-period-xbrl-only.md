# 2026-10-20: FFIEC serves the single-period UBPR ratio file only as XBRL
**What happened:** `ubpr-peer-groups` failed on every run. The Oct 20 pipeline audit counted 425
failed Hoovie runs against 813 completed in 30 days, mostly this source. #1934 (#1806) had added
diagnostics; they named the page but not the cause.
**Cause:** FFIEC answers a tab-delimited "UBPR Ratio -- Single Period" Download with its own form
page (the requested product and period still selected, no format checked, no message) for every quarter tried
(06/30/2026, 03/31/2026, 12/31/2025). The same request in XBRL downloads at once, and the same flow
downloads "Call Reports -- Single Period" tab-delimited, so the form handling is right. Read from a
Mac, not only production. The four-period UBPR products still download tab-delimited but list
years, not quarter dates, and their yearly ratio file has no peer-group number column (#2473).
**Fix:** #2474. Only that exact answer (the form, silent, holding the requested product and period,
offering XBRL) is `missing: "format_not_served"`; the partition is recorded empty with
`detail.missing_source` (host, page, issue) and retried weekly, and the Hoovie contract names the
gap. Any other HTML answer (a message, an error or timeout page, a form reset to its defaults) still
fails loudly. No parser version bump: failed quarters retry on their own schedule, and a bump would
re-run loaded quarters. Reading the XBRL file is the follow-up on #2473.
**Lesson:** when a publisher's page answers silently with itself, try the other formats and products
the page offers before concluding the form is wrong: the answer may be that the format was withdrawn.
**Guard:** `src/lib/agents/magellan/registry/ubpr-peer-groups.test.ts` ("names the withdrawn format
instead of failing when FFIEC answers with its own form, silent (#2473)" and "still fails loudly on
…"), `src/lib/agents/hoovie/source-health.test.ts` ("says how the host answers … (#2473)").
