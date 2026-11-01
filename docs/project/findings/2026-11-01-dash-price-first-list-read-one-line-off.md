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
trace and were held. One did: "Stop Payment (single check)" at the next line's $35, because that line names
a stop payment too, so it was published at the wrong price. The NSF fee, the single-check stop payment, the
deposited item return, the hourly account reconciliation and the garnishment fee were never published.

**Cause:** Knox reads a cell-less price-first list one fee per line (v94, `inPriceFirstListRun`), but only
when a capitalized name follows the price. A dash between the price and the name ("$25.00 - NSF ...") fails
that name test (`nameAfterPrice`), so no line counts as price-first, and the stacked fallback ("a price at
the start of a line belongs to the name above") pairs every name with the next line's price. The shared
check then accepts the one read whose wrong price sits on a line that names the same fee.

**Fix (Knox v148, `knox/dash-list-rows.ts`):** a run of such lines is read as the label rows it lists
("NSF Check/ACH/ATM item | $25.00"), so every field is base's own read of that row, by construction. The
row form is used, not the plain price-first line, because base reads the name's own unit on a label row
("Account Reconciliation (per hour) | $20.00" is hourly) but publishes "$20.00 Account Reconciliation (per
hour)" flat, and its price qualifier reads "$35.00 Daily Overdraft Fee" as a daily "Overdraft Fee" as
well. A run is rewritten only when:
- each line's words after the dash are a name by base's own test, with no other cell, price or rate;
- base's own run test accepts the lines without their dashes (two or more, no bare price closing them);
- the line above cannot own the first price (priced, a section title, or names no fee);
- every read from its rows traces to the stored text by the shared check, as Darwin checks it;
- no read base makes from any other line is lost.

Otherwise the text is read as stored. The shared check is unchanged.

**Measured:**

| Measure | Main (v147) | v148 |
|---|---|---|
| Lab answer-key recall | 956 / 1,312 | 961 |
| Lab, all expected fees | 1,322 / 1,766 | 1,327 |
| Lab false publication | 33 / 160 | 33 |
| Seven-state gate (right / wrong) | 915 / 30 | 920 / 30 (MN 130) |
| Texas gate (right / wrong) | 589 / 11 | 589 / 11 |

The read diff over all 291 Texas, seven-state and lab texts changes only State key 10272's reads (and adds
ten held, unpublished rows at live audit 8092's two loan lists). The single-check stop payment moves from
$35 to its own $20; $35 stays published, now under its own row, "Stop Payment (range of checks)".

**Not measured:** this session had no production access, so how many live documents print the shape is
not known. The new signature sends live documents through Hamilton's rules re-check, as for every bump.

**Lesson:** when a reader's shape test needs a name right after the price, a separator the page puts
between them silently turns the whole list into a stacked page, read one line off. Read the list as the
rows it states, with base's own readers, rather than adding rules for the separator.

**Agent lesson:** knox/issue-1092-dash-price-first-list
**Guard:** `src/lib/agents/knox/dash-list-rows.test.ts`
