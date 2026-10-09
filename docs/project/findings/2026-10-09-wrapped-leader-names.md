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

## Also in v62: business-only footnotes and former-fee columns (batch 2 UAT, 9 Oct)

UAT found 3 wrong rows among 7 new overdraft fees from the $10B+ batch 2. Two of them are Knox reads fixed here:

- **ConnectOne (135), row 103490, $40 overdraft.** The line "Overdraft - Insufficient Funds / Uncollected2 $40.00" carries footnote 2. That footnote says "Only applicable to business accounts. This fee is not charged to consumer accounts."
  - `withoutBusinessOnlyFees` (`knox/rules.ts`) now drops a fee line whose glued footnote mark points to such a note. The mark is matched to the first note with its number below the fee, because a schedule may restart its numbering on each page. Ameris does this, and its consumer "Overdraft Fee4" stays.
  - `business_schedule.ts` couldn't catch this case. It reads the document's address and the fee's own name, and it acts only when a consumer fee sits beside the business one. 135 has no consumer overdraft fee.
- **Citizens Business Bank (124), row 103570, $0 overdraft.** Doc 23735 is a conversion guide whose tables read "SERVICES | FORMER FEES | NEW FEES". The fee-change rule (`newestColumnText`) knew "current/old/previous/prior" but not "former", so Knox read the former prices.
  - The header now matches "former".
  - A three-cell row under a change header keeps only its name and its newest cell.
  - Knox's table pass reads the newest column too.

**What the v62 rules re-check takes down.** Simulated with `reproducibleFees` on prod's texts 20825 and 20828, compared with main:

| Row | Fee | Live price | Source says |
| --- | --- | --- | --- |
| 103490 | ConnectOne overdraft | $40 | Business only (footnote 2) |
| 103570 | NSF/UCF Item Paid | $0 | Former "No charge"; new $35, already live |
| 103523 | Key Replacement | $25 | Former; new $20, live |
| 103524 | Chexsystems Collection | $75 | Former; new "N/A" |
| 103525 | Coin Counting | $15 | Former; new "Not offered" |
| 103526 | Legal Process Handling | $100 | Former; new $250, live |
| 103530, 103532, 103533, 103535, 103537, 103538 | Safe deposit 2x5, 4x5, 5x5, 3x10, 6x10, 9x10 | $30, $75, $85, $100, $200, $250 | Former prices |
| 103539 | Official Check (non-customer) | $20 | Former; new $15 |
| 103541 | Stop Payment Online | $30 | Former; new $25 |
| 103542 | Wire Notification Incoming | $5 | Former; new $8 |

All 15 were checked against the source text, and 15 of 15 are former or business prices. Nothing else at either bank changes. The rows come down through the re-check's flags and second look, and none are deleted.

**Known gaps left at 124:**
- The re-check matches by category and price, so a former price that equals another row's new price stays live. These are safe deposit 3x5 $50 (4x5's new price), 2.5x10 $45 (3x5's new price) and 5x10 $150.
- Photocopies $4 stays. Its line repeats "$4.00 per copy" on its own.
- The account tables on pages 7-13 ("Account Name | Limited Checking | Personal Checking" / "Monthly Service Charge | $8.00 | $12.00") have no former/new header on their own page; it sits on page 7 above a different table. Their former monthly prices stay live: $8 (103515), $20 (103517), $25 (103520), $2 HSA (103516) and $5 quarterly savings (103521).
