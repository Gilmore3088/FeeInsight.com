# 2026-11-03: A table cell that lists several items beside a cell that lists their prices read as one line

**What happened:** `read.html_dom` writes each table row on one line, its cells joined by " | ".
St. Cloud FCU (answer key state:9308) lays ten fee rows out as two `<td>` cells. The label cell
holds a bold heading, then a `<ul>` with one `<li>` for each item. The price cell holds a `<br/>`,
which stands in for the heading, then a `<ul>` with one `<li>` for each price. One line came out per
row ("Safe Deposit Boxes 3 x 5 3 x 10 5 x 10 10 x 10 Lost Key Drilled Box | $18.00 a year $30.00 a
year ..."), so Knox paired at most the first price with the whole row and missed the rest. This is
class R3 in `findings/data/2026-11-02-lab-misses-by-root-cause.json`: state:9308 holds 22 of its 44
R3 misses. Row pairing (`HTML_ROW_PAIRING_LIVE`, #2951) reads only `<div>` rows, so it leaves these
rows byte for byte as they were (`2026-11-03-archived-source-bytes.md`).

**Fix:** `src/lib/agents/rosetta/html-cell-list-pairing.ts`, behind `HTML_CELL_LIST_PAIRING_LIVE`
(off). It writes such a row one line per item, "label heading item | price", each as its own stored
table row ("Safe Deposit Boxes 3 x 5 | $18.00 a year"). It acts only on markup evidence, and every
condition can only refuse:
- **The row:** a body row of a data table with exactly two non-empty `<td>` cells. It has no
  colspan or rowspan, and is not held by a rowspan from above. Neither cell holds a nested table or
  a hidden element (`hidden`, `aria-hidden`, `display:none`, `d-none`, `sr-only`). The table is not
  inside `<nav>`, `<footer>`, `role=navigation` or `role=contentinfo`.
- **List form:** each cell holds exactly one `<ul>`/`<ol>` as a direct child, and nothing after it
  but `<br>`s. The label cell's inline text before its list is the heading; a block before the list
  refuses. The price cell has no text outside its list. Each list holds only `<li>` items (and stray
  `<br>`s). No item is empty, and none holds a nested list or table.
- **`<br>` form:** neither cell holds a block or a list, and both split at their own `<br>`s into the
  same number of non-empty pieces. Only a trailing `<br>` is dropped; a blank piece anywhere else
  refuses, because it would shift the two cells against each other. A typed bullet ("• ") is dropped.
- **Pairing:** both cells use the same form, with the same number of items (2 to 12). Every price item
  starts with its price, states exactly one price or free word (a percentage counts as a price), and
  is at most 60 characters. No label item or heading states a dollar amount.
- **Refused rows:** a refused row reads byte for byte as with the switch off. 57 tests in
  `html-cell-list-pairing.test.ts` cover it: 3 for the switch, 11 rows that pair, and 43 near misses.
  The near misses include a count mismatch, nested lists on either side, a list on one side only,
  empty and hidden items, two prices in one item, colspan, rowspan, three cells, a footer or
  navigation table, a link-list table, a list of descriptions, and rows main already reads.

**Measured, source replay** (`source-replay.test.ts`, experiment `html-cell-list-pairing`; 39
documents, the same keys on both sides, today's pipeline). state:9308 is not in the replay, so
little was expected to move:

| Measure | Row pairing off: switch off | Switch on | Row pairing on: switch off | Switch on |
|---|---|---|---|---|
| Recall: answer-key fees published | 922 / 1,216 | 922 / 1,216 | 938 / 1,216 | 938 / 1,216 |
| Keys lost | | 0 | | 0 |
| Published fees not in the answer key | 29 | 29 | 30 | 30 |
| Documents whose score moved | | 0 | | 0 |

With the switch off, every fixture (HTML and PDF) reads the same as today's read, and row
pairing's own read is unchanged too (tested).

**Measured, St. Cloud proxy** (`src/lib/agents/deming/shadow-lab/cell-list-proxy.test.ts`; a proxy,
not recall). The 2025-02-09 Internet Archive capture is committed as test-only bytes,
`__fixtures__/proxy-bytes/state-9308-20250209.html.gz`. Its manifest gives the raw capture URL,
the CDX digest and the sha256 `350c3ad5...5e522`, which is the copy the source-bytes manifest lists as
rejected. It sits outside the replay and its denominator, and a test checks that. The capture fails
the same-document test, so keys are matched by category and amount against the capture's own text.
- **Pairs:** the switch writes 25 pairs from 9 rows. Each pair was checked by hand against the
  capture's markup, and **0 have the wrong price**. The test pins all 25, so any other pair fails it.
  Only those 9 rows' lines change.
- **The 22 R3 keys:** 14 now publish in the key's category, each named by its pair's label, at the
  price the capture prints beside that label, which is the key's price in every case:
  - cashiers_check $2.00
  - stop_payment $10.00 ("Cashier's Check Stop Payment")
  - rush_card $35.00
  - collection_item $25.00
  - safe_deposit_box $25.00, $30.00, $40.00, $80.00 and $250.00
  - nsf $35.00, overdraft $35.00 (Courtesy Pay Item)
  - deposited_item_return $35.00 and $5.00
  - monthly_maintenance $3.95
- **The 8 not recovered:**
  - The 4 check_cashing keys are refused: the label list nests a `<ul>` under "Non-Members", over one
    price and a nested list.
  - atm_international is refused: 3 label items over 2 prices.
  - notary_fee $0 is refused. The `<br>` form pairs, but the notary item states two prices ("FREE for
    members, $5 fee for non-members").
  - wire_intl_outgoing is not on the 2025 capture. Today's live page has the row.
  - monthly_maintenance $5.95 ("Checking Accounts Harvest Checking – if requirements are not met |
    $5.95 per month") is paired correctly, but Knox does not read it: a downstream miss.
- **On the whole capture:** key fees published go from 18 to 34 of 50, and published fees not in the
  key from 2 to 1. The wrong "FedEx Shipping" courier_delivery $50 publication goes, and nothing new
  is published outside the key.
- **Today's live page** (fetched 2026-11-03, plain HTTP, not committed) gives 29 pairs, all right,
  and 15 of the 22 keys: the international wire's $50 publishes as wire_intl_outgoing. Key fees go
  from 20 to 35, and outside-key fees from 2 to 1.

**The frozen-text lab, the ratchet, the quality gates and the golden gate do not move:** they
replay text that has already been read (`switch-replay-reasons.ts`).

**Before the switch flips:**
1. The PR that flips it bumps `HTML_READ_VERSION` by one in the same change. Each HTML reader switch
   that is on adds one (`reader-replay.test.ts` fails otherwise), so the flip re-reads every current
   `read.html_dom` and `read.js_fallback` copy once, and no PDF.
2. James runs the switch dry-run audit, section 11. It counts section 8's HTML exposure and the
   stored table rows in the switch's one-line shape (two cells, no dollar amount in the first, two or
   more in the second), with their documents and live fees. Stored rows keep cell text, not list
   markup, so the audit cannot say which rows would split. Rosetta's lost-text rule keeps a stored
   text unless the new one lists at least as many fees.

**Lesson:** a table cell can hold its own rows. When the label cell and the price cell list the same
number of items in the same markup, pair them item for item; refuse on any other shape (a count
mismatch, a nested list, an item with two prices), because inferring which price goes with which
item is what fails review.

**Guard:** `src/lib/agents/rosetta/html-cell-list-pairing.test.ts`,
`src/lib/agents/rosetta/reader-replay.test.ts`,
`src/lib/agents/deming/shadow-lab/source-replay.test.ts` (experiment `html-cell-list-pairing`),
`src/lib/agents/deming/shadow-lab/cell-list-proxy.test.ts`,
`src/lib/agents/deming/switch-dry-runs/run.test.ts` and `src/lib/data-store/switch-dry-runs.db.test.ts`.
Agent lesson: rosetta/issue-1092-pair-cell-lists-item-for-item. Tracker: #1092.
