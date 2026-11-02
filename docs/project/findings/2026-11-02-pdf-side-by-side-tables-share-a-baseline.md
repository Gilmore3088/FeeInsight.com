# 2026-11-02: the PDF reader joined side-by-side fee tables along a baseline, so a free service took its neighbour's price (Mountain Star FCU, fee 159428)

**Lesson:** A cell belongs to the table it is printed in. When a page sets fee tables side by
side, cut it at the gutters and read each table on its own; a gutter whose right side is an
amount column belongs inside its table. Never let one line join cells from two tables because
they share a baseline, and never pair an amount with a label it cannot be tied to by position.

**Agent lesson:** rosetta/fee-159428-cells-stay-in-their-table

**What happened:** Mountain Star FCU's 2026 fee brochure
(https://mountainstarfcu.org/wp-content/uploads/2026/01/Fee-Schedule-for-2026-1.pdf, source
document 38274, text 36365, `read.pdf_layout` at layout v4) is a tri-fold page: an introduction
beside three tables (General Fees, Account Fees, Electronic Funds Transfers), each a name column
and an amount column. The General Fees row "Money market / excess check" wraps onto two lines and
prints its "$5.00" centred between them. On the same baseline as "Money market", at the foot of
the Electronic Funds Transfers panel, the bank lists "Fax Service" among its free services.
`layoutPageResult` in `src/lib/agents/rosetta/pdf-layout.ts` grouped the whole page by baseline
(`baselineLines`), so the stored text reads:

```
Money market | Fax Service
$5.00
excess check
```

Knox read that as "Fax Service $5" (raw_fee_observations 935219), Darwin accepted it (verified
206116), and it went live as published fee 159428. The bank charges nothing for faxes; the $5 is
the money market's excess check fee. James's independent daily audit found it on Nov 2.

The earlier layout detectors split a page only when it is prose in columns (v2), a dot-leader list
beside a table (v4) or two stacked label/next-line price lists (v5). Side-by-side name/amount
tables fit none of them, so the page fell through to the across-the-page reading.

**How wide (read-only SQL on prod, Nov 2):** 4,312 current completed `read.pdf_layout` texts
(current copy, not superseded or duplicate) carry 36,265 live fees in `published_fee_catalog`
(2,294 texts have at least one). 3,226 of them hold a cell break (" | "), carrying 30,735 live
fees; only those can hold a cell joined across a gutter. As an estimate of pages set as side-by-
side tables: 308 texts (6,133 live fees) have three or more lines shaped "price | words | price",
and 1,385 (14,482 live fees) have five or more lines with three or more cells (that count also
takes a single table with two price columns). How many of these the new reading changes is not
known yet: the PDF bytes are in the vault, which the build session could not reach, and the
bank's host refused the session's fetch.

**Fix (Rosetta, `pdf-layout.ts`, `PDF_LAYOUT_VERSION` 6):**
- `tableCellColumns` cuts the page at its gutters into strips. A strip whose lines are at least
  half amounts ("$5.00", "5% of", "Free", "No fee", "Per hour", the "Amount" heading) joins the
  block on its left, so a table keeps its name and amount columns together.
- The page is split only when at least two blocks are fee tables (a label strip with an amount
  strip of its own, three or more priced lines,
  three or more worded lines, a median line of at most 40 characters, at least 12% of the page
  wide). A block that is not a table is allowed only at the page's left or right edge (an
  introduction, a notes column). Everything else keeps the old reading: one table with two price
  columns, a Service | Description | Fee table, a column of commentary that quotes prices, and a
  Service | Fee | Conditions table whose short conditions quote prices ("Plus $15 courier"), which
  has no amount strip of its own (review of #2948).
- Each table is read top to bottom on its own. An amount alone on a baseline midway (at most 0.9
  font heights, centred within 0.3) between the two lines of a wrapped label joins that label:
  "Money market excess check | $5.00", only when the lower line carries the upper one on (it
  starts in lower case, or the upper ends mid-phrase). A heading over its first row ("Electronic
  Services" / "Bill pay") or two labels sharing one merged cell ("Overdraft (paid)" / "NSF
  (returned)") are not joined. An amount a whole line below its label is left alone.
- An item that crosses a table's edge is written on its own line and never shares one with a
  table's cells. When such an item carries a price beside other tables' cells, the page's read
  attempt counts it (`detail.pdf_table_columns.ambiguousLines`), with the pages read as tables.
- Checked against every real PDF fixture in the repo (Oakwood, First United, Northern Trust,
  SchoolsFirst, two US Bank files, two of our own reports): all read exactly as before.

**Reaching the stored texts:** reader replay (`reader-replay.ts`) gains a pdf_layout branch: a
current completed `read.pdf_layout` text with a cell break and no layout read of its bytes at
`PDF_LAYOUT_REPLAY_VERSION` (6) is read once more, four documents a step beside the other replays,
keeping the earlier text unless the new one lists as many fees (`rungTextNotWorse`). It is behind
`PDF_CELL_REPLAY_LIVE` (off). The record-only layout recheck (`layout-recheck.ts`, three texts a
step) now samples every live-fee pdf_layout text below v6 and records, per live fee, whether the
shared source check supports it in the old and new reading. That is the dry run: turn the switch
on once those receipts show the v6 reading loses no supported live fee. A changed text goes to
Knox (new text hash) and Darwin re-checks its fees as usual.

**Not done here:** Knox could refuse a fee whose amount sits on another line than its name with
another label in between, or whose name is a list item under "free services" (#1092, Knox lane).
Fee 159428 itself is not touched: it goes when the replay re-reads document 38274 and Knox and
Darwin re-check it.

**Guard:** `src/lib/agents/rosetta/pdf-table-cells.test.ts`,
`src/lib/agents/rosetta/reader-replay.test.ts`
