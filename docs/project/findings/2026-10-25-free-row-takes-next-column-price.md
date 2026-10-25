# 2026-10-25: a row closed by its own "FREE" took the next column's price
**What happened:** United Bank's "ATM Transactions", free on its schedule, was live at $5 (fee 97116,
document 13443). The Oct 20 hand check on #2477 found it; it was still live on Oct 25.
**Cause:** the stored PDF text flattens two columns row by row:
`ATM Transactions……….. ……….FREE | activity……………………………………$5`. The left row is closed by its
own price word; the `$5` ends the right column's "Savings accounts after 24 months of no activity".
- Knox's table pass paired the first name cell with the next priced cell, so it read
  "ATM Transactions FREE" at $5.
- The shared check (`checkFeeAgainstSource`) gives a price to the words before it on the line, so the
  name's words in the closed row traced the $5, and Darwin verified it.
**Fix:** a dot-leader row closed by a free word ends there.
- Knox table pass v10 / rules v105: a name cell `LEADER_PRICE_WORDS` closes is not paired with a later cell.
- Shared check (`leaderFreeRowEnds`): a row is closed only when a column break (`|`) or a new
  capitalised name with its own leader follows the free word. Terms after the free word in the same
  row ("Free with e-statements, otherwise $3.00", "None for 12 months, then $5.00") keep their price.
  A closed row binds only a fee whose name holds every word of that row's name, so "Overdraft
  Transfer …. None | Overdraft Fee …. $30" still traces Overdraft Fee; a figure in the row's own note
  ("Overdraft Fee (under $5)") stays part of its name. A bound fee owns a later price when the words
  after the free word name the whole fee again ("Stop Payment … Free | Stop Payment (in branch) …
  $30") or name something of the fee the closed row does not.
- The check's free words (free, none, no charge, n/c, waived) are the ones that state a $0 price. Knox's
  wider `LEADER_PRICE_WORDS` (included, varies, at cost, call) only stops a name cell from taking the next
  cell's price; those words state no price for the check to weigh.
- Live re-check: `SOURCE_CHECK_STRATEGY` v21 re-checks every institution through Hamilton's source-check
  pass and its 12-hour second look.
**Scope:** every stored text with a line that has a dot-leader free word followed by a dollar price
on the same line (read-only, Oct 25): 397 lines in 162 texts. Their live fees whose price is on such a
line number 489 at 99 banks (605 fee-line pairs). The old and new check differ on 4, each a free fee live at the other column's price (97116, 31813, 36500, 76922). Five fees whose stored name glued both rows but whose price is right keep tracing, and 31 shapes from two independent reviews (row terms after the free word, a closed row with a different name) are tests.
**Agent lesson:** knox/issue-2477-free-word-closes-the-row
**Agent lesson:** darwin/issue-2477-closed-row-owns-no-later-price
