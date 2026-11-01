# 2026-10-25: bank income quarters worked out from year to date go wrong after a merger

**Lesson:** A bank's year-to-date line cannot be differenced into quarters without knowing about
mergers and year-to-date restarts. Where FDIC BankFind's quarter (already merger-adjusted) exists
and the differenced figure disagrees with it, show BankFind's quarter.

**What happened:** The #1925 check (2026-10-19) found 2 of 182 sampled bank quarters where FDIC
BankFind's quarterly service charges (ISERCHGQ) disagreed with the quarter worked out from the
filed year-to-date line RIAD4080 (#2025). The cause was left open; an amended filing was one
guess. Stored data settles it, with no outside fetch needed (read-only queries, 2026-10-25):

- U.S. Bank (institution 5, cert 6548) absorbed MUFG Union Bank (cert 22826) on 2023-05-26
  (`institution_structure_events`, FDIC history code 223/810). Filed YTD Q2 534,603 less Q1
  240,341 gives 294,262 ($K). BankFind's Q2 is 266,655. The gap, 27,607, is exactly Union
  Bank's own 2023-Q1 service charges in `institution_financial_records` (cert 22826).
- Horicon Bank (institution 712) absorbed Cornerstone Community Bank (cert 33137) on 2023-09-16.
  Its gap, 31, is exactly Cornerstone's 2023-Q1 + Q2 (16 + 15).

The survivor's year to date carries the absorbed bank's earlier quarters, and BankFind takes them
out of its quarter. Neither copy is an amended filing; the FDIC quarter is the standalone one.

Across every bank with both copies (4,203 banks, 58,707 quarters, 2023-Q1 to 2026-Q2):

- Service charges: 104 quarters at 87 banks disagree by more than $1K and 0.05%, 59 of them in the
  newest eight quarters (2024-Q3 on). 22 of the differenced quarters are negative.
- Revenue (RIAD4074 + RIAD4079, differenced, against NIMQ + NONIIQ): 147 quarters disagree, 99 of
  them in the newest eight quarters.
- Of the 99 Q2 to Q4 service-charge disagreements, 63 fall in a quarter where the bank absorbed
  another (FDIC history 810). The absorbed banks' earlier quarters explain 60 of those exactly.
  Of the other 36, 22 are negative differenced quarters. Institution 365 shows one cause, a year
  to date that restarts mid-year (YTD Q2 2,036, Q3 728; BankFind Q3 728); the rest were not
  traced one by one.

Hamilton's own revenue view reads BankFind's quarters (`src/lib/hamilton/workspace/revenue.ts`)
and was already right. The public institution page was not: its ledger
(`src/app/(public)/institution/[id]/quarterly-ledger.ts`) took the FFIEC-differenced line first,
so these quarters showed the inflated or negative figure.

**Cause:** the ledger differenced RIAD4080, RIAD4074 and RIAD4079 year to date for every quarter
and preferred the result over BankFind's quarter, with no view of mergers or restarts.

**Fix:** where a bank quarter has both copies and the differenced service charges or revenue
disagree with BankFind's quarter (more than $1K and 0.05%), both income lines for that quarter
come from BankFind (`differencedIncomeDisagrees`), so the fee share still divides within one
filing and the field note names ISERCHGQ and NIMQ + NONIIQ. Quarters where the copies agree keep
the FFIEC line and its citation. Balances (assets, deposits) are unchanged.

**Not fixed here:** institution 2923 (FDIC cert 8110) has FFIEC lines that belong to a different,
larger bank (total assets 145,235 vs BankFind's 56,438, $K, 2024-Q1), so its page mixes two
institutions. That is an identity-linking problem with its own root cause.

**Guard:** `src/app/(public)/institution/[id]/quarterly-ledger.test.ts`
