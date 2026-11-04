# 2026-11-03: The ninth re-read backlog dry run found a returned item service read as NSF and a transfer filed by its heading

**What happened:** after Knox v177 fixed the eighth dry run (`2026-11-03-knox-backlog-dry-run-8-misreads.md`),
a ninth read-only dry run for `KNOX_REREAD_BACKLOG_LIVE` took 40 more backlog texts (rb9: 20 top, 12 live random,
8 no-live random) at Knox v177 and compared every changed read with the bank's own line. Of 91 changed rows on 23
texts, 82 were right, 2 wrong, 5 doubtful and 2 duplicates only; no correct live fee was lost. All of rb8's wrong
reads stayed fixed.

- Wrong. First Bank (doc 4031, text 4694, line 23): "Returned Items Special Handling Service Fee1 (Business) |
  $30.00 | Per Month" was read as an NSF fee. The page's own NSF fee is line 17's "NSF Return Item Fee | $30.00 |
  Per Item".
- Wrong. Library of Congress FCU (doc 17945, text 13456, line 229): "Automatic transfers from shares | $2.00" under
  "ATM /VISA DEBIT CARD" was filed atm_non_network.
- Doubtful. Clinton Savings Bank (doc 8231, text 7843): its monthly maintenance charges sit under two-column lines
  whose first cell titles the account ("Basic Checking Account | ATM/Debit Card Replacement | $ 10.00"), and the
  $5 took "Dividend Checking Account" from further up.
- Doubtful. Flora Bank & Trust (doc 31104, text 28783): "A service charge of $7.50 will be charged if the balance
  falls below $50.00 during the quarter." was named "(A service charge".
- Doubtful. A monthly maintenance fee read with no account from a product or FAQ page: ECA FCU (doc 29283, text
  26750) "Waived $5.00 monthly maintenance fee", a reward bullet, read twice ($5 "Monthly maintenance fee" and
  "Maintenance fee"); U.S. Bank (doc 41221, text 39773) "Your $12 monthly maintenance fee is waived for the first two
  statement cycles ..."; Millersburg (doc 34979, text 33080) "$4 Monthly Service Charge".
- Doubtful. Clearview FCU (doc 25021, text 22205): a FAQ's two sentences about the one free overdraft protection
  transfer gave two $0 reads ("Overdraft Protection transfer", "traditional Overdraft Protection transfer").

**Why (root cause):**

- First Bank: the NSF family rule reads "returned item" as NSF, and nothing knew that a handling service for
  returned items (special handling, a re-clear, a reroute, a service fee priced per month) is a service, not the
  charge for the item.
- Library of Congress: no rule classified an automatic transfer from shares or savings on its own name (only one
  "to checking" or "to cover overdrafts"), so the heading join gave it the heading's category; the guard had no
  include for the name either.
- Clinton: the product lookback skipped every line with cells, so a two-column line's first-cell title was never
  read as the account.
- Flora: the name kept an opening bracket it never closed, and nothing dropped it.
- ECA and U.S. Bank: a monthly maintenance fee printed in a reward bullet or a "Your $12 ..." sentence names no
  account, and the reader published it as if the page's only account were known.
- Clearview: each sentence named the transfer in its own words, so the two $0 reads did not look alike.

**Fix (Knox v178; guard v109):**

- rules.ts `returnedItemServiceName`: an NSF read whose name prices special handling, a re-clear or a reroute, or a
  service fee priced per month, is held unclassified. A name that says NSF ("Non-Sufficient Funds (NSF)/Special
  Handling", live 108799) stays NSF.
- fee-fold.ts `AUTOMATIC_TRANSFER_FROM_SAVINGS`: "Automatic transfer(s) from shares/savings" (optionally "to cover
  overdrafts") classifies od_protection_transfer on its own; guard v109 widens od_protection_transfer's include with
  the same words (accept-only).
- lineup.ts `twoColumnAccountCell`: a two-column line printed right above the fee, whose first cell is a short
  account title (ends on an account word, has no fee or service words) and whose fee sits in the first column, heads
  the account. It never gives the other column's price that account, and never reads a table row's label beside a
  value ("Interest-bearing account | No | No | Yes").
- layout.ts `tidyFeeName`: a bracket that opens a name with an article and never closes is dropped.
- accountless-monthly.ts `accountlessMonthlyReason`: a monthly maintenance read from a reward bullet ("Waived $5.00
  monthly maintenance fee") or a "Your $12 monthly maintenance fee ..." sentence is held for review
  (eligibility, with its reason in the linked conditions).
- specialists.ts `tailTwinRead`: a later $0 read of a non-account fee whose prose sentence names the earlier read's
  fee again ("... a traditional Overdraft Protection transfer") is the same fee and is dropped, read or held.
- Review of #2973: `ira-section-fee.ts` no longer ends the IRA section on the IRA's own distribution, rollover,
  contribution, trustee or transfer-out rows, or on rows naming an IRA; `waiverAdviceName` reads waiver choices that
  each file under the whole name's category as that fee ("Use Non-Network ATM or Foreign ATM | $2.50" is
  atm_non_network again), while Honor's choice of ways ("Use Online BillPay, HonorPay or Account-To-Account
  Transfers") stays held.
- Darwin's section misread re-check v2 (`darwin/section-misread-check.ts`, switch `SECTION_MISREAD_TAKEDOWN_LIVE`
  off) adds two rules: `returned_item_service` (by name, with the published frequency) and
  `accountless_monthly_sentence` (on the line Knox stored).

**Live fees (read-only, Nov 3, prod `rmhwbbjjctzfaqjyhomu`, SELECT only):**

- Returned item services: 3 live fees match (21594, 102861, 105649), none admin-corrected. 108799 says NSF and stays.
- Accountless monthly sentences: 1 live fee's stored line is one (117986, "Waived $10 monthly maintenance fee",
  Trumark FCU text 32377), and after the review of #2976 it is kept: its page's product table prints "$10 or $0 |
  Monthly Fee | $0" and "Monthly Fee" / "$10 or $0". So 0 match.
- Automatic transfers from savings or shares: 18 live names say one (6 match the new include itself; none names a
  savings club), all already od_protection_transfer and all accepted by guard v109, so it takes down 0 and
  re-files 0.
- IRA section follow-up: 2 more live early closure fees become candidates (158072, 165843); neither matches, so the
  IRA count stays 6.
- Waiver choices: the waiver rule still matches the same 2 live fees (77750, 68504).
- So Darwin's re-check reports 15 live fees (2 waiver, 2 front matter, 2 wire modules, 6 IRA, 3 returned item
  services); the take-down waits for James's yes. The lineup, name tidy and twin fixes take
  down no live fee: Knox never retires a verified row.

**Re-run after the fix (the dry-run harness, `currentVariant` on the same stored texts, v177 vs v178):**

- rb9 (610 to 605 rows): First Bank's special handling is held; Library of Congress' transfer is
  od_protection_transfer; Clinton's charges take Preferred ($15), Dividend ($10), Basic ($5) and Total Access ($3)
  Checking Account; Flora's garbled name is gone (the $7.50 is held untraced); ECA's reward bullet and U.S. Bank's
  sentence are held; Clearview's second $0 is dropped.
- rb, rb6 and rb8 each change one row's product only (each checked against its text and right); rb2, rb3, rb4,
  rb5 and rb7 do not change.
- Live fees not reproduced stay 313 across rb to rb8 and 24 in rb9. No right read is lost.

**Review of #2976 (fixed in the same PR):**

- Blocker: the reward bullet and "Your $X" hold judged only the read that survived the duplicate drop, so a
  sentence printed before the page's real row at the same price ("Your $10 monthly maintenance fee is waived ..." /
  "Monthly maintenance fee | $10.00") held the real price. `accountlessMonthlyOnPage` now judges the page: a row
  printing that monthly fee at that price (name before price, a cell of the price's line, or a prices-only line
  right under the name) keeps the read, which takes the row as its line so the lineup gives the row's account;
  an account heading right above the sentence ("Premier Checking" / "Your $10 monthly service charge can be avoided
  with direct deposit.") keeps it under that account (decided: the sentence speaks of the account named right above
  it). Darwin's rule uses the same function on the text Knox read, which keeps live 117986.
- "Returned Item Charge (Special Handling) | $15.00" reads as NSF again: special handling in a bracket after the
  charge is a note. Live 105649 "Special Handling of return check" names the handling itself and is still held by
  Knox and reported by Darwin; the returned item service count stays 3 (21594, 102861, 105649).
- "Automatic Transfer from Savings (Christmas Club)" no longer matches the overdraft transfer: a bracket naming a
  club leaves the name unmatched.
- A two-column first cell heads the fee only when the fee's own line prints the other column too (a second price
  after the fee's), so "Premier Checking" / "Money Market Savings | Money Orders | $5.00" / "Monthly maintenance fee
  | $5.00" stays Premier Checking. Clinton's rows all print both columns and keep their accounts.
- Re-review nits: a row stands for the sentence only when its own name is the monthly fee (the words before
  its price, or every named cell of a line that opens on its price), so "Safe Deposit Box 3x5 | $10.00 | Monthly
  Fee" and "Online Bill Pay | $5.95 | Monthly fee" leave a "Your $X" sentence held and never become its line; and
  the row must sit under the sentence's own account (its first cell or the heading above it, against the heading
  above the sentence; either unknown counts as the same), so "Basic Savings | Monthly maintenance fee | $10.00"
  leaves a bullet under "Rewards Checking" held. Trumark's table rows still stand, so live 117986 stays kept.
- Re-run: harness rows across rb to rb9 unchanged (rb9 605), live fees not reproduced 313 and 24; live counts
  unchanged (section misread 15, guard v109 re-files 0).

**Left for the Knox tracker:**

- Millersburg's "$4 Monthly Service Charge" on a product page naming more than one account still publishes with no
  product. Holding a monthly maintenance read on such a page was tried and dropped: on the harness it held 8 reads
  that reproduce live fees (Byline, Elkhorn, First Interstate) and 6 new reads, and a narrower, SQL-mirrorable form
  still lost 10 live-matching rows.
- ECA's "If all account requirements are not met ..." $5 "Maintenance fee" publishes with no product.
- Flora's $7.50 quarterly service charge is held untraced rather than read under its savings account.
- Clinton's $3 and $15 now publish under their products while the live rows carry none, and its two-column rows'
  second-column fees (Treasurer's Check $5, Stop Payment $30) still take "monthly" from the first column's charge.

**Guard:** `src/lib/agents/knox/backlog-dry-run-9.test.ts`, `src/lib/agents/darwin/section-misread-check.test.ts`.
**Agent lesson:** knox/backlog-dry-run-9-2026-11-03-a-row-names-its-own-fee
