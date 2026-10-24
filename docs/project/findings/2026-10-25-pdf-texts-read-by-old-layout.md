# 2026-10-25: live fees still rest on PDF texts an older layout read

**Lesson:** A better reader does not fix the texts it never re-reads. Before re-reading thousands
of stored documents, measure on a small sample what the current reader would change for the live
fees on them, and record it without writing anything else.

**What happened:** Rosetta's PDF layout reader (`pdf-layout.ts`) went from version 1 to 5: prose
columns (v2), the gutter found by lines (v3), dot-leader columns (v4) and stacked bullet lists (v5,
#2219). Stored texts are re-read only in narrow cases: the prose interleave witness and the
stacked-repair witness (`pdf-stacked-repair.ts`). A read-only production count on 2026-10-24 found
4,205 completed `read.pdf_layout` texts last read below layout v5, 1,780 of them at v1, and
33,803 live published fees at 1,806 banks that trace to them (published `lineage_ref` → verified →
raw `source_document_id` → the text). The "layout a text was read at" is the highest
`detail.pdf_layout` (1 when absent) on its `read.pdf_layout` attempts for the same institution and
source hash. Nobody knows yet how many of those fees the current reader would read differently.

**Cause:** layout versions are scoped repairs with their own due witnesses, deliberately not a
global replay (`PDF_PROSE_REREAD_VERSION`, `PDF_STACKED_REPAIR_VERSION`), so a text whose page
shape no witness detects keeps its older reading indefinitely.

**Fix:** a record-only measurement, `LAYOUT_RECHECK_VERSION` v1
(`src/lib/agents/rosetta/layout-recheck.ts`), run inside every real Rosetta read step after the
ordinary reads. It takes up to `LAYOUT_RECHECK_PER_RUN` (3) current-copy, vault-backed texts read
below the current layout that carry live fees, most live fees first, reads the exact vault bytes
again (the shared loader and its byte-identity check; never a download), and runs Darwin's live
re-check of the shared `checkFeeAgainstSource` (`statedInOwnSource`, category pattern ".", the
refiled canonical key) on the old and the new text for every live fee. Each fee is
`supported_both`, `lost`, `gained` or `unsupported_both`. One `agent_run_events` row per document
(`rosetta.layout_recheck`) holds the counts, whether the text changed, the reader-agreement
disagreement count and up to 20 fee examples; missing or mismatched bytes record an `unavailable`
receipt and nothing else. The read step's result adds `layoutRechecked`,
`layoutRecheckNotCompared`, `layoutRecheckTextChanged`, `layoutRecheckLost` and
`layoutRecheckGained`. A receipt for a text hash at the current layout and protocol takes that text
out of the sample. No stored text, attempt, playbook or fee row is written, so it re-reads and
re-publishes nothing.

**Not yet known:** the lost/gained rates. They come from the receipts once runs have written a
sample; the decision to re-read (and which documents) waits on them.

**Guard:** `src/lib/agents/rosetta/layout-recheck.test.ts`
