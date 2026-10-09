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
rejected rows. Selection order is by the raw row's creation time, so the backlog takes about
twelve verify steps of 100 before new rows lead again.

## Lesson

Every rejection that depends on a rule needs a version the rule carries, or the rule's fixes never
reach the rows they were written for.
