# 2026-11-02: A fee from an old copy of a page stays live beside the current copy's read of the same line

**Lesson:** Two checks that each step aside for the other leave a gap that neither covers. The move
to the current copy skips a pair whose names differ. The current-copy takedown skips any fee whose
current copy has a verified row at the same category and amount, because the move is meant to handle
it. So a fee Knox read under another name on the new copy ("Overdraft charge" for "Overdraft Fee") is
judged by nobody, and both stay live.

**What happened:** James's live check on Nov 2 found Citizens Savings Bank (IA, institution 3416)
showing "Overdraft Fee" $25 (fee 12449, from the February 17 copy, document 1048) beside "Overdraft
charge" $25 (fee 16570, from the October 19 copy, document 38158, which superseded it). Both copies
have the same stored text. Both fees read the one sentence "An overdraft charge of $25.00 per
presentment with a maximum of $125.00 per day."

Prod, read-only, Nov 2:
- 7,035 live fees (6,720 flat dollar fees) still cite 2,364 superseded copies. Of the 6,720:
- 759 have a live fee of the same category and amount read from their current copy. Of those, 356
  (at 266 institutions, on 281 copies) also match its audience and product, and are not
  admin-corrected.
- 106 have a live fee of the same name at another amount on the current copy (re-priced).
- 3,282 have no match, although their current copy has live fees. On 2,573, the current copy has no
  live fee at all.
- By Knox read of the current copy: 1,164 fees sit on current copies with no stored text; 967 on texts
  Knox has never read under `extract.rules`; 4,500 on texts read at a version at least the fee's own
  (123 of them at v155, none at v156); 89 on texts read below the fee's version.
- 4,155 of those 4,500 have a Knox row at their amount on the current copy, so most stale-copy
  fees are still printed there. They are a re-read and re-point job, not a takedown.

**Fix:** Darwin's live re-check `src/lib/agents/darwin/stale-copy-check.ts`, behind
`STALE_COPY_RETIRE_LIVE` (off). It retires a twin: the current copy's own live read of the same line,
by the same name or the same row the old fee was read from, with no other row printing the old fee.
It retires a dropped fee only after Knox has read the current text at the current rules version and
the shared source check, Hamilton's layout guards and Knox's own rows all miss it on a recognizably
same schedule. Everything else stays live, counted by why.

**Still open:**
- The exact twin count comes from the first verify step's `stale_copy_check` detail. The 356 above
  is the SQL pre-filter, before the line comparison.
- Dropped fees wait on the Knox re-read of current copies (another PR queues it). Today's count at
  v156 is 0.
- Fees the current copy still prints but nobody re-points (the 4,155) are a Hamilton move, not this
  takedown. 1,391 of them (on 590 superseded copies) are the `previous_fee_published_id` of a publish
  attempt whose current-copy row Hamilton skipped as "Identical fee already published"
  (`decidePriorFee` in `hamilton/publish.ts`, kind `identical`). That attempt keeps the old copy's
  row live instead of moving it to the current copy. These fees are correct, but they cite the old
  copy. The fix is in publish: an identical row from a newer copy of the same page should re-point
  the live fee. It needs its own dry run, and this check leaves those fees as `stated`.

**Guard:** `src/lib/agents/darwin/stale-copy-check.test.ts`
