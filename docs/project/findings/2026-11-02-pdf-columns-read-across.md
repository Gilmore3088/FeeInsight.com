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
runs only when no earlier detector fires. Five review rounds of #2965 each found a fee table whose
notes, descriptions or second prices split off as a "column", so the rule now requires positive
evidence that the two sides are independent and keeps main's reading otherwise. A gutter splits a
page, or a region between spanning titles and footnotes, only when all of these hold:
- **No row reaches across it:** no shared baseline whose right side opens at its own edge with a
  price or is nothing but price cells; no bare price facing a label; no label running into the
  gutter with its price just past it.
- **Each side stands on its own:** running prose, or at least 3 lines with their own label and
  price; a fifth of the text width or more; 5 lines or more; upright text.
- **The right side is not one more column of a left table** (an extra refusal). Both sides are
  grouped into blocks (a lower-case or "(" line goes on with the block above; a right line facing a
  left continuation goes on too), a right line faces the nearest left line within half a pitch, and
  a left block is a priced row when a line ends in an amount, in a cell or not. When 42% or more of
  the right blocks start on priced rows without being fee rows of their own, the split is refused.
  On the 27 splits that rule alone allowed, the share is 0.00 on 12 and at most 0.34; the reviews'
  fee-table shapes score 0.50 to 1.00.
- **And one piece of positive evidence:**
  - (a) own baselines: 60% or more of the right side's lines face no left line within half its pitch;
  - (b) facing pages: the gutter within 10% of the text width from the centre, both halves 70% of
    the height or more, and each half with its own furniture (one of its first or last 3 lines faces
    nothing across, or a printed page number among its last 3);
  - Two self-contained tables are not evidence (fifth review). A row-aligned Member | Non-member
    table with its own "Non-members" label cells, and label | price | sub-label | sub-price tables,
    passed that test and published five wrong check_printing fees. Geometry cannot tell two
    row-aligned tables from one wide table, so they keep main's reading.

Measured on the 27 splits the earlier rule allowed:
- (a) never reaches 0.6 (highest 0.48, San Francisco FCU).
- 18 pass (b): state:10193 pp. 2 and 4, state:3981, state:6820, state:7114, state:8085,
  state:8741, texas:2451 pp. 13 and 14, and texas:841's nine facing-page spreads.
- 9 are refused: state:1338 (two regions), state:3148, state:6730, state:8036, state:8240,
  texas:2429 p. 20, texas:2451 pp. 9 and 10.
- Every reviewer fee-table case (zz-adv to zz-adv6) keeps its rows.

Left to right, a passing gutter is kept only when the column it closes stands on its own, so a
strip of bullet glyphs joins its column (U.S. Century). Spanning lines are read whole.

**Tests:** 66 near-miss tests on synthetic positioned runs (`pdf-columns.test.ts`, plus 3 for the
switch). Every repro from the five reviews is a test, and each failed before its fix. The split
tests carry their evidence (each half's page number, or the right side's own line spacing); prose
beside a fee table, and two row-aligned tables, with no such evidence keep their rows. `shadow-lab/pdf-column-reading-inert.test.ts`
reads all 18 replay PDFs with the switch off and at its default and checks each text's sha256
against main's (`__fixtures__/source-bytes/pdf-text-main-sha256.json`).

**Measured** with shadow-lab experiment `pdf-column-reading` (`source-replay.test.ts`, 38 reproduced
documents, same keys, today's pipeline on both sides, main merged):

| Measure | Switch off | Switch on |
|---|---|---|
| Re-read recall | 898 / 1,187 (75.7%) | 906 / 1,187 (76.3%) |
| Keys lost | | 0 |
| R4 keys still missed | 32 | 28 |
| Published fees not in the answer key | 29 | 32 |

- **Keys gained (8):**
  - R4 (4): state:7114 stop_payment:3000, state:8085 safe_deposit_box:12500, texas:841
    check_image:100, texas:841 wire_domestic_outgoing:2500.
  - Others (4): state:8085 wire_domestic_incoming:1500,
    wire_domestic_outgoing:1700; texas:841 document_reproduction:200, document_reproduction:500.
- **Given up by requiring evidence (11 of the earlier 19 gains):**
  - R4: state:8036 cashiers_check:0 and texas:2429 notary_fee:0.
  - Others: state:1338 ach_origination:30 (two row-aligned tables); state:3148 cashiers_check:500; state:6730 wire_domestic_outgoing:2000 and
    wire_intl_outgoing:3000; state:8240 wire_domestic_incoming:2000, wire_domestic_outgoing:2000,
    wire_intl_incoming:2000 and wire_intl_outgoing:6000; texas:2451 overdraft:500.
  - Summit's wrong gift-card "inactivity" $7.95 is no longer removed: its page is not split.
- **Publications outside the key, each checked by hand against the document's text:**
  - Added, right: U.S. Century "Charge Back Check (loan payment) | $25.00" (other_lending_fee $25),
    listed under Funds/Transaction Related on page 4.
  - Added, right: Seacoast "Collection fees (customer only) / Outgoing & incoming | $ 20.00"
    (collection_item $20).
  - Added, right: Seacoast "Excessive transactions / Savings Account (per transaction) | $ 3.00"
    (excess_withdrawal $3).
- **The 28 R4 keys still missed:**
  - 10 are wrapped table cells, not columns: a price cell on two lines with its label centred
    between them, 9 on Texhillco and 1 on Seacoast. Layout v6 (#2948, `tableCellLines`) pairs
    that shape inside its own table bands only.
  - 2 are on pages now refused for want of evidence (San Francisco FCU, Texhillco).
  - 16 already read on one line and are missed downstream, by Knox or Darwin.
- **The frozen-text lab, the ratchet, the quality gates and the golden gate do not move**: they
  replay text that has already been read.

**Before the switch flips:**
1. Layout v6 (#2948, merged during this PR and merged in): it changes none of the 18 replay PDFs,
   and its `tableCellColumns` runs before this detector, which runs only when v6 finds no tables.
2. A PDF reader version for the change. Flipping the switch alone re-reads nothing; only documents
   read after it get the new text. A `PDF_LAYOUT_VERSION` bump with a replay lane (as #2948 adds
   for v6) would re-read current PDF texts; it is not in this PR.
3. James runs the switch dry-run audit, section 10 (current PDF layout and free OCR documents and
   the live fees on them, as exposure; the audit cannot re-read bytes).

**Lesson:** a fee table is also two columns, and its notes, descriptions and second prices take
endless shapes, so refusing them one shape at a time never ends. Split a page only on positive
evidence that the sides are independent (facing pages with their own furniture, or their own line
spacing), and keep main's reading otherwise; two row-aligned tables look like one wide table.

**Guard:** `src/lib/agents/rosetta/pdf-columns.test.ts`,
`src/lib/agents/deming/shadow-lab/pdf-column-reading-inert.test.ts`,
`src/lib/agents/deming/shadow-lab/source-replay.test.ts` (experiment `pdf-column-reading`),
`src/lib/agents/deming/switch-dry-runs/run.test.ts`. Agent lesson:
rosetta/issue-1092-read-independent-pdf-columns.
