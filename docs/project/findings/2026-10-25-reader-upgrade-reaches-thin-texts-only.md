# 2026-10-25: a reader upgrade re-read only thin texts

**Lesson:** A reader upgrade must reach every current document an older version of that reader
wrote, not only the ones that look broken: queue them all at a bounded pace, read each once per
version, keep the old text unless the new one lists at least as many fees, and count how many
texts changed.

**What happened:** the 2026-10-19 pipeline learning audit (#2069) found that a
`ROSETTA_READ_VERSION` bump re-read a stored, completed text only when Knox had sent Darwin fewer
than `REREAD_MAX_KNOX_FEES` (5) fees from it, plus narrow witnesses (flat legacy PDFs, prose
columns, stacked bullets, lost-text findings since #2565). A garbled text that still yielded many
fees was never read again, so a reader fix reached only documents fetched afterwards. James
approved re-reading them all on 25 Oct ("Re-read all").

**Measured (read-only prod SELECTs, 25 Oct):** the read step's own replay selection
(`readerReplaysDueQuery`) finds 190 current documents at 190 banks with no settled read of their
bytes at reader v3. All 190 are legacy texts (no `reader` recorded); 182 of them carry 3,586 live
published fees; none is thin (each sent Darwin 5 or more fees); 173 are in the vault; 94 are PDFs,
all last laid out below `PDF_LAYOUT_VERSION` 5 (1,829 live fees), and a replay lays them out with
the current layout. The decision card's figures (409 documents at 408 banks, 6,666 live fees) were
not reproduced with this definition; it treats a permanent failure of the current reader on the
same bytes (for example `scanned_pdf` on a page OCR or the paid pass then read) as settled, as the
read step always has. Out of this change's scope and still on older versions of their own reader:
67 current `read.js_fallback` v1 texts (665 live fees) and 31 `read.ocr_tesseract` v1 texts
(334 live fees); those readers keep their own retry rules.

**Fix:** `src/lib/agents/rosetta/reader-replay.ts` and a third lane in the read step
(`rosettaReadCandidatesQuery(..., readerReplay = "only")`). At most `READER_REPLAY_PER_RUN` (4)
due documents a step; the ordinary selection leaves them to the lane. The stored text is passed as
the text to beat (`rungTextNotWorse`), so a thinner, failed or wrong-document replay keeps it and
never hands the bank to Magellan. Every replay writes one `rosetta.reader_replay` event (old and new
text hash, `text_changed`, outcome) whatever happened, which settles it for the version. Step
detail adds `reader_replayed` and `reader_replay_text_changed`; Bayes's `rosetta.read` manifest now
counts queued and done. At about 100 read steps a day the 190 take 48 steps, under a day. The next
`ROSETTA_READ_VERSION` bump makes every current primary-reader text due again in the same lane.

**Guard:** `src/lib/agents/rosetta/reader-replay.test.ts`, `src/lib/agents/rosetta/reader-replay.db.test.ts`
