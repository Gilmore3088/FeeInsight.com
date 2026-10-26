# 2026-10-26: the restore bar judged a fee's category by its name alone
**What happened:** Darwin's verify step (`darwin/verify.ts`) and Hamilton's live category guard
(`hamilton/category-guard.ts`) read three facts from a fee's stored text before the category guard
judges it: an NSF return charge printed in a foreign check or collection section
(`collection_section`, guard v90), a bill pay return the bank notes was "returned by payee"
(`payee_returned`, v99), and a late charge printed in a safe deposit box section (`box_section`,
v87). Hamilton's restore bar (`disputedRestoreVerdict` in `hamilton/restore-guard.ts`), which every
restore path uses (rules re-check, lost re-check, page-copy, cross-page, restore re-check), called
`checkFeeCategory(key, name)` with no context. A held NSF fee whose stored line put it in a
collection section, or said the payee returned it, passed the restore bar's category step as NSF,
and could come back live under the category the other two paths refuse (#1912 review follow-up).

**Cause:** the text-based refusals were added to the paths that verify and keep fees live, but
not to the path that brings them back. The restore bar already had the stored text (it traces the
fee with `checkFeeAgainstSource(text, …)`); it only did not hand it to the category guard.

**Fix:** `restoreGuardContext` reads the three flags from the same text with the same functions
(`withCollectionSection`, `withBoxSection` from `fee-category-guard.ts`), and the restore bar passes
them to `checkFeeCategory`. Only those flags are passed, so no amount-based rule joins the bar. A
fee refused here is not restored; the restore paths have no re-file step, so it stays down for the
live guard's own re-file (`refileFromLine`). No data was changed.

**Dry run** (prod, read-only, Oct 26): the superset every restore path draws from, all held or
taken-down published rows filed as NSF (with a return or bill pay return name) or late payment
(named "late"), joined through their raw read to the newest completed `agent_source_texts` row of
their `source_document_id`. A SQL prefilter kept the 191 rows whose text prints the name within 10
lines below a collection heading (NSF), 14 below a box heading (late payment) or 3 above a payee
note (NSF); each was then judged both
ways on its full stored text. The category step flips for 67: 2 NSF (56558 and 109208, BankUnited,
doc 15894, `collection_section`) and 65 late payments (`box_section`). The full restore verdict
changes for none of them (0 of 67): the 65 late payments already fail the source trace
(`category_not_in_text`), and the two NSF rows already stop at Darwin's category model (nsf at
0.41, below 0.8), now at the category guard instead. The model was rebuilt from
`published_fee_catalog` without the answer-key examples. No held row has `payee_returned`: 85460,
the one live case, was re-filed to bill pay in place by v99. So the fix closes a path, and moves no
fee today.

**Lesson:** a path that brings a fee back live must judge it with the same stored-text context as
the paths that verify it and keep it live.

**Agent lesson:** hamilton/issue-1912-restore-reads-the-same-text
**Guard:** `src/lib/agents/hamilton/restore-guard.test.ts`
