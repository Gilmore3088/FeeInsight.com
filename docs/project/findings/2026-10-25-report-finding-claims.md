# 2026-10-25: a saved answer became a report finding without its claims, so the report could not point the finding to its facts and re-checked its figures only against pooled data

**Lesson:** A checked answer stays checked only while its claims travel with it. When the report
action re-read a saved answer for a finding, it worked out the supported sentences and their
claims, then copied only title, detail, reading and identity into `report_json`. The claims were
dropped, and the finding's words reached the answer section's model as CONTEXT, where the figure
check could trace a restated figure only to pooled DATA. A finding's figure that happened to equal
a pooled number passed, and one that matched its own saved record could not be traced to that
record. Now a finding carries its checked claims, and its figures are traced to them or held.

**What happened (Cycle A trace, defect #7, #1077; V5 T4 "report fails closed"):**
`authenticatedReportFindings` (`src/app/pro/(hamilton)/reports/actions.ts`) re-reads a saved Ask
answer server side (`readSavedAnalysisRecord`) and `savedAnswerFinding`
(`src/lib/hamilton/report-saved-finding.ts`) returns its supported detail, reading and claims. The
report assembly then mapped each finding to `{ source, title, detail, reading?, identityContext? }`,
leaving `savedClaims` behind. `readerFindingsContext` (`src/lib/hamilton/report-inputs.ts`) put
the finding's title and detail into the answer section's CONTEXT; `generateVerifiedSection`
(`src/lib/hamilton/generate.ts`, the `report_section` gate) checked the section's figures only
against its DATA (peer medians, exhibits).

**Cause:** the claim contract (#1899) carried claims as far as the basket item, but no reader past
that point used them: the saved report, its screen and PDF, and the section check all predate it.

**Fix (`src/lib/hamilton/report-finding-claims.ts`):**
- `reportFindingClaims` keeps a finding's supported sentences (those its detail states, at most 12)
  and the facts they cite (value, unit, institution, fee category or metric, dates; at most 12),
  with `factsTruncated` when a cited fact is not carried. They come only from the server's re-read
  of the saved answer; `sanitizeBasketItems` never takes claims from the browser.
- `reportAddedFindings` writes them into `report_json` as `addedFindings[].claims`, with
  `addedFindings[].sources`, one line per fact worded by `writtenSourceLine` (`board-brief.ts`, now
  exported), as the written-answer PDF does. The detail stays the supported sentences only; the
  reading stays separate and prints under its label only with `HAMILTON_REPORT_FINDING_READING` on.
- `readerFindingsSection` (replacing `readerFindingsContext`) holds every figure in a finding's
  title or detail that neither its own carried facts nor the section's DATA supports, as
  `[figure held: not traced to a record]`, before the model sees it, and adds the carried facts to
  the answer section's DATA as `reader_finding_facts` (no implicit arithmetic between them). The
  section's figure check therefore traces a restated finding figure to that finding's record.
  Another finding's fact never supports it.
- The report screen (`ReportOutput.tsx`) and PDF (`PdfDocument.tsx`) list a finding's sources
  under it with the written-answer note. Report rows saved before this have no `claims` or
  `sources` and render as before.

**Known limits:**
- The finding text the reader sees in "Findings you added" is unchanged: a Position or Test finding
  (browser-sent, not re-read on the server) and an answer saved before its binding are shown as
  written, with no sources. Only what the model is given is held.
- An answer saved with claims but no facts (claims read from its binding, `savedClaimsFrom` with
  no evidence) carries supported sentences and no facts, so its figures are held unless the
  section's DATA has them.
- A figure that matches the section's own DATA passes even when it is the finding's own unrelated
  number: the figure check is numerical only (`FIGURE_CHECK_LIMITATION`).
- Once in DATA, a carried fact may be restated anywhere in the answer section, not only beside its
  finding. Sources are as saved with the answer and are not re-checked live.
- The other two sections are not given the findings, so they are unchanged.

**Guard:** `src/lib/hamilton/report-finding-claims.test.ts`:
- a saved answer's finding carries its supported sentences, the fact they cite and a worded source
  line, never the left-out sentence or the other bank's filing; the reading prints only with its
  switch;
- a Position finding and an answer saved before claims carry nothing and an old row still renders
  in the PDF;
- the carried facts are bounded and say when they were;
- a restated figure traces to the finding's carried fact and fails without it; an untraced figure
  is held; a figure in the section's DATA stays; a claims-without-facts answer's figure is held; a
  finding never borrows another finding's fact;
- the report PDF lists each carried fact's record under its finding.

Production path, `src/lib/hamilton/report-actions.test.ts` (`generateReport`): a saved answer's
finding is saved with its claims and source line, and the answer section's DATA traces its figure
only with the carried facts; a Position finding's untraced `$99` is held in the model's context.
