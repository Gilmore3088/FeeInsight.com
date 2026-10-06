# Atlas Agent Guide

Atlas is the orchestration and operator-visibility agent. Atlas-specific code may live outside this folder today, especially in `src/lib/agents/run-store.ts`, `src/lib/agents/state-lane-*`, and `/api/admin/agents/*`; keep this guide aligned with those surfaces.

## Authority

- Atlas may create, advance, pause, and describe `agent_runs`, `agent_run_steps`, and `agent_run_events`.
- Atlas may read automation posture, run receipts, blocked reasons, next actions, and state-lane memory.
- Atlas must not extract, verify, publish, or synthesize fee conclusions directly.
- Atlas must not call paid provider automation when `automation_control` indicates a stop or pause.

## Required Behavior

- Every operator action needs a durable run/event receipt.
- Every blocked state needs a concrete next safe action.
- Scheduled advancement must remain deterministic and idempotent.
- If provider automation is unavailable, Atlas can queue, label, or route manual validation, but cannot silently resume provider work.

## Boundaries

- Do not reintroduce `ops_jobs`, Modal call IDs, Supabase Edge Function product endpoints, or request-time DDL.
- Do not use free-text institution names as execution identity. Use canonical numeric institution IDs.
- Do not collapse data trust states into generic success/failure labels; preserve source, extraction, verification, publication, and refresh states separately.

## State lanes: cadence and state experts

- `state-lane-scheduler.ts`: one full pass per state per UTC calendar month. The first
  full pass of each calendar quarter is a re-check (`recheck: 'quarterly'` in the run
  params; the `discover` and `fetch` steps read it and Magellan re-validates every link
  and re-searches dead and needs-human banks). Between full passes a lane runs hourly
  catch-up passes (discover, fetch, read, extract, classify, publish) only while the state has
  free work left (`stateHasDocumentBacklog`, which must use the same filters as those steps'
  selectors); otherwise it sleeps until its next full pass, checking again at least every 12
  hours (`STATE_LANE_IDLE_RECHECK_HOURS`).
- Idempotency keys (they only dedupe active runs): `atlas:state-lane:<ST>:<YYYY-MM>`,
  `atlas:state-lane-recheck:<ST>:<YYYY>-Q<n>`, `atlas:state-lane-backlog:<ST>:<YYYY-MM-DDTHH>`.
- State experts (`state-expert/`): one design, 55 memories (`state_memory`). The roster
  (`roster.ts`) names a historical banking or finance figure per state, DC and territory.
  The `state-expert` step (right after `enhance`, full passes only, free) refreshes the
  state's regulator, common platforms, best finder/reader strategies (`pipeline_attempts`)
  and peer levels (p25/median/p75 per canonical fee and asset-size tier from
  `published_fee_catalog`). `stateExpertHints(stateCode)` gives Magellan/Rosetta a
  preferred strategy order; `hamilton/state-expert-summary.ts` gives the report engine
  the expert's summary. Darwin's peer check reads the peer levels.

## Daily health check (contract)

`agent-health.ts` runs with the daily scoreboard step and stores Atlas's numbers in
`pipeline_scoreboard_snapshots.detail.agent_health`, next to yesterday's. Each contract rule
is tested by one number; a broken rule, or any number that moved more than 25% since
yesterday, is named in the scoreboard step's summary.

| Rule | Number | Holds when |
|---|---|---|
| Lane runs do not fail | `laneRunsFailed` (24 h) | 0 |
| A state with work gets a turn at least every 90 minutes | `medianGapMinutes` | ≤ 90 |
| Catch-up runs only start when there is work | `emptyBacklogRuns / backlogRuns` | ≤ 10% |
| The backlog check counts only work a step will pick up | `phantomExtractTexts` | 0 |
| Paid steps are not skipped while under budget | `paidStepsSkipped` (24 h) | 0 |
| Spend stays inside the daily cap | `spendUsd` vs. the global `hard_daily_microusd` | ≤ cap |

Also recorded, without a rule: `overdueLanes`, `queuedRuns`, `banksDueSearch`, `staleLinks`,
`banksNotSourceChecked`. When the lane's backlog check or a step's selector changes, add or
change the matching number here so the two can't drift apart unseen. Other agents add their own
section to `agent-health.ts` with the same shape.
