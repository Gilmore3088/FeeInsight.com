# 2026-11-03: Knox read some fees with words from another part of the page, which blocked the live slice

**What happened:** two read-only checks on Knox v180 found reads that took their name or category from the wrong
part of the page.

- The live slice dry run (66 banks, 205 current texts, main 713cf507e89) changed 671 rows. 10 were wrong fees and
  9 had wrong names.
- The cross-category scan of rb to rb12 found 5 live fees whose live category is right but which v180 re-reads into
  a wrong one.

Each was checked against the bank's own line.

Wrong fees in the slice:

- Austin Bank (text 25416): "Free eStatements (Paper statements without check images are available for a $3 monthly
  fee)" was filed as check_image. It is the paper statement charge.
- Austin Bank: the $10 "Monthly fee" cell was put on "Automatic Transfer from Savings", a feature in the page's
  benefit list. The $10 column is Austin Star Checking Plus.
- Ameris Bank (text 1338): "Online Wire Monthly Maintenance Fee | $25.00" was filed as monthly_maintenance. It is a
  wire service subscription, and none of the 50 types fits it.
- First State Bank and Trust (text 22671): "COUNTER CHECKS | PER DEBIT ITEM • $32 | DEPOSIT" gave the $32 to counter
  checks. The $32 is the per-debit-item charge.
- Advia CU (text 30743): "Account History Print | Loan Skip Pay" over "$1/page | $35 where regionally offered" read
  "Loan Skip Pay" at $1. The two columns were crossed.
- Crow Wing Power CU (text 23340): "WIRE TRANSFER – $20" was filed legal_process, named after the subordination
  heading in the other column.
- St. Cloud FCU (text 21575): "Wincentive Savings Account (S40)" / "*First withdrawal $10.00" / "*Second withdrawal
  $25.00" were read as gift card purchases under "Visa Gift Card" (2 rows).
- America's FCU (text 29839): "Only a $25 membership deposit to get started" was read as a monthly fee.
- Velocity CU (text 5217): "Statement Print-Out" $5 was read a second time under "spending posted and settled", a
  phrase from the other column.

Wrong names in the slice:

- Texas Capital Bank (text 35692): "Safe Deposit Box 3x103" and its siblings carry a footnote digit, and the boxes
  were read once from each of two tables (6 rows).
- River City Bank (text 22920): the $2.50 non-MoneyPass ATM fee was named by its advice sentence ("Avoid these fees
  by using an ATM that utilizes the MoneyPass© Network").
- Velocity CU (text 35462): $0.50 temporary checks were named "... spending posted and settled" (2 rows).
- Headings glued in front of names: "LOAN FEES: 3x10 Box", "Wire Transfer: Deposit Item Chargeback", "Customer
  Services: Annual Fee 3x5", "Online Banking Fees: Share account monthly service". A font glyph was glued on as well
  ("NSF FEE: g", text 27330, 11 names).

Live fees the cross-category scan found:

- Cornerstone Community FCU #128047, "Box Late Fee" $20 (text 24203), re-read as late_payment.
- TXN Bank #141626, "Return Items" $10 (text 10944), re-read as nsf.
- Live Oak Bank #99611 and #99612, "Returned Item Fee" $10 and $5 (text 6249), re-read as nsf.
- Parthenon FCU #99606, "Returned Item Fee" $30 (text 5186), re-read as nsf.

**Why (root cause), by class:**

- *Words lent by another column or heading.* Several readers compose a name from a heading or the cell before:
  - `table-rows.ts` and `families.ts` composed "WIRE TRANSFER" with the other column's legal heading.
  - The stacked price window in `families.ts` took the second label cell for the first price cell.
  - `joinWrappedLeaderNames` in `source-check.ts` counted an open parenthesis from the other column's cell, so it
    joined "spending posted and settled" onto the Velocity names.
  - A heading or a glyph stayed glued to the label.
  - Nothing reviewed a read's name once at the end.
- *A heading taken for a price row.* `plainHeadingName` read the digits in "(S40)" as a price row. That left St.
  Cloud's withdrawals under "Visa Gift Card".
- *A feature list taken for an account.* `distinctAccountNameOnly` in `lineup.ts` took "Automatic Transfer from
  Savings" as an account name, though the name files as a fee.
- *A plain returned item beside an NSF fee.* Knox v168 (`withReturnBesideNsf`) moved a plain returned item to the
  deposited item return only when the page priced its NSF fee higher. Two cases missed it:
  - Live Oak prints "Non-Sufficient Funds (NSF) Fee No charge": no NSF price at all.
  - TXN prints "Charge Backs | $10/Item" at the return's own price. v168 treated any deposited return on the page
    as proof that the plain return is the member's own item.
- *Category from the name's other words.* "Box Late Fee" classifies as late_payment. Hamilton's taxonomy fold
  (`splitLiveCategory`) moves it to safe_deposit_box at publish, which is why live #128047 is right. Knox did not
  apply the fold itself.
- *Paper statements offered in a check image's name.* The check image rule fired on "check images". The paper
  statement rule (`paperStatementRead`) looked only at monthly fees.
- *A wire service's monthly charge.* `wireServiceSubscription` held a wire module only when it was filed as a wire.
  Ameris's charge is named "Monthly Maintenance Fee".
- *A footnote digit glued to a box size.* "3x103" is the 3x10 box with footnote 3. The source check matched sizes
  whole, so the corrected name would not trace.

**Fix (Knox v182, `KNOX_RULES_STRATEGY` 182):**

- `knox/read-name-review.ts` (`withReviewedNames`, run after every specialist) gives each read a last look for
  words another part of the page lent it:
  - `glued_heading` drops a prefix when the label alone files under the read's category, the prefix does not, and
    the prefix is a section heading (capitals, or ending in "Fees", "Charges" or "Services") or another fee's name.
    A prefix that names an audience or a delivery speed ("Non-Customer Services", "Expedited delivery") or an
    account, product or card stays, capitals or not ("VISA CHECK CARD CHARGES: Non Sufficient Funds", rb10 text
    40788, live #141969; review of 29ef3de53d2), and so does a clause of other words ("(Per month some exclusions apply)", "For Kasasa Cash, if
    ...: (1) ...").
  - `glyph_before_price` drops a glyph printed against the price ("NSF FEE: g").
  - `box_size_footnote` removes a box size's footnote digit when the side it leaves is a box's (30 inches or
    less).
  - `advice_name` renames an advice name to the title right above it when that title files under the same
    category. With no such title the read keeps its name: live #135372 "To avoid a monthly paper statement fee" is
    a real $3 fee.
  - `opening_deposit` drops a price whose own words call it a deposit to open or join. It reads only the read's own
    window: on Lyons FCU's long line the "$5 Deposit to open" belongs to another account. It drops the price only
    when every time the window prints it, it is a deposit: "Regular Savings $5 minimum opening deposit; monthly
    service charge $5" keeps its $5 fee (review of 29ef3de53d2).
  - `caps_cell_label` drops a capitals label whose price sits in the next cell's own label.
  - `box_late_fee` files the box late fee as Hamilton's fold does.
  - `paper_offer` files a check image name that offers paper statements as `paperStatementRead`. The offer must use
    the word "available" or open with "Free". A "Paper statement with check images" fee stays check_image.
  - Twins the renames create are merged. A twin has the same name, price, category and product, so one fee read at
    one price for two accounts (Gold Checking and Platinum Checking) stays two reads (review of 29ef3de53d2).
- `withReturnBesideNsf` covers both missed returned-item cases:
  - A schedule that prints its NSF fee free (`freeNsfLine`) prices no NSF item, so a priced plain return there is
    the deposited item return (Live Oak). A waiver is no free price: "Overdraft/NSF Fee Waived for first item per
    year" is not a free NSF line (review of 29ef3de53d2).
  - A deposited item return at the plain return's own price no longer marks it as the member's item (TXN). One at
    another price still does: Parthenon prints NSF $33, Returned Item $30 and its own Deposited Item Return $25, so
    its $30 return is the member's item and stays nsf. Live #99606, filed deposited_item_return, looks wrong by its
    page and is left for review.
  - An NSF fee at the return's own price still keeps it nsf, as in v168.
- Wire and heading reads:
  - A monthly fee named for a wire service (`wireServiceMonthlyName`) is held unclassified, as a wire module already
    is.
  - A wire name never borrows a non-wire heading (`table-rows.ts`, `families.ts`).
  - A fee-family label under a heading of another family is not read under it (`readUnderHeading`).
  - A heading's trailing code ("(S40)") is no price digit (`plainHeadingName`).
- Column and row pairing:
  - `parallelColumnRows`: k label cells followed by k "$" cells pair by column. A label that wraps onto the next
    line ("ACH Transfer Origination - per") leaves the row as it was.
  - The stacked price window takes its own column's label (Advia).
  - `joinWrappedLeaderNames` counts the parenthesis balance in the leader's own cell only (Velocity).
- An account name that files as a fee is no account (`distinctAccountNameOnly`). The Austin $10 cell now has no
  product rather than a wrong one.
- `paper-statement-price.ts` reads paper statements "available for a $3 monthly fee" in the price's own cell
  (`OFFERED_BEFORE`).
- The source check reads a footnoted box size as the size it marks too ("3x103" also reads as "3x10", in
  `nameHaystacks` and `rowSizes`). A wrong amount for that size is still refused.
- Darwin's section misread check v5 (`darwin/section-misread-check.ts`, switch off) re-checks the rules that hold,
  drop or re-file on live fees:
  - `wire_service_monthly_fee` (name).
  - `read_name_review`: a live fee `reviewReadName` drops or files elsewhere, on its stored line and the text Knox
    read. A rename alone is no match.
  - `return_beside_nsf`: `withReturnBesideNsf` on the live fee, the other live NSF and deposited item return fees
    from the same text, and that text.

**Live:**

- Slice dry run, v182 on main 5f56bb55a05 against v181 (the same 205 texts, harness in `slice/dry`): publish rows
  671 to 660.
  - Wrong fees 10 to 0 and wrong names 9 to 0. The 11 glyph names, the glued headings and the duplicate boxes are
    fixed as well.
  - Live fees lost or replaced: 0, as before. Live fees not reproduced: 70, as before.
  - Simulated v3 score on the 8 answer-key banks: unchanged from v180, precision 135/152 and recall 146/213
    (before the slice: 123/137 and 133/213). None of the fixed rows is on an answer-key bank's scored document.
  - Doubtful: 34 monthly fees with no product (33 before; the Austin $10 lost its wrong product). A live $5.95 fee
    is re-confirmed without the wrong product "Share-to-Share Overdraft Transfer Fee" (text 27995).
- Harnesses rb to rb12 (v181 against v182 on main 5f56bb55a05): live fees not reproduced 456 to 453.
  - Reproduced again: #128047, #99611, #99612 and #41503.
  - No longer reproduced: #63177 only. That is "Archived Statement Reproduction (see Record Research above): Wire
    Transfer" $9, filed document_reproduction; its own line is "Wire Transfer | $9.00 repair wire fee", so the live
    fee is the misread.
  - TXN #141626 is now read in its live category.
  - Publish rows: 3 gone, each renamed (a heading off: "CONSUMER ACCOUNTS: Statement Printout", and "Account
    Fees: A low balance service charge" twice, which also loses the false product "Account Fees: A"), and 6 new:
    - the same 3 renames;
    - "Share Savings Account Below Minimum Fee", which re-confirms its live fee with its product;
    - two ACH origination prices paired by column (text 16162, "$3.00 | $30.00" under "ACH Transfer Origination -
      setup / | Automatic Bank Credit"). Their names are cut where the label wraps ("... - per"), so they are
      doubtful.
- The 5 cross-category live fees:
  - Knox now reads #128047, #141626, #99611 and #99612 in their live category. The Live Oak pair, lost at v181,
    are reproduced.
  - Parthenon #99606 stays a re-read disagreement. By its page, Knox's nsf is right and the live category is the
    doubtful one.
- The 10 flagged live fees, each against its own stored line:
  - 9 keep their live category: 143778, 161745, 58050, 76451, 66367, 50803, 104858, 139453 and 98236. In each the
    stored line names the fee as filed, for example "Copy of Check Request including Bill Pay" (check_image) and
    "Cashback Checking Plus Account | $10.00 /month" (monthly_maintenance).
  - #52129 "Official Check" $15 (cashiers_check) is doubtful: its line says "Charged if you ask us to refund or
    replace a check drawn on Tech CU". That is a replacement or refund of an official check, not its purchase. It is
    left for review: no Knox misread class covers it.
- Darwin's section misread check v5 on prod, Nov 3 (SELECT only). The review of 29ef3de53d2 found the first v5
  read was invalid SQL (a missing comma between the `retextured` and `picked` CTEs). `recheckSectionMisreads`
  catches a failed read and reports nothing, so the first counts here came from hand-written queries, not from the
  function. Now:
  - The comma is in, and `section-misread-check.db.test.ts` runs the real read and the step (dry run) on the
    production schema; without the comma it fails with "syntax error at or near picked". It is in CI's E2E list.
  - The plain returns' siblings are gathered once per text by a grouped join, not by a per-row scan of `live`
    (the reviewer's corrected per-row form timed out at 60 s).
  - The real read, rendered from `sectionMisreadRowsSql` and run with `EXPLAIN ANALYZE`: 7,786 rows, 18.9 s, then
    11.8 s warm. Main's v4 read: 7,279 rows, 30.7 s, then 13.6 s warm.
  - Counts from `findSectionMisreads` on those rows. The texts were cut to the lines the v5 rules read: the fee's own
    line, the three lines above it, and the NSF lines.
    - `wire_service_monthly_fee`: 0. No live monthly fee's name says "wire".
    - `read_name_review`: 0 of 89 candidates. These are fees with a deposit or capitals-cell line, a box late fee,
      or a paper-statement image name. 12 of the 89 stored lines are not in their text, so they are judged on
      the line alone, as Knox does.
    - `return_beside_nsf`: 1 of 471 live plain returns filed as nsf: #133756 "Returned Check" $20, beside
      "Insufficient Funds (NSF) | $0". 354 of the 471 have a sibling fee or a free-NSF-like line to judge; the
      rest cannot match.
  - The v1 to v4 rules are unchanged, so the check reports 1 more live fee than v4. Switch off: nothing is written.

**Left open:**

- Switching Darwin's section misread check on needs James's yes. Its matches now include #133756.
- Parthenon #99606 and Tech CU #52129 need review.
- Monthly fees read with no product (34 in the slice, up 1 because the Austin $10's wrong product is gone). The $10
  cell is read three ways before the account table's "Austin Star Checking Plus Monthly fee" read. Fixing that
  ordering is its own change.

**Guard:** `src/lib/agents/knox/cross-category-rereads.test.ts`, `src/lib/agents/darwin/section-misread-check.test.ts`,
`src/lib/agents/darwin/section-misread-check.db.test.ts`.
**Agent lesson:** knox/backlog-cross-category-2026-11-03-name-a-read-by-its-own-row
