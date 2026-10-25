# 2026-10-25: a written answer's PDF and board brief printed its supported figures with no source, because the exports read sources only from structured evidence

**Lesson:** An export that prints where a figure came from must read every record the save keeps,
not only the shape one path saves. The analysis PDF and the board brief printed a source appendix
only from `factEvidence`, which only the storyline path saves. A written answer saves its sources
another way (the sentence binding's fact ids and the saved claims), so a supported "$37 overdraft"
sentence printed with no record, while the same fact on the storyline path printed its row. Now
both exports list, for each supported sentence, the record or filing it rests on, from what the
written answer already saved.

**What happened (Cycle A trace, defect #5, #1077):** `AnalysisPdfDocument`
(`src/components/hamilton/reports/AnalysisPdfDocument.tsx`, `savedEvidence`) and
`boardBriefFromAnalysis` (`src/lib/hamilton/board-brief.ts`, `evidenceRecordsExhibit`) both build
their record section from `savedEvidenceAppendix`, which reads only `factEvidence`. A written
answer, saved by `src/app/api/research/hamilton/route.ts` through `writtenAnswerResponse`
(`src/lib/hamilton/answer-save.ts`), has no `factEvidence`. It saves `narrativeBinding` (each
supported sentence with its `factIds`, such as `fee:published:<n>` or
`filing:fdic:<inst>:<date>:<metric>:<basis>`) and `claims` (`saved-claims.ts`: each cited fact's
value, unit, institution, fee category or metric, reporting date, period basis and date, at most
40). `exportedAnswer` used the binding only to choose which sentences print, and the exports
ignored the claims. The board brief also said "This answer was saved without a source for each
individual figure" for every such answer.

**Cause:** the exports were written for the storyline's evidence shape, and written answers
gained their own record (#981 binding, #1899 claims) without a reader in the exports.

**Fix:**
- `writtenAnswerSources` (`board-brief.ts`) builds one line per fact id cited by a supported
  sentence, from the saved binding (or the claims' own binding) and the saved claim facts. Each
  line names the institution (by name when it is the research institution, else by id), the fee
  category or filed measure, the value, and the record: "Published fee catalog · record
  fee:published:9", or the filing's publisher ("FDIC call report", "NCUA (5300 call report)", from
  `financialMeasureDefinition`), its record id, reporting date and period basis. A cited id whose
  value was not saved still gets its line, with the value "Not recorded" and marked incomplete.
- No line for reading or left-out sentences (they cite no fact), for an answer that saved
  `factEvidence` (the storyline path keeps its own record unchanged), or for an answer whose
  `answerEvidence.passed === false` (a browser fallback save, #2609, among them), the same test
  `reports/actions.ts` uses to keep a failed answer out of a report.
- **Design choice: reuse the appendix's sections and wording, not its data shape.** The PDF's
  "Evidence Record" section and the board brief's "Records behind the saved answer" exhibit (same
  id, title and columns) now print either the saved structured evidence or, when there is none,
  the written answer's lines. The claims were not mapped into `factEvidence`'s
  `HamiltonEvidenceFact` shape: that shape needs a source table, document ids, URLs, status,
  product and frequency the claims do not hold, so a mapping would either invent them or have
  `savedEvidenceAppendix` mark every line "Source not fully traceable"; and its notes say each
  figure "matches the bank document Hamilton had stored", which is not true of a filing.
- The board brief drops "saved without a source for each individual figure" from its limits when
  the answer has source lines, and its sources entry then points to the records table, as for
  the storyline path.

**New reader-facing words (for copy review):**
- Note under the lines (PDF and board brief): "Each figure matches the record or filing listed
  here when the answer was saved. It was not re-checked against the bank's current schedule or a
  later filing."
- Board brief Check column: "Matches the saved record"; "Incomplete record: value not saved".
- Period basis words in a filing line: "year to date", "quarter", "quarter end".
- Measure names: a filed metric key in sentence case ("Service charge income", "Total assets",
  "Fee income ratio"), or "Call report line ACCT_131"; a derived fact adds ", calculated".
- Reused as they were: "Evidence Record", "Records behind the saved answer", "As saved on a date
  not recorded; not refreshed", the columns, "These records were saved with this answer and show
  where each figure came from.", "Published fee catalog", "record <id>", "reporting date",
  "published <date>", "date not recorded", "Not recorded", "Institution not recorded", "Source
  not fully traceable", "Each figure's source is in the records table above."

**Known limits:**
- Saved claims drop the schedule URL, source document id, document version, product name,
  frequency and the source table, so no line names a document or a link. A fee line names the
  catalog record id only; `asOf` is null for fee records read from the profile, so most fee lines
  say "date not recorded".
- A derived fact (a filed peer median, a quarter worked out from year-to-date filings) prints its
  value with ", calculated" and its record id. The claims do not save its inputs or formula; the
  input filings print as their own lines only when the binding cites them.
- Claims hold at most 40 facts (`SAVED_CLAIM_MAX_FACTS`); a cited id past the bound, or claims
  saved under an older binding version (which `readSavedClaims` reads as none), prints with the
  value "Not recorded".
- Institution names come from the saved identity's research institution only; a peer's or
  competitor's line names it as "Institution <id>".
- The saved row's own date is not in `response_json`, so the board brief subtitle says "As saved
  on a date not recorded".
- An answer with no `answerEvidence` at all (saved before the gate) is treated as passed, as
  `reports/actions.ts` treats it.
- Separate issue, not fixed here: the analysis PDF prints a failed-verdict answer's prose (a
  browser fallback save, or a written answer saved while holding is off) under "Hamilton's View"
  with no line saying it did not pass Hamilton's check. It never marks that text as checked, and
  the board brief does carry the "not checked" limit, but the PDF prints no limits at all.

**Measured:** no existing test changed outcome. The new tests in
`written-answer-sources.pdf.test.tsx` were run against the code before this change. All four fail
there, since the functions they call do not exist. A copy limited to the old exports (the PDF
render and `boardBriefFromAnalysis`) failed the positive case: the PDF of a written answer with a
supported fee sentence and a supported filing sentence had no "Evidence Record" section. Its three
negative cases passed before and after, as negative controls should.

**Guard:** `src/lib/hamilton/written-answer-sources.pdf.test.tsx` (a fee and a filing sentence
print source lines in the PDF and the board brief; a reading-only answer, a failed-verdict answer
and a browser fallback save print none; the storyline path's record is unchanged).
