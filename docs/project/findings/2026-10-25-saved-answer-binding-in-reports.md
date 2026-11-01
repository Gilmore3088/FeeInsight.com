# 2026-10-25: a saved answer reached a board report as plain prose

**Lesson:** When a saved answer is reused anywhere (a report, an export, a brief), read it through
its sentence binding and its evidence verdict, never as its raw prose. The binding is what says
which sentences are findings.

**What happened (#1899):** a Hamilton board report re-reads each saved Ask answer in the report
basket (`authenticatedReportFindings` in `src/app/pro/(hamilton)/reports/actions.ts`) and set the
finding's `detail` to `hamiltonView` and `whatThisMeans` joined as saved. That dropped the answer's
`narrativeBinding` and its `answerEvidence` verdict. So the report's "Findings you added" list
(`ReportOutput.tsx`, `PdfDocument.tsx`) and the executive summary's reader findings stated
Hamilton's reading (figures not tied to a fee record) as findings beside sourced ones, could carry a
sentence the binding had left out, and took in answers whose evidence gate had failed.

**Cause:** the analysis PDF and the board brief already print a saved answer through
`exportedAnswer` / `applyNarrativeBinding` (`src/lib/hamilton/written-answer-binding.ts`), but the
report basket was written before the binding existed and was never moved onto it.

**Fix:** `savedAnswerFindingDetail` reads the saved binding with `savedAnswerBinding` and keeps
only what `applyNarrativeBinding` leaves in the view and what-it-means sections: the supported
sentences. Hamilton's reading is dropped from the finding rather than shown under
`INTERPRETATION_LABEL`, because a basket finding has one `detail` line and the report screens have
no place to print a labelled reading; the reader can still open the saved answer for it. Left-out
sentences never appear. A saved answer whose stored `answerEvidence.passed` is false is not added.
An answer saved before the binding keeps its text as saved. Builds on #2563 (merged), which moved reader
findings from a section's DATA into its context.

An answer with no supported sentence left is not added either: its title alone is model prose with
nothing behind it.

**Guard:** `src/lib/hamilton/report-actions.test.ts`, "a saved answer with a sentence binding
(#1899)" (supported sentences only, reading kept out, left-out sentences absent, failed verdict
skipped, nothing supported skipped, legacy answer unchanged).
