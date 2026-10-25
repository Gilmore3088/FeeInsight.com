# 2026-10-25: an ATM network table was read cell by cell, and a late charge's cap was read as the late fee

**Lesson:** A table with one column per ATM network prices each row once per column; the fee for
another bank's ATM is the price in the non-network column, read by row and column, never a row's
first price. A late charge's cap or floor bounds a percentage charge and is not the late fee. Both
amounts trace to the page, so the shared source check alone could never catch them: the reading
rule has to.

**What happened (#1905):** Navy Federal's fee page (doc 39026, and the older copies 15428 and 26712)
prints its ATM fees as a network table:

    Transaction Type | Navy Federal ATM | CO-OP ATM Network® | Non-Navy Federal/Non-CO-OP Network ATM | MAESTRO | ...
    Share withdrawal $1,000 maximum per 24 hours† | None | None | $1.00 | Not applicable | ...
    Credit card cash advance§ | None | $0.50 | $1.00 plus ATM owner fees | Not applicable | ...

Knox's readers took each row's first price whatever its column. "Credit card cash advance" went
live as a $0.50 deposit cash advance (the CO-OP column; guard v80 has since taken those down), a
returned deposit was read from the CO-OP cell, and the share withdrawal row, the account's real $1
network fee, was never read because its name carries the $1,000 daily limit. On the same page, the
mortgage late-charge sentence ("Generally 5% of the principal and interest ...; maximum late
charge of $30") went live as three late_payment fees ($30, $30, $10). The same bound shape was live
at two more institutions: "Minimum Late Fee" $10 beside "5% of Payment Amount" (doc 21032) and
"Minimum Late Charge" $0.50 beside "5% of payment due" (doc 26406).

**Cause:** no reader knew a network table's shape, and no name rule knew a late charge's bound.
Guard v80 caught the cash advance class after the fact; the input step was unchanged.

**Fix:**
- Knox v115 reads a network table by its columns (`src/lib/custom-report/network-column-rows.ts`):
  a header of three to eight short cells with exactly one non-network ATM column and one own-network
  column arms it. The own column must name an ATM or a network by name, so a product column like
  "Star Checking" does not. Each withdrawal, transfer or inquiry row is read at a flat price opening
  the non-network cell, named "<row> at <column>"; a conditional price ("$3.00 per transfer after
  4") gives no read. Only the table's machine rows are blanked for the other readers; a "Stop
  Payment | $30 | $30" row under the same header stays theirs. The source check traces the
  composed name through the same module, admit-only.
- Guard v91 lets "share withdrawal at <non-network> ATM" stay a network ATM fee.
- Knox v115 refuses a name whose last clause is a late charge's cap or floor
  (`src/lib/late-charge-bound.ts`), and Darwin's `late-charge-bound-check.ts` re-checks live ones
  with the same pattern. Its switch (`LATE_CHARGE_BOUND_TAKEDOWN_LIVE`) is on under the
  sampled-clean rule (DECISIONS, 2026-10-20): the review read all 5 dry-run fees against each
  bank's text and all 5 are correct takedowns.

**Dry run (prod, read-only, Oct 25):** network headers appear only on Navy Federal (15428, 26712,
39026) and R-G FCU (15582, 35833) documents. 4 live fees are re-read differently (3 renamed, same
category; Navy's "Returned Check Deposits" $6 no longer read), and each still traces, so Hamilton's
rules recheck keeps them live as disputed: 0 come down from the Knox change. The late-charge check
selects 5 live fees at 3 institutions (15729, 154636, 154637, 79880, 124614), which come down
after the 12-hour second look. Re-run after the review fixes: every row of the 5 armed tables is a
machine row with a flat non-network price, so the reads and the 0 takedowns are unchanged. Guard v91 matches 0 live and 0 raw rows today.

**Not covered:** a labeled-price cell ("Weekday delivery $12.00 Saturday delivery $20.00", about 47
documents), a counted free allowance under a heading ("First 2 per week: no charge; each
additional: $5.00"), and the CO-OP footnote's "ATM owner will impose a fee of" raw read (publish
already holds it as a cut-off name).

**Guard:** `src/lib/agents/knox/network-column-table.test.ts`,
`src/lib/agents/darwin/late-charge-bound-check.test.ts`. **Agent lesson:**
knox/issue-1905-network-table-columns, darwin/issue-1905-late-charge-bound-is-no-fee.
