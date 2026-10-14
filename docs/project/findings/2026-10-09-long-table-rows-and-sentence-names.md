# Long table rows untraced, sentence fragments read as names (Arvest, Old National, 9 Oct 2026)

**Arvest (78), document 23381.** The fee page is a four-column table: Type | Additional Details |
Amount | Action. Knox read the overdraft row as raw 449097 ($17), but held it as `untraced`.
The shared source check splits lines longer than 300 characters at sentence ends, so the long
details cell left the name in one piece and "$17.00" in another. Other rows on the page had
different problems:
- An "N/A" or a sentence in the details cell was glued onto the name ("ATM or Debit Card
  Replacement: N/A"), and Darwin rejected those rows.
- Rows whose details cell named nothing, such as "Stop Payment Order | Initial order or a
  renewal | $30.00", gave no fee at all.
- The overdraft fee was read as "daily", from "four (4) OD fees per day" in the details, instead
  of the row's own "per item".

**Old National (41), document 23326.** On the Everyday Checking page, prose became names:
- "Otherwise, a monthly service fee of $6.95." was named "Otherwise, a monthly service fee".
- "Go green with eStatements to avoid $3 paper statement fee" was named "Go green with
  eStatements to avoid", and held as unclassified.
- The page does not list an early-closure fee.

**Fix (Knox v57).**
- The source check also reads a long table row from its short cells: name | price | unit.
- `tidyFeeName` drops an "N/A" cell, a details cell after the name, and a leading "Otherwise,"
  (or similar connecting word) together with the article after it.
- "to avoid $X <name> fee" is named by the words after the price.
- A markdown table row is named by its first cell when nothing else names it.
- A fee whose row traces takes its frequency from that row.

The seven-state gate (744 right / 42 wrong) and the Texas gate (509 / 14) are unchanged from main.
The same name-noise class appears in the whole-record sample of 9 Oct (class 3).
