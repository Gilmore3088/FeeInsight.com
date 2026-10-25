# 2026-10-25: Hamilton could only hold or show a failing written answer, never fix it once or show its good part

**Lesson:** A rewrite of a failing answer is a paid provider call, and a partial answer is a change
to what a reader sees. Build both behind one named switch that is off by default, count every
rewrite as a call the reader's quota sees, and switch it on as a decision, not as a side effect of
a merge.

**What happened (#1077, claim contract step 5):** two places already asked the model for one
rewrite: the Ask memo (`memo.ts`, `MAX_ATTEMPTS = 2`, problems fed back, each call one quota row)
and the report sections (`generate.ts`, `generateVerifiedSection`, one regeneration on an untraced
figure). The written answer had none. Its streaming path held a failing Analyze answer whole; its
buffered `gate_citations` path refused on any failure or any left-out sentence. Step 4's one gate
(`gateAnswer`) already computes `ready_partial` and `repairable`, but only in shadow.

**Fix:** the repair lives in its own module, `src/lib/hamilton/output-gate-repair.ts`; the route
only wires it into the buffered path. The streaming branch is a spike (below), not shipped.
- `runGatedAnswer` gates a draft and, when it is not `validated`, is `repairable`, and the caller
  allows one more call, asks for ONE rewrite with the gate's own failure lines fed back. It keeps
  the better verdict by the design's table (validated, then partial, then held; fewer failures
  breaks a tie). A failed rewrite (a provider or budget stop included) keeps the first draft. There
  is never a second rewrite. The feedback never quotes an `instruction_text` sentence, and marks
  every quoted sentence as data from the last answer, never an instruction.
- `gatedAnswerView` is what a reader is shown: the whole text when `validated`; nothing when
  `held`; when `ready_partial`, the answer rebuilt from the same parsed sections the gate binds
  (`parseAnalyzeResponse`, which drops backticks, strips bullet markers and bold leads, rewrites
  tier keys and "$X thousand"), without the cut sentences and the binding's left-out ones, with the
  premise corrections and the lead `PARTIAL_ANSWER_LEAD`. It fails closed: a cut it cannot find,
  a cut sentence still in the view, a failing check line that also sits in Evidence or Explore
  Further (sections the gate never cuts), or nothing left, holds the answer (`heldBy`).
  The review of PR #2580 found the first version cut the raw text by exact match, so a backticked
  word, a bold-led bullet or a reworded figure kept a cut sentence on screen while the reply said
  `ready_partial`.
- The rewrite gets only the time left under the route's `maxDuration` less a 15 s margin
  (`repairTimeBudgetMs`); with under 20 s left it is not started.
- When the chosen rewrite fails the citation-density check but the first draft passed it, was
  `ready_partial` and still shows, the first draft is kept (`settleGatedDraft`). The reply's
  metrics are those of the draft actually chosen.
- The run ledger records the repair: the shadow run's `gate_shadow` record gets `repair`
  (`firstStatus`, `outcome`, `calls`), codes and counts only.
- The switch is `HAMILTON_GATE_REPAIR` (`isGateRepairEnabled`), off unless "true", "1" or "on". It
  gates the buffered written-answer path only: there the one gate decides, the rewrite runs and a
  partial answer shows. Off, that path runs today's checks unchanged and makes no rewrite.
- The rewrite is one `generateText` step (`toolChoice: "none"`, the same tool results in the
  history, so the gate re-checks it against the same reads), through `getAnthropicLanguageModel`
  and `trackAnthropicRequest` (operation `research_gate_repair`, so the provider budget, breaker
  and ledger see it), with its own `research_usage` row, `hamilton-repair`, so the Pro quota counts
  it. It runs only when `checkProAiQuota` still allows a call.
- Untraced figures stay critical. A draft that keeps one after the rewrite is held as today. A
  rewrite that drops the figure is a new answer and is shown when it passes. That rewrite rule is
  kept as built for now and waits on James's pending decision on the untraced-figure line.
- The repair module is on the golden set's held-out list (`CLAIM_GOLDEN_PROMPT_FILES`), so no case
  text can reach the feedback.

**Provider calls:** switch off, none added. Switch on, at most one more call per buffered written
answer whose first draft is not validated, is repairable and is within quota. The streamed answer,
the memo, Simulate and reports gain none: the memo and reports keep their own one retry.

**Golden set:** unchanged (set 2026-10-25.6, no version bump). The cases have no model, so no case
is repaired, and the switch decides nothing on the streaming path the cases replay.

**Streaming spike (written up, not shipped).** The design (2.3) leaves open how a rewritten answer
replays on the streaming route, because the stream the reader gets is the first `streamText`
result. What the code shows today: an Analyze answer is already held until `onFinish` gives the
verdict (`holdsAnswers`), and the held branch already writes its own text (`writer.write`
text-start, text-delta, text-end). The likely shape is: in `onFinish`, run `runGatedAnswer` with the
same rewrite call; resolve the verdict with the shown text; in `execute`, when the shown text is not
the first draft (a rewrite or a cut), write it as one text block in place of
`writer.merge(result.toUIMessageStream())`. Costs to check in the spike: a rewritten or partial
answer arrives in one block, not token by token; the rewrite's latency (one more model call)
lands before any text; the client's `narrativeBinding` on the start chunk must then describe the
written text, not the first draft; the saved row and `feeRefs` must be built from the shown text;
an admin chat (no mode) is not held today, so it has no place to wait for a rewrite.

**Left open:** whether a cut sentence should become `ready_partial` instead of a hold for untraced
figures is James's decision; this step keeps it critical. Turning `HAMILTON_GATE_REPAIR` on, and
the streaming spike, are follow-ups. Found while writing the review's tests, not fixed here (the
binding's own root cause): a bold-wrapped sentence that follows another on the same line
(`... $10. **Bank A's $35 ...**`) is not split from it, because the sentence split needs a capital
or quote after the space, so the binding never sees the restated premise and the gate validates it.

**Guard:** `src/lib/hamilton/output-gate-repair.test.ts` (switch values; fails then passes;
fails twice partial; untraced held; no rewrite without quota, on a provider stop or when not
repairable; the view over parsed sections: a backticked advice sentence, a bold-led bullet, a
failing line also in Evidence or Explore Further, a premise_contradicted sentence in bold or
backticks, a cut it cannot find; the time budget; the density fallback; feedback holds no case
text and never quotes an instruction) and `src/app/api/research/hamilton/route.gate-repair.test.ts`
(switch off: today's refusal, one call; switch on: two calls recorded and a `hamilton-repair` quota
row, partial shows only the supported sentence, critical held, a provider stop on either call makes
no further call, no rewrite with too little time left, the repair in the shadow record, the chosen
draft's metrics, the bold bullet and Evidence cases end to end, the streamed answer unchanged).
