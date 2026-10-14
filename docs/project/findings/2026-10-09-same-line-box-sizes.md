# Same-line check read box sizes as one line

**Found:** 2026-10-09, by Largest banks and the Hamilton publish thread.

## What happened
Citizens Business Bank's 5 x 5 ($60), 5 x 10 ($110) and 3 x 5 ($45) safe deposit boxes (verified
119628, 119630, 119627) never published. Hamilton skipped each as identical to a live box on the
same page at the same price. Four separate gaps in the same-line check (`publish.ts`) caused it:

- `significantWords` drops all-digit words, so "3 x 5" and "2 x 10" both read as {x}.
- `unclearName` treats a name that does not start with a capital as a cut-off line, which covers
  every box size.
- `linesApartOnPage` looked only at the first place a name was printed. "5 x 10" first appears
  inside "2.5 x 10".
- The price had to follow the name within six letter-only words, so the second column of a
  "former fee | new fee" table never counted.

The same page check also missed a name with a footnote mark glued on ("Premium overdraft fee2").
Because of that, the same-line duplicate cleanup (PR 902) flagged 103621 as a duplicate of
"Insufficient funds fee - paid". The two are separate $30 lines.

## Fix
- A box size ("3 x 5", "2.5x10") is one word and may start a name.
- A box of another size that the page does not print at all is a separate line. CBB's 3 x 5 at
  $45 sat behind a misread "SAFE DEPOSIT BOX: 2.5 x 10" at $45.
- A box name the page prints without this price is not set apart. In a price-first table
  ("$25.00 Safe Deposit Box 3x5"), the price after a name belongs to the next line.
- A name ending on "a", "an", "of" or "the" counts as a cut-off sentence, and zero-width
  characters are ignored.
- Every place a name is printed counts.
- A one- or two-digit footnote mark after a name's last letter is still part of the name.
- Up to six words, digits included, may sit between a name and its price.
- Check version 2 (`same_line_check: 2`) decides again only the box-size rows that check 1
  skipped as identical. 895's wide identical check still applies to them.
- The duplicate cleanup counts an older line from another document only when one name reads as
  the other.
- `SOURCE_CHECKED_SEPARATE_LINES` lists five flags that a source review found to be lines of
  their own, which the check cannot tell apart. Their flags clear through the second look.

## Dry read (prod, 9 Oct, before merge)
- **Box rows:** 15 of the 81 box-size rows skipped by check 1 would publish, and all 15 match
  their source line and price: 54131, 56741, 56883, 62572, 102035, 103876, 108818, 113118,
  119627, 119628, 119630, 120059, 120209, 120418, 120438.
- **Price-first table:** without the printed-without-price rule, the price-first table in
  doc 12680 would have published 57120 to 57124 at the next line's prices.
- **902's 208 flags, random 20 against source:** 19 are true duplicates. 104895 (Loan Refinance vs
  Loan Application) is not.
- **Flags cleared, 9 in total:**
  - By the rules: 103621 (footnote mark), 104744 (box size), 104895 (zero-width character) and
    105054 (another document's unrelated name).
  - By the source-checked list: 104713, 104650, 104875, 104615 and 104906.
- **Swapped:** 104758 ("Night Deposit Key Replacement (Business)") stays live. Its older twin 14458
  is the garbled read ("ACH, one-time ... Night Deposit Ba"), so 14458 goes through the second
  look instead (`REVIEWED_REPEATS`, from UAT).
- **Reviewed repeats** (from Data inventory):
  - 83889 "Returned Items: Monthly Fee" $15 repeats 83890 "Monthly Fee (if average daily
    balance falls below $5,000)" on the same printed line.
  - 87575 "ATM TransacƟon Fee" $3 repeats 85596 from a sibling copy of the schedule.
  - Both go through the same flag and second look, keeping 83890 and 85596.
- **Kept flagged:** without the cut-off-sentence rule, 104637 would have cleared against
  "GUASFCU charges a". That is a sentence restating the check copy fee, so it stays flagged.

## Balance-named lines (SCCU, same PR)
SCCU's Interest Checking low balance fee ($15/mo, verified 119831, from the Interest Checking
page, doc 23995) sat behind the live "Money Market Savings Account (below $2,500)" $15 line from
the fee schedule (79501). SCCU's schedule lists both "Money Market Savings Account (below $2,500)"
and "Interest Checking (below $1,500)" at $15/mo, so they are separate fees.

**Fix:** a live line at the same price that names a balance ("below $2,500") is another fee in
two cases:
- this row names a different balance;
- it comes from another document, and this row's page never prints that balance.

Check 2 decides again the identical skips made against such a line.

**Dry read:** about 45 unchanged rows sit behind a live line that names a balance. Two flip, and
both are separate fees on their source:
- 119831, SCCU Interest Checking;
- 56431, "Minimum Balance Fee (if Balance is Below $7,500)" for Business Checking Plus, beside a
  "Below $1,000" line.

**Duplicates:** raw 468046, the second read of the same SCCU line, is not verified yet. Once
119831 is live, the same-name same-document check skips it as identical.

## When the older line is the bad read

After 920 went live, the cleanup flagged 104667 ("All Money Market Accounts Withdrawals in excess of
6 per month", $5) as a repeat of 70143 ("Transactions in excess of 6 per month will be subject to a",
$5). Archiving 104667 would have left the cut-off name live. The cleanup now checks which side is
unclear: when the newer line's name is clear and the older live line's name is cut off, the newer
line passes (clearing its flag) and the older one goes through the same flag and 12h second look.

## Glued cells in run 3467, and the stale-copy skip

Run 3467 (10:53:35 UTC) published 55 rows (106290-106344). UAT found three bad names among them.
Against source:
- 106318 (Keys FCU, doc 2628) "(balance falls below $1,000)" at $15 under check_image is wrong. A
  three-column page joined Keys Premier Checking's low balance line to "Copy of Check $3.00". It is
  now a hand-checked `wrong_category` verdict, so it goes through the 12h look. Publish now holds
  any name that would show only a parenthetical condition (`condition_only_name`).
- 106315 "(Fee depends on style of check selected): Rental Late Fee (Past Due 30 Days)" at $20 and
  106333 "3x10” 8" at $60 have the right price and category: the source prints "Rental Late Fee
  (Past Due 30 Days) $20.00 per Year" and "3x10” 8 | $60.00" (8 is a footnote). Only the name is
  off, so they stay live for a rename rather than coming down. Publish now drops another line's
  leading "(...):" cell and a box size's footnote number (`withoutNeighbourCell`). Live rows with
  these shapes (21 leading-cell names, 4 box footnotes on Oct 9) need Knox's logged retidy.
- 56431 (OnTap, "Below $7,500" $15) was skipped as an older document because the October copy of
  the page had live lines at $2,500 and $1,000. The October copy still prints the $7,500 line, so
  that skip was wrong. Publish now treats a balance-named row as current when the newer copy prints
  its balance and price (`newerCopyPrintsLine`), and check 3 re-decides the 2 rows skipped that way.

## 56431 published without its balance

After PR 930, 56431 published as 107240 under the name "Minimum Balance Fee". The verified name is
"Minimum Balance Fee (if Balance is Below $7,500)". `publishedFeeName` took Knox's cut-off repair,
which trims the "(if ...)" condition. Publish now refuses any repair that `dropsCondition` flags,
which is the same bar retidy v15 uses. The live name of 107240 needs a logged rename back to the
verified name.
