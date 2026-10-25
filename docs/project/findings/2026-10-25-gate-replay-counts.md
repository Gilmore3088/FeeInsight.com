# 2026-10-25: the output gate's enforcement decision waited a week for reader shadows; a free replay gives the counts the same day

**Lesson:** A decision that waits on counts should not wait on live traffic when the same engine can
be replayed on real questions for free. Record replayed verdicts exactly as live ones are recorded,
under their own origin, so they can be read the same day and are never added to readers' counts.

**What happened (#1077, claim contract step 4):** the one output gate (`gateAnswer`,
`src/lib/hamilton/output-gate.ts`) runs in shadow on the live routes, and each verdict is recorded
as a `pro.answer_gate_shadow` run (`output-gate-shadow-store.ts`). The plan was to switch
enforcement on after about a week of those records. Pro reader traffic is small, and the paid eval
adds at most five samples a day, so a week would still give few counts. James asked for the
decision today.

**Cause:** the only sources of shadow records were readers' live answers, the paid eval's five a
day, and the golden set (48 synthetic cases, never recorded). Nothing put real questions through
today's engine and the gate at volume.

**Fix:**
- New `src/lib/hamilton/gate-replay.ts`, step `hamilton-gate-replay` (deterministic: not in
  `PROVIDER_STEP_KEYS`; held by the `pipeline` pause like the other Hamilton evals; the tick never
  starts it, `TICK_EXCLUDED_STEP_KEYS`). Each day it plans up to 400 answers: every Pro reader
  question on record (`pickProQuestions`, the Ask ledger and saved analyses of the last 90 days),
  then the 17 quality-bar questions (`EVAL_QUESTION_IDS`) for two institutions per charter and asset
  tier (`pickEvalInstitutions`, seeded by the date). Each is answered through the Ask bar's free
  engine path (`answer` in `answer-eval.ts`). An answer with a storyline goes through `gateAnswer`
  with the input the live Ask path builds over a storyline (`memoGateInput`'s shape: the storyline
  as `memoPayload`, its fee evidence for the binding, no question for the check, no account for the
  binding), surface `ask`, and today's decision `shown_ungated`, since the Ask bar shows the
  storyline with no gate. Its verdict is recorded with `recordGateShadow` as `origin: "replay"`,
  path `ask_replay`, with `mode` set to `pro` or the quality-bar question id.
- `ShadowOrigin` gains `replay`; `tallyGateShadow`'s `byOrigin` keeps it apart, and the paid eval's
  summary still shows only readers and its own samples.
- Batching: one run stops starting answers at 200 s. Each recorded shadow keeps a `replay_key`
  (day, institution, and the quality-bar id or a hash of the Pro question's wording, no text), and a
  skipped answer's key is kept in the step's detail (`settledKeys`), so the next run skips both and
  nothing is recorded twice. `/api/admin/crew/gate-replay` (cron `53 * * * *`, or on demand with an
  admin session or the cron secret) starts one run an hour and starts none once a finished step
  today says `complete: true`.
- The step's summary reports today's replay counts from every run together: unified status
  (validated, partial, held), agreement with today's decision and each kind of disagreement, the
  codes that held answers and the top failure codes, Pro questions apart from the quality bar, by
  surface, the golden set's replay totals (`replayClaimGoldenGate`), and the last week's reader and
  paid-eval counts beside them.
- Same PR: the paid eval's `publicDataDollars` (`paid-answer-eval.ts`) checked
  `_shortened === true`, but `compactToolOutput` sets `_shortened` to a note string, so a result
  cut by characters was never unwrapped. It now checks for the key and a string `text`.

**Known limits:**
- The replay covers the free Ask path only. Written answers, memos, Simulate reads and report
  sections are written by a model, so replaying them needs paid calls; the paid eval samples five a
  day. A paid replay batch was asked for in the same task and is not in this PR (the session's
  permission check refused the paid-call change; see the PR description).
- Today's decision for these answers is `shown_ungated`, so "agrees" means the gate validates the
  answer. Every disagreement is something enforcement would hold or cut on the Ask bar, not a
  difference between two gates.
- The figure check over a storyline mostly passes by construction: the memo payload is built from
  the same storyline. The binding to the fee evidence, the interpretation rules, advice, internal
  names and the cause rule are the checks that move these counts.
- Answers with no storyline (a question asked back, a scenario, a list, a peer list) are skipped and
  counted by kind, not gated. An engine error is counted and not retried that day.
- About 400 shadow runs a day are added to the run ledger (`pro_request` runs with no user).

**Guard:** `src/lib/hamilton/gate-replay.test.ts` (no provider client or model is built, every
record is `origin: "replay"`, the cap holds, a second run records nothing twice, the time budget,
counts by origin stay apart), `src/app/api/admin/crew/gate-replay/route.test.ts`, and
`src/lib/hamilton/paid-answer-eval.test.ts` ("reads a public-data result cut by characters").
