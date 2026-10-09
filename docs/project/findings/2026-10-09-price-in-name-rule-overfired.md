# A price in a fee's name is usually not the fee's price

**Date:** 2026-10-09. **Where:** `src/lib/agents/hamilton/eval-verdicts.ts` (`priceInName`,
eval verdict v4 -> v5), `retireEvalVerdictFees`.

## What happened

PR 814 added the live-row twin of the `price_in_name` publish hold: a live fee whose name
prints a dollar figure that is not the published amount is flagged `wrong_amount:price_in_name`
and archived at its 12-hour second look. Its first run (3232, 02:58:41 UTC) wrote 390
`takedown_pending` flags at 305 banks, 389 of them for this rule. UAT sampled 20 at 03:44 and
read about 18 as correct fees. Reading all 389 names: the dollar figure is a threshold
("Overdraft Fee – Each overdraft paid over $5"), a floor or cap ("Account Research per hour
($20.00 minimum)", "Money Orders ($1,000 maximum)"), a balance ("Service charge (balance falls
below $1,000)"), a range ("Visa Gift Cards $10.00-$500.00") or another price for another case
("Stop Payment ($15.00 if initiated through on-line banking)", "rush order $80.00"). About ten
names present the figure as the fee's own price and are real catches (100439 "Courtesy Pay
(Paid Overdraft) Fee .. . . .$35.005" at $50; "Stop Payment (per item) $30.00 Lost Key" at $25;
"Counter Checks (per page) $0.50 Signature Validation Program" at $5).

Left alone, the 12-hour look at about 15:00 UTC would have archived roughly 370 correct fees.

## Why

The v4 rule read "any price in the name" as "the fee's price". Schedules print dollar figures
in names for the conditions of a fee far more often than for its price; a correct fee with a
threshold in its name is the common case, and a cut-off name carrying the next cell's price is
the rare one the rule was written for.

## Fix

- v5 `priceInName` counts a price only when the name presents it as the fee's own: one price in
  the name, a fee noun (fee, charge, cost, price, each, item, copy, page, transfer,
  transaction) or a closed parenthetical right before it (dots, a colon or a dash between are a
  printed leader), no floor/cap word qualifying that noun ("minimum charge $10"), and no
  threshold or range word after the price ("$500 or less", "$25.00 minimum", "$10 - $500").
  The publish hold uses the same function, so it narrows with it.
- `retireEvalVerdictFees` now re-reads every live fee holding a pending flag from this check
  and passes every row no rule fails today to the second look as `passing`, which writes
  `takedown_cleared` over the pending flag (same dedupe key). A narrowed rule clears its
  predecessor's flags through the normal path; nothing is confirmed unless the current rule
  fails the fee again, and nothing is deleted or hand-updated.
- The lesson is one `pipeline_feedback` row per rule version (`kind = rule_revised`, dedupe
  key `hamilton.eval_verdict:rule_revised:v5`) carrying the cleared count and the why.

## Rule going forward

A name rule that archives live fees ships with a dry read of the live names it would flag, not a
test fixture alone: the first run of v4 flagged 389 fees from a rule tested on three names. The
second look must be able to clear a flag the current rule no longer supports; a rule revision
that leaves its predecessor's flags pending still archives them.
