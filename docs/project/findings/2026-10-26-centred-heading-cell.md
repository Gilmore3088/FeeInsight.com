# 2026-10-26: a centred heading cell left a bank's standard wire unread
**What happened:** Sound Community Bank (institution 978) had one live outgoing domestic wire,
"Wire Transfers: Outgoing Domestic - Not in Person" at $60 (published 15716), so its wire value was
$60. Its schedule also prices the standard outgoing domestic wire at $30, incoming wires at $15 and an
outgoing international wire at $45; none of them was read (#1912).

**Cause:** the schedule (document 14765, agent_source_texts 2527) is a PDF table whose "Wire Transfers"
label is one cell merged down the wire rows and centred vertically. The PDF reader prints a merged cell
once, level with the middle row, so the stored text reads:

```
Incoming Domestic & International: $15.00
Outgoing Domestic: $30.00
Wire Transfers | Outgoing Domestic - Not in Person: $60.00
Outgoing International: $45.00 plus international wire fee
assessed by correspondent bank
```

Knox only lends a heading to the rows under it, from a heading line with no price. Here the heading
sits on a priced row, so the rows above and below it read as "Outgoing Domestic" with no fee word and
were dropped. Two smaller gaps sat behind it: "Not in Person" was not a channel a heading may qualify,
so free Knox did not read the middle row either, and the international wire review (`own-wire-scope.ts`,
#2278) treated "plus international wire fee" after the price as a second scope and declined the $45.

**Fix (Knox v130):**
- `src/lib/custom-report/centered-heading-cell.ts` finds a centred heading's block by layout: a middle
  row "<Heading> | <name>: <price>" with a short figure-free heading, and the contiguous
  "<name>: <price>" rows above and below it that have no cell of their own and share a word with the
  middle row's name. The block stops at a blank line or any other line, drops the rows above when a
  heading line of their own sits over them (or a line whose last cell is a heading: a two-column page
  read across, "... | WIRE TRANSFERS" over "Outgoing Domestic: $30" beside "OVERDRAFT PRIVILEGE |
  Outgoing International: $50", text 7728, where the left column's heading is no centred cell), must be centred (rows above and below differ by at most
  one), and a row two middle rows reach is lent by neither. Each row of the block gains "<Heading> | ".
- Knox applies it with a fee-family check (`withCenteredBlockHeadings` in `rules.ts`): the heading names
  a fee family, the middle row's name alone names no fee and reads with the heading, and each borrowed
  row's name names no fee alone, is made only of words a heading may qualify (`composableTail`) and
  reads as the same family. The shared source check (`checkFeeAgainstSource`) applies the layout rule,
  so Knox's self-check, Darwin and Hamilton's re-check trace the borrowed reads on the stored text.
- "Not in Person" is a channel a heading may qualify (`composableTail`).
- The international wire review keeps a row's scope when the words after its price open with "plus",
  hold no price and restate the row's own geography and direction.
- Hamilton's rules re-check revisits each live document once for the new rules signature (v130).

The fixture now reads wire_domestic_outgoing $30 and $60 and wire_intl_outgoing $45. The answer-key
gates are unchanged (Texas 589 right / 11 wrong, held out 60 / 4; seven states 910 / 31).

**Not fixed here:** the shared row "Incoming Domestic & International: $15.00". Knox (v18) files one
price for "Domestic & International" as the domestic wire, and the category guard refuses a domestic
wire whose name says International, so the $15 now reaches Darwin and is refused at category, as the
same row printed with its heading always was. Whether a shared price publishes under the domestic wire,
the international one, or both is a separate decision.

**Live impact:** not measured; the session had no database access. A reviewer counts the stored texts
with a centred-heading middle row next to a same-shape row with the read-only query in the PR.

**Lesson:** a heading cell that spans several rows is printed on the middle row only; when a
"<Heading> | <name>: <price>" row has sibling "<name>: <price>" rows directly above and below it,
the heading names them all.

**Agent lesson:** knox/issue-1912-centred-heading-cell
**Guard:** `src/lib/agents/knox/centered-heading.test.ts`
