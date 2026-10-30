# 2026-10-30: The escheat range shipped without a re-read, and missed escheat's legal name

**What happened:** The #2062 audit counted 8,685 `outside_range` rows that Darwin's verify wrote
against Knox reads (prod, read-only, Oct 30), 3,039 of them on fee names held under the same category
at 3 or more banks (#1110). Split by date and reason code, most of them are history:

- Returned mail, fax and photocopies (account_research, document_reproduction) were held from Oct 5 to
  Oct 10, almost all as `peer_outlier` (2,123 and 378 rows that week, 4 and 1 the week after). The
  account_research floor moved from $5 to $1 on Oct 9, returned mail got its own type on Oct 15, and
  the ungraded v1/v2 peer holds of Oct 5-10 stay held by design (DARWIN_PEER_GRADED_VERSIONS).
- The rows written since Oct 23 are mostly misreads the range is right to stop: balance minimums
  ("Minimum daily balance to avoid monthly fee ... $2500.00"), withdrawal limits ("ATM Withdrawal
  limit per day $700.00"), fee caps ("Daily Overdraft Maximum Fee $60.00").

The group still losing real fees is escheat processing under dormant_account:
- 603 escheat-named reads at 466 banks (`$33` to `$150`) are held as outside_envelope and sit inside
  the $1-$150 escheat range that shipped on Oct 22 (#2541). They were held before it, and nothing
  re-read them. At 458 of the 466 banks the amount stands on an escheat line of the bank's own stored
  text. Since Oct 23, 103 of 104 new escheat reads verified, so the range works for new reads.
- 129 reads at 97 banks name the same charge by its legal name: "Abandoned Property Fee | $50.00",
  "Abandoned Account Processing | $100.00", "Unclaimed Funds Fee $100". The escheat name pattern
  (`\bescheat`) never matched them, so the $1-$30 monthly dormant range held every one; none verified.
  In a check of 149 of them, 148 had the amount on the bank's own line, and the last had it on the
  next line ("Abandoned Property, per account or such lesser rate / as may be set by law ... $65.00").

**Cause:** Two gaps in one rule. Darwin's verify never selects a decided row again unless
`darwinStandingDecisionSql` names an exception for it. The category ranges have one (the account
research floor) and the box late fee range has one (#1912), but the escheat name range shipped
without one. And the name range read only one of the two names banks use for the charge.

**Fix:** Behind `ESCHEAT_HOLD_REREAD_LIVE` (off) in `src/lib/agents/darwin/envelopes.ts`:
- An abandoned or unclaimed property name (`ABANDONED_PROPERTY_NAME`, unless the name says it is
  charged by the month) takes the escheat range wherever the escheat name does: Darwin's verify, Knox's
  own check, the held-row release, Hamilton's publish range, the outlier rollback and its restore.
- Darwin's verify re-reads a dormant account fee held as outside_envelope whose escheat-processing name
  today's escheat range takes. The re-read runs the full verify (source check, peer check, guard), so
  it re-decides the fee rather than passing it.

**Dry run (prod, read-only, Oct 30), switch on:**
- 732 held rows would be re-read: 603 escheat (466 banks) and 129 abandoned/unclaimed (97 banks).
- 0 live fees are taken down. The 69 live abandoned-named dormant fees (68 banks) are all $1 to $30,
  inside both ranges.
- 5 rolled-back fees become restore candidates (published 136, 322, 325, 327, 5577). Each still passes
  the restore bar first: current copy, category step and source check.

**Lesson:** A range widened for a fee that Darwin has already held needs its re-read in the same
change (darwin/issue-1110-a-wider-range-needs-its-reread).
