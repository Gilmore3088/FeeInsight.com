# 2026-11-02: Knox dropped clean name-and-price rows it had no name rule for, some with no trace (James's missing-fee review)
**What happened:** James's Nov 2 review of three institutions counted 32 fees printed on the bank's own
schedule with no live row: River City Bank GA (institution 2037, stored text 18568), Special Metals FCU
NY (5956, text 40204) and Mountain Star FCU TX (4467, text 36365). The ledger
(`missing-fees-2026-11-02.md` in the session scratchpad) put 22 of them on Rosetta's multi-column PDF
read of Mountain Star (another thread), 4 outside the taxonomy, and 6 on Knox: a clean row whose name no
rule filed.

**Cause 1 (Knox, `extract.table`):** `extractFromTableRows` ran `if (!hint) continue;`: a row whose name
classified as nothing was thrown away with no hold and no drop count. Special Metals prints its
schedule as name and price on alternating lines, which only the table pass reads, so "Late Loan Payment /
$15.00", "Protest Fee / $22.00", "Address Change - Failure to notify / $1.00" and "Check Payable to 3rd
Party / $1.00" left no record at all; the held-name relabel and the held-pile scorecards could not see
them.

**Cause 2 (Knox, rules pass):** `labelPriceRow` accepted only a bare price cell, so "Charged Back Checks |
$4.00 (returned deposit item – per item)" (River City) was dropped as `no_fee_word_not_table_row`
instead of held, because a short note followed the price.

**Cause 3 (Knox, name rules):** no rule named "late loan payment" (the late payment rule reads only "late
payment / charge / fee" with nothing between), "charged back checks", "image statement", "coin deposit",
"transaction copies", "reprint statements", "savings withdrawal fee" or "money market excess check",
although each has a type in the taxonomy.

**Fix (Knox v167, extract.table v12, category guard v107):** the table pass holds a clean row no rule
names as unclassified (`unclassifiedRowHold`: a short label and one price, none of the non-fee guards; a
row without "fee" or "charge" only in a fee schedule, as the rules pass does) and counts every other such
row (`table_row_no_category`; a row whose heading-composed category Darwin's checks refuse is held under
its own name when that names nothing, else counted as `table_row_guard_refused`); its holds are admitted after every other specialist so they never take a
place under the unclassified cap. A price cell with a short bracketed note that holds no other figure is
a label-and-price row (`priceOnlyCell`). The held-name vocabulary (tried after every other rule) files
the eight wordings under late_payment, deposited_item_return, check_image, coin_counting (a percentage
through `percent.ts`), document_reproduction and excess_withdrawal; guard v107 accepts the two it refused
(charged back, savings withdrawal / excess check).

**Left held on purpose:** a card's late payment (credit card fees, DECISIONS Oct 7); an instant-issue debit
card and a protest fee (the hand-keyed answer keys leave "INSTANT ISSUE DEBIT CARD | $7.00" and "Protest
Fees ... $15" unfiled, and each raised the gates' category errors: Texas 11 -> 12, NY 4 -> 6); a "CU
Check" and a bare "Wire Transfers" (both need a decision); "Address Change - Failure to notify" and "Check
Payable to 3rd Party" (no type). These are category questions for James.

**Measured (read-only, Nov 2):** current vs new Knox on the three banks' texts and 41 other prod stored
texts with these shapes (38 byte-identical to prod by md5; 3 transcribed with whitespace that differs):
12 reads and 2 coin deposit rates added, 0 renamed; every added read traces on its own line with
`checkFeeAgainstSource`. 3 reads are dropped, each a second read of a fee under a junk name whose plain read
stays (7808 "(if more than six preauthorized ...): Cashier’s Check Stop Payment Fee", 9195 "Only available
to a checking account holder with automatic: Safe Deposit Box Late Rental Payment", 20170 "(Fee charged if
denied ...): Returned Loan Payment"): `columnContinuations` ran the left column's lowercase wrap into the
next row even when that row named its own fee, and the new "transaction copy" name exposed it on 10782
("Share Draft account, or are under age 21: Transaction Copy"). A row of three or more cells that names its
own fee before its price now ends the join (`namesItsOwnFee`). A late loan payment whose name carries a
cap word ("Late Loan Payment max of $30", text 23093) states a ceiling, not the price, and is not read:
the limit guard reads only figures of $100 or more, so it could not catch a $30 cap. Of James's fees, the new code reads River City's Charged Back Checks $4 and
Image Statement Fee $2 and Special Metals' Late Loan Payment $15; Special Metals' Protest Fee, Address
Change, Check Payable to 3rd Party and Wire Transfers ($15; the heading above it, "ATM Withdrawals 4 per
month", had filed it as an ATM fee that Darwin's checks refuse, and the table pass then skipped it
silently too) are now held for review instead of vanishing; Mountain Star's Coin Deposit 5% and Daily Transaction
Copies stay unread on the stored text because Rosetta's merge splits their lines (on a clean line, "Coin
Deposit | 5% of total" reads as a 5% rate and "Daily Transaction Copies | $1.00/pg" as a $1 copy fee).
The answer-key gates do not move (Texas 586 right / 11 wrong, tuning 526 / 7; seven states 926 / 29).
Estimate of the held pile the new names would file: 73 deduplicated knox_review:unclassified rows
(institution, name, amount), 52 at institutions with no live fee of that type: late payment 30 (20),
coin counting 13 (11), document copies 11 (5), excess withdrawal 10 (9), check image 6 (6), deposited
item return 3 (1). Rows the table pass used to skip are not in that count: nothing recorded them.

**Live fees:** none taken down or re-filed. Guard v107 only accepts more (1 live name matches, 95269,
already deposited_item_return; none matches the excess words). The live correction paths read without the
vocabulary while `HELD_VOCABULARY_RELABEL_LIVE` is off, and the rules re-check (category and price) keeps
every key it kept: the one rename over the frozen texts, live 90350 "Coin Deposits: Bad Address Locator
Fee" $5 returned_mail, keeps its key.

**Lesson:** A row Knox cannot name is still a fee the bank prints: hold it (or count it) where every
scorecard can see it, never `continue` past it, and check the taxonomy for a home before leaving it held.

**Guard:** `src/lib/agents/knox/missing-fee-rows.test.ts`, `src/lib/agents/knox/held-name-vocabulary-admit.test.ts`

**Agent lesson:** knox/missing-fees-2026-11-02-unnamed-row-never-vanishes
