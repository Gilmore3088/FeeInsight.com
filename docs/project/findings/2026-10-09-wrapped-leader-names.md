# A dot-leader fee name wrapped over several lines named no fee

**Found:** 2026-10-09, Largest banks thread (Northern Trust, $10B+ with no live overdraft fee).

After PDF layout v4 (PR 858) read Northern Trust's fee list as its own column, every list line
was clean, but Knox's free rules still missed two kinds of line:

- `debit card payments) ......... $25.00 per Occurrence`: the overdraft fee's name ran over five
  lines ("Overdrafts Paid and Items Paid against Nonsufficient / Funds (includes but not limited
  to overdrafts / ..."). Knox read the price line alone. Its name closes a parenthesis it never
  opened, so Knox drops it as another line's tail. The shared source check could not trace the
  fee either, because no single line held both the name and the price.
- `Domestic Outgoing (client only) ........ $25.00 per wire`: the name has no fee word. Only
  "per wire" after the price says what it is, so no rule classified it.

**Fix (Knox v62):**
- `joinWrappedLeaderNames` in `src/lib/custom-report/source-check.ts` joins a leader line whose
  name closes an unopened parenthesis with the price-less lines above it. It takes lines until
  the parenthesis opens, plus the one long line the name starts on. It stops at a price, a dot
  leader, a table cell or a finished sentence, and never goes more than five lines up.
  - Knox and the shared check both read lines through it, so a fee Knox reads traces to the
    same row the check reads.
- A line with no fee word whose price is followed by "per wire" is classified with "wire" added
  to its name.
- Two specialists reading the same line at the same price and category count as one fee.

On Northern Trust's text, Knox's free rules now read the $25 overdraft, the $115 legal
processing fee, and the $25 and $45 outgoing wires.

Gates:

| Gate | Before (right/wrong) | After (right/wrong) |
| --- | --- | --- |
| Seven states | 744/42 | 744/42 |
| Texas | 509/14 | 511/14 |
| CA | — | 133/6 |
