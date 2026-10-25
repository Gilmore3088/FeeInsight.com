# 2026-10-25: BankFind and the FFIEC bulk file hold different versions of refiled call reports

**Lesson:** When two feeds of the same filing disagree, first ask whether they hold different
versions of it, and keep the filing's own last-updated time so the check can say which feed is
newer. Compare years to date before quarters, so one refiled quarter is not counted twice.

**What happened:** The first daily runs of `deming-filings-reconcile` (#1925, v1) left 16 figures
unexplained at three banks: institution 3541 (12, 2024-Q3 to 2025-Q4), 744 (2, 2026-Q2) and 3519
(2, 2026-Q1). A read-only trace (issue #1925, comment of 2026-10-25) found one cause for all 16:
for the same quarter, `institution_financial_records` (FDIC BankFind) and
`institution_call_report_items` (the FFIEC CDR bulk file) hold different versions of the bank's
call report. Every quarter where they disagree also differs on a balance-sheet or year-to-date
line, which points to a refiled or amended report, not a reading error. Bank-quarters whose assets
differ by more than 0.05% between the two feeds numbered 1 to 3 a quarter from 2023-Q1 to 2025-Q3
(of about 4,190), then 8 in 2025-Q4, 8 in 2026-Q1 and 18 in 2026-Q2 (the trace's counts).

Two of the 16 were not separate differences. 3541's 2025-Q4 year to date agrees in both feeds; its
quarter differs only because 2025-Q3's difference is carried into the subtraction. And 3519's
2026-Q2 was counted as explained by the "negative differenced line" rule (a restarted year to
date), though the negative figure came from 2026-Q1 differing between the feeds.

**Cause:** the FFIEC call-detail loader kept only the schedule files from the bulk zip and dropped
its POR file, the one place the file says when each bank's report for the quarter was last
submitted or amended ("Last Date/Time Submission Updated On"). With no such time stored, the
reconcile could not tell a refiling BankFind had not picked up yet from a real disagreement, and
it compared quarters without first comparing years to date.

**Fix:**
- Loader (`src/lib/agents/magellan/registry/ffiec-call-detail.ts`, parser v5;
  `readFfiecPor` in `src/lib/regulatory/ffiec.ts`): reads the POR file from the same zip and stores
  each bank's last-updated time for the quarter as one more row in `institution_call_report_items`:
  `item_key` `filing_last_updated`, `item_code` `POR_LAST_UPDATED`, schedule `POR`, value in epoch
  seconds (UTC; the filed clock time is read as US Eastern), unit `count` because the table's unit
  check allows no other fitting value. No migration. The row is left out of the line counts and
  value checks, is not in `FFIEC_CALL_ITEMS`, and `queryData` refuses it as a measure. Every other
  reader of the table filters by its own item keys.
- Reconcile (`src/lib/agents/deming/filings-reconcile.ts`, v2):
  - A bank quarter whose assets or year-to-date income disagree is a `filing_version_skew`. The
    mismatch names which feed holds the newer filing: `ffiec_newer` (POR time after the BankFind
    row's `fetched_at`), `bankfind_fetched_after_refiling`, or `unknown` (no POR time stored yet).
    It counts as explained only when FFIEC is newer and its refiling is less than 14 days old
    (`BANKFIND_LAG_DAYS`); otherwise it stays unexplained, with the class shown.
  - A quarter whose year to date agrees but whose prior quarter differs between the feeds is a
    `prior_quarter_knock_on`, explained only when that prior quarter is itself reported.
  - A negative differenced line no longer counts as explained when the prior quarter differs
    between the feeds.
  - The summary and the crew line say how many unexplained figures are version skews.

**What the 16 will read as, from the code (not yet measured on prod):** 3541's 2025-Q4 income
figures become knock-ons, explained because 2025-Q3 is reported (unless a differenced line there
is negative, in which case it stays unexplained). The other quarters (3541 2024-Q3, 2024-Q4 and
2025-Q3, 3519 2026-Q1, 744 2026-Q2) become version skews. Until the loader has re-read those
quarters, no POR time is stored, so each reads `unknown` and stays unexplained. The loader re-reads
current-year quarters every 7 days and older quarters every 180 days, so 3519's and 744's 2026
quarters get their POR times within a week of deploy, and 3541's 2024 and 2025 quarters later
unless their partitions are re-run sooner. 3519's 2026-Q2 moves from explained to unexplained.

**Not settled:** which feed Hamilton should show when the two disagree. That decision waits for
the stored POR times.

**Guard:** `src/lib/agents/deming/filings-reconcile.test.ts` (3541, 3519 and 744 cases),
`src/lib/regulatory/ffiec.test.ts` (POR parse),
`src/lib/agents/magellan/registry/public-data-loaders.test.ts` (POR row written apart from the
lines). Agent lessons: deming/issue-1925-filing-version-skew,
magellan/issue-1925-keep-filing-version-time.
