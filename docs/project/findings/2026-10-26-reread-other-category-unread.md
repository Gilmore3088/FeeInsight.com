# 2026-10-26: Knox's other_category re-reads were left for Darwin, and no Darwin step read them

**What happened:** #1513 listed live fees under the wrong category. #2677 (Knox v120) fixed how
Knox reads two of them and said 128668 would move "on its next read". On Oct 26 (prod, read-only)
it had not: Knox's re-read pass read its line again at rules v124 as "Overdraft Transfer Fee (For
ATM and Debit Card transactions ONLY, when funds are available in your savings)" $1, under
od_protection_transfer, and 128668 was still live as a non-network ATM fee. The same was true of
85754 (First Interstate, "You will be assessed a" $10, live as account research; the line is its
"$10 Excess Withdrawal Fee") and 35970 (Ripco, a dormant-account sentence glued to the
"3x10x21” per year | $30.00" safe deposit box row, live as a dormant account fee; Ripco's dormant
fee is $10).

**Cause:** Knox's re-read pass (`knox/reread-feedback.ts`) settles a request whose proper read is
under another category as `other_category`, unresolved, "left for Darwin". No Darwin step read
those `knox_reread_resolved` rows. A full re-read of the bank does not fix the fee either: the new
read is a new raw row in the new category, and Hamilton supersedes a live fee only with a new price
in its own category, so the misfiled row stays live beside it. 11 live fees have ever settled
`other_category`; 9 of them were still live on Oct 26.

**Fix:** Darwin's live re-check `darwin/reread-category-check.ts` (check `darwin.reread_category`,
switch `REREAD_CATEGORY_RECHECK_LIVE`, **off**), run in every verify step. It reads each live fee
whose re-read settled `other_category` and still carries that request's fragment name, reads the
document's newest text with today's free team (no provider call), and:
- re-files it in place when exactly one proper read is on the line at its price in another
  category, no read keeps the live category, the guard and amount checks accept the name, and
  `checkFeeAgainstSource` traces it (`refile`);
- takes it down when another live fee of the bank already shows that line under the new category
  (`twin`);
- leaves an overdraft/NSF move alone (`convention_pending`), and every split, ambiguous or refused
  read.
Switched on, each move waits for the shared 12-hour second look, is guarded on the old category and
name, and logs the old values (`reread_category_refiled`) or rolls back with
`reread_category_twin: live fee #<twin>`.

**Dry run (Oct 26, prod read-only):** `REREAD_CATEGORY_ROWS_SQL` returned 9 live fees; each
document's newest text (8 texts, sha256 checked against `text_hash`) was read with
`findRereadCategoryMoves` on this branch.

| Outcome | Fees |
|---|---|
| refile | 2: 128668 atm_non_network to od_protection_transfer; 85754 account_research to excess_withdrawal ("Excess Withdrawal Fee") |
| twin (take down) | 1: 35970, twin 158740 "Safe Deposit Box 3x10x21” per year" $30 |
| convention_pending | 1: 60485 (overdraft; Knox reads "NSF fee", nsf) |
| split_read | 5: 80427, 80453, 81952, 128128, 149336 |

Each of the three movers was checked with `checkFeeAgainstSource` on its bank's stored text:
- 128668 (text 24713): "For ATM and Debit Card transactions ONLY, when funds are available in
  your savings, there will be a $1 Overdraft Transfer Fee."
- 85754 (text 14767): "You will be assessed a $10 Excess Withdrawal Fee for each transfer or
  withdrawal after six (6) of the following transaction types in a service charge cycle:"
- 35970 (text 5408): "months, shall be considered dormant, and a fee will be assessed on each
  share. | 3x10x21” per year | $30.00". The bank's dormant fee is the "Dormant Account (Per
  Month) | $10.00" row; $30 is the 3x10x21 box.

**Still open:** 60485 (Library of Congress FCU, doc 17951). The bank's Member Privilege FAQ calls
the $28 per paid item "our standard NSF fee" ("three paid items in one day will result in $84 in NSF
fees"). Knox's paid-item convention files a paid item as overdraft (its live category), but
Knox's priced noun phrase (v114) reads this line as nsf "NSF fee", and a raw row of that read
(1179952) went to Darwin on Oct 26. That is the paid-NSF convention question on #1513, so the check
leaves it. Ripco's box line is also live twice (85485 and 158740), a duplicate for the duplicate
checks.

**Lesson:** a hand-off is not a fix until the receiving step reads it. A read "left for" another
agent needs that agent's reader in the same PR, and "it moves on its next read" needs proof that a
new read replaces the live row.

**Agent lesson:** darwin/issue-1513-read-what-knox-left-for-you
**Guard:** `src/lib/agents/darwin/reread-category-check.test.ts`, `src/lib/agents/darwin/reread-category-check.db.test.ts`
