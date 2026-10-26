# 2026-10-26: the account type hold's releases were labelled as wrong-category verdicts
**What happened:** #1680. The account type hold (`hamilton/account-type-hold.ts`, #1100) puts a
guard-refused monthly fee back to verified, held out of the consumer category, when it passes every
check once its account words are set aside. It logged each such release in `pipeline_feedback` with
its takedown's label: signal `wrong`, kind `wrong_category`. A release undoes a refusal, so it is the
opposite judgement. #2594 (merged Oct 25) gave new releases their own label, `restored` /
`account_type_hold_released` (weight 0). Two things were still open:
- The 5 rows written on Oct 16 at 04:35:32 UTC still carry the old label on prod.
- Darwin's release review (`loadReviewLessons`) teaches its prompt that a `restored` row is "a check
  took it down by mistake; it is a real price in this category". It left the new kind out only
  because a release has no `fee_published_id` for its join, not by name. A release with a published id
  would have taught the review that a business account's fee is a real consumer monthly maintenance fee.

**Cause:** writers choose a label per row. The hold reused one label for two outcomes, and readers
of `signal = 'restored'` listed the record kinds they leave out one at a time (only
`business_schedule_restored`, #1671).

**Fix:**
- `RESTORE_RECORD_KINDS` (`learning/feedback.ts`) names the weight-0 restore records that are no
  verdict on a category: `business_schedule_restored` and `account_type_hold_released`. Darwin's
  release review leaves both out by kind, in its restore lessons and in the restores that cancel a
  category lesson.
- The existing typed feedback repair (`learning/account-type-hold-feedback.ts`, run by the
  `holdFeedback` publish sweep) has a second part. It relabels the hold's old release rows (dedupe
  `hamilton.account_type_hold:restored:<fee_verified_id>`, still `wrong` / `wrong_category`) to
  `restored` / `account_type_hold_released` and keeps the old pair in `evidence.relabeled_from`. Its
  switch `ACCOUNT_TYPE_HOLD_RELEASE_RELABEL_ON` is off: changing the rows is a production-data change,
  so James decides. Off, a dry run counts the rows (`release.due`, and `holdFeedback.relabel` in the
  sweep counts) and a real run reads nothing.

**Readers checked (Oct 26):** none counted the 5 rows as a lesson, because each one filters them out:
- Knox's lessons and label queue read only extract-stage rows.
- Darwin's category lessons read only the category guard's own checks.
- Deming's error fixes need a `fee_published_id`.
- Deming's error classes and the morning brief's unread count need weight above 0.
- The feedback sync's restore detection reads `hamilton.restore` rows.
- The admin Darwin panel counts rows by reporter only.

**Sibling writers checked:** no other writer gives a restore or release the `wrong` signal.
- These keep their wrong rows and their restores apart: Darwin's held release (`right` /
  `restored` / `wrong` by outcome), Knox's held recheck, the admin hold and correction, business
  schedule and the feedback sync.
- The source link records a re-source as `wrong` and a restore as `restored` under one kind,
  `missing_lineage`. Release review reads only its restore rows by signal, so that is by design.

**Scope (read-only, prod, Oct 26):**
- Check `hamilton.account_type_hold` has 787 `live` rows (`wrong` / `wrong_category`, weight 0,
  publish, correct) and exactly 5 old-label `restored` rows (fee_verified_id 4436, 5239, 6185, 9159,
  9166, no published id). A dry run of the relabel would change these 5.
- Across all checks, the rows whose signal is `wrong` and whose dedupe key or evidence names a
  restore or release are real wrong verdicts whose check name contains "release" or "restore":
  - `darwin.release` rejects: 653
  - `hamilton.rules_recheck_restore` second looks: 80
  - `darwin.release_repair` takedowns: 3

  The hold's 5 rows are the only mislabelled ones.
- Separate from this issue: the 1,432 #1100 sync rows (kind `account_type_hold`, weight 1) are still
  at weight 1, waiting on `ACCOUNT_TYPE_HOLD_FEEDBACK_REPAIR_ON`.

**Lesson:** a weight-0 restore record kind is named in every reader that treats `restored` as a lesson,
and rows written under an old label are relabelled through the typed repair behind an off switch,
never by hand.

**Guard:** `src/lib/agents/learning/account-type-hold-feedback.test.ts`,
`src/lib/agents/learning/account-type-hold-feedback.db.test.ts`,
`src/lib/agents/darwin/release-review.test.ts`. **Agent lesson:**
hamilton/issue-1680-record-kind-named-by-every-reader.
