# A dot-leader fee list beside a table was read into the table's rows

**Seen:** 2026-10-09. Northern Trust (25) had no live fees from a full personal schedule
(text 20257, document 23187).

**Why:** the PDF reader groups each page by baseline. Page 1 has an account table on the left
and a "Service Fees" list down the right ("Cashier's Checks ....... $8.00"). Read across, each
list line became the last cell of a table row, and a wrapped name was spread over three rows
("Overdrafts Paid and Items Paid against Nonsufficient Funds ... $25.00 per Occurrence"). Knox
read 2 fees. Layout v2-v3 split only prose columns, and a priced list never counted as prose.

**Fix:** layout v4 (`leaderListColumns` in `src/lib/agents/rosetta/pdf-layout.ts`). The page is
split at the leftmost gutter right of which the text is one column of dot-leader fee lines:
at least 5 of them and 25% of its lines, with no cell breaks and no lines that open with a price
(a table's amount column). The rest of the page reads row by row as before. On the fixture,
Knox's free rules read 8 fees, up from 2. The overdraft line and the outgoing wires are now
clean lines, but today's rules don't read them yet (a wrapped name, "(client only)"). That is
a Knox change for later.

PDF texts that layout v3 read across columns get one read with v4. This is the existing
`INTERLEAVED_PROSE_CELLS` re-read, and Northern Trust's text qualifies with 32 joins. A text
whose reading doesn't change keeps its hash, so Knox doesn't read it again.
