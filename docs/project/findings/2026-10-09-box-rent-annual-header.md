# Box rents lose their period when "annual" is only in the column header (Oct 9, 2026)

Altra (104006) shows a $25 safe deposit box with no frequency. The schedule prints the period once, as
the box table's column header: "Box Size: | Annual Rental:" over "3 x 5 x 21 | $25". Knox keeps only
the row as the fee's excerpt, and the frequency fill reads only the excerpt, so the period never
reached the row. 1,614 live safe deposit fees named by a box size had no frequency.

Fix, frequency fill v10 (`boxTableAnnualHeader` in `src/lib/fee-frequency.ts`, box pass in
`hamilton/frequency-fill.ts`):
- The fee's own line still decides first.
- Otherwise the fill finds the row in its document's text and reads up to 12 lines above it for a short
  cell that says "annual", "per year" or "yearly". The cell prints no price and is not followed by one.
- The header line must not say "monthly". Every priced line between it and the row must carry a box
  size. So "Annual Fee | $10.00" (an IRA) above "Safe Deposit Boxes*" fills nothing.
- Only annual is read. A box table with no period, or one with a monthly header, stays blank.
- Each fill logs a `frequency_filled` lesson with `basis = box_table_header`.

Dry read on prod data (08:40 UTC), using 1,200 characters of each document above the row:
- 633 of the 1,614 rows fill as annual, across 147 documents. The prod run reads full texts and may
  differ slightly.
- Hand check of 20 rows against their source text: 19 right, 0 wrong fills.
  - All 14 filled rows print an annual header over the box table.
  - 5 of the 6 rows left blank have a box table that states no period.
  - 1 row was missed: 54529 sits under "Safe Deposit Box Annual Rental", but a glued "Legal Process
    $25.00" line between them stops the read. It stays blank, so nothing wrong is written.
- No live box table had a monthly header. The unit tests cover that case.

Still blank: headers longer than 40 characters ("Lock Boxes: Rent charge assessed on an annual
basis", 88369) and rows under a glued line with another fee's price.
