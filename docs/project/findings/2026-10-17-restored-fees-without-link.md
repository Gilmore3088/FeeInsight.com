# 2026-10-17: restored fees come back live with no source link

**What happened:** after the one-off source link repair (run 6508, Oct 15: 1,345 links filled,
13 fees taken down), `published_fee_catalog` still had 14 live fees with `document_url` NULL on
Oct 17 (read-only). All 14 are imported rows (`source = 'migration_v10'`). Each was down
(`source_check_untraceable:*`) when the repair ran, and the source check restored it between Oct 15
04:31 and Oct 16 08:35 UTC (`pipeline_feedback`, check `hamilton.restore`). 13 of them name a
document of their own institution that has a link; 1 (11764) names no document.

**Cause:** a fix that ran once by hand covers only the rows that were live at that moment. The
source check's restore clears `rolled_back_at` and never fills a link, and publish's own refusal
(`sourceLinkSkipReason`) does not see a restore, because a restored row is not published again.

**Fix:** this PR (`acct2/data-backlog-1`, #1342): `fillSourceLinks` runs the repair's fill in every
publish step, never a takedown. Dry run on Oct 17: 13 fills; 11764 stays live for the re-source
pass or the hand-started repair.

**Lesson:** when a repair is hand-started, check every path that can bring a row back live
(restores, re-reads, re-sources) and either run the repair's safe half on every step or make the
path itself keep the invariant.
