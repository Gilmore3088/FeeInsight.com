# 2026-10-25: the gate's counts on paid text came five a day; one capped paid replay batch gives about 200

**Lesson:** When a decision needs counts from a paid path, run one bounded batch with its caps
held in the ledger (a constant batch id, a reservation before every first model call, a spend
check that holds the ceiling of every sample still in flight), not a bigger daily schedule. A batch
that knows it is finished stops forever without anyone turning it off.

**What happened (#1077):** the free gate replay (`gate-replay.ts`, PR #2644) gives the one output
gate's counts on the Ask path the same day, but the written answer, memo, Simulate read and report
section are written by a model, and the paid eval samples only five a day. James approved one paid
batch of about 200 samples, about $35: a decision card at 16:12 UTC ("Yes, one batch of ~200
(~$35)") and in his own words at 17:30 UTC ("I approve the update that would run paid models"),
2026-10-25. An earlier session's change to `paid-answer-eval.ts` was refused by a permission check
before that approval.

**Cause:** the paid paths' shadow verdicts had one source, the daily eval, capped at five a day by
James's 2026-10-15 budget, so a week gives about 35 paid shadows across four surfaces.

**Fix:**
- New `src/lib/hamilton/paid-gate-replay.ts`, step `hamilton-paid-gate-replay`: a provider step
  (`PROVIDER_STEP_KEYS`), so the global provider stop and the budget policies hold it; the tick
  never starts it (`TICK_EXCLUDED_STEP_KEYS`). One batch, `PAID_REPLAY_BATCH_ID = "2026-10-25"`.
- Questions: the free replay's plan (`planGateReplay`), seeded by the batch id so every run reads the
  same plan: every Pro question on record first, then the quality bar over two institutions per
  charter and asset tier. Each is answered free first; only an answer the path can write up is
  reserved and paid for.
- Mix 100 written answers, 50 memos, 25 Simulate reads, 25 report pages, taken in proportion (the
  path furthest behind its share goes next), so a batch stopped early by spend still holds every
  path. The paid calls are the daily eval's own (`writeUp`, `simulateUp`, `writtenUp`, `reportUp`,
  now exported with an optional `SampleTag`), tagged with the batch's operations
  (`*_replay`) and shadow origin `replay_paid`; each shadow carries its sample's subject key as
  `replay_key`.
- Caps: each sample is reserved by a `paid_replay.sample_reserved` run event under the batch's
  advisory lock, outside the step's transaction. The reservation is decided on a fresh read of the
  batch's reservations and usage rows (`ai_api_usage_events` for the batch's subject keys and runs),
  then inserted by a conditional insert that refuses a sample key already reserved, a path at its
  share, and the 201st sample; a refused insert is decided again so the caller gets the real reason
  (`path_full`, `count_cap`, `spend_cap`, `in_flight`). It refuses a ninth sample in flight across
  every run (reserved, not marked `paid_replay.sample_done`, under 15 minutes old), and a sample
  whose ceiling would take the batch's charge past $40.
- The charge (`batchCharge`, review of 938daa70a): a sample counts its recorded
  `estimated_cost_microusd` only when it is finished and every one of its usage rows is `completed`
  with a cost. Any other sample counts `max(recorded, ceiling)`: one still running or killed, one
  whose call failed or was aborted with unknown usage (`recordProviderUsage` writes a NULL cost
  then), and one with no usage row because the usage insert failed. Rows on a batch run with no
  sample's subject key count as recorded.
- Ceilings are each path's worst case from its own limits, priced for the configured model
  (`estimateAnthropicCostMicrousd`, never below the Opus 5.5 floor): written answer 4 steps x 16,000
  output tokens (the Pro agent's `maxSteps`/`maxTokens`) plus 80,000 input a step, $2.88; report 2 x
  8,000 output plus 30,000 input, $0.62; memo 2 x 4,000 plus 20,000, $0.36; Simulate 1 x 4,000 plus
  10,000, $0.13. Input is priced at the cache-write rate (1.25x), the dearest way it is billed. A path's costliest clean sample raises its ceiling.
- Its own budget line: the live readers' lines are $5 a day each (`route:api.research.hamilton`,
  `route:api.hamilton.ask.memo`, `route:api.hamilton.simulate`, `route:api.reports.generate`) and
  `agent:hamilton` is $20 a day, so a $31 batch on them would stall after about $5 of written
  answers a day and block real Pro readers. Every batch call is budgeted and recorded as agent
  `hamilton_replay` with no route (`PAID_REPLAY_LEDGER`, threaded through the tagged paths as a
  `ledger` on each path's tracking and read by `ledgerFields` in `ai-provider-usage.ts`), so it
  checks only `global:provider:default` ($75 a day, $500 a month) and `agent:hamilton_replay`.
  Migration `20270110000078_hamilton_replay_budget.sql` inserts that row (enabled, fail-closed, $40
  a day, $40 a month, $20 a run; `ON CONFLICT DO NOTHING`, no existing row changed). The daily eval
  passes no ledger and keeps its route lines and `agent:hamilton`. Usage rows keep the batch's
  subject keys, so `batchCharge` reads them. Before reserving, the same keys the real call checks are
  checked (`replayBudgetContext`, `assertProviderBudgetAllowed`), so a spent line does not use up the
  batch's samples.
- A failed free read (`answer(..., { strict: true })`, which throws on a fee-research error instead
  of answering with none; the daily eval's call is unchanged) or a report's reads that throw or pass
  60 s keep the question for a later run; it is passed over for good only after failing in three
  runs. Only a clean "nothing to write up" passes a question over at once.
- Trigger: `GET /api/admin/crew/gate-replay?paid=1` (cron secret or an admin) runs a paid run at
  once, whatever the free plan's state, keyed by the minute. While a batch run is running (touched in
  the last 6 minutes) it returns that run and starts nothing, and a queued one runs first, so it is
  safe to call every few minutes. The hourly gate replay call (`53 * * * *`) runs the free replay
  first and continues the paid batch once today's free plan is complete. Once the batch is complete
  (200 samples, every path at its share, no sample that fits the spend cap with nothing in flight,
  or no question left), the step records `complete: true` and no run starts again.
- Ledger: each run is a `hamilton.paid_gate_replay` run with one step whose summary gives samples
  reserved by path, estimated spend of $40, this run's samples scored as the daily eval scores
  them, and the batch's shadows by surface (validated/partial/held, agreement, top codes).
- `ShadowOrigin` gains `replay_paid`; `tallyGateShadow`'s `byOrigin` and the free replay's `recent`
  keep it apart. The daily eval is unchanged: its origin, operations, reservation event and caps.

**Known limits:**
- Expected spend: the daily eval's last 30 days averaged $0.217 a written answer, $0.081 a memo,
  $0.040 a Simulate read and $0.156 a report page, so the full mix is about $31; the cap is $40.
  The spend is the ledger's estimate, not the provider's bill.
- Throughput: a run writes six at a time and starts no sample after 100 s (a written answer
  started then stops by 180 s more, inside the 300 s function), so roughly 10 to 20 samples a run.
  Called with `?paid=1` every 2 to 3 minutes, a new run starts as each one finishes (about every
  5 minutes), so the batch should take an hour or two. The batch's calls fail closed until the
  `agent:hamilton_replay` row exists: the migration must run (it needs James's yes) before the
  batch can write anything. The global line ($500 a month, about $380 spent this month) leaves room
  for the batch, but the batch shares it with every other agent.
- The worst-case ceilings are far above the daily eval's real costs, so near the end the cap stops
  a written answer once the charge passes $37.12; cheaper paths may still fill. A killed sample
  keeps its full ceiling for good.
- A sample whose usage row was lost after a real call is charged its full ceiling, so the cap
  still holds. A killed function's reservation counts for good.
- A question a path cannot write up (no storyline, no peer band, no report) is passed over for
  good; a free-engine error is kept for a later run.
- While the provider stop is on, each hourly paid run is blocked at launch and leaves a blocked run
  in the ledger.

**Guard:** `src/lib/hamilton/paid-gate-replay.test.ts` (caps by count and by cost, a failed,
NULL-cost or unrecorded sample keeps its ceiling, the batch-wide in-flight cap, the real refusal
reason, worst-case ceilings, reservation idempotency, never runs once complete, budget-line refusal,
failed reads kept, origin separation, the daily eval unchanged),
`src/app/api/admin/crew/gate-replay/route.test.ts` (no stacked runs, `?paid=1` independent of the
free plan).
