# 2026-10-30: Fees published before Knox v139 stay flat although their own line prices them per page

**What happened:** Knox v139 (#2804) reads a page, document, image or statement unit on more line
shapes ("Photocopies (per page) | $0.10", "Counter Checks | $1.00 | Per Page"), but only on new
reads. Fees already live keep `per_item`, and the category medians (`fee-stats`, `specialUnitSql`)
pool a $0.25-per-page photocopy with flat $3 and $5 photocopy fees (#2248).

**Cause:** No step moves a live fee's stored frequency to a special unit. Hamilton's frequency fill
keeps a special unit only when one is already stored (`settledFrequency`), Darwin's verify reads
only new raw rows, and the hourly re-check (#1456) covers the hour alone. A new reader rule reaches
only fees read after it unless a live re-check ships with it.

**Fix:** Darwin's own-unit re-check (`src/lib/agents/darwin/own-unit-check.ts`, behind
`OWN_UNIT_REFILE_LIVE`, off). Each verify step reads live flat per-event fees whose stored line
names such a unit. A fee is re-filed (price, name and category unchanged, nothing taken down) only
when `ownFeeUnit` proves the unit on its own stored line, `checkFeeAgainstSource` still traces it in
the document's current text, the traced line states no other unit, and Hamilton's fill keeps that
unit on the same line, so the next publish does not set it back. Off, a step records only its counts
(the `darwin.own_unit_check` event); a verify run with `own_unit_full_count: true` counts the whole
table. Each re-file is logged to `pipeline_feedback` (kind `own_unit_refiled`, with the old
frequency) and a `darwin.own_unit_refiled` event.

**Dry run (prod, read-only, Oct 30), switch off:** 1,776 live flat per-event fees name a unit on their
stored line; `ownFeeUnit` proves one on 861.
- `refile`: 848 fees at 652 banks (847 `per_item`, 1 `per_transaction`): document_reproduction 602,
  counter_check 124, notary_fee 63, check_image 42, garnishment_levy 6, check_printing 4,
  account_research 4, legal_process 2, check_cashing 1. By unit: per_page 768, per_document 70,
  per_statement 9, per_image 1.
- Kept: 9 `untraced` (the document no longer prints the fee at its price), 2 `unit_conflict` (the
  stored line says per page or per document, the document's line per statement), 2 `no_text`; no
  `hourly` and no `fill_unstable`.
- The source check ran on each document's lines that print the fee's price (with the line before),
  not the whole text, so the step's own count can differ slightly.
- Medians (approximation: one median value per institution, then the median of those, consumer rows
  with a source document at active institutions, special units left out): no national category
  median moves (document_reproduction stays $3.00 on 2,555 to 2,352 institutions; counter_check
  $2.00; notary_fee $2.50; check_image $3.00). 57 of 459 state medians in those categories move, 29
  of 54 in document_reproduction (AL $2.00 to $3.00, PA $3.00 to $4.00, MT $2.00 to $4.50).
- 15 sampled re-files, each checked against its stored line: every line states the unit. One
  (65124, "Copy Fee (per document) | $2 | Fee is charged per item each time presented") also says
  "per item" in its note; the name's unit wins.

**Lesson:** darwin/issue-2248-a-reader-fix-needs-its-live-refile.
