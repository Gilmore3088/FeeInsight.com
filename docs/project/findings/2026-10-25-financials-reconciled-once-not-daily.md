# 2026-10-25: shown financials were checked against the filings once, never again

**Lesson:** A one-off audit says nothing about next quarter's load. A check of shown figures
against their source filings has to run on its own, record every run, and tell a difference with
a known cause (a merger, a restarted year to date, a definition) from one that needs a look.

**What happened:** The #1925 launch gate (Hamilton V5 plan, T3: "8-12 quarter reconciliation
against FFIEC and NCUA filings ... every displayed metric") was answered on 2026-10-19 by a single
read-only comparison of 25 institutions, posted as an issue comment. Nothing in the code repeated
it. A new quarter, a reloaded file or a mislinked institution could put a wrong figure on the
institution page or in Hamilton with no run to show it. The one comparison also had no way to tell
#2025's merger quarters from real errors, so they waited as an open question.

**Cause:** the check lived in a session, not in a typed module on the run ledger.

**Fix:** `deming-filings-reconcile` (`src/lib/agents/deming/filings-reconcile.ts`,
`FILINGS_RECONCILE_VERSION` v1), a read-only step in Atlas's daily scoreboard run after
`deming-source-health`. Each day it draws 150 banks and 150 credit unions (md5(id || date), so the
draw changes daily and covers the population over a few weeks) and compares, over the newest 12
quarter ends, what `institution_financial_records` shows with the stored filing lines in
`institution_call_report_items`: bank assets (RCFD/RCON2170), deposits (RCON2200), service charges
(RIAD4080) and revenue (RIAD4074 + RIAD4079) as quarters; credit-union fee income (ACCT_131),
overdraft (IS0048) and NSF (IS0049) income, year to date. Explained differences are counted apart:
merger quarters (FDIC history 810, #2025), quarters where an income line differences negative (a
restarted year to date), and foreign-office deposits. Assets more than 10% apart mark an identity
suspect. NCUA's zero overdraft and NSF lines that the loader stores as not reported are counted as
not reported. The summary names unexplained differences as an ALARM; the step detail keeps the
tallies, up to 25 mismatches and the shown figures with no stored filing line.

**First run, computed read-only on 2026-10-25** (the module's own comparison functions, fed the
rows its queries return for that day's draw): 10,077 of 10,122 figures match, 29 differ for a known
reason, 16 unexplained. Credit unions: all 1,786 fee-income figures and all 592 reported overdraft
and NSF figures match; 898 of each are NCUA zeros stored as not reported. Banks: assets 1,784 of
1,788, deposits 1,771 (14 foreign-office quarters at institutions 4 and 987), service charges
1,778 (7 explained: merger quarters at 4 banks, restarted years to date at 3), revenue 1,774 (8
explained). The 16 unexplained fall at three banks: institution 3541
(12, over 2024-Q3 to 2025-Q4), 744 (2, 2026-Q2) and 3519 (2, 2026-Q1). The bank items read took
1.9 s for the 150 banks (EXPLAIN ANALYZE).

**Not covered:** bank net income and ROA (RIAD4340 is not stored), and credit-union assets,
deposits, revenue and net income (ACCT_010, ACCT_018, the income totals and ACCT_661A are not
stored). The step lists them in its detail rather than counting them as matched.

**Guard:** `src/lib/agents/deming/filings-reconcile.test.ts`
