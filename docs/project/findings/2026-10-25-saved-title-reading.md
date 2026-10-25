# 2026-10-25: a reading sentence could become a saved answer's title, and reports printed it as a headline with no label

**Lesson:** A title is a headline with no label, so it may only say what a label-free line may say: a sentence the binding supports, or one that states no figure. Hamilton's reading must stay under its label everywhere it is reused, so the title is chosen from the shown sentences, not from the raw lead with only the left-out ones removed.

**What happened (Cycle A trace, defect #8, #1077):** `writtenAnswerResponse`
(`src/lib/hamilton/answer-save.ts`) set the saved title to `answerTitle(parsed.hamiltonView)`, the
view's first sentence (`answerTitle` / `shapeHamiltonView` in
`src/components/hamilton/analyze/parse-response.ts`) after `withoutOmitted` had removed only the
sentences the records contradict. A reading sentence (a figure no record holds, kept in
`binding.interpretation` and shown on screen only under `INTERPRETATION_LABEL`) stayed in, so it
could lead and become the title. That title is then reused unlabelled: as the report finding's
title (`src/app/pro/(hamilton)/reports/actions.ts`, `title: saved.responseJson.title`), as the
board brief's fallback title (`src/lib/hamilton/board-brief.ts`, `fallback = ... analysis.title`),
and as the PDF title when the shown view has no lead (`AnalysisPdfDocument.tsx`,
`view.lead || analysis.title`). So "Your overdraft fee sits about 21% above the peer median."
could head a report as if it were a checked fact.

**Cause:** the title was built from a different sentence set than the one the screen shows. The
screen (`applyNarrativeBinding`) drops the left-out and the reading sentences; the title only
dropped the left-out ones. The browser fallback save (`saveAnalysis` in
`src/app/pro/(hamilton)/analyze/actions.ts`) took the browser's title as sent, and copied it into
the saved response too (`fallbackSaveSections` keeps `title`), with no binding the server trusts.

**Fix:**
- New `src/lib/hamilton/saved-title.ts`. `savedAnswerTitle(view, binding, question)`: with a
  binding, the first sentence of the view after `applyNarrativeBinding` drops the left-out and
  reading sentences, kept when the binding lists it as supported (matched by `sentenceMatchKey`)
  or when it states no figure (`extractFigures`, the figure check's reader); with no binding, the
  view's first sentence only when it states no figure; otherwise the reader's question
  (`questionTitle`: the first 60 characters, an ellipsis when cut, as the fallback save already did).
- `writtenAnswerResponse` takes the question as a new last argument and uses that rule; the route
  passes `questionOnly(lastUserText)`.
- `saveAnalysis` (the fallback save) uses `fallbackSaveTitle`: the explicit or the browser's
  title only when it states no figure, else the prompt, and writes that title into the saved
  response as well as the row, since reports and briefs read the response's title.
- Storyline and memo saves checked, unchanged: a storyline's title is `analysisTitle(storyline)`
  (`workspace/analysis-record.ts`), the engine's governing thought built from records before any
  model text; a memo save (`ask-service.ts`, `updateSavedAnalysisResponse`) does not change the
  title. Written answers have no model-supplied title field, so "the model's own title" is the
  view's lead, kept when it states no figure.

**Known limits:**
- Saved rows from before this change keep their titles, and board briefs already made keep
  theirs. Reports read `saved.responseJson.title` as saved; nothing re-derives it on read.
- "States a figure" is what `extractFigures` reads: dollar amounts and percents. A count, a rank
  or a figure written in words ("thirty-five dollars") is not caught, so a reading lead that
  states only such a figure can still be the title.
- With no binding (the tools returned no fee record and no claim fact), a lead with a dollar or
  percent figure is no longer the title, even when the answer gate traced that figure: the gate
  checks numbers, not whose they are. Such answers now file under the question.
- The supported-sentence match is by text. Where `splitSentences` (the lead) and the binding's
  splitter cut a sentence differently, a supported lead with a figure is not matched and the
  question is used. That errs toward the question, never toward an unsupported figure.
- The Analyze screen still builds its browser title from the raw lead (`AnalyzeWorkspace.tsx`); it
  is filtered at the server action, not changed in the browser.

**Measured:** one existing assertion changed: `answer-save.test.ts` expected a non-empty title for
an answer with no binding whose lead states $35 and $29; it is now the question (empty when no
question is passed). Without the change, four tests fail: the supported-sentence and reading-only
title cases in `saved-title.test.ts` ("writtenAnswerResponse title"), that changed assertion, and
the fallback-save case in `actions.h01-guards.test.ts`. The figure-free cases pass before and after.

**Guard:** `src/lib/hamilton/saved-title.test.ts`, `src/lib/hamilton/answer-save.test.ts` and `src/app/pro/(hamilton)/analyze/actions.h01-guards.test.ts` ("files the prompt, not a browser title that states a figure").
