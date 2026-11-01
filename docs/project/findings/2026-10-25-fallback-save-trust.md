# 2026-10-25: the browser fallback save kept a verdict and binding the browser sent

**Lesson:** A save that takes an answer from the browser keeps only what the reader saw (the
title and sections). Every field that says what the records support (the binding, the evidence
verdict, claims, memo, storyline, evidence bundle, dataset stamps) is written only by the server,
and a browser save gets the server's own "not checked" verdict, so every reader fails closed.

**What happened (#1077 follow-up):** `saveAnalysis` in `src/app/pro/(hamilton)/analyze/actions.ts`
is the save the Analyze screen falls back to when an older route sent no saved id. It already
dropped the browser's `claims`, but spread the rest of the browser's `AnalyzeResponse` into the
row. So a browser could save a forged `narrativeBinding` (marking untraced sentences as supported),
a forged `answerEvidence` with `passed: true`, a `memo` carrying its own binding, a `storyline` and
`factEvidence` (which a later memo write and the board brief reuse as saved evidence), dataset
stamps and a "high" confidence. Report findings (`savedAnswerFinding`), exports and board briefs
(`exportedAnswer`, `savedAnswerBinding`) and the memo writer (`ask-service.ts`) read those fields
as if the server had computed them.

**Cause:** the fallback copied the browser payload by spread and removed known-bad keys, so any
server-derived field not named was kept.

**Fix:** `fallbackSaveSections` (`src/lib/hamilton/saved-analysis-record.ts`) builds the saved
response from an allow-list: title, sections and evidence metrics (type-checked), confidence level
capped at medium with the server's basis line, and `answerEvidence: { passed: false }` with the
reason "Saved from the browser: the server did not check this answer against its records."
Readers then fail closed: a report basket skips an answer whose verdict did not pass; with no
binding or claims, `savedAnswerFinding` and `exportedAnswer` mark nothing as supported; with no
storyline or evidence bundle, a memo or board brief has no saved evidence to reuse. The server's
own save (`src/app/api/research/hamilton/route.ts`) is unchanged. No recompute: the browser's tool
outputs are not trusted either.

**Guard:** `src/lib/hamilton/analyze-actions.test.ts`, "never keeps a binding, verdict or other
server-derived field the browser sent" and "keeps only well-formed prose from a malformed browser
answer".
