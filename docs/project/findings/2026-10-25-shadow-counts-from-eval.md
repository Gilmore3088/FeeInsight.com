# 2026-10-25: The shadow output gate had too few verdicts to decide on, and none came from the daily paid eval's own answers

**Lesson:** A shadow decision needs volume. Count where answers are already being written, such as
the daily paid eval, instead of waiting for readers. Keep synthetic and eval counts apart from
reader counts, so an eval sample never stands in for a reader's answer.

**Guard:** `src/lib/hamilton/paid-answer-eval.test.ts` (each sample records exactly one shadow
with `origin: "paid_eval"`: each memo, Simulate, the written answer with the route's own `today`
(held when its check passes but the binding leaves nothing, shown when the binding supports it)
and the report section, with the sampled institution as both the account and the research
institution. The summary carries the last week's counts, readers apart from the eval, and a count
that cannot be read never fails the run),
`src/lib/hamilton/output-gate.test.ts` (the tally per origin; a record with no origin reads as a
reader's) and `src/lib/hamilton/analyze-answer-decision.test.ts` (the Analyze decision both
callers share).

**What happened (#1077 step 4 follow-up):** the one output gate runs in shadow, and each verdict
is a `pro_request` run with `params_json.gate_shadow`. Switching it on needs counts of where it
disagrees with today's gates. Production gets only about 0 to 5 real Pro questions a week. The
daily paid eval (`runPaidAnswerEval`, five samples a day: two memos, one Simulate read, one
written answer and one report answer page) already writes answers through the same paths, but
only the Simulate read's shadow was recorded. The written answer computed its verdict
(`gateAnswer`) and dropped it, the memo branch passed no `onGateShadow`, and `writeReportAnswer`
dropped the section's `gateShadow`. Nothing marked a record as an eval's, so eval and reader
verdicts could not be counted apart.

**Fix:**
- `GateShadowRecord.origin` (`"reader" | "paid_eval" | "golden"`, `output-gate-shadow.ts`).
  `gateShadowRecord` and `shadowGate` default it to `"reader"`, and `readGateShadowRecord` reads a
  missing or unknown origin as `"reader"`. The golden replay marks its records `"golden"` (they
  are never written to the ledger).
- `tallyGateShadow` keeps the overall shape and adds `byOrigin`, the same counts for each origin.
  `countGateShadowDisagreements` returns it.
- The paid eval records every sample's shadow with `origin: "paid_eval"`
  (`recordEvalShadows`). The memo branch drains `onGateShadow`. The written answer records its
  verdict with the Analyze route's own decision. The report branch passes `gateIdentity` (the
  sampled institution as account and research institution) and records the section's shadow, now
  returned by `writeReportAnswer`.
- The Analyze route's held / partial / shown rule moved into `analyzeAnswerDecision`
  (`analyze-answer-decision.ts`). The route's `onFinish` and the eval both call it, and the
  route's behaviour and log line are unchanged.
- `runPaidAnswerEval` adds `shadow` (the last 7 days, `reader` and `paid_eval` counts) to its
  summary, and the `hamilton-paid-answer-eval` step's run summary ends with that line, so it shows
  in the run ledger.

**Provider calls:** none added. The gate runs over answers the eval already paid for.
**Golden set:** not recorded daily. **Migration:** none.

**Left open:** the written answer's `today` is the streaming Analyze rule (`written_streaming`,
mode `analyze`), since that is the screen the eval's prompt reproduces. The report section's
`today` is the figure check's, as the Reports screen records it. The partner review is not part of
it.
