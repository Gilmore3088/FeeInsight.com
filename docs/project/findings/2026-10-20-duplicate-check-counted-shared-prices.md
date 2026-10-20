# 2026-10-20: the daily duplicate alarm counted different fees that share a price
**What happened:** Deming's daily data-quality step has raised ALARM: duplicates on every run since
at least Oct 17 (7.2% to 7.6% of live dollar fees, 6,011 rows on Oct 20), above the 3% FAIL line.
**Cause:** the check counted a row as a duplicate when another live row had the same institution,
category and amount, whatever the fee. Two products at one price (a checking and a savings
"Monthly Service" at $6), two services in one category (a statement copy and a check image at $5)
or two free lines all counted. Hamilton's duplicate collapse already closes the same fee line
published twice (same name, audience, variant, product and charging frequency) every publish step,
so the alarm measured shared prices, not duplicate fees.
**Fix:** the graded check uses the collapse's identity; the old reading is reported beside it as
`same_amount`, not graded. No fee data changes.
**Lesson:** a data-quality check has to use the same identity as the step that repairs the problem,
or its alarm can never clear.
**Guard:** `src/lib/agents/deming/data-quality.db.test.ts` ("grades only the same fee line twice,
and counts a shared category and amount apart").
