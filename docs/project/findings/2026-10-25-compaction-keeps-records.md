# 2026-10-25: tool-output compaction cut the fee records a written answer rests on

**Lesson:** When a result must shrink, shrink what an answer does not rest on first. A fee row's
identity (record id, document id, amount, category, name) is evidence; its display name, model
confidence and long conditions are not. Trim fields and other lists before dropping a record, and
when a record must go, choose by importance, not by sort order. A marker that a result was
shortened has to say whether rows were dropped or only fields trimmed, or every reader that needs
the whole set (saved fee refs) treats a harmless trim as a loss.

**What happened (Cycle A trace, defect #9, #1077):** `compactToolResult`
(`src/lib/research/tool-output.ts`) shrinks every tool result above 12,000 characters before the
model, the answer gate and the binding see it. It halved the largest list until the result fit,
keeping the first half. The `getInstitution` profile's `fees.verified` is sorted by fee name and
each row carries display name, confidence, conditions and source URL, so a profile with about 60
fees (Capital City Bank) lost its second half, the "Overdraft…" rows among it. The model then took
the overdraft price from `your_fees` in `getLocalCompetitors`, an aggregate with no record id, and
the sentence became Hamilton's reading or was held as untraced although the record existed. A
result with no list left to halve was cut to plain text (`{ _shortened, text }`), which no reader
can bind. And since #2623, `writtenAnswerFeeRefs` saves no fee refs whenever the subject's profile
carries `_shortened`, so every cut also cost correction tracking.

**Cause:** compaction knew sizes and list positions, not which fields or rows are evidence.

**Fix:** for an institution profile (`identity.id` with `fees.verified` / `fees.provisional`),
`compactToolResult` now, in order: (1) trims every fee row to the fields the binding, gate and ref
collector read (`fee_name`, `fee_category`, `amount`, `frequency`, `status`, `record_id`,
`source_document_id`, `source_url`, `pipeline_stage`, and conditions up to 160 characters), and
moves a source URL every row shares to `fees.shared_source_url`; (2) drops the rows'
conditions; (3) halves the profile's other lists down to a floor: the filing history
(`financials.records`, `revenue_trend`) keeps `HISTORY_FLOOR` (5) quarters, enough for a
year-over-year change, and any other list one row; (4) then drops fee rows, keeping spotlight and
core fee types (`getFeeTier`) first, in their original order; (5) only then takes the filing
history below its floor. (Review of #2635: an earlier order cut the history to one quarter before
any fee row, so a trend question at a bank with many fees lost its prior quarters.) A profile is never cut to plain text. When no fee row was dropped
the result carries `_fee_rows_complete: true`, and `writtenAnswerFeeRefs` saves the subject's refs
for it. The binding (`profileFact` in `src/lib/hamilton/written-answer-binding.ts`) reads
`fees.shared_source_url` when a row has no URL of its own, so a surviving row has the same fact id
and the same source URL as before compaction. Other results compact as before.

**Known limits:**
- The user's question is not used: tools are built once per toolset
  (`src/lib/research/agents.ts`), so when rows must drop, the order is fee tier, not relevance. A
  question about an extended or comprehensive fee type at a bank with very many fees can still
  lose its row.
- A provisional pipeline preview row (no `record_id`) gets its fact id from its position; if rows
  drop, positions shift. Published rows are keyed by record id and are unaffected.
- A profile over budget for reasons other than its lists (a very long text field) is returned over
  budget rather than cut to text.
- When rows are dropped, refs are still not saved, as before: a partial set would narrow the
  correction match.
- Conditions are cut to 160 characters, and dropped entirely before any row goes; the note tells
  the model to read the schedule when the answer depends on them.

**Guard:** `src/lib/research/tool-output.test.ts` ("compactToolResult on an institution profile":
every row kept with the same fact ids and refs saved; rows dropped only last with the overdraft
row kept; never plain text), `src/lib/saved-output-corrections.test.ts`
("should_keep_refs_when_compaction_trimmed_the_subjects_profile_but_kept_every_fee_row").
