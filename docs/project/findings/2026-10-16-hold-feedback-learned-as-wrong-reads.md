# A publish-policy takedown was logged as Knox and Darwin errors (2026-10-16)

**What happened.** The account type hold (#1566, #1100) took 712 live monthly maintenance fees down
with `rolled_back_reason = 'account_type_hold: <type> (#1100)'` on its first publish step. The
learning store's feedback sync (`learning/feedback-sync.ts`) treats every takedown reason it does not
list as a lesson against the read. It wrote 1,422 rows (kind `account_type_hold`, weight 1): one
`wrong` row about Knox's extract and one about Darwin's verdict for each fee. By 04:50 UTC there
were 1,428. The goal scorecard's "wrong after publish" also counted the reason as an error.

**Who read them.** As of main 00b1ef9e, no reader consumed them as a lesson:
- Knox lessons and the label queue read kinds `wrong_category`, `darwin_verified` and `answer_key`.
- Takedown lessons read `takedown_confirmed`.
- Calibration reads takedown reasons through `KNOX_FAULT_REASONS`.
- Darwin's readers filter by their own kinds or checks: release-review, category-model, verdict-score
  and verified-recheck.

The sync's restore step would have read them: a held fee brought back would have become a
`restored_after_takedown` lesson. None had been written yet.

**Structural point.** The sync skips policy takedowns by a deny list. Every new takedown reason that
is not a read error has to be added to that list, and to `HOUSEKEEPING_REASON_KEYS`, in the same PR
that introduces the reason.

**Fix.**
- The sync skips `account_type_hold:%`, both as a takedown and as a restore.
- The scorecard counts it as housekeeping.
- A step behind `ACCOUNT_TYPE_HOLD_FEEDBACK_REPAIR_ON` (off) sets the written rows to weight 0. Turning
  it on waits for James.
