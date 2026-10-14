# A `not_in_source` rejection was final

**Date:** 2026-10-09. **Where:** `src/lib/agents/darwin/verify.ts` (`selectRawFees`).

## What happened

Darwin rejects a raw fee as `not_in_source` when the shared source check
(`checkFeeAgainstSource`) cannot trace the fee and its amount to the bank's stored schedule text.
The selection query skips every row this rule version has already decided, with two exceptions
that re-read a row once when the rule that stopped it changes: a `category_mismatch` under an
older guard version, and an `outside_envelope` hold today's envelope would take. `not_in_source`
had no such exception, so a fee the check could not read before a fix stayed rejected after it.

By 2026-10-09 prod held 1,126 such rejections at 499 banks, 70 of them overdraft or NSF fees. One
was Northern Trust's $25 "Overdrafts Paid and Items Paid against Nonsufficient Funds" (raw
457013), rejected at 07:12 UTC because its name wraps across five leader lines; Knox v62 (#861)
had taught the check wrapped leader names, and today's check passes it.

## Dry read before the re-select

131 of the 1,126 rows were read through today's check on their source lines (90 drawn at random,
41 from the 101 rows on leader-dot schedules, where #861's fix lands). 31 pass. The first 20
passers, checked by hand against the source line, were 20 right on amount and category; over all
31, one is wrong (raw 246460, "Bond return items" $35 filed as NSF, a returned-deposit item). The
other 100 still fail, mostly `name_not_in_text`, and would be rejected again. 135 of the 1,126 are
$0 rows the dry read could not window.

## Fix

Every decision now records `source_check_version` (`DARWIN_SOURCE_CHECK_VERSION`, 1). A
`not_in_source` rejection stamped lower, or not stamped, is selected once more; a row the check
still fails is stamped and rests. The constant is bumped when a source-check fix should reach
rejected rows. The wrong passer is kept out of this pass by a typed hold: a row whose filed
category matches a lesson in `DARWIN_CATEGORY_HOLDS` (here `nsf` with a bond-return name) is
decided `category_lesson_pending` (needs_review, no verified row, so Hamilton has nothing to
publish) and is read once more when `CATEGORY_GUARD_VERSION` rises, the `category_mismatch`
path. Darwin never re-files a row itself; the lesson (a returned bond or coupon is a returned
deposited item, not a customer NSF) went to Accuracy for the guard. Two verified rows with the
same lesson, "Bond/Coupon Returned Item Fee" $45 under `nsf` (raw 118545 and 277863, one bank),
are Accuracy's to re-file. Selection order is by the raw row's creation time, so the backlog
takes about twelve verify steps of 100 before new rows lead again.

## After the re-select ran (10:42 UTC)

UAT drew 20 of the first 36 rows the re-select verified and checked them by hand against the
source line: 16 right (first scored 14, re-scored at 10:59), below the 18-of-20 bar. The dry read above had checked amount and category
against the matched line; it had not asked whether a $0 reading was the fee at all. Three misses
were $0 readings of lines that price the fee when a condition is not met ("Bill Pay - FREE with
E-Statements and Debit Card | $6.95 per Month", 217716, live; "Monthly fee for balance of $500 &
over | FREE" with $5.00 on the next row, 233082, live; "$0 with $100 minimum daily balance OR
$2.50/month", 230322), one was a package list ("Includes: Bill Pay E-Statement...") verified into
the retired `estatement_fee` type (251150). Two more (250826 $10, 226547 $3) were first marked
wrong on amount; Accuracy found both amounts on the source one line below the name, and UAT
re-scored them right. Hamilton's publish-time rules would have taken the live $0 ones down after the fact;
nothing stopped them before verification.

Fix: `postSourceCheck` in `verify.ts` runs after the source check on the matched line and stops a
retired category (`retired_category`, rejected), a $0 whose own line or excerpt carries a price
(`conditional_zero`, needs_review) and any of Hamilton's name rules (`name_rule`, rejected). A
`verify.recheck` pass (`verified-recheck.ts`) reads every row v3 verified once under the same
checks: unpublished failures are rejected with a `darwin_recheck:` flag, live ones are archived in
the same step (rolled back with the reason, never deleted; James at 11:55 UTC: "stop waiting 12
hours. go") once UAT has passed 10 of them at 9/10; until then they are flagged. A dry read of the
27 live rows the re-select had verified by 12:00 UTC found 6 the first rule would take down, 3 of
them wrong: a neighbour's price in the same table row ("Monthly Maintenance | Free | Assisted
Phone Transactions* | $3") read as this fee's. The rule now reads the fee's own cell; 3 of 27 come
down (two conditional $0s and a two-fees line). The recheck never judges an amount; the shared
source check (Accuracy's `checkFeeAgainstSource`) stays the one amount check.

## After the recheck ran (11:25 to 12:19 UTC)

Version 1 of the recheck read 4,062 verified rows on prod: 15 unpublished rows rejected, 7 live
rows flagged `takedown_pending`, nothing rolled back (the switch is off). UAT checked the 10 rows
the rule would take down and found 7 right, below the 9-of-10 bar. The three misses were all the
same fault, a $ figure near the fee read as the price it falls back to: "Notary Fee | $0 - Members
$5 - Non-Members" (106172; $5 is the non-member price), "Monthly fee | $0 | $5* | $0" (fee verified
121229; the $5 is the next product's column) and "Monthly Service Charge: FREE Minimum Balance:
$1.00 | Monthly Balance Fee: $7.50" (122005; the $7.50 is another fee). Three more of version 1's
rejections were the same fault on comma lists and dot-leader runs (120921, 119878, 119879), and
one read an opening deposit as a price ("$1 minimum opening requirement", 119753).

Fix (version 2): `ownSegment` scores cells on the name's own words (a generic "fee" or "charge"
alone is no match), takes only the name cell when two price cells follow it (a comparison table),
and inside a cell of several "Label: value" pairs keeps the fee's own label; `conditionalZero`
drops non-member prices and opening deposits before it looks for a price. Version 2 re-reads every
row version 1 rejected or flagged: a row that passes now is restored (unpublished) or has its
pending flag cleared (live), through the typed recheck step. The dry read over the 27 live cohort
rows plus the 16 version 1 rows: 3 live rows still come down (106510 two fees on one line, 105790
and 105610 conditional $0s, all three UAT-right), 4 live flags clear (105793, 106232, 106233,
106172), and 119878, 119879, 120921, 121229, 122004, 122005 and 119753 are restored.

## Lesson

Every rejection that depends on a rule needs a version the rule carries, or the rule's fixes never
reach the rows they were written for.

A dry read proves the rule it runs; a hand check of what the rule verified is the only proof of
the verification. The first 20 verified rows get the hand check before the re-select keeps going.
