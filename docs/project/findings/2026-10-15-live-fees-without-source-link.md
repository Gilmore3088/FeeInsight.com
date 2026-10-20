# 2026-10-15: imported live fees with no link to their own document
**What happened:** a live read on Oct 15 (00:40 UTC) found 1,338 of 76,928 `published_fee_catalog`
fees with `document_url` NULL, at 568 institutions; 11 of them also had no `source_document_id`.
Read-only SQL later the same hour: every one came from the April import
(`raw_fee_observations.source = 'migration_v10'`), published Apr 18 to Aug 12. 1,327 named their own
`source_documents` row (same institution), and that row had the URL. The institution page fell
back to the institution's general schedule link ("Institution's schedule") for 1,311 and showed a
dash for 27.
**Cause:** the import wrote these raw rows without `source_url`, and the URL never reached the
verified or published tier. The publish rule (`publishSkipReason`) took a stored file key with no
link as lineage and never read the document's own URL. No verified row waiting to publish lacked
a URL on Oct 15, so this was old rows, not a live leak.
**Fix:** #1342. Publish refuses a fee with no source document or no link and takes the
document's URL when the verified row has none. A hand-started step (`source-link-repair`, dry run
first) fills live rows from their own document or takes them down, one rollback record per row.
**Lesson:** "lineage" must mean a link a visitor can open to the bank's document. A file key or a
document id alone passes a check and still shows nothing on the page.

**Agent lesson:** gutenberg/pr-1345-visitor-link
