# 2026-11-01: a dash price-first list was read one line off
**What happened:** State key 10272 (Crow Wing Power CU) prints its fee schedule as price-first lines with a
dash before each name:

```
Checking Fees
$25.00 - NSF Check/ACH/ATM item
$20.00 - Stop Payment (single check)
$35.00 - Stop Payment (range of checks)
$10.00 - Debit Card Replacement
```

The shadow lab (Knox v147) read every price under the name on the line above. Most of those reads did not
trace, so they were held. One did trace, because the line below also names a stop payment: "Stop Payment
(single check)" was published at the next line's $35. The NSF fee, the single-check stop payment at $20,
the deposited item return, the hourly account reconciliation and the garnishment fee were never published.

**Cause:** Knox reads a cell-less price-first list one fee per line (v94, `inPriceFirstListRun`), but only
when a capitalized name follows the price. A dash between the price and the name ("$25.00 - NSF ...") fails
that name test (`nameAfterPrice`), so no line counts as price-first. The stacked fallback then pairs every
name with the next line's price. The shared check accepts the one read whose wrong price sits on a line that
names the same fee.

**Fix (Knox v148, `knox/dash-list-rows.ts`):** a run of these lines is read as the label rows it lists
("NSF Check/ACH/ATM item | $25.00"), so every field is base's own read of that row. The row form is used
rather than the plain price-first line for two reasons. Base reads the name's own unit on a label row:
"Account Reconciliation (per hour) | $20.00" is hourly, but "$20.00 Account Reconciliation (per hour)" is
published flat. And on a plain price-first line, base's price qualifier takes the first word of
"$35.00 Daily Overdraft Fee" as the unit, so it also publishes a daily "Overdraft Fee".

A run is used only when all of these hold:
- each line's words after the dash are a name by base's own test, with no other cell, price or rate;
- base's own run test accepts the lines without their dashes;
- the line above cannot own the first price;
- every read from the rows traces to the stored text by the shared check.

**Admit-only on live paths (review of #2834):** the exact-head review traced the live effect of replacing
base's reads. After a re-read, the rules re-check keeps the live "Stop Payment (single check)" $35 row,
because its price is still read, now on the range line. Hamilton's `decidePriorFee` then publishes the new
$20 as an `additional_line`, so the same name would be live at both $35 and $20, and nothing later retires
the $35. Replacing a read that publishes today is a reject plus a reprice, and that needs its live re-check
and a dry-run count.

So with `DASH_LIST_ROWS_LIVE` off (the default), base's whole reading is kept. A row read is added only when
all of these hold:
- base reads nothing from the read's run: no read's excerpt holds a run line's name or the line itself;
- base reads no fee of the same name anywhere in the document, comparing names tidied as readers tidy
  them, with only letters and digits kept;
- base reads no fee of the same category at the same price;
- the read traces.

The first two rules came from the re-review of bbd4388. At a section break the stacked reader names a run's
last fee "Stop Payment: \u200d" at the next section's first price, so a name test that kept the colon let
the added "Stop Payment" $20 through beside it: one fee at two prices. Either rule alone now stops it.

Its stored excerpt is the printed line, not the synthetic row. The full rewrite, which replaces base's
reads of the run, sits behind the switch and is measured by the shadow lab's `dash-list-rows` experiment.
The shared check is unchanged.

**Measured:**

| Measure | Main (v147) | v148, switch off (today) | v148, switch on (lab experiment) |
|---|---|---|---|
| Lab answer-key recall | 956 / 1,312 | 956 | 961 |
| Lab, all expected fees | 1,322 / 1,766 | 1,322 | 1,327 |
| Lab false publication | 33 / 160 | 33 | 33 |
| Seven-state gate (right / wrong) | 915 / 30 | 915 / 30 | 920 / 30 (MN 130) |
| Texas gate (right / wrong) | 589 / 11 | 589 / 11 | 589 / 11 |

With the switch off, the read diff over all 291 Texas, seven-state and lab texts is empty. State key
10272 reads exactly as on main, because main reads a name or price from both of its runs: the $35 single
check from the first, and the card replacement priced from the second's first line. The switch-off path
adds reads only on other pages, where base reads nothing from a run (66 near-miss cases in the test). With the switch on, 10272's single check moves from $35 to $20,
the $35 moves to the range row and the card replacement loses an invisible character from its name. Live
audit 8092 gains ten held loan rows (five on each copy), which do not publish.

**Known live reads, logged on #1092 for the switch:** 10272's "Stop Payment (single check)" $35 (wrong:
the range line's price) and "Debit Card Replacement: \u200d" $10 (priced from the next section's first
line, which happens to print the same $10) stay as main reads them.

**Not measured:** this session had no production access. How many live documents print the shape, and
how many live rows the switch would replace, are not known.

**Lesson:** when a reader's shape test needs a name right after the price, a separator that the page puts
between them silently turns the whole list into a stacked page, read one line off. Read the list as the
rows it states, with base's own readers. And when a new reading would replace a read that publishes today,
trace the live path: a fresh read of the same document publishes beside the old row, not instead of it.

**Agent lesson:** knox/issue-1092-dash-price-first-list
**Guard:** `src/lib/agents/knox/dash-list-rows.test.ts`
