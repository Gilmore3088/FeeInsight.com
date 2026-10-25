# 2026-10-25: a report's figure check counted the reader's own notes as data

**Lesson:** the data a figure check traces figures to holds only what the server read itself. A
reader's note, a browser field or earlier model prose goes to the model as context, never into
that data, or the check passes any figure the note contains.

**How it was found:** V5 build plan move 2 (Hamilton PRD, "Build plan and checklist" tab): trace one
compound banker question through both Ask routes, the evidence gate, a saved answer and the board
report, and note where a figure stops being tied to its source. Read from `main` at `78f4cccec`.

## The trace

1. **Ask bar** (`/api/hamilton/ask`, `src/lib/hamilton/ask-service.ts`). Parsed with regular
   expressions (`workspace/ask.ts`) and answered from data with no model call. Fee answers carry a
   `HamiltonEvidenceBundle` of fact IDs (`evidence-contract.ts`). The optional memo is the only
   model call, and `memo.ts` checks it against those fact IDs. Peer-list questions go to
   `peer-list-service.ts` first. The account institution comes from the server session.
2. **Written answer** (`/api/research/hamilton`). The model runs a tool loop (`research/agents.ts`).
   On finish, `writtenAnswerCheck` (`answer-gate.ts` with `figure-check.ts`) checks every `$` and `%`
   against the tool outputs, and `writtenAnswerBinding` (`narrative-bound.ts`) ties sentences to fee
   records and leaves out the ones the records contradict. An answer that fails is held, never
   shown or saved. The figure check is numerical only: it does not tie a figure to its
   institution, period or source (its own header says so).
3. **Saved answer** (`insertSavedAnalysis`). It stores the parsed sections, the gate's verdict, the
   sentence binding and `feeRefs`. It does not store the tool outputs. Financial figures from call
   reports, peer statistics and regulatory reads therefore have no fact ID once saved. Only fee
   records are bound.
4. **Report basket** (`report-basket.ts`). Kept in the browser's localStorage. When the report is
   built, an Ask item with a saved-answer ID is re-read on the server (`authenticatedReportFindings`
   in `reports/actions.ts`): the title is kept, and `hamiltonView` plus `whatThisMeans` are joined
   into `detail` as plain text. The binding and verdict are dropped. A Position or Test item is
   passed on as the browser sent it (`detail` up to 1,200 characters).
5. **Report sections** (`report-inputs.ts`, `generateVerifiedSection` in `generate.ts`). Before this
   fix, every finding's text went into the executive summary's `data` as
   `findings_added_by_reader`, and `checkNarrativeFigures` traces a section's figures to `data`.
   **Break:** any figure in a finding passed the report's figure check. That included a number
   typed into a browser basket item, and a "Hamilton's reading" sentence that the saved answer's
   binding had kept apart from its sourced findings. The PDF then printed it as a figure that had
   passed.
6. **PDF** (`PdfDocument.tsx`). Prints the sections and the "Findings you added" list from the same
   saved report JSON. `bound-export.pdf.test.tsx` already proves the PDF matches the screen for a
   bound written answer.

## Fix in this PR

`readerFindingsContext` in `report-inputs.ts` passes the findings in the section's CONTEXT, labelled
"not evidence", and tells the model to state a figure from them only when the same figure is in
DATA. The figure check no longer sees them, so a restated figure passes only when the server's own
data holds it; otherwise the section comes back `needs_review`.

**Guard:** `src/lib/hamilton/report-actions.test.ts`, "keeps the reader's added findings out of the
DATA a section's figures are checked against".

## Gaps found, not fixed here (each goes on its existing issue)

- **Saved answers keep no fact IDs for financial, peer or regulatory figures** (step 3). The report
  can't carry their provenance forward. V5 T4 and P4: the claim contract (#1077) and research-first
  reports (#1899).
- **A saved answer reaches a report as prose** (step 4). Its binding and verdict should travel with
  it, so the report quotes only supported sentences and keeps Hamilton's reading under its label
  (#1899).
- **Two Ask routes, two truth models** (steps 1 and 2): the Ask bar binds fact IDs, while written
  answers get a numerical check plus a fee-only binding. V5 P1 joins them into one research service
  (#1077, #1895).
- **The gated buffered path** (`gate_citations: true` in `/api/research/hamilton`) has no caller
  outside tests. The report path does not use it; it runs its own figure check instead. One output
  gate (V5 T4) should be the only gate.
- **The written-answer gate runs only for `mode: "analyze"`.** Every customer screen sends that
  mode today (`AnalyzeWorkspace.tsx`), so nothing streams ungated now, but a new screen with
  another mode would stream unchecked and unsaved. The one output gate should not depend on a
  mode string.
