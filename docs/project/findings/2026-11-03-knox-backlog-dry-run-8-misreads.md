# 2026-11-03: The eighth re-read backlog dry run found prices named or filed by another part of the page

**What happened:** after Knox v176 fixed the seventh dry run (`2026-11-03-knox-backlog-dry-run-7-misfiles.md`),
an eighth read-only dry run for `KNOX_REREAD_BACKLOG_LIVE` took 40 more backlog texts (rb8) at Knox v176 and
compared every changed read with the bank's own line. Of 112 changed rows, 94 were right, 5 wrong and 12
doubtful; no correct live fee was lost or replaced.

- Wrong. Honor FCU (doc 6435, text 4644, lines 183-193): "Wire Transfer Fee - Domestic | $20.00 per wire | Use
  Online BillPay, HonorPay or Account-To-Account Transfers | • Verification of Deposits | $25.00 each" gave
  "Use Online BillPay, HonorPay or Account-To-Account Transfers: Verification of Deposits" $25 filed bill_pay,
  and the next line's "$50.00 per month", which only the waiver column names, a bill_pay $50.
- Wrong. Mattel FCU (doc 17062, text 12602, line 39): "Early Closure Fee (if <59 1/2 ) | $ 30" under
  "Individual Retirement Account (IRA) Fees | Elite" was filed early_closure (and renamed live 56206).
- Wrong. Citizens National Bank of Crosbyton (doc 42167, text 40702): "Cashier Checks (Non-Banclub Member" $10,
  the cap of "$1.00 Minimum or 1% up to $10.00", read as a flat price from the page's meta description.
- Wrong. First-Citizens Bank & Trust (doc 42352, text 40703, line 718): "Domestic wire transfer base module
  (per month)D | $20.00" filed as a domestic outgoing wire; the international module on line 722 was held.
- Doubtful. Honor's "Account Reconciliation" $30 carried the waiver column in its name; Mattel's "Real Estate
  Reconveyance (up to...)" $300 took "each month" from the next column's prose; Primis Bank's Premium Checking
  $10 lost its product; Elkhorn Valley Bank's savings charge took "IRA" as its product; First-Citizens'
  "International wire origination for USD (each)D | $45.00" was held while the FX $0 was read; and
  First-Citizens' QuickBooks/Quicken digital banking and bill pay bundles were filed bill_pay.
- Doubtful, not fixed here: business-section rows read with unknown audience (Thinkwise, 1st National, Lake
  Elmo, First-Citizens business rows).

**Why (root cause):**

- Honor: a later price's own words ran from the end of the earlier price to it, so they took the waiver column
  as well as the bullet item, and the name started at the advice. Nothing knew advice on avoiding a fee names
  no fee, and the family expert read the same advice as a bill pay name.
- Mattel: no reader knew a section's owner: the IRA title sits beside a price column label ("| Elite"), and the
  row's own words say early closure.
- Crosbyton: Rosetta keeps a page's front matter ("canonical:", "meta-description: ...") at the top of the text,
  where the page's words run together with no cells, so a price takes the wrong words.
- First-Citizens base module: no rule told a monthly wire service module from a wire's price. The $45 is held
  because "origination" names no direction to the international wire review, so only the FX $0 reaches Darwin.
- Mattel #28: the frequency was read from the whole segment, including the next column's prose.
- Primis: the "BEST FOR ... checking balance ..." marketing label read as a checking heading naming no account
  and stopped the product lookback. Elkhorn: the product lookback took the last entry of a product tab list.

**Fix (Knox v177; table and guard unchanged):**

- rules.ts `laterPriceOwnWords`: a later price's own words start at the last bullet cell after the earlier
  price. `waiverAdviceName`: a later price named only by advice ("Use ...", "Enroll in ...", "Maintain ...") is
  held unclassified; a service name ("Use of Foreign ATM", "Use at NON-MCU ATM") or a name with its charge
  ("... request a paper statement for a") is a fee name. The family expert skips advice names too.
- `custom-report/ira-section-fee.ts` `iraSectionClosingFee`, applied by `iraSectionClosingRead` to every
  specialist's early closure read: a closing printed only in an IRA's own section (a title naming an IRA or a
  retirement account, alone or as a line's first cell, listing no other account) is ira_termination.
- specialists.ts `withoutFrontMatterLines`: the front matter's meta and canonical lines are blanked before any
  reader runs (line count kept).
- rules.ts `wireServiceSubscription`: a wire read whose name prices a module, package or subscription (not a
  wire sent through one) is held unclassified.
- rules.ts `withoutTrailingProse`: cells of next-column prose after the last price are left out of the
  frequency text.
- lineup.ts: a product card's marketing label (`MARKETING_LABEL`) is skipped by the product lookback; the last
  entry of a product tab list (`inProductTabList`: four short title lines, three heading an account, unless it
  repeats a tab above it) ends it with no account.
- Found by the golden-set gate on this change: the IRA rule moved golden-set case `wrong_amount:17477` ("IRA
  Closing Fee | $50.00 if closed within two years. Minimum balance is $500.00 ...", a $500 read taken down) from
  early closure to ira_termination instead of dropping it. rules.ts `minimumBalanceStated`: a sentence that states
  the minimum balance ("Minimum balance is $500.00") gives a balance, not a price, unless its clause names a
  charge ("Penalty for falling below the minimum balance is $8.00", live 137774, still read). The case moves from
  the gate's known misses into its cases (refused by Knox).
- Darwin's section misread re-check (`darwin/section-misread-check.ts`, `darwin.section_misread`, switch
  `SECTION_MISREAD_TAKEDOWN_LIVE` off): live fees matching any of the four new rules, by name or, for the IRA
  rule, on the text Knox read.

**Live fees (read-only, Nov 3, prod `rmhwbbjjctzfaqjyhomu`, SELECT only):**

- Waiver column names: of 31 live candidates the name pre-filter selects, 2 match: 77750 "Use Online BillPay,
  HonorPay or Account-To-Account Transfers: Verification of Deposits" $25 (bill_pay) and 68504 "Use Online
  BillPay or Account-To-Account Transfers: Gift Card" $3 (bill_pay). 18786 (the same Honor line, account_verification)
  names the right fee in a long name and stays.
- Front-matter names: 2 match (101378, 167014, Citizens Bank, account_research $30). 11 more live fees were read
  from front-matter lines under proper names (9 at institution 3294, 102232 and 101379); they stay live.
- Wire modules: 2 match (152355 "International Wire Module" $20, 85500 "Premium Package (per month) (includes ACH
  & Domestic Wire access)" $30). No live fee is a "base module".
- IRA section closings: of 1,069 live flat early closure fees on a text that names an IRA, 6 match (63736,
  94053, 136541, 156197, 159259, 159533), found with a Postgres mirror of the rule and each checked with the
  rule on its text.
- Minimum balance sentences: 1 live flat fee's line says "minimum balance is" its price (137774, a penalty for
  falling below it), and v177 still reads it.
- The front-matter skip, frequency and lineup fixes take down no live fee: Knox never
  retires a verified row.
- So Darwin's re-check reports 12 live fees; the take-down waits for James's yes.

**Re-run after the fix (the dry-run harness, `currentVariant` on the same stored texts, v176 vs v177):**

- rb8: Honor's $25 and $30 are named by their bullet items, the $50 is held; Mattel's $30 is ira_termination;
  Crosbyton's flat $10 is gone; First-Citizens' base module is held; Primis' $10
  keeps "Premium Checking"; Elkhorn's charge has no product.
- rb4: six reads of Citizens Bank's (text 40584) front matter are gone; its body rows are read as before.
- rb, rb2, rb3, rb5, rb6 and rb7 do not change.
- Across rb to rb8, the harness rows (new publish reads and reads matching a live fee) go from 5,273 to 5,263
  (new publish reads 1,041 to 1,035), and the live fees not reproduced stay 313. No right read is lost.

**Review of #2973 (fixed in the same PR):**

- The IRA section reached past its end: it ended only on a first cell ending in fees, charges or services and
  kept 20 lines. It now ends on a row whose first cell names another account kind ("Checking Accounts | Early
  Account Closure | $25.00", "Money Market | ...", "Share Certificates | ...", "CERTIFICATE ACCOUNTS | ...", "Other
  Fees (All Accounts) | Stop Payment | $25.00") and at the first general service row (wire, copies, money order,
  stop payment); under a title line of two section titles ("IRA FEES | CHECKING ACCOUNT FEES") only the IRA's
  column of each row counts. A name printed in both an IRA row and a certificate row stays early_closure.
- The waiver hold took "Use Non-Network ATM | $2.50" and "Switch to paper statements | $5.00": advice that names
  one fee's type is that fee; only advice naming no type, or offering a choice of ways, is held.
- The wire hold took per-wire prices ("Outgoing domestic wire, Business Package", "Outgoing international wire –
  Treasury Module", "Domestic Wire Out (subscription required)"): only a price for the module itself (a base
  module, priced per month, a module or package fee, or a name whose head is the module) is held. Darwin uses the
  same function.
- A tab entry printed right above the fee ("... / Premier Checking" / "Monthly Service Charge $10") keeps its
  product.
- Trailing prose erased the fee's own terms ("| You will be charged each month ...", "| Charged monthly if ...");
  only a cell that carries on another column's sentence (opens in lower case) is left out. The harness showed
  v177 had also erased two right frequencies (rb3 40221 NSF per item, rb6 4106 ATM per transaction); both are back.
- Re-run: harness rows across rb to rb8 unchanged (5,263); the only frequency change from v176 is Mattel's
  reconveyance. Live: the same 12 fees match (each rule only narrowed; each of the 12 re-checked with the new
  rule). 63736 stays: its "IRA Share Savings Account Fees" title shares a line with the right column's wire row,
  and "Account Closure Fee | $25.00" is the left column's IRA row, the last before the page's footer.

**Left for the Knox tracker:**

- The business-section audience rows: a section heading's audience is the audience lessons' work
  (`KNOX_AUDIENCE_LESSONS_LIVE`, off).
- First-Citizens' QuickBooks/Quicken bundles (bill_pay is arguable) and its ACH modules, read as ACH
  origination.
- First-Citizens' "International wire origination for USD (each)D" $45 stays held: reading "origination" as
  outgoing was tried and dropped, because the golden set forbids "Cash Management International Wire
  Origination" $10 (`shadow:not_a_fee:eval_critical:93480`), which that reading would publish.
- Crosbyton's "$1.00 Minimum or 1% up to $10.00" is not read as a rate fee with a minimum and cap.

**Guard:** `src/lib/agents/knox/backlog-dry-run-8.test.ts`, `src/lib/agents/darwin/section-misread-check.test.ts`.
**Agent lesson:** knox/backlog-dry-run-8-2026-11-03-the-rows-own-part-of-the-page
