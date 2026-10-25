# 2026-10-25: a saved written answer recorded no fee rows, because the ref collector never read the profile shape

**Lesson:** A saved output is found by a later fee correction only through the rows its collector
recognises. When a read gains a new shape (here the `getInstitution` profile, with snake_case
`record_id` and `source_document_id`), the collector has to learn it too, or every output built
from that read silently falls back to the institution match. A save records every published row
its reads returned, not only the rows its sentences rest on, as the storyline save already does.

**What happened (Cycle A trace, defect #4, #1077):** the written answer route
(`src/app/api/research/hamilton/route.ts`) saves an analysis with
`feeRefs: collectFeeRefs(toolOutputs, response)`. `collectFeeRefs`
(`src/lib/saved-output-corrections.ts`) knew three shapes: `ownRows`, an evidence fact whose
`source.table` is `published_fee_catalog`, and `feePublishedIds` / `fee_published_ids`. A written
answer's fee rows come from the profile `getInstitution` returns (`src/lib/research/tools.ts`):
`identity.id` and rows under `fees.verified` / `fees.provisional`, each with `record_id` and
`source_document_id`. None of the three shapes matched, and the saved response holds the bound
facts only as id strings (`fee:published:<n>`) in its binding and claims. So the save recorded no
rows, `recordSavedOutputFeeRefs` wrote nothing, and a correction to one of those rows flagged the
answer only if it was about the corrected row's institution.

**Cause:** the profile gained `record_id` / `source_document_id` for the sentence binding (#981),
and the binding (`feeFactsAndNames` in `src/lib/hamilton/written-answer-binding.ts`) learned the
shape; the H03-T09 collector, which predates it, did not.

**Fix:** `collectFeeRefs` now reads the profile shape the binding reads: an object with `identity`
and a `fees` object, taking each row in `fees.verified` and `fees.provisional` that has a positive
`record_id`, with `identity.id` as its institution and `source_document_id` as its document. A row
with `pipeline_stage` (a verified-unpublished or raw preview, which has no catalog row) records
nothing. A local competitor read (`getLocalCompetitors`) carries no record id, so its aggregate
prices record nothing. The route is unchanged.

**Option chosen: what the tools read (A), not what the sentences rest on (B).** The H03-T09 module
says a saved output records "the published fee rows it read", and the storyline save
(`fileAnalysis` in `src/lib/hamilton/ask-service.ts`) passes the whole `FeeResearch` (every own
row and every named peer's rows), not the rows its storyline cites; the existing H03-T09 tests
assert that too (a peer's rows are recorded). Deriving refs from the binding would also miss rows
behind a sentence the binding called a reading or left out, which are the answers a correction
most needs to flag. So the written answer now matches that meaning.

**Known limits:**
- No `sourceContentHash` is recorded for profile rows: the profile does not carry the document's
  content hash, so the source version is the document id only.
- Provisional catalog rows (in `published_fee_catalog` but not approved) are recorded, as the
  binding reads them; a correction to one flags the answer, which may be broader than a reader
  expects.
- An answer that read many profiles records every row of each, up to `MAX_SAVED_FEE_REFS` (2000).
- The browser fallback save (`src/app/pro/(hamilton)/analyze/actions.ts`, #2609) does not benefit:
  it keeps only the prose the browser sent and has no tool outputs, so it still records no rows and
  keeps the institution match. That is by design (the browser is not trusted for evidence), not
  fixed here.
- Answers saved before this change keep no rows; they stay on the institution match. Nothing is
  backfilled.

**Measured:** no existing test changed outcome. The new unit test and the new route test fail
without the collector change (both get `[]`); the preview-only route test passes both ways, as a
guard.

**Guard:** `src/lib/saved-output-corrections.test.ts` ("profile catalog rows by record_id"),
`src/app/api/research/hamilton/route.answer-gate.test.ts` ("records every published fee row the
profile reads returned", "records no fee rows when the profile holds only pipeline preview rows").
