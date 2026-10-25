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
  batch's reservations and its estimated spend (`ai_api_usage_events.estimated_cost_microusd` for
  the batch's subject keys and runs, any status), then inserted by a conditional insert that refuses
  a sample key already reserved, a path at its share, and the 201st sample. A sample is refused when
  spend + the unspent ceiling of each sample in flight (reserved, not marked
  `paid_replay.sample_done`, under 15 minutes old) + its own ceiling would pass $40. Ceilings:
  written answer $0.90, report $0.50, memo $0.30, Simulate $0.10, or a path's costliest finished
  sample when higher. Before reserving, the path's own budget line is checked
  (`assertProviderBudgetAllowed`), so a spent daily line does not use up the batch's samples.
- Trigger: the hourly gate replay route (`53 * * * *`) runs the free replay first; once today's free
  plan is complete it continues the paid batch instead, and `?paid=1` (cron secret or an admin)
  runs it at once. Once the batch is complete (200 samples, every path at its share, no sample that
  fits the spend cap with nothing in flight, or no question left), the step records
  `complete: true` and no run starts again. A run left queued runs first.
- Ledger: each run is a `hamilton.paid_gate_replay` run with one step whose summary gives samples
  reserved by path, estimated spend of $40, this run's samples scored as the daily eval scores
  them, and the batch's shadows by surface (validated/partial/held, agreement, top codes).
- `ShadowOrigin` gains `replay_paid`; `tallyGateShadow`'s `byOrigin` and the free replay's `recent`
  keep it apart. The daily eval is unchanged: its origin, operations, reservation event and caps.

**Known limits:**
- Expected spend: the daily eval's last 30 days averaged $0.217 a written answer, $0.081 a memo,
  $0.040 a Simulate read and $0.156 a report page, so the full mix is about $31; the cap is $40.
  The spend is the ledger's estimate, not the provider's bill.
- Throughput: a run starts no sample after 100 s, four at a time, so about 4 to 10 samples a run;
  with the free replay taking its hours first, the batch takes about one to two days. Each path's
  own budget line (daily caps on `api.research.hamilton` and the others) can slow it further; a
  refused line is skipped for that run and tried again the next.
- A usage row lost after a real call is not seen by the spend check (as in the daily eval); the
  ceilings and the 200-sample cap still bound it. A killed function's reservation counts for good.
- A question a path cannot write up (no storyline, no peer band, no report) is passed over for
  good; a free-engine error is kept for a later run.
- While the provider stop is on, each hourly paid run is blocked at launch and leaves a blocked run
  in the ledger.

**Guard:** `src/lib/hamilton/paid-gate-replay.test.ts` (caps by count and by cost, in-flight
ceilings, reservation idempotency, never runs once complete, budget-line refusal, origin
separation, the daily eval unchanged), `src/app/api/admin/crew/gate-replay/route.test.ts`.
