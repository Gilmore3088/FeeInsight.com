# 2026-10-22: Knox did not read a two-column line's fee that only its column heading names

A two-column fee schedule flattened row by row prints two fees on one line, one per column, and each
column has its own heading. A bare row in either column ("Domestic Outgoing", "Customer") is a fee
only under its own column's heading.

**What happened:** #2546's grouping of the shadow lab's answer-key misses counted about 32 in 8
documents on lines that carry two fees, where one of the two is named by a column or section
heading. Listing them again by layout shape, only some have that cause alone. Example lines:
- State key 1338 (Ameris Bank): "ACCOUNT ASSISTANCE | WIRE TRANSFERS" over "Garnishments and Levies
  | $100.00 | Domestic Outgoing (branch assisted) | $35.00".
- State key 10193 (U.S. Century Bank): "Cashier's Check | Stop Payment | $35.00" over "Customer |
  $10.00 | Internal Transfer | $10.00".
- State key 8085 (Seacoast): "WIRE TRANSFER | Notary Services" over "Domestic | Customer | $ | 3.00"
  and "Outgoing (In branch assisted) | $ 37.00 | Non-Customer | $ | 5.00".

**Cause:** Knox's table pass (`tableRowsFromText`, `extractFromTableRows`) reads a line's first
name and price pair only, and lends a bare name only the last heading printed on a line of its own.
A heading printed beside another column's heading, or in a cell that opens a priced line, was never
a heading to it. So a right-hand direction was never read, and a left-hand customer type under a
heading cell was held unclassified.

**Fix:** Knox rules v102, table pass v9. `columnHeadingRows`
(`src/lib/agents/knox/column-heading-rows.ts`) keeps one heading per column:
- A line of two heading cells and no price sets both columns' headings.
- A heading cell that opens a line, before a pair or with none, sets the left column's. A bare
  direction there ("Domestic", "International") is a sub-heading of the left heading above.
- A heading cell after a line's last pair sets the right column's.
- A heading lasts while its page's lines are priced cell rows, and 8 lines past them.

On each line, the first pair belongs to the left column only when it opens the line; any other pair
is the right column's. A pair gets a row under its column's heading only when its name needs one:
- No rule files the name alone.
- Without its notes, it is a direction, a customer type or a size (`composableTail`).
- It is not only a unit or a sequence ("Each additional", "Per item").
- It names no service of its own (wire, transfer, cash, withdrawal, account).

A price split over two cells ("$ | 3.00") is joined first. The table pass then files the row only
when heading and name together name a fee, and holds a range as a range. These rows come after every
row the table pass read before.

Admit-only: no read is dropped, held or re-filed. Knox's self-check traces each new read on the
stored text with the shared check (`checkFeeAgainstSource`). Across every Texas, seven-state and
shadow-lab text, the only change is four new right reads and four new untraced holds; no other read
moved. The first cut lent "Temporary Checks | 4 personalized checks for $5.00" to the rows under it
("Wire Transfers (VeraBank customers only) - Outgoing", Texas key 2414), a new wrong read the Texas
gate caught. Now a name with a service of its own borrows no heading, and a heading cell with its
own price beside it ends the heading above.

Shadow lab, before -> after:
- Answer-key recall: 940 -> 944 of 1,312 (71.6% -> 72.0%).
- All-expected recall: 1,302 -> 1,306 of 1,766.
- Known-wrong fees published: 34 of 160, unchanged.
- Names: 313 of 317, unchanged. Fees outside the keys: 35, unchanged.
- Ratchet: 4 gained, 0 lost, locked in `ratchet-baseline.json`: 10193 cashier's check $10, 1338
  domestic outgoing wire $35, 8085 notary $3 and $5.

Gates, before -> after:
- Seven-state gate: 903 -> 907 right (FL 137 -> 140, GA 185 -> 186). 34 wrong, unchanged.
- Texas gate: 590 right / 11 wrong, unchanged. Held out: 60 / 4, unchanged.

Left out, each for its own cause:
- Dot-leader two-column lines with the right heading on a priced line ("Debit/ATM PIN
  replacement.....$5.00 | Wire transfers (outgoing)" over "Official checks.....$5.00 |
  Foreign.....$30.00", keys 6730 and 8240). The shared source check takes no heading from a priced
  line, so these reads would only be held untraced. The same holds for 8085's wires under the
  "Domestic" and "International" sub-headings: Knox now reads them, the self-check holds them
  untraced (4 new holds), and none is published. A fix belongs in the shared check, with its own
  Darwin re-check.
- 1338's online-banking wires ("Domestic Outgoing (Business Online Banking)"): the category guard
  reads "Online Banking" in the name as another service.
- 1338's international branch wire ($50): the international-wire scope check (#2278) keeps it out.
- 10193's Non-Customer cashier's check ($35): above Darwin's cashier's check envelope ($25).
- Rows that only a heading can classify, not a bare direction ("Monthly Statements Cycle" and
  "Quarterly Statements" under "Dormant Deposit Accounts"; "Mortgage Payoff Processing Fee" and
  "Reamortization schedule" under "LOAN", keys 10193 and 8085). These need heading-aware
  classification.
- #2064's box size under a "Night Deposit Bags" heading: this mechanism never lends a heading to a
  name a rule already files, and re-filing a box read would not be admit-only.
- Self-named right-hand fees on dot-leader lines that Knox does not read ("Counter/Temp Checks (4
  cks)....$5.00", key 3981): a different cause.

The stale-read floor stays at v97 and name re-tidy at v26. Live documents get v102 on their next
read. No count of stored texts with this layout has been run: this session had no database access.

**Lesson:** A two-column line is two rows, each under its own column's heading. Name a bare pair
only by its own column's heading, and only when the name is a direction, customer type or size with
no service of its own.

**Guard:** `src/lib/agents/knox/column-heading-rows.test.ts`; the seven-state gate floors (FL 140,
GA 186, all 907); the shadow lab ratchet baseline. Agent lesson: knox/column-heading-rows.
