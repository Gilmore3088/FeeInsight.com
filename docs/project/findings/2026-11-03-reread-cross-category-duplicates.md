# 2026-11-03: A re-read that files a line under a corrected category goes live beside the old fee

**Lesson:** A category is the extraction's reading of a line, not part of the line's identity. When a
later read of a page files a line under another category, the new row and the live fee are one printed
line read twice, and publish must replace the live fee, not add a second one. A later read is not proof
that the new category is right, so the replacement waits until the wrong re-reads are measured and fixed.

**What happened:** A dry-run scan of 482 re-read backlog texts (the texts Knox's backlog re-read reads
when `KNOX_REREAD_BACKLOG_LIVE` is on; dry runs rb to rb10, Nov 3) looked for rows the re-read would
publish next to a live fee of the same bank at the same price under another category with a similar
name. It found 58 pairs. 37 were one printed line read twice:

| Judged | Pairs | Example |
|---|---|---|
| The new category is right | 21 | Intercredit Bank #64789, "‐Late Payment Fee ..... $15.00" in the safe deposit box list, live as a loan late payment fee |
| The old category is right (Knox's re-read is wrong) | 5 | Parthenon FCU #99606 and Live Oak Banking #99611, #99612, "Returned Item Fee" on a returned deposited item list re-read as NSF; TXN Bank #141626 "Return Items"; Cornerstone Community FCU #128047 "Box Late Fee" re-read as a loan late fee |
| Overdraft or NSF on a line naming both (#1513, owner's decision) | 8 | Multi-States FCU #32093 "NSF/Overdraft/Reg D Fees" |
| Either category fits | 2 | New South CU #32351 "Certified Check/Cashier’s Check/Money Order" |
| Unclear | 1 | Peake FCU #33508 " Overdraft" |

The other 21 pairs were different fees at one price: check copies and statement copies ($3, Summit CU),
domestic and foreign incoming wires (First1Bank, $0; Bank of Botetourt, $15), a safe deposit box key and
a night-deposit key (Thomaston Savings Bank, $30), a check and an ACH return (Summit CU, $32), a copy of
a deposit item and of a deposit slip (Mega Bank, $2), consumer and business overdraft lines (Hingham
Institution for Savings, $45), and others. Only 2 of the 37 were covered by any Darwin re-check (the
section misread check's reasons). `darwin/reread-category-check.ts` judges only fees with a
`knox_reread_resolved` feedback row, and none of these had one.

**Cause:** Hamilton supersedes a live fee only inside its own category. `selectLivePublishedFees` reads
the live rows of the row's category, and `decidePriorFee` (`src/lib/agents/hamilton/publish.ts`)
compares only those, so a re-read under another category found no live line and was "new". The exact
and page-copy collapses, the same-line read (#1876) and the product split also need the same category.
Darwin's line conflict check (`darwin/line-conflict-check.ts`) needs the same name and source address,
and leaves a two-category line `undecided` unless the guard, a re-file rule or the category model
settles it.

**Fix:** `src/lib/agents/hamilton/reread-category-move.ts`, one rule (`rereadsLineInAnotherCategory`)
used by publish and by Darwin:

- Same institution, dollar amount and product; different categories.
- The same page: one document, or a copy of the same page (`samePageCopy`, as the product split reads
  it). A row from an older copy never replaces a fee from a newer one.
- The re-read gate: the live fee's raw row was written before the row's. A first read has no earlier read
  of its lines, and two rows from one Knox pass (Knox reading one line twice) are a Knox problem, never a
  replacement.
- The same stated line (`sameStatedLine`): the stored lines fold to the same words and figures ("$1" and
  "$1.00" alike), or one is the other with only priceless words around it (a heading glued in front, a
  neighbour's label after the price). The shorter and the longer line are each printed exactly once in
  the newer copy's stored text.
- The price is printed once on the line, unless both rows carry the same name ("Overdraft Protection (6)
  | $ 30 $ 30").
- One name's words are all in the other's (`namesShareReading`), and the frequencies do not differ.
- Never between overdraft and NSF when the line or a name names both (`combinedOverdraftNsfLine`: an
  overdraft word with NSF, insufficient funds or a returned item).

Publish supersedes the live fee with the re-read (`superseded by #<id>`; the amount is the same, so no
price change is recorded). Darwin's live re-check (`src/lib/agents/darwin/reread-category-move-check.ts`,
check `darwin.reread_category_move`, version 1) reads the pairs already live with the same rule and
takes the earlier read down as `same_line_duplicate: live fee #<later>`, after the shared second look.

**Why the switch is off:** the rule would also replace 4 of the 5 right live fees whose re-read is wrong
(#99606, #99611, #128047, #141626). Another change fixes those Knox reads; once a re-read keeps the live
category, the pair is a same-category pair and this rule never sees it. So `REREAD_CATEGORY_MOVE_LIVE`
stays false: publish and Darwin only count (`reread_category_move_check` in the publish step detail and
in Darwin's verify step detail). Gating to re-read rows only is structural, not a flag: a row with no
earlier read of its line on the same page cannot match.

**Results on the scan (judged against the full stored texts, and in
`src/lib/agents/hamilton/reread-category-move.test.ts` against windows of them):**

- New category right (21): 15 superseded (#31273, #35781, #36460, #37115, #43968, #55012, #63736, #64789,
  #94582, #109197, #120582, #124105, #131024, #137555, #143685). 6 left: #21527 and #21530 (the line is
  printed under two or three accounts, and the re-read also named the account), #119438 (the re-read also
  named a product, which is the product split's move), #129895 (the re-read is from another page address),
  #77750 (from an older page at another address), #146938 (the live fee's stored line, with its section
  heading glued on, is not printed in today's copy).
- Old category right (5): 4 would be superseded (above); #99612 is left (its line is printed three
  times).
- Overdraft/NSF combined (8): none moved.
- Either (2): both left: #32351 ("Certified Check/Cashier’s Check/Money Order $2" prices both items), #161632 (another page). Unclear (1): #33508 left (the live line was
  cut off at "per transfe").
- Different fees at one price (21): none paired.

**Live dry-run count (prod, read-only, Nov 3):** the candidate read (`REREAD_CATEGORY_MOVE_ROWS_SQL`'s
pairs: live dollar fees of one bank, amount and product under different categories, the earlier raw row
written first, one stored line inside the other) found 395 pairs. Narrowed by SQL to the rule's page,
newer-copy, printed-once, priceless-words and overdraft/NSF tests (139 pairs), and then judged by
`findRereadCategoryMoves` on those rows, 101 live fees at 96 institutions would have come down. The page and
printed-once tests ran as SQL ports of `samePageCopy` and `sameStatedLine`, not the TypeScript itself,
because no session here can run the step against prod; the first verify step with the check reports its
own count.

**Review of #2980 (Nov 3): one line can price two fees.** The independent review ran the rule over all 396
live pairs and found it would take down a right fee where one printed line prices an item of each category:
"Official Checks and Money Orders (up to $1,000) | $2.00" (#21097), "Money order/Cashier check fee | $8.00"
(#57717), "Money Orders and Corporate Checks | $3" (#74604), "Teller's checks/money order" (#76925),
"Purchase money orders and cashier's checks / Free" (#72813), "Copy Requests (checks, statements, deposited
items)" (#52322). The bank charges that price for both, so both categories stay live. And the overdraft/NSF
test missed a combined line that names its overdraft program ("NSF/Privilege Pay Fee | $25.00", #37509,
nsf to overdraft), saved today only because its text prints the line twice. Fixes: `lineNamesBothCategories`
reads the line's label part by part (split at "/", "and", "&", "or", commas and brackets) with Knox's
`classifyFeeText`, and leaves the pair when it names both categories; `overdraftNsfMove` never moves between
overdraft and NSF at all, as Darwin's `CONVENTION_PENDING` already does. The upper bound over the 396 pairs
(the TypeScript rule on the stored lines) fell from 121 to 94, and 24 of the 101 above drop out, leaving
77 live fees at 73 institutions (the 101 less those 24; the first verify step reports its own count). Ids:
13397, 14830, 15840, 16686, 17905, 18122, 20317, 23584, 24750, 25249, 25971, 26570, 27543, 27908, 28116, 30658, 30678, 33582, 34019, 34580, 35460, 35639, 37081, 37082, 37632, 37633, 37828, 38440, 41880, 44226, 44366, 44459, 50803, 52129, 53494, 55406, 55950, 56100, 56849, 59975, 65195, 66367, 67304, 69931, 76451, 80371, 80980, 83106, 83813, 86120, 86121, 90080, 94538, 96475, 99628, 101882, 104637, 104806, 104858, 108260, 108726, 111141, 111576, 113669, 113791, 114272, 114614, 127694, 129383, 132445, 137561, 139453, 139766, 143121, 143778, 144869, 161745.

Most are the loan taxonomy's two readings of one line (`loan_origination` and `other_lending_fee`,
"Loan Processing Fee", "Loan Modification Fee") and safe deposit box late fees live as loan late fees.
On a quick read of the names and lines, not checked against the bank's page, at least 10 look like the
later read is the wrong one: #143778 ("Stop payment of Credit Union Cashier’s Checks" re-filed as a
cashier's check), #161745 (a personal line of credit's overdraft fee re-filed as an account overdraft),
#58050 (an inactive account's monthly fee re-filed as monthly maintenance), #76451 (a balance-below fee
re-filed as monthly maintenance), #66367 (an international wire re-filed as domestic), #50803 (a check
copy re-filed as bill pay), #104858 (a monthly service charge re-filed as account research), #139453 (a
$10 card replacement re-filed as a rush order), #98236 (an overdraft paid-item fee re-filed as a
continuous overdraft fee) and #52129 (an official check re-filed as an outgoing wire). That is the same
lesson as the 5 wrong re-reads: the later read is not always right, so the switch needs a sampled
verdict on these before it goes on, and the wrong later reads go back to Knox as read fixes.

**Guard:** `src/lib/agents/hamilton/reread-category-move.test.ts` and `src/lib/agents/darwin/reread-category-move-check.test.ts`.
**Agent lesson:** hamilton/publish-reread-category-is-not-line-identity

**Status:** Shipped off. Next: Knox's fix for the 5 wrong re-reads, then a sample of the 77 live pairs;
turning `REREAD_CATEGORY_MOVE_LIVE` on is James's call on that dry run.
