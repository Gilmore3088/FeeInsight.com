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
- Shared check (`namesItsClosedFreeRow`): a priced fee whose stored name is its own closed free row
  ("ATM Transactions FREE") is refused when the source prints that name, its leader and that free word,
  and the row ends there (a column break, the line's end, or a new named row with its own leader).
  Terms after the free word ("Free, $2 for non-members") or a next row that only sets the same fee's
  tier or audience ("FREE | Each Additional …. $3.00", "None | Within 90 days", `FREE_ROW_CONTINUES`)
  leave the fee to the usual reading. Knox's table pass uses the same continuation words.
- Why so narrow: four independent reviews of a general rule (a closed row's name never owns a later
  price) found 54 correct schedule shapes it refused, from repeated names to tier rows. The narrow
  rule targets the signature of the error, a fee name that says it is free, and leaves every other
  line exactly as before.
- The check's free words (free, none, no charge, n/c) are the ones that state a $0 price. Knox's
  wider `LEADER_PRICE_WORDS` (included, varies, at cost, call) only stops a name cell from taking the next
  cell's price; those words state no price for the check to weigh.
- Live re-check: `SOURCE_CHECK_STRATEGY` v21 re-checks every institution through Hamilton's source-check
  pass and its 12-hour second look.
**Scope (read-only, Oct 25):** 71 live priced fees have a stored name ending in a free word. Run
against their documents' full stored text, the old and new check differ on 4, each a free fee live at
the other column's price (97116, 31813, 36500, 76922). The other 67 (e.g. "ATM Withdrawals After 6
Free", "Cashier's Check | N/C", "Notary Service Free" from "Free, $2 for non-members") keep tracing.
The 54 review shapes are tests and all keep their old result.
**Agent lesson:** knox/issue-2477-free-word-closes-the-row
**Agent lesson:** darwin/issue-2477-closed-row-owns-no-later-price
