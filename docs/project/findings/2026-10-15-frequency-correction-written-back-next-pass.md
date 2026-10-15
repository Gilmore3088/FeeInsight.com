# 2026-10-15: a frequency fill v13 correction was written back by the next pass, and one write-back overwrote an old ledger row
**What happened:** After #1344 (frequency fill v13) deployed, its corrections landed at 01:30:40 UTC
(53797 monthly→per_item, 65200 monthly→daily, 76864 annual→per_item, 103686 annual→daily, 128934
daily→per_item, 124039 daily→per_item, 87587 monthly→daily). At 01:32:41 a second v13 pass wrote five
of them back to the old period. 124039 also went back to daily but had no v13 row for it. At 01:44, 6
live rows still broke the per-item rule. Clears to blank held, and the live and verified rows agreed
throughout. Read-only SQL on `pipeline_feedback` and the fee tiers.
**Cause:** The fill's per-event check (`perEventPeriodCheck`, `continuousOverdraftPeriodCheck`) acts only
on a stored period. On the next pass the corrected row (per_item or daily) skipped the check and went
down the generic `settledFrequency` path, which read the old period off the same line ("Dormant Account
Fee (per month)", "Cap Monthly", "Annual Rent") and wrote it back. #1344 guarded only blanks against
this. 124039's write-back used the dedupe key `fix:124039:daily`, which already existed from v10.
`recordFeedback` upserts on that key, so the v10 row was overwritten (new evidence and run id,
`about_version` still 10) instead of a v13 row being added. The two-pass test that would have caught
this was not written: #1344's tests ran each rule once.
**Fix:** #1339, frequency fill v14 (this PR):
- Every value the fill writes must be one its own check keeps.
- Feedback keys carry the version and the from value.
- A regression test runs the fill twice on these rows' real lines.
**Lesson:**
- A fill that corrects must be idempotent: test it by running a second pass on its own output.
- A ledger keyed without a version is not a history, because an upsert on an old key rewrites it.
