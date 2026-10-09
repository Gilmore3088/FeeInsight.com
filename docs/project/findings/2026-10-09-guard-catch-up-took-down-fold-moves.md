# 2026-10-09: guard catch-up took down fees a fold was about to move
**What happened:** UAT failed PR 848 (fold v14, ATM adjustment to account research) at 07:22.
All six live "ATM Adjustment" fees (14754, 45585, 52348, 65855, 73610, 76825; $2 to $6) had
been rolled back at 06:43:15 by `category-guard-run-3322` with `category_guard:name_contradicts`,
eight minutes before 848 merged, so the fold never saw them.
**Cause:** PR 843 bumped the category guard to v57, which started the guard catch-up run over
every live fee. Guard v31 already rejects "adjustment" under atm_non_network, so the catch-up
took them down. The fold reads only live rows (and verified rows still verified), and the guard's
restore pass only brought a takedown back under the category it was taken down from.
**Fix:** PR 863. The guard's restore pass brings a category-guard takedown back under the
top-50 type its fold split gives it (`restoreTarget`), when that type's guard and price range
accept it, re-filed in place and logged to pipeline_feedback as a fold. 8 takedowns qualified.
**Lesson:** a guard bump re-judges every live fee; a fee whose right type is a fold split
should come back under that type, not stay down because the fold runs later or reads only live rows.
