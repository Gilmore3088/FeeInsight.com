# 2026-11-03: The fourth re-read backlog dry run found a stop pay, one account's perks and a returned check misfiled

**What happened:** after Knox v170 fixed the third dry run
(`2026-11-02-knox-backlog-dry-run-3-misfiles.md`), a fourth read-only dry run for
`KNOX_REREAD_BACKLOG_LIVE` took 40 more backlog texts (rb4: 20 from the top of the queue, 12 random
texts behind live fees, 8 random texts with none; the rb, rb2 and rb3 texts left out) at fe611ab3326
(Knox v170, guard v108). Each text was read with that head's Knox (`currentVariant`), passed through the
Darwin verify and Hamilton publish checks that can be replayed, and compared with the live fees on its
document. Of 43 changed rows, 35 were right, 2 known product-split duplicates, and 2 wrong and 4 doubtful
against the bank's own stored text:

- Wrong. Northwest Missouri Regional FCU (institution 7465, doc 42066): "Counter Check Stop Pay Fee (per
  check) $25.00" was filed as counter_check. It is the stop payment on a counter check.
- Wrong. O'Bannon Banking Company (2415, doc 42058): "Special Rates on one Safe Deposit Box" was read as a
  $0 safe deposit box fee. The page prints it in the Premiere Club's list under "This account also
  includes:", over "Free Photocopies (limits may apply)"; the "Free" is the next item's.
- Doubtful, same page: "Bill Pay" $0 (bill_pay), "Online Statements and Check Images" $0 (check_image) and
  "1st order of starter checks" $0 (counter_check), all with no product. The first two are items of the
  Safeguard FREE Checking list under "This account also includes:"; the third is the Safeguard FREE
  Checking cell of the page's account comparison table ("Regular Checking | Safeguard FREE Checking |
  Premiere Club | Money Market Deposit" over "Checks | 1st order of starter checks FREE (postage not
  included) (FREE Checking) | FREE Basic Checks (postage not included)").
- Doubtful. Four Corners FCU (6169, doc 41706): "| Returned Check | $ 25.00 |" was re-filed as nsf, while
  live 149144 files the same line as deposited_item_return. Published, the re-read would leave two live
  rows in two categories for one line.

**Why (root cause):**

- Stop pay: the stop payment rule in `FEE_PATTERNS` (rules.ts) needs "stop payment(s)". The short "Stop
  Pay" was only in `HELD_NAME_PATTERNS`, which `classifyPatternKey` tries after every `FEE_PATTERNS` rule,
  so the counter check rule took the row by its other words.
- Perks: the stacked-table adapter (`tableRowsFromText`, table-rows.ts) treats a line that opens with a
  free word as a price line. In a list of free items, one per line, each "Free ..." item became the price
  of the line above: "Special Rates on one Safe Deposit Box" / "Free Photocopies ..." read as the box at
  $0, "Free Bill Pay" / "Free Online Statements ..." as bill pay at $0, and so on down the list. The v157
  one-account-benefits gate (`accountBenefitZeroOf`, account-benefit-zero.ts) would not have held the
  items anyway: its leads (`ACCOUNT_WAIVERS`) have no "This account also includes:", its whitelist walk
  stops at "Free Photocopies (limits may apply)" (a verb) and "Special Rates on one Safe Deposit Box"
  (no list entry), and it never reads a cell of an account comparison table.
- Returned check: the page prints its own NSF row as "| ACH - Insufficient | $ 30.00 |". No rule files
  "insufficient" without "funds", so the row was not read, `withReturnBesideNsf` saw no NSF price on the
  page, and the plain returned check stayed NSF. The page is not ambiguous: it prints a separate NSF row
  at a higher price, so no fallback to the live row's category is needed; the fix is to read that row.

**Fix (Knox v171, table v13; guard unchanged at v108):**

- `STOP_PAY_SHORT` in rules.ts: the held-name rule's short stop payment ("Stop Pay", "Stop-Pay", "Stop
  Pmt") is tried in `FEE_PATTERNS` right after "stop payment(s)", ahead of the check, money order and draft
  rules, and still in `HELD_NAME_PATTERNS`. It is read only while the held-name rules are on, so
  `withHeldNameRules(false)` reads as before. A row an earlier rule files keeps it ("NSF/Stop Pay/Courtesy
  Pay" stays overdraft).
- `freeItemList` in table-rows.ts (table v13): a line that opens with a free word and goes on to name an
  item is a free item of its own, and its free word never prices the line above when that line or the
  next is one too. A free note ("Free for members", "Free (with eStatements)") and a lone stacked "Incoming
  Wire" / "Free" still read as before.
- `accountBenefitZeroOf` (account-benefit-zero.ts): an "account includes" lead ("This account also
  includes:", `ACCOUNT_INCLUDES`) is an `account_waivers` lead. The account is the nearest name in the eight
  lines over it ("Regular Checking", "Premiere Club"), or the lead itself. Under it every short line is the
  account's own list until a heading, a table cell or a priced row. A new kind, `account_column`
  (`accountColumnZeroOf`): a perk an account's own cell names and prices free ("1st order of starter checks
  FREE") in a table under a header row of two accounts or more, when the cells cannot be lined up with the
  accounts or another account's cell differs. A bare free word under an account ("Bill Payment fee | FREE")
  prices that row's fee for the account, which the account lineup ties to its product, and stays. Knox holds
  matches as before (v157 path, `knox_account_benefit_zero`), and Darwin's verify and the shadow lab refuse
  them.
- `ITEM_INSUFFICIENT` in rules.ts: an ACH, check, item, draft or debit named insufficient with no "funds"
  ("ACH - Insufficient", "Insufficient Check Charge") is the NSF row. An insufficient balance, deposit or
  collateral is not; a row an earlier rule files keeps it ("ACH Insufficient Return" stays ach_return).
- Darwin's live re-check `darwin.account_benefit_zero` v2 reads the new kinds: its query also selects a
  live $0 whose stored line has a free word in a cell after the row's label, on a text with a line that
  names two accounts in neighbouring cells, and it reads 1,500 characters before the line (the account
  table's reach; the list walk still reads 450). The switch (`DARWIN_ACCOUNT_BENEFIT_ZERO_LIVE`) stays off.

**Live fees (read-only, Nov 3, prod `rmhwbbjjctzfaqjyhomu`, SELECT only):**

- Stop pay: no live counter_check fee is named "stop pay" (the live fees named "stop pay" that are not
  stop_payment are 8 ach_return, 15 nsf, 2 overdraft, 1 notary_fee and 1 money_order, "Money Order Stop
  Pay" 37574). Under the new rule a re-read of 37574's text would file that row as stop_payment, as "Money
  Order Stop Payment" already is. No guard rule or Darwin take-down follows, so no switch was added.
- Account benefits: the v2 query selected 308 live $0 candidates (143 free-item lines, as v1, and 165 cell
  rows). Judged with the module's own `findAccountBenefitZeros`, v1 and v2 each match the same 12 at 4
  institutions; v2 matches none more. A first version of `account_column` matched 5 more (62793, 91112,
  98245, 124983, 165162): a bare free word or "None" under an account, two account pages side by side, and
  junk header rows. It was narrowed to a perk an account's own cell names, under a header of account cells
  only.
- Insufficient: 11 live names put "insufficient" beside an item with no "funds" (7 nsf, 3 overdraft, 1
  ach_return). Read by v170 and v171 rules, 10 file the same; the 11th, "Insufficient Checks" (live as
  nsf), named no fee to v170 and now reads as nsf, its live category. None changes category.

**Re-run after the fix:**

- The 40 rb4 texts, v170 vs v171: rows passing publish 558 -> 555, all tracing on the bank's line.
  - Both wrong rows and all four doubtful rows are gone. The counter check stop pay is now stop_payment.
    The four O'Bannon perks no longer pass: three are not read at all and the starter checks cell is held
    as one account's benefit. Four Corners' returned check is deposited_item_return (it now reproduces
    live 149144), and its "ACH - Insufficient" $30 is read as NSF, a new right row.
  - No right row was lost, and no live fee on the documents stops being reproduced.
- The 40 rb3 texts, v170 vs v171: 682 -> 683 rows. The one change is a new right row, Cinfed FCU's "Bill
  Payment Stop Pay Fee | $33.00" as stop_payment (v170 filed it as bill_pay and verify refused it). Nothing
  lost.
- 60 fresh random stored texts (seeded, all earlier dry-run texts left out), main (53c80d54eff, v170) vs
  v171: 842 -> 837 reads.
  - I.B.E.W. Local 66 FCU's money market perk lists ("Free Money Orders" / "Free Cashier's Checks" / ...
    one per line) no longer give six $0 reads. Each took the next item's free word ("Paper Statement
    Delivery" $0 was read from "Free Online (Paperless/Electronic) Statement Delivery(1)").
  - Heritage South FCU's "Insufficient Check Charge | $28.00" is now read as NSF; it was held unclassified.
  - Every changed read was checked with `checkFeeAgainstSource`: the added NSF traces, and reads that
    trace go 837 -> 832 (minus the six removed perk reads, which traced to their perk lines, plus the NSF).
- Answer-key gates: the reproducible reads of all 81 answer-key texts are the same at v170 and v171; the
  Texas and seven-state answer-key gates, the golden gate and the shadow-lab ratchet pass.

**Lesson:** file a row by the charge it names, in every short form; a free word that opens a list item is
that item's, not the price of the line above; and one account's perks are held or tied to the account,
never published as the bank's price.

**Guard:** `src/lib/agents/knox/backlog-dry-run-4.test.ts` (Knox reads and holds on the real lines for each class) and `src/lib/agents/darwin/account-benefit-zero-check.test.ts` (the live re-check's kinds).
**Agent lesson:** knox/backlog-dry-run-4-2026-11-03-stop-pay-free-item-insufficient
