# 2026-10-15: a frequency fill and its own check undid each other on every pass, and the log showed one round
**What happened:** At 00:40 UTC `published_fee_catalog` showed overdraft fees 79931, 130684 and 140170 as
monthly. By 01:00 the same rows were blank, with no new `pipeline_feedback` row. Their feedback held a
single v11 `frequency_cleared` (Oct 14 00:10:39) and a single `frequency_filled` monthly (00:11:00).
Read-only SQL, prod.
**Cause:** The frequency fill filled the blank overdraft fee "Overdraft Trans. (After 3rd trans. per mo.)
| $5.00" with monthly from its own line. The next pass's v11 check (`perEventPeriodCheck`) cleared it as
an allowance, and the pass after that filled it again. The fill's guard against filling a period
(`perEventFrequency`, #1196) covered only NSF. Feedback rows are deduped by key (`fill:<id>`,
`fix:<id>:none`), so after the first round the loop wrote nothing to the ledger. The live value
depended on which step ran last.
**Fix:** #1339, frequency fill v13: the fill never writes to a blank a period that its own check would
clear or hold.
**Lesson:** When a fill and a check share a version, the fill must not write anything the check undoes.
Dedupe keys hide repeats, so to find a loop compare the live value at two reads, not the feedback
count.

**Agent lesson:** gutenberg/pr-1355-fill-fixed-point
