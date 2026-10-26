# 2026-10-26: the HTML reader drops empty table cells, so a value moves under the wrong column (#1912)

**Lesson:** An empty table cell holds a column. Place every cell on the table's column grid
(colspan, rowspan and empty cells included) before writing the row, and when an empty cell would
shift a value under the column to its left, write that column's header name after the value.

**Agent lesson:** rosetta/issue-1912-empty-cells-keep-their-column

**What happened:** Capital City Bank's savings page (https://www.ccbg.com/personal/savings,
document 31378, text 29131, `read.html_dom`) has a "Compare Accounts" table. Its header row has an
empty corner cell, then Minor Savings+ | money market | CD | ira | premium money market. Its
"Fees/Penalties" row is (empty) | (empty) | "Early withdrawal penalty" (CD) | "$50 fee to close
prior to maturity" (IRA) | (empty). `writeTable` in `src/lib/agents/rosetta/html-dom.ts` kept only
the non-empty cells (`rowCells.map(inlineText).filter((cell) => cell.length > 0)`), so the text and
`agent_source_texts.table_rows` both hold:

```
Minor Savings+ | money market | CD | ira | premium money market
Fees/Penalties | Early withdrawal penalty | $50 fee to close prior to maturity
```

Read against the header, the $50 sits under "CD". Knox's paid read filed it as
"Early closure of CD (fee to close prior to maturity)", `early_closure` $50, and it is live as
fee 140269 (`agentic_darwin_verified`; read-only check of `published_fee_catalog`, 2026-10-26).
The bank charges it for closing an IRA early. The bank's IRA closing fee is already live
separately, as fee 90972 "Individual Retirement Account Closing Fee", `ira_termination` $50
(document 37072).

Knox's free team reads no fee from either form of that row (`reproducibleFees`, checked in
`src/lib/agents/rosetta/html-table-columns.test.ts`), so the wrong category came from the paid read
of a text whose columns had already been lost.

**How wide (read-only SQL on prod, 2026-10-26):** across all `read.html_dom` texts with
`table_rows` (10,679 texts, current and older copies), 15,180 non-header `html_table` rows that
hold a dollar figure have fewer cells than the widest row of their table: 1,983 texts at 640
institutions. Of those, 10,925 rows (1,290 texts, 448 institutions) are in a table with a header
row of two or more cells. These are upper bounds. A row is short for three reasons: an empty
cell inside the row (the bug), empty cells at its end, or a colspan cell. The stored rows cannot
tell these apart because the empty cells are gone.

**Fix (Rosetta, `html-dom.ts`, `ROSETTA_TABLE_ROWS_VERSION` 2):**
- Every row is placed on the table's column grid. A colspan cell covers its columns, a rowspan
  cell holds its column in the rows below, and an empty cell keeps its column.
- `table_rows` rows from HTML tables gain `columns` (the row's text per grid column, "" for an
  empty or covered column, as wide as the table). `cells` is unchanged.
- A cell is displaced when an empty cell of its own row comes before it. If the nearest header row
  names its column (at most 40 characters, no digit), the text writes the name after the value:
  `Fees/Penalties | Early withdrawal penalty (CD) | $50 fee to close prior to maturity (ira)`. That
  row's text is stored in `line`, and `rowsInText` matches on `line`.
- Nothing else changes. Full rows, rows whose empty cells all sit at the end, colspan and rowspan
  rows, header rows, and tables with no header row keep exactly the text they had.

**Why the name goes after the value:** the first form tried was the header name before the value
("Stop payment | Premier Checking: $25.00"). It lost fees from Knox's free reading: the words
before the price became the fee's name. In a test table it lost 5 of 8 fees that the old line
read. The form "Stop payment | $25.00 (Premier Checking)" read all 8, and no new ones.

**What re-reads the stored texts:** nothing, on purpose. A Rosetta re-read of stored HTML is
triggered by `ROSETTA_READ_VERSION` (reader replay, `rosetta/reader-replay.ts`: every current copy
whose primary-reader text predates the version is read again, at most 4 a read step). It was not
bumped. A bump would re-read every current HTML, PDF, plain-text and Word copy. Each changed text
gets a new hash, which Knox re-extracts, and Knox's paid pass (`extract-paid`) buys a model call
for a changed text with at least 15 priced lines, a low free yield and no paid attempt on its new
hash. That is paid spend, and it needs James's approval. `ROSETTA_TABLE_ROWS_VERSION` selects
nothing (its Bayes manifest is uncounted, and no query reads it), and Hamilton's rules re-check
signature is Knox's free-team versions only, so neither re-reads anything. The new text reaches a
page on its next ordinary read. Text 29131 keeps its stored text until then, and fee 140269 stays
live until a re-read of document 31378 or an admin action. Fixing the process comes first, and
the one-off data fix comes after it.

**Dry run:** none on live pages. From the build container on 2026-10-26, the egress proxy refused
every outbound host this session (`connect_rejected` for www.ccbg.com and the 60 sampled affected
pages, and for example.com too). So 0 of 60 sampled affected pages could be fetched, and no old
and new reader comparison on live HTML exists yet. Offline, the old and new readers give
byte-identical text on all 65 HTML files in the repository, with no fee read gained or lost. The
existing Rosetta, Knox and custom-report suites pass unchanged, apart from three expectations that
now include `columns` or table-rows version 2.

**Left as it is:** the Word reader (`docx.ts`) drops empty table cells the same way (`.filter(Boolean)`
on a row's cells). It is not changed here.

**Guard:** `src/lib/agents/rosetta/html-table-columns.test.ts` (fixture
`test-fixtures/capital-city-savings-compare.html`, rebuilt from text 29131's stored rows and the
column positions #1912 reports, without the rows whose empty cell's column is unknown).
