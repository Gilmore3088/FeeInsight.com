# 2026-11-02: PDF pages in two independent columns were read across the page

**What happened:** `read.pdf_layout` groups a page's text runs by baseline and writes each baseline
as one line, with " | " at a wide gap. When none of its column detectors fires (prose columns v2,
a dot-leader list beside a table v4, stacked bullet lists v5), a page set in two independent
columns is read across: each left-column line takes the right-column line on the same baseline as
its next cell. Two fees land on one line ("Youth Savings | Free | Official Check | Free", San
Francisco FCU), a heading loses its rows ("Wire transfers | 202288762-020 Rev. 10/2024", First State
Bank of Livingston), and a heading from the other column sits above the wrong rows ("RESEARCH | 5 x 10
| $ 100.00", Seacoast). This is class R4 in `2026-11-02-lab-misses-by-root-cause.md`. On the
source-bytes re-read (`2026-11-02-lab-replays-source-bytes.md`) 32 R4 keys were still missed.

**Diagnosis from the bytes** (pdf.js items of the 18 replay PDFs, x-positions and gutters):
- **Prose beside a fee table** (Texhillco, texas:2429 p. 20): prose at x 27-205, gutter 207-221, the
  fee table's labels at 221, its prices at 308. A second gutter (294-309) is the table's own gap
  between label and price.
- **Two fee tables side by side** (San Francisco FCU, a landscape page; Seacoast; Ameris; Expedition;
  Ithink): each side has its own label and price columns.
- **Facing pages on one sheet** (First State Bank of Livingston, pages 22 and 23).
- **Account terms in two columns** (U.S. Century Bank): prose with prices in its sentences, so the
  v2 prose detector refuses it.
- **The risk:** a fee table is also two "columns". On Schools FCU (state:7450) a tier table's label
  and first price sit left of a clean gutter (258-277) and four more price columns sit right of it.
  An early rule that tested only whether the right side opened at its own left edge with a price
  split that table and lost 4 keys. A page-wide gutter also fails when titles and footnotes span
  the page (Seacoast: 10 footnote lines against a 7-line allowance).

**The rule** (`src/lib/agents/rosetta/pdf-columns.ts`, behind `PDF_COLUMN_READING_LIVE`, off). It
runs only when no earlier detector fires. A gutter splits the page only when:
- no row reaches across it: no shared baseline whose right side opens at its own edge with a price,
  or is nothing but price cells ("$1 $1 $1 $1", "3 Free → $5"); none whose left side is a bare
  price facing a label; no label running into the gutter with its price just past it;
- the right side is not one more column of a table on the left (two reviews of #2965). The right
  side's lines are grouped into blocks: a line goes on with the block above when it starts in lower
  case or has no left cell on its baseline, so a wrapped note or description is one block. A block
  starts on a row when the left side on its first line is a table row ending in a price cell
  ("Overdraft fee | $30.00") and the right side there is not a fee row of its own (a cell row with
  a price, a dot-leader line). When half or more of the blocks start on rows, the split is refused:
  a table's notes, descriptions (wrapped onto three lines too) and second prices ("Non-members
  $30.00", "Not available") start on their rows, while independent columns start their blocks
  wherever their own text runs. Prose that shares a table's baselines is refused the same way; prose
  set in its own leading is not.
  - Row alignment alone could not separate them: the real splits share 36% to 100% of their
    baselines (texas:841's facing pages 90-100%). A line-count share (round two) let a wrapped
    description column through, since only a third of its lines sit on a row.
  - Block-start share on the 27 splits of the 18 replay PDFs: 0.00 on 17; 0.03 on 2; 0.07, 0.10,
    0.11, 0.16, 0.20, 0.24, 0.25; at most 0.32 (Buffalo Metropolitan). The review's fee-table
    shapes score 0.94 to 1.00. The threshold is 0.5;
- each side stands on its own: running prose (median line 25 characters or more, few cells), or at
  least 3 lines that hold their own label and price;
- each side is a fifth of the text width or more and holds 5 lines or more; text is upright.

Left to right, a passing gutter is kept only when the column it closes stands on its own, so a
strip of bullet glyphs joins its column (U.S. Century). When no gutter runs the whole page, the
page is cut into regions at lines holding one item half the text width wide (a title, a footnote),
and each region is tried alone; spanning lines are read whole.

**Tests:** 53 near-miss tests on synthetic positioned runs (`pdf-columns.test.ts`): two fee lists,
offset baselines, two side-by-side tables, prose beside a table both ways, account terms, full-width
title, heading mid-page, spanning footnotes, title plus footnotes, bullet strip, booklet spread,
landscape tables, three lists, headings and wrapped labels inside a column, box-size rows; and kept
row by row: label|price tables, word prices, priced terms, two price columns, a five-column tier
table, service|description|fee, price-first, right-aligned prices, a table under a heading, wide
labels, one crossing row, a bare price facing its label, a label running into the gutter, tier
prices set in from the edge, a narrow sidebar (prose or prices), a column of footnote marks,
two-column footnotes under a table, a rotated page, a wide landscape table, too few runs, short
columns, labels beside descriptions, a mixed page whose table rows cross, a mixed page split only
below its heading, pages the earlier detectors already read, and from the review: a Service | Fee |
Notes table, a notes column of long lines, a Member | Non-member table whose second price opens with
words, table rows beside single-cell fee lines (which read like notes, so they stay rows), a
description column wrapped onto three lines, near-equal mixed-case notes, all-lower-case notes, and
prose on a table's own baselines. Switch tests: off by default, the
default read is the switch-off read (3 tests). `shadow-lab/pdf-column-reading-inert.test.ts` reads all 18
replay PDFs with the switch off and at its default and checks each text's sha256 against main
d5771aa66's (`__fixtures__/source-bytes/pdf-text-main-sha256.json`).

**Measured** with shadow-lab experiment `pdf-column-reading` (`source-replay.test.ts`, 38 reproduced
documents, same keys, today's pipeline on both sides; main 53c80d54e merged, layout v6 and Knox v170):

| Measure | Switch off | Switch on |
|---|---|---|
| Re-read recall | 898 / 1,187 (75.7%) | 917 / 1,187 (77.3%) |
| Keys lost | | 0 |
| R4 keys still missed | 32 | 26 |
| Published fees not in the answer key | 29 | 31 |

- **Keys gained (19):**
  - R4 (6): state:7114 stop_payment:3000, state:8036 cashiers_check:0, state:8085
    safe_deposit_box:12500, texas:2429 notary_fee:0, texas:841 check_image:100, texas:841
    wire_domestic_outgoing:2500.
  - Others (13): state:1338 ach_origination:30; state:3148 cashiers_check:500; state:6730
    wire_domestic_outgoing:2000, wire_intl_outgoing:3000; state:8085 wire_domestic_incoming:1500,
    wire_domestic_outgoing:1700; state:8240 wire_domestic_incoming:2000, wire_domestic_outgoing:2000,
    wire_intl_incoming:2000, wire_intl_outgoing:6000; texas:2451 overdraft:500; texas:841
    document_reproduction:200, document_reproduction:500.
- **Publications outside the key, each checked by hand against the document's text:**
  - Added, right: U.S. Century "Charge Back Check (loan payment) | $25.00" (other_lending_fee $25),
    listed under Funds/Transaction Related on page 4.
  - Added, right: Seacoast "Collection fees (customer only) / Outgoing & incoming | $ 20.00"
    (collection_item $20).
  - Added, right: Seacoast "Excessive transactions / Savings Account (per transaction) | $ 3.00"
    (excess_withdrawal $3).
  - Removed, was wrong: Summit FCU's "Inactivity fee after 12 consecutive months of inactivity
    $7.95" was published as the account's dormant_account $7.95. It sits under "Visa® Gift Cards";
    read in its column it is no longer published.
- **The 26 R4 keys still missed:**
  - 10 are wrapped table cells, not columns: a price cell on two lines with its label centred
    between them ("$10.00 if account closed / Account Closure / within 90 days"), 9 on Texhillco and
    Seacoast's "Cashier's Check with Expedited Shipping / $ 45.00". Layout v6 (#2948,
    `tableCellLines`) pairs that shape inside its own side-by-side table bands only; reading these
    column bands with it is the next step.
  - 16 already read on one line in today's re-read or after the split, and are missed downstream
    (Knox or Darwin): state:10193 x2 (a maintenance fee stated in a sentence), state:1338 (its
    description is on the next line), state:3148, state:3981, state:6730, state:7114
    atm_non_network:25 (a wrapped label), state:8240 card_replacement (a gift card fee), texas:2451
    x3, texas:841 x5.
- **The frozen-text lab, the ratchet, the quality gates and the golden gate do not move**: they
  replay text that has already been read.

**Before the switch flips:**
1. Layout v6 (#2948, merged during this PR and merged in): it changes none of the 18 replay PDFs,
   and its `tableCellColumns` runs before this detector, which runs only when v6 finds no tables.
2. A PDF reader version for the change. Flipping the switch alone re-reads nothing; only documents
   read after it get the new text. A `PDF_LAYOUT_VERSION` bump with a replay lane (as #2948 adds
   for v6) would re-read current PDF texts; it is not in this PR.
3. James runs the switch dry-run audit, section 9 (current PDF layout and free OCR documents and
   the live fees on them, as exposure; the audit cannot re-read bytes).

**Lesson:** a fee table is also two columns, so split a page only on positive evidence that no row
reaches across the gutter and that each side carries its own fees or prose, and look for the gutter
within each region between spanning lines.

**Guard:** `src/lib/agents/rosetta/pdf-columns.test.ts`,
`src/lib/agents/deming/shadow-lab/pdf-column-reading-inert.test.ts`,
`src/lib/agents/deming/shadow-lab/source-replay.test.ts` (experiment `pdf-column-reading`),
`src/lib/agents/deming/switch-dry-runs/run.test.ts`. Agent lesson:
rosetta/issue-1092-read-independent-pdf-columns.
