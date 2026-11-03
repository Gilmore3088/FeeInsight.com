# 2026-11-03: The sixth re-read backlog dry run found list headings and section titles lost on two-column pages

**What happened:** after Knox v172 fixed the fifth dry run (`2026-11-03-knox-backlog-dry-run-5-misfiles.md`),
a sixth read-only dry run for `KNOX_REREAD_BACKLOG_LIVE` took 40 more backlog texts (rb6: 20 from the top
of the queue, 12 random texts behind live fees, 8 random texts with none; the rb to rb5 texts left out) at
f8d231cf7a5 (Knox v172, guard v108). Of 97 changed rows (publish, not already stored) across 15 texts, 82
were right, 1 wrong, 5 doubtful and 9 duplicates (6 known product splits, PR #2964). No live fee would come
down and no right live fee is lost.

- Wrong. Navigant FCU (institution 7511, doc 2007), business schedule, a two-column page: "Stop Payment |
  Cashier’s Check | $5.00" over "• Money Order | $30.00 | Positive Pay Checks | $50.00/mo" ... "• Bill
  Payment | $30.00 | Custom Data Reporting | $50.00/mo". "Bill Payment" $30 was filed bill_pay; it is the
  stop payment's price for a bill payment.
- Doubtful. Greylock FCU (6842, doc 20487): "Card Replacement ...... Free" printed in the right column under
  "CREDIT CARD CHARGES" would publish as a $0 card_replacement beside the debit card's $5 replacement.
- Doubtful. LM FCU (5020, doc 8108): "Personal accounts: Internet Bill Pay Free Business accoutns: Internet
  Bill Pay $4.95 per month". The $4.95 was tagged consumer.
- Doubtful. Truist (9, doc 13069): "Monthly Paper | No charge for Paper Statement or Paperless Online
  Statement8 | No charge for Paper Statement or Paperless" gave two $0 paper statement reads of one row.
- Doubtful. Truist: "Monthly Maintenance | $5.00 | $0 | $0" under "PERSONAL SAVINGS ACCOUNTS" gives one
  product label both $5 and $0; the $0 cells are two other savings accounts.
- Doubtful. Tongass FCU (6060, doc 12648): "Cashier’s Check ...... $5.00 each" and "VISA Gift Card ......
  $7.00 each" under "Non-Member Fees" carry no audience, while members pay $3 and $5.

**Why (root cause):**

- Navigant: the rules pass carries a heading only from an unpriced line (`headingName`). On the two-column
  page the list's heading shares its line with the other column's priced row, so the bullets lost it, and
  each bullet's own words filed it (bill pay; money order and official check, which verify then dropped
  outside their envelopes). Even on a one-column page a bullet that names an item never took a stop
  payment heading: `billPayByHeading` re-files only under an overdraft or NSF heading, and the heading
  reach ends at the first bullet that reads as another fee. Live #143685 "Stop Payment: Cashier’s Check" $5
  is the same layout read the other way: an October read (raw 123835, Oct 5) glued the heading cell onto the
  other column's priced cell ("Stop Payment | Cashier’s Check"), and the name then filed it stop_payment.
  v172 already reads that cell as "Cashier’s Check" cashiers_check; v173 does not change it.
- Greylock: a free cell is held at $0 by its own words, and nothing read the section. The name check that
  keeps a credit card's replacement out of `card_replacement` (`passesDarwinChecks`) sees only the name,
  which names no card.
- LM: `feeApplicability` (fee-audience.ts) found "Personal accounts" and not the misspelt "Business
  accoutns", and with one price in the excerpt it took the consumer word as row-local.
- Truist paper statement: the v76 side-by-side free cells (rules.ts) dedupe zero reads by exact name, and the
  second column's cell is cut short by the page's wrap.

**Fix (Knox v173; table and guard unchanged, v13 and v108):**

- rules.ts `listHeadingOf` and `stopPaymentListRead` (applied to every specialist's reads in
  specialists.ts): the heading of a bullet list is read from an unpriced heading line, or from a line whose
  first cell is a heading and whose next cells are another column's priced row, when the next line opens
  with a bullet. A read whose whole name is its bullet's own label at the bullet's own price, where the label
  names an item a stop payment is placed on (check, draft, money order, official check, ACH, bill payment,
  debit, item, payment), is filed stop_payment and named "Stop Payment: <label>".
- credit-card-section.ts `creditCardSectionColumns` / `creditCardSectionRead`: a card replacement or rush
  card read whose every printed row sits under a credit card title in its own column (left cell or later
  cells, as `loanReturnedPaymentRows` reads loan titles), and whose name names no debit, ATM or check card,
  is left out of the read (candidates and holds). A title that also names a debit, ATM or check card ("ATMs,
  Check & Credit Cards") heads both kinds and does not count.
- fee-audience.ts: a misspelt "account" made of the same letters ("accoutns") reads as "accounts", and when a
  row-local excerpt names both audiences in labelled clauses ("Personal accounts: … Free Business accounts:
  … $4.95"), each earlier clause priced by a free word, the price takes the last label before it. The
  audience reader has no version constant; Darwin's `AUDIENCE_RELABEL_VERSION` reads its own reader and is
  unchanged.
- rules.ts `sameFreeCellName`: a zero name that another zero name of the same row and category opens with,
  word for word, is the same fee and is held once.

**Review of v172, folded in:**

- families.ts `feeNamedAfterPrice`: a bare fee word after the price ("Service Charge", "Charge", "Fee",
  `GENERIC_FEE_NAME`) names no fee of its own, so "ATM Fees" / "Foreign: $1.00 Service Charge." reads "ATM
  Fees: Foreign" $1 atm_non_network again, as before v172. "$4.95 Monthly Service Charge." still names its
  price. (The rules pass's separate "Service charge" $1 read of that line is unchanged from v172.)
- rules.ts `LOW_BALANCE_CHARGE`: a name that offers the monthly fee, named in full, and the minimum balance
  fee as one charge ("Monthly Maintenance Fee / Minimum Balance Fee", "Monthly Service Charge or Minimum
  Balance Fee", "No monthly service charge or minimum balance fee") stays monthly maintenance.
- rules.ts `ITEM_INSUFFICIENT`: a deposited or cashed item ("Deposited Item - Insufficient", "Cashed Item
  Insufficient") and a paid item ("Insufficient Debit Paid") are no longer filed nsf by this rule; no other
  rule files them, so they stay unread.
- None of the three changes a read in the rb to rb6 harnesses.

**Doubtful rows, left as they are:**

- Truist "Monthly Maintenance | $5.00 | $0 | $0": each $0 is a true price of another account column
  (Truist Confidence Savings, Secured Credit Card Savings); what is wrong is the product label, which comes
  from the section heading for all three cells. Dropping the $0 would lose real free prices elsewhere (v68
  holds the free column on purpose); naming the column is lineup work (product split, PR #2964), not a rule
  fix.
- Tongass non-member prices: `FeeAudience` has no non-member value (consumer, business, both, unknown), the
  non-member cashier's check policy waits for James (`NON_CUSTOMER_CASHIERS_CHECK_LIVE` off; the Texas answer
  keys file it as cashiers_check), and the "Non-Member Fees" title is the first cell of a priced two-column
  line eleven lines above the rows, past any heading reach. A clean fix needs a column-aware section reader
  and an audience value of its own; it is left for the Knox tracker.

**Live fees (read-only, Nov 3, prod `rmhwbbjjctzfaqjyhomu`, SELECT only, `published_fee_catalog`):**

- Stop payment list: 58 live fees named only as an item (money order, cashier's/official check, counter
  check, bill payment) on a document whose latest text prints "• <name>" and a stop payment: none is re-filed
  by `stopPaymentListRead` (the only bullet run under a stop payment heading is Navigant's, where the live
  "Money Order" $4 is the other column's). On Navigant v173 adds three stop_payment reads at $30.
- Credit card section: of 315 live card_replacement and rush_card fees whose document text names a credit
  card and has a credit card title within 2,000 characters above the fee's name (latest text only), 42 on
  36 documents sit under a credit card title in their own column and would not be read again as the debit
  card's (Whitewater Community FCU 75676, Argent FCU 129766, 129767 and 154631, Greylock 73521, Epb
  Employees FCU 129890 and others; a site menu's "Credit Card" with no price after it heads nothing, and a
  heading naming an ATM, debit card or deposit account ends the section). They stay live: a re-read never retires a verified or live row, and this
  PR adds no Darwin take-down.
- Audience: the 12 live consumer or unknown fees whose Knox evidence names a business word keep their
  audience under v173; LM's live business bill pay rows (46651, 125469) are already business.
- Free cell: 2 live pairs of $0 fees on one document and category have one name opening the other
  (88726/88725, 161273/12134); whether either pair comes from one row was not checked.

**Re-run after the fix (the dry-run harness, `currentVariant` at v172 vs v173 on the same stored texts):**

- rb6 (40 texts): the wrong row is gone ("Bill Payment" $30 is now "Stop Payment: Bill Payment"
  stop_payment, and "Money Order" and "Official Check" $30, dropped by verify before, now publish as stop
  payments; all three trace with `checkFeeAgainstSource`); Greylock's $0 card replacement is not read and
  its stored rush replacement (live 73521) is not reproduced. Truist's second $0 paper statement read now
  comes from the savings table's own line, not a second read of the checking row. LM's $4.95 is business.
  The other 95 changed rows are unchanged.
- rb, rb4 and rb5: four stored or new credit card section replacements are no longer read (Whitewater
  "Replacement Card Fee" $10 under "VISA Credit Cards"; Argent "Replacement Card (Individual)" $15, "(Joint)"
  $20 and "Rush Fee (Overnight)" $30 under "Credit Card Fees"; Epb "Replace Due to Card Loss" $10 under
  "Visa Credit Card"). rb2 and rb3 do not change.
- Golden set: no number worse than main (recall 1341/1766 unchanged; precision 1388/1450 to 1388/1449 and
  known-wrong refused 256 to 257 of 287). A first cut lost live audit 75's "Card Replacement" $5 to a site
  menu's "Credit Card" link 28 lines above; the credit card title now needs a price after it. The committed
  baseline is regenerated for this code.

**Lesson:** a heading or section title is read from the page's own column, even when it shares its line with
another column's row: a bullet list keeps its heading, a credit card section keeps its replacements, and a
labelled clause keeps its audience.

**Guard:** `src/lib/agents/knox/backlog-dry-run-6.test.ts` (Knox reads on the real lines for each class).
**Agent lesson:** knox/backlog-dry-run-6-2026-11-03-column-headings-and-sections
