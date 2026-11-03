# 2026-11-03: The eleventh re-read backlog dry run found cells read under the wrong column

**What happened:** after Knox v179 fixed the tenth dry run (`2026-11-03-knox-backlog-dry-run-10-reads.md`),
an eleventh read-only dry run for `KNOX_REREAD_BACKLOG_LIVE` took 40 more backlog texts (rb11) at Knox v179
(main de8cf5a68c4) and compared every changed read with the bank's own line. Of 67 changed rows on 21 texts, 4 were
wrong and 9 doubtful; no correct live fee would have been lost or replaced. rb10's four wrong reads stayed fixed.

- Wrong. Advancial FCU (text 17551, line 20): "In-person ..... FREE | Additional withdrawals (per withdrawal over 3
  per month) ..... $10" was filed atm_non_network, named "ATM Transactions: In-person (Additional withdrawals (per
  withdrawal over 3 per month))". The right column is the money market's withdrawal limit.
- Wrong (two rows). Community First National Bank (text 25687, line 225): "Monthly Service Fees | None | $5 per
  paper statement if not enrolled in eStatements ... | $6 if $300 minimum balance or $750 average daily balance is
  not maintained | $10 ..." filed the $6 as a paper statement, named by the cell before it, and filed "Monthly
  Service Fees" at $5, the paper statement cell's price. The $5 paper statement itself was already read right.
- Reported wrong, kept. Bank of Travelers Rest (text 32342): "FREE Zelle® Person to Person Transfers (P2P)" filed
  bill_pay at $0. The top-50 fold (Oct 8) retired zelle_fee and files Zelle under bill_pay, whose public label is
  "Bill Pay & Zelle" (`fee-fold.ts`, `fee-taxonomy.ts`). Knox hints zelle_fee and the fold moves it, as designed.
- Doubtful, fixed. The People's FCU (text 12465, lines 129-132): "Bill Payer ..... Free" over "when opting for
  E-Statements/no mail paper statements" read as an unconditional $0 beside "Bill Payer ..... $4.95" (live #159909).
- Doubtful, not fixed: Corner Stone FCU's two $7 rows (text 21525), Piedmont's mortgage subordination, First Bank's
  lost "InControl Checking" product, Bank of Travelers Rest's free online bill pay and mobile deposit, and Inwood
  National Bank's grid name.

**Why (root cause):**

- Advancial: no rule named "additional withdrawals ... over N per month" as the excess withdrawal charge, so the
  ATM family expert read it as a tier row of the fee before it on the same line, the left column's "In-person".
- Community First: the account-table reader's header walk stopped at "Free E-Statements", a one-cell caption printed
  inside the table, so it found no header and did not read the row by column. The general rules and the account
  family expert then read the row: one named the $6 by the cell before it, the other put the row's label on $5.
- People's FCU: nothing read the line under a free row, where this page prints the free price's condition.

**Fix (Knox v180):**

- `rules.ts`: the excess withdrawal pattern reads "additional (or extra) withdrawals, transfers or debits ... over
  N", not when the line names an ATM, a network or foreign use.
- `custom-report/account-table.ts`: the header walk goes on above a one-cell caption (up to five words, no price,
  no sentence end). `accountRowCellsPricing` says which fee each cell printing a price states.
- `knox/account-table.ts` `accountRowRivalRead`, applied in `specialists.ts`: on a monthly fee row the account-table
  specialist reads, a monthly fee read is dropped at a column's price or at a price only cells stating another fee
  print; a read of another fee is dropped only when every cell printing its price is a column's monthly fee. Another
  fee's read at its own cell's price stays, also beside a column at the same price ("$5 per paper statement" next to
  a "$5" column; review of #2978).
- Review of #2978: the account table's column names drop button text ("Open Account", "Request Appointment") and a
  "Student Version Available6" note (`productName`), so a re-read never names a column "Interest Checking Open
  Account" or "Cashback Checking Student Version Available6" next to the live "Cashback Checking" (137619). On the
  reviewer's texts (17677, 34068, 22059, 27674, 27675, 27783-27786) every column is now the plain account name.
- `families.ts`: a monthly fee priced "per paper statement" is the paper statement charge, which the rules read.
- `specialists.ts` `conditionalFreeRow`: a held $0 whose next line opens with a condition, beside a priced read of
  the same fee, is dropped.

**Live:** the new excess withdrawal wording matches no live fee name (Nov 3, SELECT on `published_fee_records`, not
rolled back or quarantined: 0 rows; 6 live names contain "additional withdrawal/transfer/debit", none with "over N").
No live fee's name carries a column name the cleanup changes (Nov 3, SELECT: 4 live rows mention "open account"
or an appointment in the name or raw product, none in the account-table name form), so the shared check traces the
same live fees. Live 149047 ("Monthly Service Fee" $7.50, raw product "Interest Checking Open Account") still traces on
its own row ("Monthly Service Fee | $7.50 ..."); a re-read reads it under the same name and price, and the
account lookup still gives it "Interest Checking Open Account" (`sameProduct` true), so it is confirmed, not
duplicated. That product name comes from the lineup's own heading read, which this change leaves alone. No rule
here holds, re-files or takes down a live fee, so no Darwin re-check is added; the caption change only lets
the shared check trace more account-table rows. Harnesses rb to rb11 (v179 vs v180): live fees not reproduced 408 to
408; rb11's three wrong rows and People's FCU's $0 fixed; rb5 renames one confirmed fee to its column's name
("Premium Checking Monthly Service Charge"). No right read lost.

**Left open:**

- Corner Stone's $7 under "Business Share Draft Less than 10 Employees" gets no product, so it reads like a general
  checking fee; the lineup finds no account heading for that line, and fixing it needs the lineup's heading lookback.
- Inwood's markdown grid labels its row "Service Charge Other Restrictions and Fees", which the account table's row
  label does not take; widening that label was not cheap to do safely.
- A cell in the right column of a two-column page can still take the left column's fee as a tier base when its own
  words name no fee; Advancial is fixed because its cell now names one.

**Guard:** `src/lib/agents/knox/backlog-dry-run-11.test.ts`.
**Agent lesson:** knox/backlog-dry-run-11-2026-11-03-each-cell-is-its-own-column
