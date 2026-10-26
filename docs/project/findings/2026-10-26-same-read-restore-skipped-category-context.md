# 2026-10-26: the rules re-check's same-read restore skipped the category guard's stored-text context
**What happened:** the rules re-check (`hamilton/rules-recheck.ts`) brings back a fee it took down
in three ways. Two of them ("newer_text", "restore_bar") go through the restore bar
(`disputedRestoreVerdict` in `hamilton/restore-guard.ts`), which since #2745 judges the category with
the fee's stored-text context (`restoreGuardContext`: a collection section, a safe deposit box
section, a bill payment the payee returned). The third, "same_read" (today's free Knox team reads the
fee again from its own unchanged text under the same name, category and price, and the name and price
trace there), restored on `checkFeeAgainstSource` alone. Its only category check was the one inside
the read (`passesDarwinChecks`), which calls `checkFeeCategory(key, name)` with no context. So an NSF
"Returned Items" $25 printed under a COLLECTIONS heading (BankUnited, doc 15894) is read again as NSF,
traces, and came back as NSF through same_read, although the restore bar, Darwin's verify and
Hamilton's live guard all refuse it there (#1912 follow-up to #2745).

same_read is not limited to takedowns whose cause was something other than the category: it covers
every row the re-check took down (`rolled_back_reason = rules_recheck_unreproduced`), whatever its
second look said. A late payment in a box section does not reach it today, because Knox reads that
row as a safe deposit box fee (its key differs), but an NSF row in a collection section or under a
payee note does.

**Cause:** #2745 put the stored-text context into the restore bar, and the restore bar is the shared
check for restores, but one restore branch never called it.

**Fix:** the restore bar's category step is its own function, `restoreCategoryVerdict` (the category
guard on the stored name with `restoreGuardContext`), and `disputedRestoreVerdict` and the same_read
branch both call it. A same_read fee it refuses stays down; the restore bar would refuse it on the
same step. The rest of the restore bar (Darwin's category model, its own row) is not added to
same_read, so an ordinary same-read fee still comes back as before. No data was changed.

**Dry run** (prod, read-only SELECTs, Oct 26): the rows same_read considers are taken-down rows the
re-check selects (`rolled_back_reason = 'rules_recheck_unreproduced'`, verified row rejected with that
flag, a free Knox read, a flat amount): 4,875, of which 3,430 still have their own text (the
`text_hash` they were read from is a completed `agent_source_texts` row), in 1,742 documents. Knox
v131 changed the free signature, so all 1,742 are due a re-check (one attempt at the new signature so
far). Those documents' 20,282 live and taken-down rows and their texts were exported and run through
`rollBackUnreproducedFees` as a dry run, before and after the fix, with Darwin's category model built
from `published_fee_catalog` (without the answer-key examples) and every document in one batch in
document order. Both runs propose the same 731 restores (705 same_read, 25 restore_bar, 1
newer_text): 0 restore verdicts change. Of the 705 same_read restores, 132 are NSF or late payments,
and the category step passes every one with its stored-text context. Of the 453 NSF and late payment
rows with their own text, 81 have collection, payee or box wording anywhere in their text and 36 of
those have a name the context readers look at; in the simulation none is read as printed in such a
section. So the fix closes a path, and moves no fee today. The 705 same_read restores are what the
re-check would bring back as it walks the v131 signature; they are the existing behaviour and are not
changed here.

**Lesson:** every path that brings a fee back live calls the same shared category step, with the same
stored-text context; a restore branch that skips it can bring a fee back under the category the other
paths refuse.

**Agent lesson:** hamilton/issue-1912-every-restore-path-checks-category
**Guard:** `src/lib/agents/hamilton/rules-recheck.test.ts`
