# 2026-10-26: two prices glued into one cell set a credit union's wire value from its PIN change price
**What happened:** Access FCU (institution 4965) had a $2 incoming domestic wire live, "Change of
Personal Identification Number (PIN)Wire Transfers (incoming)" (published 142973, raw 680290,
document 33871), beside its real "Domestic Wire Transfers (incoming)" at no charge. Six more live fees
on the same page came from the same kind of line: "Card Replacement Share Draft Protest" $20, "Rush
Card Replacement Fee Transactions at ACCESS FCU ATMs" $55 (the page's own rush card line says $50), two
stop payments read from a dormant fee's and a club closure's lines ($10 and $5), "Photo Copy of Draft
(each) Foreign Check Fee" $10, and a $10 foreign check fee (the clean line says $25). Separately, Apl FCU's
"Foreign Wire Reject" $25 (67971) was live as an international outgoing wire beside its $40 wire (#1912).

**Cause:** the stored PDF text puts both columns of the schedule on one line, names and prices glued:
"Card Replacement .....Share Draft Protest ..... $20.00$10.00", "...(PIN)Wire Transfers (incoming) .....
$ 2.00n/c*". Knox read the first price for the whole glued name and the shared source check traced it,
but the glued prices are not in the names' order: the same page prints Share Draft Protest at $20 and
the PIN change at $2 on clean lines. And the category guard refused a returned, recalled or traced wire
under the wire types but had no word for a rejected one.

**Fix:**
- Knox v128 and the shared source check: a line whose only price is two different prices glued into one
  cell is emptied before any reader or check sees it (`gluedPricePair`,
  `src/lib/custom-report/glued-price-pair.ts`). Two equal glued prices under a name printed twice are one
  price and read as before; a line with any other price is left alone. Dry run (prod, read-only, Oct 26):
  36 lines in the newest texts of 18 documents glue two different prices, most of them balance tables;
  the 7 Access FCU fees above are the only live fees read only from such lines, and Hamilton's rules
  re-check sends them to its second look once the new signature reaches the document. At North Side
  Federal Savings and Century FCU no live fee's read or trace changes; the other documents' glued lines
  are minimum balances, deposit limits and rate tiers, not fees.
- Category guard v98: `WIRE_CORRECTIONS` gains "reject", so a rejected wire fails the four wire types.
  One live fee fails it (67971).

**Lesson:** when two prices are glued into one cell, the line is two columns flattened and neither price
belongs to either name; read each fee from a line that prints it alone.

**Agent lesson:** knox/issue-1912-glued-price-pair, darwin/issue-1912-rejected-wire-is-a-correction
**Guard:** `src/lib/custom-report/glued-price-pair.test.ts`
