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
  look instead (`GARBLED_OLDER_TWINS`, from UAT).
- **Kept flagged:** without the cut-off-sentence rule, 104637 would have cleared against
  "GUASFCU charges a". That is a sentence restating the check copy fee, so it stays flagged.
