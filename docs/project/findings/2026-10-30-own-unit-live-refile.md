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
when all of these hold:
- `ownFeeUnit` proves the unit on its own stored line;
- `checkFeeAgainstSource` still traces it in the document's whole current text;
- every current line that traces it (the whole text's trace, and each line that prints the fee's
  name and price and traces by itself) states the same unit in the fee's own row, with one price,
  no conflicting units and no per-event basis after the price;
- Hamilton's fill keeps that unit on the stored line, so the next publish does not set it back.

Off, a step records only its counts (the `darwin.own_unit_check` event). A verify run with
`own_unit_full_count: true` counts the whole table. Each re-file is logged to `pipeline_feedback`
(kind `own_unit_refiled`, with the old frequency) and a `darwin.own_unit_refiled` event.

The shared reader (Knox v140) also stopped letting a unit that appears only in the name override an
explicit per-event basis after the price ("Research Copies (Per Page) | $5.00 per request" or "...
per item" reads no unit; "each" still keeps the name's unit). Hamilton's fill keeps a stored special
unit only when this reader agrees, so v140 could flip a live per-page fee back. It flips none: on
prod (read-only, Oct 30) all 164 live fees stored per page, document, image, statement or part-hour
read the same unit on their stored line under v139 and v140, and `settledFrequency` keeps every one.

**Dry run (prod, read-only, Oct 30, switch off, whole-text source check as the step runs it):**
1,776 live flat per-event fees name a unit on their stored line; `ownFeeUnit` proves one on 893.
- `refile`: 879 fees at 671 banks (877 `per_item`, 2 `per_transaction`).
  - By category: document_reproduction 632, counter_check 127, notary_fee 63, check_image 41,
    garnishment_levy 6, check_printing 4, account_research 4, legal_process 2.
  - By unit: per_page 799, per_document 72, per_statement 8.
- Kept: 6 `unit_conflict` and 8 `unit_unstated`. Examples:
  - 92645: stored per document, but the document says "Statement Copy | $1.00 | per Statement".
  - 149808: the line that traces it is "Cleared Check Inquiry/Copy Fee $5.00 per item".
  - 163638: the current row is "*Photocopy (per page) | $ | 1.00", with the price split from its
    dollar sign.
- Against the first dry run (848, which ran the source check on price lines only):
  - 11 of those 848 drop out: 3 `unit_conflict`, 7 `unit_unstated` and 1 the v140 reader no longer
    proves (66744, "Copy of Share Draft (Image) | $3.00 per copy").
  - 42 come in: lines the v139 reader now proves (dashes, label slashes) and fees the whole text
    traces.
- Medians (approximation: one median per institution, then the median of those; consumer rows with
  a source document at active institutions; special units left out):
  - No national category median moves. document_reproduction stays $3.00 while its institution count
    goes from 2,555 to 2,344; counter_check stays $2.00, notary_fee $2.50, check_image $3.00.
  - 54 of 405 state medians in these categories move, 28 of 54 in document_reproduction.
- 15 sampled re-files, each checked against its stored and current lines: every line states the unit
  in the fee's own row. Examples: "Statement Copies | $3.50 / page", "Notary Service $5 per
  document", "Photocopies ....$1.00 Each Page", "Temporary Checks (per page) | $5.00".

**Agent lesson:** darwin/issue-2248-a-reader-fix-needs-its-live-refile

**Guard:** `src/lib/agents/darwin/own-unit-check.db.test.ts`, `src/lib/agents/darwin/own-unit-check.test.ts`
