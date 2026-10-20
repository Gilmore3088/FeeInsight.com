# 2026-10-17: Hamilton confidence labels, inventory and legacy display policy

**What happened:** #981 (H06-T07) asked where Hamilton assigns a confidence, "verified" or "high"
label, and how answers saved before record-bound evidence should read. The labels come from several
independent places. Before PR #974 a figure-only match could save `confidence.level: "high"`, and
before the report answer parser was changed a model could write `CONFIDENCE: High` into a saved
report. Those rows are still in `hamilton_saved_analyses.response_json` and
`hamilton_reports.report_json`. How many there are is not known; this session had no database access.

**Cause:** each surface rated itself, and "high" meant "the numbers were found", not "the claim was
checked against its record".

## Inventory (code at this PR's base, `0db024718`)

| Where | What it assigns | Can it say high or verified today? |
|---|---|---|
| `figure-check.ts` `confidenceFromFigureCheck` (Ask stream in `AnalyzeWorkspace.tsx`, written answers in `answer-save.ts`, memos in `workspace/analysis-record.ts` `withMemo`) | `low` / `medium` | No. The type still allows `high` for old rows. |
| `evidence-contract.ts` `structuredEvidenceConfidence` (storyline saves, `storylineAnalysis`) | always `medium`, with `CLAIM_BINDING_LIMITATION` | No |
| `peer-list-snapshots.ts` | always `low` | No |
| `report-answer.ts` `parseConfidence` (report answer page) | model's `High` is parsed as `Medium`, with `REPORT_CONFIDENCE_LIMITATION` | No |
| `report-evidence.ts`, `report-synthesis.ts` `evidence_tier` | `verified` / `provisional` per fee row (`review_status = 'approved'`) | Yes, by design: a fee-row status, not a claim rating. Customer payloads drop each row's `confidence` field (`withoutConfidence`, `customerFeeRow`). |
| `report-quality.ts` | blocks "verified benchmark" wording when no verified delta exists | Gate only |
| `confidence.ts` (Simulate), `hamilton_scenarios.confidence_tier` | `strong` / `provisional` / `insufficient` from institution counts | Data-coverage tier, not a claim rating. Shown as "Strong data". |
| `home-data.ts` `deriveConfidence` | `high` / `medium` / `low` from maturity tiers | Set on the home briefing data; no screen renders it today. Data coverage, not a claim. |
| Source labels "(verified, live)" in `workspace/*.ts` | describe the fee catalog source | Source description, not a claim rating |
| `memo.ts` / `narrative-bound.ts` (this PR) | each memo sentence: record-bound, Hamilton's reading, or left out | Never sets a level. Its limits are added to the saved basis. |

Read paths that show a stored rating:
- Reopened analysis: `app/pro/(hamilton)/analyze/actions.ts` and
  `data-store/hamilton-analyses.ts` `getSavedAnalysisResponse` both call
  `normalizeLegacyAnalyzeConfidence`.
- Board brief and analysis PDF: `evidence-export.ts` `savedEvidenceAppendix` (also normalized), then
  `board-brief.ts` `savedAnswerLimits` / `readerLimitation`.
- Report screen and report PDF: `ReportAnswer.tsx` and `PdfDocument.tsx` now pass each decision
  through `displayReportDecision`.
- `answer-eval.ts` reads saved questions only (no rating). It is internal.

## Policy (read time only)
1. A stored `high` analysis displays as `medium`. With no evidence snapshot it adds
   `LEGACY_HIGH_CONFIDENCE_LIMITATION`; with a snapshot it adds `CLAIM_BINDING_LIMITATION`, since
   records alone do not check sentences. The board brief reads the first as "This answer was saved
   before Hamilton kept a source for each figure, so treat it as directional."
2. A stored report decision rated `High` displays as `Medium`, with `LEGACY_REPORT_CONFIDENCE_NOTE`
   added to its reason.
3. Stored rows are never rewritten. Nothing in this policy writes to the database, and no migration
   runs.
4. Regeneration is explicit. A new Ask or a new report runs the current checks. Nothing regenerates
   a saved answer on its own.
5. No current path writes `high`. A future one needs record-bound semantic evidence first, and this
   inventory must be updated in the same PR.

**Fix:** this PR (H06-T06 and H06-T07): `report-answer.ts` `displayReportDecision`, the memo's
sentence binding (`narrative-bound.ts`), and the legacy-vs-current tests in
`src/lib/hamilton/confidence-legacy.test.tsx`.

**Lesson:** a rating needs one owner per surface and one read-time policy for history. Find the
read paths before changing a label, and change the display, not the stored record.

**Guard:** `src/lib/hamilton/confidence-legacy.test.tsx:47` (a stored high analysis displays as medium with the legacy line and its record is untouched; line 67 checks no current save is high, and line 89 shows a stored High report decision as Medium)
