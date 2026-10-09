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
- A name ending on "a", "an", "of" or "the" counts as a cut-off sentence.
- Every place a name is printed counts.
- A one- or two-digit footnote mark after a name's last letter is still part of the name.
- Up to six words, digits included, may sit between a name and its price.
- Check version 2 (`same_line_check: 2`) decides again only the box-size rows that check 1
  skipped as identical. 895's wide identical check still applies to them.

## Dry read (prod, 9 Oct, before merge)
- **Box rows:** 81 rows were skipped by check 1. 14 would publish, and all 14 match their source
  line and price: 54131, 56741, 56883, 62572, 102035, 103876, 108818, 113118, 119628, 119630,
  120059, 120209, 120418, 120438.
- **CBB 3 x 5 (119627)** stays skipped. The live line 103534 ("2.5 x 10" at $45) is the former
  price of the 2.5 x 10 box, so that live row is the misread, not the skip.
- **902's 208 flags:** 103621 (the footnote case) and 104744 ("Drilling Fee & Key Replacement" vs
  "3x10") clear, and both are real separate lines. The "every place" rule alone would also have
  cleared 104637 against "GUASFCU charges a". That is a sentence restating the check copy fee;
  the cut-off-sentence rule keeps it flagged.
