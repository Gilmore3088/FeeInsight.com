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

**Measured (read-only prod SELECTs, 25 Oct):** current copies (`superseded_by_id` and
`duplicate_of_id` null) whose completed text an older version of its reader wrote: 375 documents
at 374 banks, carrying 5,526 of the 85,713 live fees in `published_fee_catalog`.

| Reader of the stored text | Due when | Documents | Live fees | Not in vault |
|---|---|---|---|---|
| Legacy (no `reader`) or a primary reader | no settled primary read of the bytes at reader v3 | 277 | 4,550 | 50 |
| `read.js_fallback` | no fallback read of the bytes at v3 | 67 | 651 | 19 |
| `read.ocr_tesseract` | no OCR read of the bytes at v2 | 31 | 325 | 7 |

All 277 in the first row are legacy texts. 85 of them sit on a link that has a newer download
but still carry 1,019 live fees; the read step's current-copy rule had left them out, so the
first version of this change queued only 190. One has a dead link and no vault copy and cannot
be read again. The paid pass's 243 texts are left out: re-reading them would be a paid call.
The decision card's figures (409 documents at 408 banks, 6,666 live fees) were not reproduced
with this definition.

The SQL (the primary row; the OCR and fallback rows swap the last test for "no attempt of that
strategy on these bytes at its current version"):

```sql
SELECT COUNT(DISTINCT cr.id), COUNT(DISTINCT cr.institution_id),
       (SELECT COUNT(*) FROM published_fee_catalog p WHERE p.source_document_id = ANY(array_agg(cr.id)))
  FROM source_documents cr
  JOIN agent_source_texts t ON t.source_document_id = cr.id AND t.source_hash IS NOT DISTINCT FROM cr.content_hash
 WHERE cr.superseded_by_id IS NULL AND cr.duplicate_of_id IS NULL AND t.status = 'completed'
   AND (t.reader IS NULL OR t.reader = ANY(ARRAY['read.pdf_layout','read.html_dom','read.plain_text','read.docx_text']))
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_attempts r
      WHERE r.stage = 'read' AND r.institution_id = t.institution_id AND r.input_fingerprint = t.source_hash
        AND r.strategy <> ALL(ARRAY['read.page_check','read.reopen','read.pdf_stacked_repair','read.table_rows',
                                    'read.ocr_tesseract','read.js_fallback','read.paid_transcribe'])
        AND (CASE WHEN r.strategy = 'read.document_access' THEN COALESCE((r.detail->>'reader_version')::int, 0)
                  ELSE r.strategy_version END) >= 3
        AND (r.strategy <> 'read.document_access' OR r.strategy_version = 1)
        AND r.outcome = ANY(ARRAY['too_large','js_required','scanned_pdf','empty','parse_error','unsupported_format',
                                  'wrong_document','no_candidates','rejected','ok','ok_partial','unchanged','low_yield']));
```

**Fix:** `src/lib/agents/rosetta/reader-replay.ts` and a third lane in the read step
(`rosettaReadCandidatesQuery(..., readerReplay = "only")`). At most `READER_REPLAY_PER_RUN` (4)
due documents a step; the ordinary selection leaves them to the lane. The stored text is passed as
the text to beat (`rungTextNotWorse`), so a thinner, failed or wrong-document replay keeps it and
never hands the bank to Magellan. Every replay writes one `rosetta.reader_replay` event (old and new
text hash, `text_changed`, outcome, the three reader versions) whatever happened, which settles it for the version. Step
detail adds `reader_replayed` and `reader_replay_text_changed`; Bayes's `rosetta.read` manifest now
counts queued and done. At about 100 read steps a day the 375 take 94 steps, about a day. The next
bump of `ROSETTA_READ_VERSION`, `ROSETTA_OCR_VERSION` or `ROSETTA_JS_FALLBACK_VERSION` makes every
current text of that reader due again in the same lane.

**Guard:** `src/lib/agents/rosetta/reader-replay.test.ts`, `src/lib/agents/rosetta/reader-replay.db.test.ts`
