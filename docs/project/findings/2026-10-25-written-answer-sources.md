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
gained their own record (#981 binding, #1899 claims) without a reader in the exports. The exports
also loaded the answer through `loadAnalysisRecord`, the loader a browser may call, which drops
the claims, so a reader added there alone would still have found none (review of PR #2627).

**Fix:**
- `writtenAnswerSources` (`board-brief.ts`) builds one line per fact id cited by a supported
  sentence (the saved binding, the written answer's own or its memo's as `exportedAnswer` reads
  it, else the claims' own binding). A line is printed only for a fact the saved claims hold.
  Claims come only from the server's save, so an answer without readable claims gets no line. That
  includes a browser fallback save from before #2609, which kept a browser-sent binding with no
  verdict and no claims. Each line names:
  - the institution: by name when it is the research institution, by id otherwise, and "Peer
    median" for a median across peers (`derived:peer_median:…`, `stat:…:median`);
  - the fee category or filed measure, and the value;
  - for a fee, the record: "Published fee catalog · record fee:published:9";
  - for a filing, the publisher ("FDIC call report", "NCUA (5300 call report)", from
    `financialMeasureDefinition`), its record id, reporting date and period basis;
  - for a calculated figure, "Calculated by Hamilton" with the quarter it covers. It names no
    record or reporting date of its own.
- No line for reading or left-out sentences (they cite no fact), for an answer that saved
  `factEvidence` (the storyline path keeps its own record unchanged), or for an answer whose
  `answerEvidence.passed === false` (a browser fallback save since #2609 among them). That is the
  same test `reports/actions.ts` uses to keep a failed answer out of a report.
- **Claims are read on the server and never sent to the browser.** `loadAnalysisRecord` (a server
  action) drops the claims, so a line built from what it returns could only say "Not recorded".
  The three exports now read the whole saved answer with `readSavedAnalysisRecord`
  (`saved-analysis-record.ts`, not a `"use server"` module). It checks the same user, active row
  and Pro access as `loadAnalysisRecord`. The three exports:
  - the PDF route (`api/pro/report-pdf/route.ts`): only the PDF leaves the server;
  - the board brief save (`reports/board-actions.ts`): only the saved brief, which holds the lines
    and not the claims, is stored and returned;
  - the editor preview (`reports/page.tsx`): the client `BoardBriefEditor` still gets the answer
    through `withoutSavedClaims`, plus a `writtenSources` prop with the lines built on the server.
    It passes them to `boardBriefFromAnalysis`.
- **Design choice: reuse the appendix's sections and wording, not its data shape.** The PDF's
  "Evidence Record" section and the board brief's "Records behind the saved answer" exhibit (same
  id, title and columns) now print either the saved structured evidence or, when there is none,
  the written answer's lines. The claims were not mapped into `factEvidence`'s
  `HamiltonEvidenceFact` shape. That shape needs a source table, document ids, URLs, status,
  product and frequency the claims do not hold, so a mapping would either invent them or have
  `savedEvidenceAppendix` mark every line "Source not fully traceable". Its notes also say each
  figure "matches the bank document Hamilton had stored", which is not true of a filing.
- The board brief drops "saved without a source for each individual figure" from its limits only
  when every supported sentence that states a figure has a complete line (a saved value) for each
  fact it cites. Its sources entry points to the records table whenever the table is shown, as for
  the storyline path.

**New reader-facing words (for copy review):**
- Note under the lines (PDF and board brief): "Each figure shown matches the record or filing
  listed beside it, as saved with the answer. It was not re-checked against the bank's current
  schedule or a later filing."
- Board brief Check column: "Matches the saved record"; for a saved fact with no value, "Value not
  in the saved record" (also the PDF line's note).
- Institution for a median across peers: "Peer median". Detail for a calculated figure:
  "Calculated by Hamilton", "for <date>".
- Period basis words in a filing line: "year to date", "quarter", "quarter end".
- Measure names: a filed metric key in sentence case ("Service charge income", "Total assets",
  "Fee income ratio"), or "Call report line ACCT_131"; a derived fact adds ", calculated".
- Reused as they were: "Evidence Record", "Records behind the saved answer", "As saved on a date
  not recorded; not refreshed", the columns, "These records were saved with this answer and show
  where each figure came from.", "Published fee catalog", "record <id>", "reporting date",
  "published <date>", "date not recorded", "Not recorded", "Institution not recorded", "Each
  figure's source is in the records table above."

**Known limits:**
- Saved claims drop the schedule URL, source document id, document version, product name,
  frequency and the source table, so no line names a document or a link. A fee line names the
  catalog record id only; `asOf` is null for fee records read from the profile, so most fee lines
  say "date not recorded".
- A calculated figure prints its value with ", calculated". The claims do not save its inputs or
  formula; the input filings print as their own lines only when the binding cites them.
- Claims hold at most 40 facts (`SAVED_CLAIM_MAX_FACTS`). A cited fact past the bound gets no line
  and keeps the no-source limit. Claims saved under an older binding version, which
  `readSavedClaims` reads as none, give no lines at all.
- Institution names come from the saved identity's research institution only; a peer's or
  competitor's line names it as "Institution <id>".
- The saved row's own date is not in `response_json`, so the board brief subtitle says "As saved
  on a date not recorded".
- A server-saved answer with no `answerEvidence` but with claims is treated as passed, as
  `reports/actions.ts` treats it. Claims were added after the gate, so a save without a verdict
  but with claims is not expected.
- Separate issue, not fixed here: the analysis PDF prints a failed-verdict answer's prose (a
  browser fallback save, or a written answer saved while holding is off) under "Hamilton's View"
  with no line saying it did not pass Hamilton's check. It never marks that text as checked, and
  the board brief does carry the "not checked" limit, but the PDF prints no limits at all.

**Measured:** no existing test changed outcome. Three existing tests (`report-pdf/route.test.ts`,
`reports/board-actions.test.ts`, `reports/page.saved-claims.test.tsx`) now mock
`readSavedAnalysisRecord` and keep the loaders above it real, in place of mocking
`loadAnalysisRecord`. Each gains a production-path case: a saved answer with claims gives a line
with its value in the rendered PDF's answer, the saved brief, and the editor's `writtenSources`
prop. With the three loader files put back as they were, all three cases fail: no lines, no
records exhibit, no prop. The other 19 tests in those files pass. The first commit's
`writtenAnswerSources` gave a line for a pre-#2609 browser save (binding, no verdict, no claims);
the new test for it expects none.

**Guard:** `src/lib/hamilton/written-answer-sources.pdf.test.tsx` and three production-path cases.
- `src/lib/hamilton/written-answer-sources.pdf.test.tsx`:
  - a fee and a filing sentence print source lines in the PDF and the board brief;
  - a reading-only answer, a failed-verdict answer, a browser fallback save and a pre-#2609
    browser save print none;
  - a fact missing from the claims gets no line and keeps the limit;
  - a peer median names no record;
  - the browser preview built from the server's lines equals the server's brief;
  - the storyline path's record is unchanged.
- The production-path cases in `src/app/api/pro/report-pdf/route.test.ts`,
  `src/app/pro/(hamilton)/reports/board-actions.test.ts` and
  `src/app/pro/(hamilton)/reports/page.saved-claims.test.tsx`.
