# Darwin learned from its own holdout misses

**Date:** 2026-10-09. **Where:** `src/lib/agents/darwin/verdict-score.ts`.

## What happened

The verdict score checks Darwin's category review and release review against 81 hand-keyed
schedules. 26 of the keys are `tuning` (used while writing rules) and 55 are `holdout` (never
used). Every miss, from either set, was written to `pipeline_feedback` as a `review_wrong`
lesson, and both reviews read their recent misses back into the prompt before the next call.
So a holdout miss corrected the review on that very fee, and the next verdict on it counted
toward the holdout hit rate. The Agentic OS baseline caught it: the holdout figure measured
fees the review had already been told about.

Before the fix, 29 holdout misses had been fed back (20 to the category review, 9 to the
release review). The only holdout chunks scored before any lesson existed are the category
review's v1 chunks of 2026-10-07 06:57 UTC: 20 right, 13 wrong (60.6%). Later figures
(category review v2 30/37, release review v10 8/12 and v11 7/12) were taken after holdout
lessons were in the prompt and are not a clean holdout number.

## Fix

- A holdout miss is still recorded (the measurement keeps every miss) but at weight 0 with
  `evidence.lesson = false`.
- `loadReviewMisses` skips any row whose `answer_key_set` is `holdout`, which also retires
  the 29 rows already stored without touching them.
- Each `verify.verdict_score` attempt now carries `detail.holdout.hit_rate` next to the
  pooled `hit_rate`, so the honest number is read straight from the attempt.

## Lesson

A held-out set is only held out if nothing downstream reads it. When a scorer and a learner
share a store, mark the rows by set at write time and filter at every read.
