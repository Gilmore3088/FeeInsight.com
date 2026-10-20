# 2026-10-12: fees caught after publishing

**What happened:** In the 7 days to 2026-10-12, 47,800 published fee records were taken down
(read-only query on `published_fee_records`, grouped by `rolled_back_reason`). 31,410 were
`refreshed by #…` (a newer copy replaced the same fee), 6,003 `rules_recheck_unreproduced`
(rule changes; 4,899 of those fees are live again under another row), 5,657 `duplicate of #…`,
and about 4,400 real errors: source check 1,352, category guard 892, product page 745, another
bank's document or an unconfirmed host 815, business-only 344, no category 243, not a fee 37.
Daily "published" counts (16,928 on Oct 10) therefore say little about how many fees were added.

**Cause:** The checks that catch wrong fees and duplicates run after publication, in Hamilton's
re-checks, instead of as a gate before it. A refresh writes a new row and rolls back the old one
instead of updating it.

**Fix:** Not yet. Tracked under the pipeline review master tracker
(#1037; `docs/plans/pipeline-review-2026-10-12.md`, finding 1): run the same checks before publishing,
refresh in place, and report wrong-after-publish as a trust number.

**Lesson:** Count fees added and fees taken down as wrong, never raw publishes. A check that runs
after publishing is a detector, not a gate.

**Agent lesson:** gutenberg/issue-1069, gutenberg/issue-1068
