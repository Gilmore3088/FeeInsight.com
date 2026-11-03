# 2026-11-03: The tenth re-read backlog dry run found reads the page never printed

**What happened:** after Knox v178 fixed the ninth dry run (`2026-11-03-knox-backlog-dry-run-9-reads.md`),
a tenth read-only dry run for `KNOX_REREAD_BACKLOG_LIVE` took 40 more backlog texts (rb10: 20 top, 12 live random,
8 no-live random, excluding the 362 ids of rb to rb9) at Knox v178 and compared every changed read with the bank's
own line. Of 124 changed rows on 22 texts, 111 were right, 4 wrong, 8 doubtful and 1 a duplicate only. One correct
live fee would have been lost (#162230). rb9's two wrong reads stayed fixed.

- Wrong. Midwest Members FCU (text 40777, lines 338-348): "Fax Service | FREE" under "Senior Perks (60 & Over)"
  would have replaced the general "Fax Service | $1 per page" (live #162230) as a newer price of the same fee.
- Wrong. MassMutual FCU (text 11896, line 39): "Overdrafttransfer(from shareaccount).....$3" was filed
  atm_non_network, named "Includeschecks,ACH,ATM,debitwithdrawals(peritem): Overdrafttransfer(...)".
- Wrong. Oklahoma Educators FCU (text 34246, line 198): "Cash Advance Fee | 2% minimum or $2, maximum fee of $10"
  gave a flat $2 cash advance fee.
- Wrong. North State Bank (text 13544, line 228): "4 Monthly maintenance fee waived when minimum account balance
  requirement is met." gave a $0 monthly fee.
- Doubtful. LifeStore Bank (text 13549, line 537): "Monthly Service Charge of $15.00" had no product; "Premier
  Checking" heads it above a marketing sentence.
- Doubtful. Meridia Community FCU (text 4803, line 44): "Minimum Balance (under $500)" took the product "Overdraft
  Transfer from Share\u0003", a broken fee label.
- Doubtful. Blackhawk Bank & Trust (text 30592, line 217): named "This account contains a monthly service charge".
- Doubtful. Greater Valley FCU (text 6729): "Third Party/Cashier's Check $2.00/$5.00 per check" and "Collection
  Items $15 / $20 per item" each read as the first price.
- Doubtful. St. Mary's: a card column's "Maintenance Fee ... None" read beside the account column.

**Why (root cause):**

- Midwest: the section's heading names an audience, and nothing carried it to the rows, so the seniors' $0 had no
  product and publish's `sameProduct` took it for the general fee's newer price.
- MassMutual: the od_protection_transfer rule wanted a space ("overdraft transfer"), so the read fell back to the
  heading join, and the heading above it was the NSF row's note listing channels, whose "ATM" chose the category.
- Oklahoma: `rateBoundOf` read a bound word only right before its figure ("minimum of $2"), not joined by "or".
- North State: the $0 came from a waiver sentence, and nothing asked whether the line prints a free price.
- LifeStore: the marketing sentence names "Checking", so the account lookback stopped at it.
- Meridia: the PDF reader left control characters in the label, and the title check let it through.
- Blackhawk: "This account contains a" was not taken for a sentence opening.

**Fix (Knox v179; source check v31; Darwin section misread re-check v3):**

- `audience-section.ts` `audienceSectionHeading`: walking up from the row, past priced and free rows and exemption
  notes ("(Youth Accounts exempt from fee)", "No fee for senior citizens (62+)"), the first plain title is the
  section's heading; when it names an audience by age or stage of life it becomes the read's product
  (`withLineupFromText`, `candidateWriteFacts`) and a held $0's (`insertHeldCandidate`). `AUDIENCE_WORDS` reads "60
  & Over" shapes. Review of #2977: an age is a two-digit figure with age words ("60 & Over", "65+", "18 years and
  under", "Over age 62"), never a quantity ("Wire Transfers Over 10,000", "Certificates Over 12 Months", "Coin
  Counting Over 50 Rolls", "Access to over 30,000 ATMs", "Visit one of over 30 branches") or an account's name
  ("55 Year Old"); a title naming an account, a loan, a branch, an ATM, months or rolls is no section; "Student" and
  "Kids" are left out ("Student Checking", "Kids Club" title accounts over general rows); and a footnote or a line
  that runs on ("* Customers 22 years old or younger are") is no heading.
- rules.ts: od_protection_transfer accepts the run-together "overdrafttransfer"; `channelListHeading` stops `readUnderHeading` from
  taking a channel list as the heading.
- rate-bound.ts `rateBoundOf` v2: a bound joined to its figure by "or" ("2% minimum or $2"); percent.ts reads the
  minimum and the maximum ("maximum fee of $10", "never exceed $10.00") for the rate read. Both Oklahoma lines are
  held as the 2% rate; no flat $2.
- rules.ts `zeroPrintedOnLine` / `zeroPrintedForRead`, applied in specialists.ts to reads and held rows: a $0 needs
  its line, or a price-only cell right above it on a stacked page ("$0", "Free", "None", "N/C", "No charge",
  "Waived"; never another perk's label such as "Free eStatements"), to print a free price, and never one offered
  against a price ("$0 or $4.95"). Review of #2977: an unconditional waiver prints the free price ("Waived Annual
  IRA Fee", "Waived Non-QCBT ATM Transactions", "ATM fees waived"); a waiver on a condition ("... waived when
  minimum account balance requirement is met", "waived with direct deposit") does not. A no-charge NSF sentence the
  NSF reader already judged keeps its $0.
- lineup.ts: a marketing sentence (eight words or more, ending in a period) no longer ends the account lookback; a
  label with control characters is no account title. layout.ts: "This account contains a ..." opening is dropped.
- Darwin's section misread re-check v3 (`darwin/section-misread-check.ts`, switch `SECTION_MISREAD_TAKEDOWN_LIVE`
  off) adds `zero_not_printed`, judged on the stored line and the text Knox read by `zeroPrintedForRead`, and
  (review of #2977) `audience_section_untagged`: a live fee with no product under an audience section heading
  (`audienceSectionHeading` on the text Knox read) whose name the bank prices otherwise with no product.
- Source check v31 (`hamilton/source-check.ts`) re-checks every institution with `rateBoundOf` v2.

**Live fees (read-only, Nov 3, prod `rmhwbbjjctzfaqjyhomu`, SELECT only):**

- Live $0s with a stored line: 3,381, every one judged (the 35 cut lines are not). Three stored lines print no free
  price: 36427 and 36428 (stacked pages, a bare "$0" cell right above the unit line: kept) and 141225 ("Monthly
  Maintenance Fee: $0 or $4.95": matched). 134219 ("Waived Annual IRA Fee") and 140028 ("Waived Non-QCBT ATM
  Transactions", under "Visa® Debit Card") print an unconditional waiver and are kept. So `zero_not_printed`
  matches 1 live fee (141225). Before the review of #2977 it matched 2: 140028 was flagged, and 134219 survived only
  because the "Free ..." perk label above it counted as a price cell.
- Untagged audience rows: 1,858 live fees have no product while their bank prices the same name otherwise with no
  product, on 777 texts that could name an audience. Judged by `audienceSectionHeading` on the 2,500 characters
  above each stored line (lines the stored excerpt does not appear in as one line cannot match), 3 sit under an
  audience heading: Midwest Members FCU's 137448 "Copy of a Check", 137449 "Copy of a Statement" and 137483 "Fax
  Service", all $0 under "Senior Perks (60 & Over)". `audience_section_untagged` matches those 3.
- So the Darwin re-check reports 19 live fees (v2's 15, 1 `zero_not_printed`, 3 `audience_section_untagged`),
  switch off.
- Rate bound joined by "or": 5 texts print the shape; no live flat fee is priced at such a bound, on its stored line
  or on its text. Source check v31 takes down 0.
- The overdraft transfer, channel list, lineup and name fixes take down no live fee: Knox never retires a verified row.

**Re-run after the fix (the dry-run harness, `currentVariant` on the same stored texts, v178 vs v179):**

- rb10 (539 to 537 rows): Midwest's three seniors' $0s carry "Senior Perks (60 & Over)" and #162230's $1 is
  reproduced again; MassMutual's $3 is od_protection_transfer (matches live); North State's $0 is gone; Oklahoma's
  flat $2 is gone (both lines held as the 2% rate); LifeStore's $15 is Premier Checking's; Meridia's product is
  empty (live has none); Blackhawk's fee is "Monthly service charge".
- rb (Midwest's older copy, text 27658), rb3, rb6 and rb9 change one product each (Senior Perks, Interest Checking
  Account, Tiered Interest Checking, Value Checking), each checked against its text and right; rb2, rb4, rb5, rb7 and
  rb8 do not change.
- Live fees not reproduced: 382 to 381 across rb to rb10 (rb10 45 to 44). No right read is lost.

**Not fixed, for the Knox tracker:**

- Greater Valley's slashed pairs ("$2.00/$5.00 per check"). Holding a slashed pair as a range was tried: it held
  live-matching tier and split rows on the harness ("$10.00/$20.00/$30.00", "Fee $30.00/$50.00 legal", "$6.00/$7.00
  (mailed)"), and narrowed to a pair that ends the line it still matched about 70 live fees that are split
  correctly. A pair needs the page's own column labels to say which price is whose.
- St. Mary's card column: telling a two-column table's card column from its account column needs heading tracking
  per column.
- Run-together names ("Overdrafttransfer(from shareaccount)") are left as printed: splitting glued words needs a
  dictionary and would re-key existing names. MassMutual's other 18 fees are unchanged.
- Oklahoma's 2% cash advance rate is held untraced rather than published as a rate.
- Midwest's live seniors' $0s with no product (137448, 137449, 137483) read like general prices until the Darwin
  re-check's switch is on; the re-read publishes them under "Senior Perks (60 & Over)" beside them.

**Guard:** `src/lib/agents/knox/backlog-dry-run-10.test.ts`, `src/lib/agents/darwin/section-misread-check.test.ts`.
**Agent lesson:** knox/backlog-dry-run-10-2026-11-03-the-line-must-say-it
