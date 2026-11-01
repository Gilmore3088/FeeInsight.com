# 2026-10-26: a bill payment the payee returned went live as NSF
**What happened:** Bellco FCU's two-column fee schedule (document 15817) prints
"Wire Transfers – Domestic | Bill Pay Return Item Fee | $10.00" with
"(Free with Platinum Checking) | $20.00 | (per item returned by payee)" on the line below. Knox's
table pass read the first line only, filed "Bill Pay Return Item Fee" $10 as NSF by its "return item"
words, and it went live as fee 85460 (#1912). A payment the payee sends back is a bill pay service
charge. It is not the member's insufficient funds fee.

**Cause:** the note that says who returned the item sits on the next source line, outside the line
Knox's table pass and Darwin's re-check read. v127 already rebuilt the rules pass's row with the note
("Bill Pay Return Item Fee (per item returned by payee) | $10.00"), but the category list still filed
any "return item" name as NSF, and the table pass's read without the note was added as a second NSF
fee. The name alone cannot decide it: the Texas answer key files "Bill Payment Return Item Fee (per
presentment)" (tid 2419) as NSF, and most live "Bill Pay Return Item" rows print no note.

**Fix:** `custom-report/payee-returned-bill-pay.ts`. A bill pay return name with no NSF words is bill
pay when the name says the payee returned it (`BILL_PAY_RETURNED_BY_PAYEE`, Knox v131's category
list), or when its line, or the note wrapped onto the next line, says so (`payeeReturnedBillPayOnLine`).
A next-line note counts only when it is that line's last cell and the fee's name is the last name on
its own line, so a two-column page never lends one column's note to the other. Knox re-files any
specialist's NSF read this way (`payeeReturnedBillPayRead`). Guard v99 makes the same check on live
fees: `withCollectionSection` sets `payee_returned` from the stored text, NSF refuses the fee, and
`refileFromLine` moves it to bill_pay, in place on Hamilton's live guard unless the bank already has a
live bill pay fee at that price.

**Dry run** (prod, read-only SELECTs on `published_fee_catalog` and `agent_source_texts`, Oct 26):
3,964 live NSF fees. 20 are bill pay return names with no NSF words (20206, 37067, 37997, 52346,
60141, 67534, 85405, 85460, 100625, 107171, 109876, 110099, 116794, 125397, 125765, 131184, 134377,
137178, 138675, 159059). No live NSF name itself says the payee returned it. Only 85460's stored text
says "returned by payee", so 1 fee fails NSF and re-files to bill_pay in place (Bellco has no live
bill pay fee at $10). 0 fees are taken down; the other 19, tid 2419's own row among them (137178),
stay NSF. The Texas answer-key gates are unchanged.

**Lesson:** "return item" words do not make a fee NSF; read the whole row, including the note wrapped
onto the next line, for who returned the item.

**Agent lesson:** knox/issue-1912-payee-returned-bill-pay
**Guard:** `src/lib/custom-report/payee-returned-bill-pay.test.ts`, `src/lib/agents/knox/payee-returned-bill-pay.test.ts`
