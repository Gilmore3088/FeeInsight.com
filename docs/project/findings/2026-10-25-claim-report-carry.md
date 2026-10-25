# 2026-10-25: a saved answer's claims did not travel to the report, and report sections had no gate beside the figure check

**Lesson:** When a checked answer is reused somewhere else, save what the check decided (each
sentence's outcome and the facts behind it, with their values and a version) and have the next
surface read that record. Re-deriving the decision from prose, or reading prose at all, loses it.

**What happened (#1077, claim contract step 6; #1899):** a written answer was saved with its
sentence binding but not with its claims: no version of the claim record, and no value or date for
the facts a supported sentence cites, so nothing downstream could re-check a supported filing figure
against a revised filing. The report basket re-read the binding to keep only supported sentences
(PR for `2026-10-25-saved-answer-binding-in-reports.md`), but handed the report one joined string.
Report sections (`generateVerifiedSection`) were checked by the number check only: every `$` and `%`
must be in the section's DATA. That check has no question and no fact bundle, so a report section
gets no premise check, no sentence binding (wrong institution, wrong period or basis, median stated
as a fee) and none of the shared gate's other rules. This is the gap the step leaves open; see below.

**Open question 1 of the design, settled:** `generateSection` (`generate.ts`) runs no check. It
builds the prompt, makes the provider call and returns the text. The report path's other checks
sit in the caller: the partner review of the answer page (`reviewAnswerPage`) and the artifact
quality gate (`validateHamiltonReportArtifact`). Neither holds on an equivalent of the one output
gate's rules, so the gate ships in shadow for reports.

**Fix:**
- `src/lib/hamilton/saved-claims.ts`: `SavedClaimSet` (version 1): each sentence as `supported`
  (with its fact IDs), `reading` (with its index basis) or `omitted` (with its reason), the cited
  facts with value, unit, institution, metric, period, basis and `asOf` (at most 40, with
  `factsTruncated`), and the binding's correction lines. `savedClaimsFrom` builds it from the binding
  the save already computes; `readSavedClaims` reads it back defensively; `bindingFromClaims` turns
  it back into a binding so every reader applies one rule.
- `answer-save.ts` / the route: `writtenAnswerClaims` builds the claims from the same fee records and
  claim facts as the binding, and `writtenAnswerResponse` saves them as `claims` in `response_json`
  beside `narrativeBinding`. No migration (jsonb). The claims are not sent to the browser and
  nothing on the Analyze screen reads them. The browser fallback save (`saveAnalysis`) drops any
  `claims` the browser sent: only the server's own save writes them.
- `report-saved-finding.ts` / `reports/actions.ts`: `authenticatedReportFindings` reads a saved
  answer through `savedAnswerFinding`: the saved claims decide (an answer saved before them is
  read through its binding the same way; one saved before the binding keeps its text). The basket
  item carries `savedClaims` and `reading` server side; `sanitizeBasketItems` never takes them from
  the browser. The finding's `detail` and the model's reader-findings context are byte for byte
  what they were.
- Switch `HAMILTON_REPORT_FINDING_READING` (off unless "true", "1" or "on"): with it on, a saved
  answer's reading sentences print under `INTERPRETATION_LABEL` below the finding in "Findings you
  added", on the report screen (`ReportOutput.tsx`, the shared `InterpretationBox`) and in the PDF
  (`PdfDocument.tsx`). Off, the report prints exactly what it printed before.
- `generate.ts`: `generateVerifiedSection` returns a `gateShadow` thunk (inputs captured) with the
  one output gate's verdict on the returned section, surface and path `report_section`, today's
  decision being the figure check's (`needs_review` refuses the report). `generateReport` records it
  with `scheduleGateShadow` for each section the report kept (not drafts the partner review
  discarded), each as its own `pro.answer_gate_shadow` run, with the report's research and account
  institutions for the account rule. The figure check still decides. No provider call is added.

**The gap, stated:** a report section has no question, so the asked-figure rule does not loosen it,
but nothing checks the reader's added findings or the saved answer's question as premises either,
and with no fact bundle the gate binds no sentence. The shadow therefore adds the shared gate's
advice, internal-name, house-wording and interpretation rules, the cause rule and the account rule,
not premises or bindings. Binding a section's sentences needs a fact bundle built from the report's
own reads (fee deltas, peer medians, filings), which is later work.

**Reader-visible change:** none with the switch off. With it on: under each saved Ask finding that
had sentences not tied to a record, a box labelled "Hamilton's reading, not tied to a fee record"
lists them, on screen and in the PDF.

**Guard:** `src/lib/hamilton/claim-report-carry.test.ts` (claims round trip, bound, fall back to the
binding, decide over the prose; the switch is off by default; the report section shadow and its
gap), `src/lib/hamilton/report-actions.test.ts` ("a saved financial answer's claims travel to the
report": supported financial sentence only, swapped bank never printed, reading only with the
switch on and never in the model's context, one shadow run per kept section),
`src/lib/hamilton/bound-export.pdf.test.tsx` (the financial claim prints the same on the report
screen and in its PDF, the reading under its label), `route.answer-gate.test.ts` (claims saved with
the binding, not sent to the browser) and `analyze-actions.test.ts` (browser claims dropped).
