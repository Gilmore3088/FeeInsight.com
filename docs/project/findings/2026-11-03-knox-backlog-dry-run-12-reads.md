# 2026-11-03: The twelfth re-read backlog dry run found rows read apart from the row they belong to

**What happened:** after Knox v180 fixed the eleventh dry run (`2026-11-03-knox-backlog-dry-run-11-reads.md`),
a twelfth read-only dry run for `KNOX_REREAD_BACKLOG_LIVE` took 40 more backlog texts (rb12) at Knox v180 (main
713cf507e89) and compared every changed read with the bank's own line. Of 72 changed rows on 20 texts, 2 were wrong
and 7 doubtful; no correct live fee would have been lost or replaced. rb11's fixes stayed fixed.

- Wrong. St. Louis Community FCU (text 3810, line 56): "Savings accounts | • Corporate Check | $15.00" sits in the
  right column under "Stop Payment Fee – Check or ACH (per item): | $20.00" and "Check series | $25.00". It was
  filed cashiers_check; it is the stop payment on a corporate check.
- Wrong. ESL FCU (text 20267): the card "Fee TypeReturned Item Fee" / "DescriptionFor each item you deposit or cash
  that is returned unpaid. ..." / "Fee$10.00" was filed nsf; it is the deposited item return.
- Doubtful, fixed. First Bank & Trust Co. (text 12416): OCR letters on the dot leaders went into names ("Paid Item
  Charge c", "Sweep Transfer Fee iii iiieeeeeeaeeeeeaaeaeeaaaaaaa", three wire names). "Paid Item Charge c" would have
  published beside live #107178 ("Overdraft Privilege (ODP) Paid Item Charge", $30, same copy, doc 16904).
- Doubtful, fixed. San Francisco FCU (text 33150): "Maintenance Fee | $5.00/month" traced to line 12, "deposit and
  maintain at least a $5 (par value of a share) ...".
- Doubtful, kept. Synergy FCU (text 9089): "Returned Check Fee - Same Party Check | $25.00" stays nsf. The page
  prints it beside "Returned Check Fee - Third Party Check | $5.00" and never says the check was deposited, and
  banks use "same party" and "two-party" for both the member's own check and a check the member deposits. Live
  #50808 is this fee as nsf, and 7 other live "same/second/two-party" returns are nsf while 40 "third party" ones
  are deposited item returns (Nov 3, SELECT).
- Doubtful, noted. St. Louis's "Enhanced Overdraft Privilege Fee (per month) | $5.00" is a monthly charge for an
  overdraft program, not a per-item overdraft fee. No type of the 50 fits it: overdraft is the paid item's price.
  Knox's `periodic_program` hold (#2240) is the existing home for a program's periodic price, but it is read only
  for an annual program price on a stacked page today; extending it to a monthly program fee needs its own review.
- Not changed: First Heritage Bank's two $0 rows (text 30132) and the Zelle → bill_pay fold, which is by design.

**Why (root cause):**

- St. Louis: `stopPaymentListRead` takes only an unpriced heading as a bullet list's parent, and reads only lines
  that open with a bullet; here the parent prints its own price and the list is the page's last column. Alone,
  "Corporate Check" hits the cashier's-check rule.
- ESL: the fee card join (`joinLabeledFeeCardText`) keeps the card's name and price and drops its description, so
  "Returned Item Fee" was read by name alone.
- First Bank & Trust: the scan put noise letters on the leaders, and the name readers kept any word before the price.
- San Francisco: "maint" reads in "maintain", so both lines carry the name's one stem, and on a tie the source check
  kept the first line.

**Fix (Knox v181):**

- `custom-report/stop-payment-variant.ts`: a bulleted variant (`STOP_PAYMENT_VARIANT`: checks, check series,
  corporate or official checks, drafts, money orders, ACH, debits, items) that is the last label of its line at the
  line's last price. Walking up the last label of each line above, past other variants, it must reach a stop payment label
  that prints its own price, is not bulleted itself and introduces its list with a colon. A label naming anything
  else ends the walk. Knox (`stopPaymentVariantRead`) files the read as that stop payment, named "<label>: <variant>",
  and the source check admits that composed name at that row only (admit-only).
- `source-check.ts` `labeledFeeCardDescription` and Knox `depositedCardReturnRead`: an NSF read from a fee card
  whose own description says the member deposited or cashed the returned item is the deposited item return; a card
  about the member's own check ("a check you write ... your account does not have enough funds") stays NSF.
- Knox `withoutOcrLeaderNoise` (`knox/ocr-leader-noise.ts`): a run of single letters or of a few repeated letters on
  a dot leader is blanked before any reader runs; a run with a real word ("free", "see below") is kept. Review of
  #2979: the checks that look for a read's stored line in a text (`zeroPrintedForRead`, `audienceRowLineCount`,
  `audienceSectionHeading`, `conditionalFreeRow`) blank both the line and the text first (`ocrComparable`), so a line
  stored before v181 (with its noise) and one stored since find the same row of the raw or the cleaned text.
- Darwin's section misread check v4 (`darwin/section-misread-check.ts`, switch off): the live re-check of the two
  re-filing rules, on the text Knox read with the same shared functions. `stop_payment_variant`: a live fee not filed
  as stop_payment that `stopPaymentVariantFor` reads as a stop payment variant at its own price, its stored line on
  the variant's row (cell bars aside). `deposited_card_return`: a live NSF fee whose labeled fee card's description
  (`labeledFeeCardDescription`, via `depositedCardReturnRead`) says the member deposited or cashed the item. Darwin's
  re-read category check (`reread-category-check.ts`) does not cover these: it judges only fees with a Knox re-read
  request settled other_category, and #40324 and #68629 have none.
- `source-check.ts` `statedLineScore`: on a stem tie, a priced fee's line is the one whose label prints the whole
  name word for word (a footnote digit glued to a word aside), then one whose label opens with the name's first word
  (past a row number); two rows that score alike keep the first, as before. Review of #2979: opening with the first
  word alone sent "Incoming Wire Fee" $10 (text 3219) to "Incoming Wire Return Fee • $10 per request". A $0 is left as it
  was: which line a free price traces to decides Darwin's conditional $0 hold (#1593), and applying the rule to a $0
  changed that check's verdict in `darwin/verify.test.ts` (the students' $0 row).

**Live:**

- Harnesses rb to rb12 (v180 vs v181): live fees not reproduced 456 to 456; no right read lost. The source check's
  line changes for 74 reads or lost live fees, mostly to the fee's own row. 0 verdicts change across 7,274 checked
  reads and the lost live fees, so the tie-break takes down nothing on those texts. It and the variant admit
  path can change only which equal row is the evidence, or admit a composed name.
- Superset dry run (Nov 3, SELECT, then the v181 functions on the stored texts):
  - Variants: 49 live non-stop-payment fees named like a variant, printed after a bullet on a page that names stop
    payments. One reads as a variant: #40324 "Corporate Check" $15 cashiers_check, St. Louis's own older copy (text
    372). An earlier walk also took #75973 "• Certified Checks | $10.00" under "• Check Stop Payment Fee Per Item";
    that is a list of different fees, so the parent must now be unbulleted and introduce its list with a colon.
  - Cards: 9 live NSF fees on fee-card pages that mention deposited or cashed items. One moves: #68629 "Returned
    Item Fee" $10, ESL's own live fee (text 18587).
- The reviewer's 1,270 live fees on 116 texts (review of #2979, `checkFeeAgainstSource` at main and at this head): 12 evidence
  lines change, each to the fee's own row (text 3219's "Incoming Wire Fee" is back on "Wire | Incoming Wire Fee • $10
  per transfer"); 0 verdicts change.
- Darwin's section misread check v4, dry run Nov 3 (prod, SELECT only, then `findSectionMisreads` on the 1,800
  texts Knox read): of 7,279 live candidate fees, 1,685 selected by the new rules' pre-filters, the new rules match
  2: `stop_payment_variant` #40324 ("Corporate Check" $15 cashiers_check, read as "Stop Payment Fee – Check or ACH (per
  item): Corporate Check") and `deposited_card_return` #68629 ("Returned Item Fee" $10 nsf). The check reports 23 live
  fees at 20 institutions; the v3 rules match the other 21 on today's rows (the 19 counted earlier today, plus
  #146687, an IRA section closing, and #139551, under "Gold Advantage 50+"), and the same 21 with v3's code, so the
  OCR blanking changes no verdict. Switch off: nothing is written. On, with James's yes, the two come down after the
  second look, and a re-read files them as Knox v181 reads them, so the right fee never sits beside the wrong one.

**Left open:**

- Switching Darwin's section misread check on (#40324 and #68629 among its 23), James's yes.
- A monthly overdraft program fee's home (St. Louis), above.
- Other OCR noise that carries digits ("Non-Customer cc00") is left as printed.

**Guard:** `src/lib/agents/knox/backlog-dry-run-12.test.ts`.
**Agent lesson:** knox/backlog-dry-run-12-2026-11-03-read-the-row-under-its-parent
