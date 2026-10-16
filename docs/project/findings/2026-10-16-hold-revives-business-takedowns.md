# The account type hold brought back business-schedule takedowns

**Found:** 2026-10-16, tracing First American Bank's monthly fees after the first hold runs (#1100).

The business-schedule rule (`hamilton/business-schedule.ts`) takes down a fee read from a business-only
schedule when the bank has a live consumer fee in the same category. `restoreBusinessScheduleTakedowns`
brings such a takedown back when the bank no longer has a live fee in that category. A "live fee"
there meant `rolled_back_at IS NULL`.

The account type hold (`hamilton/account-type-hold.ts`, first live Oct 16 04:35:32 UTC) takes down
non-checking accounts' monthly fees as `account_type_hold: <type> (#1100)`. Where the held fee was the
consumer fee a business takedown stood beside, the bank was left with no live consumer monthly fee,
and the restore brought the business fee back:

| Run | Time (UTC) | Restored | What happened next |
|---|---|---|---|
| 7160 | Oct 16 04:36:07 | 8 | 111877, 111878 and 57375 held again in the same step; 42961, 86536, 66721, 66722 and 135709 stayed live |
| 7249 | Oct 16 09:01:30 | 3 | First American Bank 111321, 111322 and 111353, held again in the same step |

Earlier restores (runs 6381 and 6902, Oct 14 and 15, 3 fees) came before the hold. The 6 older
fees live with `business_schedule_restored` (55007, 57376, 38155, 81001, 37350 and 140665) are NSF,
bill pay, cashier's check and lending fees. The hold only takes monthly maintenance fees, so it
cannot have brought them back. Their consumer fees came down for other reasons: a frequency hold,
a product-page takedown or the category guard. They are left as they are.

The restore event recorded only a count (`{restored, reason}`), and no feedback row was written, so
which fees had come back could only be found by matching verified-row flags against event times.

**Fix (this PR):**
- The restore counts a fee held by `account_type_hold:` as the consumer fee being present.
- Each restore's event lists `fee_published_ids`, and each restored fee gets a weight-0
  `pipeline_feedback` row: kind `business_schedule_restored`, signal `restored`, keyed per run.
- The same "a held fee counts as present" change goes into two other paths the hold can trigger:
  - the cross-page restore (`replacement_live` and its no-second-copy guard);
  - the same-line duplicate restore (its older line).

  Neither had a case on prod that day.
- Four of the revived fees are business fees by their bank's stored text. They come down through
  `hamilton/hand-takedowns.ts` under #1671: 42961, 86536, 66721 and 66722.
- 135709 is not a business fee. It is the consumer Money Market column of a dividend table, a fee
  the hold should take but cannot type. Filed as #1672.

**Left open:**
- The same-line restore also brings back a copy beside its older line's live replacement, 8 live
  pairs, not hold-related: #1673.
- The newer-copy and category-guard restores cannot be triggered by the hold. Their duplicate guards
  ignore a held twin, with 0 cases on prod: #1674 and #1675.

**Lesson:** a hold that takes fees down for a publish policy is not a sign the fee is gone. Every rule
that reads "no live fee here" as a reason to act has to decide whether a held fee counts.
