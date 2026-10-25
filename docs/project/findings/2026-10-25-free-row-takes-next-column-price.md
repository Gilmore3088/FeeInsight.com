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
- Shared check: a name the closed row states better than the words after it does not own the price
  (`leaderFreeRowEnds`); its own free price and a fee named after the closed row still trace.
- Live re-check: `SOURCE_CHECK_STRATEGY` v21 re-checks every institution through Hamilton's source-check
  pass and its 12-hour second look.
**Scope:** the layout appears in 113 stored texts at 96 banks (read-only prefilter, Oct 25). Of their 561 live fees whose price sits on such a line, the old and new check differ on 4, each a free fee live at the other column's price (97116, 31813, 36500, 76922). Five fees whose stored name glued both rows but whose price is right keep tracing (tests).
**Agent lesson:** knox/issue-2477-free-word-closes-the-row
**Agent lesson:** darwin/issue-2477-closed-row-owns-no-later-price
