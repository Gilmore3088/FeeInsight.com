# 2026-11-01: the automated audit scored the number, not the price a person reads

**What happened:** Deming's stored-copy audit read 98.3% over 7 days (2,911 of 2,960, Nov 1 scoreboard)
while James's W43 live check read 68.5% (604 of 882). 188 of his 192 wrong-amount rows had the right
number with what the bank prints beside it lost: "$25" for "$25.00 per hour", "$1" for "$1.00/page plus
tax", "$150" for "$150/year", "$5" for "$5 for first occurrence then $10 each", a monthly fee shown
without the balance that waives it.

**Cause:** the audit (`fresh-audit.ts` v9) asked the shared source check (`checkFeeAgainstSource`)
whether the number and category trace, and the category, evidence, perk and name checks. None of them
compared the unit, period, condition, tier or audience printed with the price against what the
published fee shows. The audit was never compared with the person whose verdict it stands in for.

**Fix (fresh audit v10, audit side only):**
- The shared check returns the traced line's `terms` when asked (`{ terms: true }`,
  `source-line-terms.ts`): unit (hour, part of an hour, page, per $100, a pack), period
  (`frequencyFromLine`), conditions (plus tax or other charges, a balance waiver, a counted allowance,
  greater-of), tier (first-then, additional, a size band, the check's own `tiered_fee` band) and
  audience, read only from the words beside the fee's own price. Off by default: no pipeline caller's
  result changes.
- Deming's `lostTerm` (`terms-check.ts`) calls a term lost when neither the published name nor the
  stored frequency carries it; a `qualifier` miss (`deming.terms_lost`) in the accuracy series. A period
  is not scored when the stored frequency is unknown to the caller. `FRESH_AUDIT_VERSION` 9 to 10 starts
  a new history segment. Nothing is published, held or taken down for it.
- `w43-agreement.ts` replays the audit on the frozen W43 fixture and compares with James row by row;
  `robot-human-agreement.json` is the receipt the goal scorecard shows
  (`goal.deming_robot_human_agreement_w43`), and its test fails if agreement falls below 391 of 466.

**Measured (W43 fixture, 466 scorable rows; MISSING, CANT_VERIFY, STALE_SOURCE, rows with no saved text
and rate rows are counted and excluded):**

| | agreement with James | robot "right" |
|---|---|---|
| audit v9 | 335/466 = 71.9% | 444/466 = 95.3% |
| audit v10 | 391/466 = 83.9% | 387/466 = 83.0% |
| v10, stored frequency read as not shown | 370/466 = 79.4% | 359/466 = 77.0% |
| James on the same rows | | 337/466 = 72.3% (overall 68.5%) |

No MATCH row became a terms miss. Target 95% is not met. The rules were written while looking at
these rows, so the v10 figure is an in-sample number; the next live check is the out-of-sample test.
The 466 rows are a subset of James's 882 checked rows (the rest have no saved text or are a rate), so
agreement is reported as the range 79.4–83.9%: the high end leaves the period unscored, the live audit
scores it against the stored frequency.

Review of 0951351: the first reader took a neighbour's words as the fee's own terms ("Research $25.00
per hour | Copies $25.00" marked Copies hourly; "waived for customers 65 and older" read as an age
audience). The terms are now read only when the line prints the fee's price once (a bound such as
"$25.00 minimum" is not a second printing), never across a cell boundary or a sentence end, and never
as an audience after a waiver word.

Re-review of f4d7b3f: in pipe tables the next row's cells still read as this fee's ("Stop Payment |
$30 | Student Checking | $0"; "Wire | $30 | Monthly Service | $10" read as monthly by the shared period
reader, which saw the whole line). Now the reader takes only the fee's own row: its name cell and
price cell, and a following cell only when it is a bare basis ("| Per Hour", "| Monthly"), read for
unit and period alone; `hourlyFromLine` and `frequencyFromLine` are given that row, not the line. The
fixture's saved texts hold only 41 "|" characters, so these table paths rest on unit tests, not on the
W43 replay. Left for a later pass (they miss terms, never invent them): a ladder printed before the
price, a waiver word blanking every audience after the price, basis cells longer than one modifier and
one word.

**Still disagreeing (v10):** 31 wrong-amount rows the audit calls right (a period the replay cannot
score without the stored frequency, a waiver in a footnote or another sentence, "$0 online" priced
elsewhere, a misaligned two-price row); 18 bad names the name check accepts (box sizes without "Safe
deposit box"); 12 wrong categories the category guard accepts; 10 matches the source check cannot trace
(`name_not_in_text` 7, `amount_not_the_fee` 3).

**Guard:** `src/lib/agents/deming/w43-agreement.test.ts`, `src/lib/agents/deming/terms-check.test.ts`.
**Agent lesson:** deming/plan-2-score-like-a-person
