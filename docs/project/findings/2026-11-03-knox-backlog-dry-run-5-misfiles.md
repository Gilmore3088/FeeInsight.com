# 2026-11-03: The fifth re-read backlog dry run found rows named or filed by their neighbours' words

**What happened:** after Knox v171 fixed the fourth dry run
(`2026-11-03-knox-backlog-dry-run-4-misfiles.md`), a fifth read-only dry run for
`KNOX_REREAD_BACKLOG_LIVE` took 40 more backlog texts (rb5: 20 from the top of the queue, 12 random texts
behind live fees, 8 random texts with none; the rb to rb4 texts left out) at 0075660ca83 (Knox v171, guard
v108). Of 99 changed rows (publish, not already stored) across 11 texts, 88 were right, 2 known
product-split duplicates (PR #2964), 3 doubtful and 6 wrong against the bank's own stored text. No live fee
would come down (stale-copy take-downs 0) and no right live fee is lost.

- Wrong. Epb Employees FCU (institution 7157, doc 40771), Visa Credit Card section: "Statement Copies Per
  Item | $1" filed check_image. It is a statement copy (document_reproduction).
- Wrong (two rows). Citizens Bank of Ada (2345, doc 41229): "Account Fees: A low balance service charge of
  $7.50 will be assessed if the average daily balance for the statement cycle falls below $1,500.00" and
  the savings account's $1.00 twin filed monthly_maintenance. The account expert read the same lines as
  minimum_balance, so each line would go live under two categories.
- Wrong. Same page: "Account Fees: $4.95 Monthly Service Charge." (Citizens Elite Checking's monthly
  charge) was also read as "Monthly Statements with Check Images: Account Fees" $4.95, check_image. Check
  images are one of the account's free perks, printed four lines above.
- Wrong. Same page: "Monthly Statements with Check Images" / "No Charge on First Visa Debit Card." gave
  "Check Images" $0, check_image. The "No Charge" is the debit card's; no price is stated for check images.
- Wrong. Community Powered FCU (6026, doc 42174): under the heading "Money Orders/ Cashier's Checks",
  "Cashier's (Counter) Check | $3.00" was named "Money Orders/ Cashier's Checks: Cashier's (Counter) Check"
  and filed money_order. It is the cashier's check.

**Why (root cause):**

- Statement copy: the copy-of-item check_image rule is the first rule in `FEE_PATTERNS` (rules.ts) and
  reads "copies ... item" anywhere, so it took the statement copy before the statement-copy rule
  (document_reproduction) further down.
- Low balance: the monthly_maintenance rule's "service charge" is tried before the minimum_balance rule's
  "low balance ... charge", so the rules pass filed the line as monthly maintenance while the account
  expert's sentence reader filed it as minimum balance.
- $4.95: the family experts (`runFamilyExpert`, families.ts) name a price whose own words file nothing
  ("Account Fees:") by the heading above. A perk line that names a fee ("Monthly Statements with Check
  Images") counts as a heading, and the price's own name came after it ("$4.95 Monthly Service Charge.").
- $0 check images: `priceWindows` gives a price that opens a line to the name on the line above. A free
  word that goes on to name its own item ("No Charge on First Visa Debit Card.") was read that way. It is
  the same class as the fourth dry run's O'Bannon perk list, which table v13 fixed only in the
  stacked-table adapter (`freeItemList`, table-rows.ts), not in the family experts' price windows.
- Cashier's check: the cashier's check rule needs the words side by side, so "Cashier's (Counter) Check"
  filed nothing on its own label, the heading was copied into its name, and money_order (tried first) took
  the composed name.

**Fix (Knox v172; table and guard unchanged, v13 and v108):**

- rules.ts: the first check_image rule no longer takes a copy a statement word opens when it ends on
  "item"; a copy that names checks or drafts still files there ("Statement Copies with Checks",
  "Statement copy of check").
- rules.ts `LOW_BALANCE_CHARGE`: a low or minimum balance fee or (service) charge is minimum_balance, tried
  right before the monthly_maintenance rule. "Minimum balance to avoid monthly service charge" (the charge
  word does not follow the balance words) and "Monthly or Minimum Balance Service Charge" stay monthly
  maintenance.
- families.ts `feeNamedAfterPrice`: a price whose own words file nothing and whose text after it opens
  with a name a rule files is named by that name, never by the heading above. The rules pass already reads
  "Monthly service charge" $4.95 right.
- families.ts `freeWordOnItem`: a free word that opens a line and goes on to name an item ("No Charge on
  First Visa Debit Card.", "No charge on first order of personal checks") is never stacked under the line
  above. A note with a figure or no item word ("Free on the first 3 withdrawals", "No charge on balances
  over $500") still prices the line above, and so does a lone "Free".
- rules.ts: the cashier's check rule reads a short note in parentheses between its words, so "Cashier's
  (Counter) Check" files cashiers_check under its own name.

**Doubtful rows, left as they are:**

- Community Powered FCU "NSF Collection Fee | $15.00", collection_item. The page prints its own NSF fee
  ($25 per presentment) on another row; this one is a collection charge on NSF items, and guard rule
  `COLLECTION_NSF_NAME` (fee-category-guard.ts) deliberately re-files NSF collection names to
  collection_item. Nothing on the line says otherwise.
- Same page, Debit Card section: "ATM Withdrawals (5 free per month) | $2.00/each", atm_non_network. The
  line does not say non-network, but the taxonomy has no other ATM withdrawal category; atm_non_network is
  where the catch-all ATM rule and the answer keys put a bank's ATM withdrawal fee.
- Same page, VISA section: "Returned Item | $25.00", nsf. The section is the credit card, so this is
  likely a returned card payment, but the line itself says only "Returned Item", and #1099 keeps a bare
  returned item as NSF unless the line names a loan, lease or mortgage. A section-aware rule would need its
  own Darwin re-check; it is left for the Knox tracker.

**Live fees (read-only, Nov 3, prod `rmhwbbjjctzfaqjyhomu`, SELECT only, `published_fee_catalog`):**

- 7 live check_image fees are a statement copy priced per item that v172 would file as
  document_reproduction ("Statement Copies Per Item" 129895, "Statement Copies (Per item)" 100590,
  "Statement Copies per item" 144647, "Statement Copy (per item) 3" 136453, "Statement Copy: Per item"
  105713, "Printed - Monthly Statement Copy (per item)" 45035, "Statement Copy or Other Items (plus
  research fee)" 137555). 26 more live check_image names with a statement copy also name checks or drafts
  and keep their category.
- 12 live monthly_maintenance fees are named a low or minimum balance charge. 11 would file as
  minimum_balance (63226, 127148, 107234, 122516, 111392, 13949, 133400, 133399, 21527, 21528, 21530);
  "Monthly or Minimum Balance Service Charge" 142793 stays monthly maintenance. 21527, 21528 and 21530 sit
  beside live minimum_balance twins 21532 and 21533 on the same First National Bank of Kansas lines.
- 1 live money_order fee carries the composed name ("Money Orders/ Cashier's Checks: Cashier's (Counter)
  Check" 146938).
- None of these change until a re-read; this PR adds no guard rule and no Darwin take-down, so no switch.

**Re-run after the fix (the dry-run harness, `currentVariant` at v171 vs v172 on the same stored texts):**

- rb5 (40 texts): the six wrong rows are gone. "Statement Copies Per Item" $1 is now document_reproduction
  and "Cashier's (Counter) Check" $3 is cashiers_check (both trace with `checkFeeAgainstSource`); the two
  monthly-maintenance low balance reads, the $4.95 check image and the $0 check image are not read. The
  other 93 of the 99 changed rows are unchanged, and the stale-copy verdicts are the same (0 take-downs).
- rb, rb3 and rb4 (122 texts): no read changes.
- rb2 (40 texts): First National Bank of Kansas's three "Service charge (Minimum Balance Fee)" reads
  ($2.95, $5.95, $7.50, all already stored) re-file from monthly_maintenance to minimum_balance, as the
  page says ("A minimum balance fee will be imposed every month if the balance in the account falls
  below"), and the separate "Minimum Balance Fee" $7.50 read merges into the same row. Nothing new
  publishes.

**Lesson:** name and file a price by its own row's words first: the narrower name before the broader one,
the name after a label's price before the heading above it, and a free word with an item of its own as that
item's price.

**Guard:** `src/lib/agents/knox/backlog-dry-run-5.test.ts` (Knox reads on the real lines for each class).
**Agent lesson:** knox/backlog-dry-run-5-2026-11-03-own-words-before-neighbours
