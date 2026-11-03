# 2026-11-02: HTML had no reader version of its own, so an HTML change could only replay every PDF too

**What happened:** HTML row pairing (`HTML_ROW_PAIRING_LIVE`, #2951,
`2026-11-02-html-rows-without-tables.md`) changes only how `read.html_dom` writes a page. Flipping
it re-reads nothing: only pages read after the flip get the new text. Reader replay
(`reader-replay.ts`, #2069) replays a text when its reader's version moves, but `read.html_dom`
shares `ROSETTA_READ_VERSION` with `read.pdf_layout`, `read.plain_text` and `read.docx_text`. A
bump of it would replay every primary-reader current copy, PDFs included, at 4 a run. #2951 lists
an HTML-only version as flip prerequisite 3.

**Fix:** `HTML_READ_VERSION` (`reader-versions.ts`, v1), with `HTML_READ_BASE_VERSION` (1) and
`HTML_READ_READERS` (`read.html_dom`, `read.js_fallback`; the fallback reads its rendered page
through the same DOM reader, so pairing changes its text too).
- **Recorded:** every read attempt whose reader is an HTML reader stores `detail.html_read` (in the
  existing `pipeline_attempts.detail` jsonb; no migration). An attempt without it, every read before
  this PR, counts as the base version. A replay receipt for an HTML-read text stores
  `html_read_version`.
- **Selected:** above the base, `readerReplayDueSql` adds one branch. A current completed text whose
  reader is an HTML reader is due when no read attempt on its bytes records `html_read` at the
  version and no `rosetta.reader_replay` receipt names it at that version. No other reader's text
  enters the branch, so PDFs, plain text, DOCX and OCR texts are untouched.
- **At the base the SQL is unchanged:** the branch is left out of the text, not made false. Checked
  by generating the read candidate query on `main` and on this branch for all 19 lane/stacked/
  current-copy combinations: byte-identical (query and params). `reader-replay.test.ts` pins it.
- **Legacy texts (no reader recorded) are not in the HTML branch.** An HTML reader did not write
  them, and they are already due under `ROSETTA_READ_VERSION` (the primary branch takes
  `reader IS NULL`) until a current-version read settles them; that read is an ordinary read, so an
  HTML page is then read by `read.html_dom` with whatever pairing is on. Pulling them in would also
  sweep in legacy PDFs, which is what this version exists to avoid.

**Tied to the switch:** v2 is `HTML_ROW_PAIRING_LIVE`. `reader-replay.test.ts` asserts
`HTML_READ_VERSION` is base + 1 exactly when the switch is on, so the PR that flips the switch fails
until it bumps the version too, as `FOLD_RULES_VERSION` follows its switch (#2892). The constant
stays a literal so `reader-versions.ts` keeps no imports (Bayes's manifests read it).

**Live effect:**
- **Now (switch off, v1):** the read selection is byte-identical to `main`, so no document is
  selected differently. Two record-only changes: HTML read attempts carry `html_read: 1`, and replay
  receipts for HTML-read texts carry `html_read_version: 1`. Nothing reads either at v1.
- **When the switch flips with the bump to v2:** every current completed `read.html_dom` and
  `read.js_fallback` text becomes due in the replay lane once, 4 a read step, sharing the lane with
  the other replays. The lost-text rule holds: the new text replaces the old only when it lists at
  least as many fees. A copy not in the vault is fetched again from its link. Exposure: 4,311
  current `html_dom` texts on Nov 2 (`2026-11-02-html-table-rows-inside-a-wrapper.md`); the
  `js_fallback` count is not known here. At 4 a step, the 4,311 alone take about 1,078 steps. The
  switch dry-run audit (#2951 prerequisite 4) counts the exact exposure before the flip.

**Lesson:** give each reader a version that covers only what it reads, and record it on every read,
so a change to one reader replays only that reader's documents.

**Guard:** `src/lib/agents/rosetta/reader-replay.test.ts` (base SQL unchanged, bump selects HTML
readers only, the version follows the switch, receipt key), `src/lib/agents/rosetta/reader-replay.db.test.ts`
(real PostgreSQL: same rows at the base; a bump replays `html_dom` and `js_fallback` texts once,
settled by a read or receipt at the version; PDF, plain-text and legacy texts untouched),
`src/lib/agents/rosetta/read.test.ts` (an HTML read records `html_read`, a plain-text read does not).
Agent lesson: rosetta/issue-1092-version-what-a-change-rereads.
