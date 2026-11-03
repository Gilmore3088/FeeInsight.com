# 2026-11-03: A line that opens with its price was named by the whole line with its figures deleted

**What happened:** a live-site audit found Fort Worth City Credit Union's live fee 137329 (fwccu, text
27597) named "monthly fee, waived with minimum balance of or City of Fort Worth/City of Fort Worth Retirement
direct deposit totalin". Its line is "● $5 monthly fee, waived with minimum balance of $500 or City of Fort
Worth/City of Fort Worth Retirement direct deposit totaling $500 or more". The amount ($5) and the category
(monthly_maintenance) are right; the name is words the bank never printed.

**Why (root cause, Knox `rules.ts`, `readPlainSegment`):**

- The words before the price are only a bullet, so the name fell back to `nameFrom(segment)`: the whole
  line, every amount deleted, cut at 120 characters.
- `maintenanceFromProse`, which names this line "Monthly fee", runs only when no category was found (`if
  (!hint)`), and `priceFirstHint` had already found monthly_maintenance from the words after the price.
- A later price that opens a bracket ("$8 monthly service charge ($6 if age 55+)") was read as a second fee
  named by the first fee's words ("monthly service charge (" at $6).

**Fix (Knox v176, with the seventh backlog dry run's fixes; table and guard unchanged):**

- A price-first monthly_maintenance line with a second figure takes `maintenanceFromProse`'s name when it
  prices the line's first figure ("Monthly fee", "Monthly service charge").
- A bare fee word never renames a read: when `maintenanceFromProse` or `priceFirstClauseName` would name it
  only "Fee", "Charge" or "Service charge" (`BARE_FEE_NAME`, as `GENERIC_FEE_NAME` in families.ts), the read
  keeps its v175 name. A first cut renamed live 130284 to "Fee"; it now keeps "fee if the minimum balance falls
  below during the statement cycle".
- A renamed read never merges two rows: when the new name and price equal another line's read on the same text
  (the raw key has no product), the renamed read keeps its v175 name (`wholeLineName`, restored in
  `extractCandidatesFromText`). A first cut named rb4 text 40434's Money Market Deposit "$10.00 monthly service
  charge (to avoid ...)" like the Super NOW Account's own "$10.00 Monthly Service Charge", and the raw key kept
  only one of the two rows v175 kept; both are kept now.
- Backstop: a price-first line with two or more figures never falls back to the whole line when that would
  delete a later figure that is a condition (a balance or threshold, `isConditionAmount`) and keep the words
  around it (`wholeLineNameDropsCondition`). It is then named by
  the words after the first price, cut at the first clause boundary (`,` `.` `;` `:`, a spaced dash), a
  condition or waiver word, "or", "per", "each" or "for each", or the next price (`priceFirstClauseName`); the
  price's own unit ("per month", "/mo") is skipped first, and a bracket the cut leaves open is dropped, so a
  closed one stays ("Non-Sufficient Funds (NSF) Fee"). When those words name nothing, an unclassified line that
  says "fee" or "charge" is held for review under the line's words, as before, never sent on. A later figure
  that is another fee's price ("$30.00 - NSF Fee, $30.00 Overdraft Fee") or that a threshold bracket keeps
  ("$25.00 - Overdraft Fee (per item; maximum $125 per day)") leaves the whole-line name as it was; the first
  cut, which also renamed those, failed the v148 dash-list fixtures and was narrowed. The one fixture name that
  changes is "$10.00 - Monthly Service Fee (waived with $500 balance)": "Monthly Service Fee", not "Monthly
  Service Fee (waived with balance)".
- On a price-first line, a later price that opens a bracket right after the earlier fee's words is a note on
  that fee and is not read.
- Re-read: a current copy with a live Knox fee whose stored line opens with its price and prints a second
  figure, last read below v176, is read again once (`KNOX_PRICE_FIRST_NAME_READ_BELOW_VERSION`,
  `knox/extract.ts`). Like every re-read class it waits for the re-read floor (a text read at v167 or later in
  the last 14 days comes back inside `KNOX_REREAD_REFRESH_DAYS`); `KNOX_REREAD_BELOW_VERSION` stays at 167,
  because raising it would queue every text of the floor's other classes, not these pages. No Darwin check is
  added: the fees are right in amount and category, and the re-read renames them.

**Live fees (read-only, Nov 3, prod `rmhwbbjjctzfaqjyhomu`, SELECT only):**

- 534 live Knox fees were read from a stored line that opens with its price and prints a second figure. Run
  through the rules on their stored lines (v175 at 5c5c8c757 vs v176), 251 are renamed (166 institutions; 230
  monthly maintenance; most to "Monthly service charge", "Monthly fee", "Monthly maintenance fee", "Monthly
  service fee"), none to a bare fee word, and no live fee loses its read (same amount and category). Five other reads on those lines go: age or
  member discounts in a bracket ("$8 monthly service charge ($6 if age 55+)", "($3.00 for customers 50 years
  old and over)", "($8 for members 62 and older)", "($4.25 if older than 50)", "($1.95 if >65 years ...)") are
  no longer read as fees of their own, as the audit asked; the live fee on each line is the full price. Eight reads on those lines are named only "Service charge" at v176, each
  exactly as at v175 (a path the rename does not touch, such as "$0.00 - $499.99 = $4 Service Charge").
- The re-read class matches 293 current-copy texts at 265 institutions, 288 of them due now.

**Re-run (the dry-run harness, `currentVariant`, v175 at 5c5c8c757 vs v176, rb to rb7):** live fees not
reproduced stay 286 and the publish reads go from 4,691 to 4,692. Five stored or new monthly maintenance reads
take their own names with their products kept (rb5 32576 twice, rb6 32798 twice, rb7 32140) and rb7 gains
"Monthly maintenance fee" $8 (26809, "$8 Monthly Maintenance Fee waived when a $200 average monthly ledger
balance is maintained"). rb4 does not change: text 40434 keeps both $10 rows.

**Not changed, noted for the shared check's owner:** `isThreshold` (`src/lib/custom-report/source-check.ts`,
line 1133) reads "$5 minimum balance monthly fee" (fwccu's FAQ line) as a threshold.

**Guard:** `src/lib/agents/knox/backlog-dry-run-7.test.ts`.
**Agent lesson:** knox/live-audit-2026-11-03-price-first-line-own-name
