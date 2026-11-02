# 2026-11-02: the HTML reader drops table rows wrapped in any element other than thead/tbody/tfoot (#1050)

**Lesson:** A table's rows belong to it wherever they sit between the table and its cells. Collect
every row that is not inside a nested table or a cell, so a table never reads as its header alone.

**Agent lesson:** rosetta/table-rows-inside-a-wrapper-2026-11-02

**Guard:** `src/lib/agents/rosetta/html-dom.test.ts` ("keeps table rows that sit inside a wrapper
element", "keeps rows under a form, under a thead wrapper, and in an implicit second body", "never
takes a nested table's rows")

**What happened:** Live-site audit draw 275762 flagged live fee 37214 at Salem Five (institution
190): "Account Reconciliation (per hour)", $25, `account_research`, cited at
https://www.salemfive.com/feeschedule/, with the name not in the stored text. The fee is right.
It is cited to document 12903 (Oct 2), whose text (265, written before `read.html_dom`) has the
row. Every `read.html_dom` copy of the page since then (documents 20491, 21507, 24524, 36134 and
the current 39537; texts 16388, 17931, 21709, 34265, 37687) keeps the header row
"Misc. Account Related Fees | Amount" and nothing under it. The "Foreign Currency Exchange Related
Fee | Amount" and "Electronic Banking Related Fees | Amount" tables and the product comparison
tables ("Features | Classic Five Checking℠ | ...") lost their body rows the same way.

`tableRowsOf` in `src/lib/agents/rosetta/html-dom.ts` took only `<tr>` elements directly under
`<table>` or directly under thead/tbody/tfoot, and `writeTable` writes nothing else inside a
table. A row inside any other element there (a `<div>`, a `<form>`, a framework's wrapper) left
no text at all, and no row in `table_rows`.

**What was not the cause:** another session suggested rows directly under `<table>` after a
`<tbody>`, or rows in a second implicit body. htmlparser2 already keeps those as direct children
of `<table>`, and the old reader read them. The new tests cover both shapes.

**Not verified:** the page's raw HTML. The vault needs R2 credentials this session did not have,
and the egress proxy refused salemfive.com. The wrapper element was reconstructed from the stored
texts and the reader code. The old reader keeps a header row and drops its body only when the rows
sit inside a non-section element under `<table>`, which matches every stored copy. The exact
wrapper tag on Salem Five's page is still unknown.

**How wide (read-only SQL on prod, 2026-11-02):** of 4,311 current `read.html_dom` texts (not
superseded, not a duplicate) with `table_rows`, 80 texts at 52 institutions have at least one
`html_table` table whose every stored row is a header row of two or more cells; 150 such tables.
This is an upper bound: a page can also put its header in a table of its own. Those 80 documents
are the source of 297 live fees in `published_fee_catalog`; their 52 banks have 1,066 live fees in
all. Salem Five has 24 live fees, none cited to its current document 39537.

**Re-reads:** `ROSETTA_READ_VERSION` is not bumped. A bump replays every current primary-reader
text (`read.pdf_layout`, `read.html_dom`, `read.plain_text`, docx) through `reader-replay.ts`, at
`READER_REPLAY_PER_RUN` (4) a run, and Knox re-extracts every text whose hash changes. That is
thousands of documents to repair 80. A page picks up the fix on its next ordinary read, when
Magellan fetches new bytes. Salem Five's page has returned new bytes every week since Oct 7. A
page whose bytes never change keeps its old text until a scoped re-read selects texts with a
header-only table; that re-read is a follow-up, not part of this fix.

**Fees:** the change only adds rows that were missing; it holds, rejects or re-files nothing.
When a page is read again, the lost-text rule keeps the new text only if it lists at least as
many fees. Knox re-extracts it, and Darwin's live re-check then finds names like "Account
Reconciliation (per hour)" in the current text again. No live fee comes down from this change.
