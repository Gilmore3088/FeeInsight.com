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
- A state lane with no finished step for 15 minutes gets a fresh tick ahead of maintenance,
  longest idle first. Customer reports remain first. Finishing any step resets that priority;
  old launch dates alone do not promote a busy lane. Deadlines and publish serialization still apply.
- A capped state lane whose next step is an optional paid pass still enters the tick when
  deterministic work follows: the executor records the paid skip and advances the free work.
  Mandatory paid jobs and paid-only lanes stay queued; operator pauses and scope guards still apply.
- If provider automation is unavailable, Atlas can queue, label, or route manual validation, but cannot silently resume provider work.

## Boundaries

- Do not reintroduce `ops_jobs`, Modal call IDs, Supabase Edge Function product endpoints, or request-time DDL.
- Do not use free-text institution names as execution identity. Use canonical numeric institution IDs.
- Do not collapse data trust states into generic success/failure labels; preserve source, extraction, verification, publication, and refresh states separately.

## Daily scoreboard execution (#2177)

The 60-second daily route creates or reuses the UTC day's `atlas.scoreboard` workflow and
reports its actual pending/running/terminal state. It runs no steps inline. Opt-in whole-key
idempotency locks only lookup/create and its step inserts in a short ledger transaction; terminal
failed/cancelled runs are returned as such, and the earliest pre-existing duplicate is canonical
without deleting history. Other callers retain active-only idempotency.

The existing 300-second tick consumes the workflow over bounded passes. Its first reference-score
step is priced at 150 seconds and must fit an explicit tick deadline even when selected first;
other runs retain their existing first-step progress behavior. Both controls paused permits only
recovery and already pause-exempt execution in Atlas `workflow` runs with source `atlas.scoreboard`.
That path schedules no runs, consults no provider budget, and leaves unrelated alerts/digests,
marketing/data runs and other sources untouched. The new live-source draw and city repair/storage remain queued until the
pipeline control permits them; backend disabled still does nothing. Run/step/events expose every
completion, deferral and held tail. The narrow continuation's opt-in ceiling checks the existing
exempt list in selection, before each step and on the actual step under the ledger claim lock,
so a control change or concurrent progression cannot carry it into the held tail. No new
exception is added to `PAUSE_EXEMPT_STEP_KEYS`; normal callers have no new ceiling.

## Separate live-source diagnostic (#2061)

The daily workflow has 13 steps. After all ten existing pause-exempt measurements and their
snapshot, `deming-live-source-draw` freezes a capped current-dollar catalog frame without network
I/O. This draw and all subsequent observation/capture/archive work obey the pipeline pause.
The existing tick admits at most one finite `deming.live_source_audit` workflow per UTC ten-minute
bucket, alternating fresh oldest-draw work and due capture episodes. Magellan's capture workflow
has its own Atlas archive tail. No provider, R2 activation, extra pause exception or inline daily
execution is introduced. See [the diagnostic contract](../deming/LIVE-SOURCE-AUDIT.md).

## Answer-key relabels (`answer-key-relabels.ts`, #1099)

The score step of Atlas's daily scoreboard run (`score-answer-key`) first applies James's category
decisions to a fixed list of answer-key lines, then scores, so the day's score reads the corrected key.
The relabel has no step of its own, so the score can never run before it (the scoreboard advances in tick passes; its daily route only queues work, #2177).
`score-answer-key` is pause-exempt, since it writes only the answer key and score rows, never a fee
row, so a pipeline pause does not hold the score. A failed relabel runs in its own savepoint, is
reported in the step detail (`answer_key_relabel`), and never stops the score.

First list (Oct 16, night deposit option A): 28 confirmed bag and key purchase lines at 11 banks, 6
prefilled ones at 6 more, and bank 61's deposit for the receptacle key (line 48) leave scoring
(`canonical_key = 'unmapped'`, a note in `conditions`). A key deposit is a key charge, not the night
depository service. The answer-key score and Deming's Knox replay skip `unmapped` lines. The repo
copies of these lines (the Knox gate fixtures and `darwin/answer-key-fees.json`) carry the same
`unmapped` labels. A line changes only while it reads as listed (id, institution, category, price,
source line); every change goes in the step's ledger detail, and a second run changes nothing.

## City repair (`city-repair.ts`, #1213)

NCUA's FOICU file cuts a credit union's city at 15 characters ("Colorado Spring", "North Little
Ro"); credit unions inserted before #1317 kept the cut. `atlas-city-repair`, the last step of the
daily scoreboard run, restores the full name from the credit union's own office cities in NCUA's
branch file (`credit_union_branches`, latest report) when exactly one longer office city starts
with the cut (case ignored), title-cased where the file writes it in capitals. It writes only rows still holding the cut,
so a second run changes nothing, and lists every change (id, old city, new city) in the step
detail; a dry run lists them and writes nothing. Two possible names, or none (College Station, San
Luis Obispo, and the cuts with no longer office city), stay for a person; a person's checks go on
`HAND_CITY_REPAIRS` (3 on Oct 17: North Little Rock, Palm Beach Gardens, Saratoga Springs), written
by the same guarded update only while the stored city is still the cut. On by James's decision
(Oct 15). The cut city's public page redirects permanently to the full one once no institution
keeps the cut (`fullCityForCut`). It is a data step, so the pipeline pause holds it.

Hand-checked fee links (`hand-link-repair.ts`, #2022) ride the same step: each `HAND_LINK_REPAIRS`
entry (Natbank 2675 on Oct 19: from National Bank of Canada's business accounts page to Natbank's
own U.S. accounts page) writes the website and fee link only while the fee link is still the listed
old one, moves the profile's canonical link unless a correction locked it, takes the bank's own
pages off `rejected_source_urls` and sets the wrong pages aside there. Step detail `hand_links`.
On by James's decision (Oct 19, "Do all three"). Add later checks to the list, never edit a past one.

## Storage watch and retention (`storage-retention.ts`)

`atlas-storage-retention`, after the city repair in the daily scoreboard run, records the database
size, the 12 largest tables and the growth since its last run, and warns in its summary above
13,000 MB or 300 MB a day (raised from 9,000 MB on Oct 18, 2026: the public-data back-fill left
the database at about 10 GB on an 18 GB disk, so 9,000 warned every day). It also measures every
table a Hoovie source writes against its size budget (`src/lib/agents/hoovie/size-budgets.ts`),
records the sizes (`budget_tables`), the tables over budget and the registry sources the
scheduler holds for them, and warns for each table over budget. The registry scheduler reads the
newest recorded sizes (`readLatestTableSizes`) and schedules no partition for a source that writes
a table over its own budget (a table over the unmeasured default is warned about, not held); with no measurement it holds nothing. Nothing is deleted from those tables.
The morning brief (`daily-brief.ts`) emails James the step's warnings, only on a day with one. Supabase grew the disk from 8 to 12 GB on Oct 17, 2026; that day 2.5 of
the 6.3 GB was log history nothing trimmed. Three trims count what they would delete every day and
delete (at most 20,000 rows each a run) only while their `RETENTION_LIVE` switch is true; each
switch turns on by PR after James's yes naming it (he chose all three on Oct 17, 2026): `legacy_event_log` (retired `agent_events`
rows over 60 days old), `run_events` (run events over 90 days old, keeping the newest of each kind
per step and any with a cost) and `attempt_repeats` (attempt-log rows over 30 days old in the
extract, verify and publish stages that have an identical twin both before and after them; first
and last copies stay; rows with no institution stay). Fees and audit records are never in scope. It deletes rows, so the pipeline
pause holds it.

## Direct state re-search (`priority-state-research.ts`)

A state on `PRIORITY_STATE_RESEARCH_REQUESTS` gets a `manual_repair` run (source
`atlas.priority_state_research`) of free steps: discover with `upgrade_slots` 25, then
fetch, read, extract, classify, publish. One run per state at a time, none while the
state's own lane is running (a queued lane does not count), and none once nothing is due (dead ends whose last search used
an older discovery method, and product-page links not yet searched for the real schedule)
or the request's `until` day has passed. Magellan's own selectors pick the banks, so a bank
is never searched twice under one method. No state is on it now; Tennessee's request ended
10 Oct 2026 and was removed (#1117).

A state on `REPORT_REVIEW_REQUESTS` (`report-review-states.ts`, a report James is waiting to
review) runs its lane ahead of routine passes until the entry's `until` day. Tennessee is on it
until 19 Oct 2026; remove it sooner once its report is reviewed.

## Direct runs for one institution (`priority-institutions.ts`)

Up to two at a time, free steps only (fetch, read, extract, verify, publish) for one bank, in
this order: a schedule found by hand and not yet fetched; a Pro account's own institution
(an active `institution_workspace_memberships` row) with fewer than `PRO_INSTITUTION_MIN_FEES` (3)
live dollar fees, again every 24 hours until it has them (#1078); a document Magellan's paid fetch
stored that is still unread (the paid step fetches blocked links for banks in every state,
while a state run reads only its own state, so these would wait for their state's lane); a
bank asked for by name; a $10B+ bank or market leader with no live overdraft fee. A new
hand-found link or paid-fetched document starts a new run even inside the retry window.

- A request by name ends once a run for it, started on or after the request's `requestedAt`
  date, has read one of the bank's documents (an `extract` attempt in `pipeline_attempts` for
  that run and bank). A run whose fetch fails still completes, so completion alone is not enough
  (Oct 15: 242 of 596 completed request runs had an extract attempt). Until this, each of 71
  requested banks re-ran every 24 hours, 506 re-runs since Oct 7, and 28 of the banks had no new
  or taken-down fee from any of them. After that the bank runs directly only on another tier;
  asking again means a new entry or a later `requestedAt`.
- A Knox rules version that has not read a $10B+ bank's or leader's current page lets that bank
  past its retry window, but at most `PRIORITY_RULES_REREADS_PER_HOUR` (6) such runs an hour. A
  version bump otherwise made every one due at once (v68 made about 213 banks due; 25 v68
  runs started, at most 10 in an hour, before v69 at 05:30 started 84, up to 22 in an hour). Past the cap, a bank waits
  for its retry window, or for its state's lane to read the page first.
- In the tick, a direct run ahead of a state lane stops starting steps while the next one would
  leave the lane no room for its first work (`run-store.ts`, `laneFirstWorkMs`). The lane then
  gets the tick's first-step exemption. A state re-search run idle 15 minutes
  (`LANE_ROOM_MAX_IDLE_MS`) takes one step without leaving that room, since its `discover` never
  fits beside a fresh lane's first work (#1421); Read-now runs always leave it. The bound is firm
  only when the re-search run is the tick's first row: several waiting re-search runs can each take
  a step ahead of the lane.

## State lanes: cadence and state experts

- `state-lane-scheduler.ts`: one full pass per state per UTC calendar month. The first
  full pass of each calendar quarter is a re-check (`recheck: 'quarterly'` in the run
  params; the `discover` and `fetch` steps read it and Magellan re-validates every link
  and re-searches dead and needs-human banks). Between full passes a lane runs hourly
  catch-up passes (discover, fetch, read, extract, classify, publish) only while the state has
  free work left (`stateHasDocumentBacklog`, which must use the same filters as those steps'
  selectors); otherwise it sleeps until its next full pass, checking again at least every 12
  hours (`STATE_LANE_IDLE_RECHECK_HOURS`).
- A state runs daily full passes instead of monthly while more than
  `DAILY_FULL_PASS_MISSING_LINKS` (50) of its banks have no fee link and a search can still
  find them (website on file, not offline or manual-review, last search not `dead` or
  `needs_human`). Dead ends wait for the quarterly re-check instead. A state also stays daily
  while at least `DAILY_FULL_PASS_FIND_DUE` (25) banks are paid-find targets
  (`paid_find_due`, the same banks Magellan's paid find picks this month) or have no website
  and are still due Magellan's website search (`website_find_due`, the same rows
  `magellan/website-find.ts` picks), or while any market leader is among them. A state with
  fewer of them due runs a weekly full pass until they are tried. The paid caps still bound
  the spend.
- The hourly nationwide sync (`runNationwideLaneSync`: every state's lane and profile rows, the
  unchecked-live-fee and second-look wakes, the priority refresh) is the `lane-sync` step of its own
  run (`atlas.lane_sync`), started by `/api/admin/crew/lane-sync` at minute 6 of each hour. The tick
  never runs it: inside the first tick of each hour it held that tick's first step back p50 80 s,
  max 200 s (2026-10-18 finding, tick loses budget before steps).
- Which lane goes next (James, 2026-10-06: schedule by where the work is): the hourly
  nationwide sync sets each lane's `priority_score` (`refreshLanePriorities`) to the number of
  banks in the state with open work or a recent error: due a search, a fee link not fetched
  for 30 days, newest live fee not source-checked, or a source-check takedown in the last 7
  days. Due lanes run highest score first; a lane overdue by `STATE_LANE_STARVATION_HOURS`
  (3) goes ahead of all, so quiet states still get turns. The tick launches
  `STATE_LANE_LIMIT_PER_TICK` (3) lanes every 5 minutes. A refresh that fails keeps every
  lane's old score and says so: the tick's `priorities.error`, and a `lane.priorities_failed`
  event on each lane run that tick starts (or the newest lane run when it starts none; #1264).
- Report demand goes first (2026-10-06, funnel audit): a state gets
  `REPORT_REQUEST_PRIORITY` (2000) while an unpaid report request from the last 30 days names
  an institution there (`institution_id=` in `leads.use_case`) that fails James's report rule,
  and `NEAR_READY_BANK_PRIORITY` (2000) plus 10 per rich bank while its bank market is within
  `NEAR_READY_GAP` (6) rich banks of ready (`market-readiness.ts`). This only changes when a
  state runs, not what its steps pick.
- Market leaders next (2026-10-07, James wants all fees for each state's 10 to 15 largest):
  each institution in `loadMarketLeaderIds` (`data-store/market-leaders.ts`) with fewer than 9
  headline fees live adds `UNCOVERED_LEADER_PRIORITY` (50) to its home state's lane, since
  that lane finds its schedule. On 2026-10-07, 585 of 693 leaders were uncovered (ME, UT and
  WI had 19 each).
- Coverage gap (2026-10-12 target, #1117): each covered institution the state's size groups
  under $10B still need to reach James's target (30 live institutions per group, or 75% of a
  group under 40) adds `COVERAGE_GAP_PRIORITY` (20). The groups come from `coverageGroupsSql`
  in `goal-scorecard.ts`, the same query behind the scorecard's benchmark-ready groups, so the
  gap a lane works on is the one the scorecard shows per state (now, 7 days ago, and the newly
  live institutions that closed it). A state is at most 90 short (1,800), below report demand.
  Institutions over $10B are compared nationally and by district, so they add nothing.
- At most `MAX_ACTIVE_STATE_LANE_RUNS` (3) lane runs are queued or running at once. The
  executor finishes started runs first, then runs waiting over an hour, then the highest
  `priority_score`.
- Idempotency keys (they only dedupe active runs): `atlas:state-lane:<ST>:<YYYY-MM>`,
  `atlas:state-lane-recheck:<ST>:<YYYY>-Q<n>`, `atlas:state-lane-backlog:<ST>:<YYYY-MM-DDTHH>`.
- State experts (`state-expert/`): one design, 55 memories (`state_memory`). The roster
  (`roster.ts`) names a historical banking or finance figure per state, DC and territory.
  The `state-expert` step (right after `enhance`, full passes only, free) refreshes the
  state's regulator, common platforms, best finder/reader strategies (`pipeline_attempts`)
  and peer levels (p25/median/p75 per canonical fee and asset-size tier from
  `published_fee_catalog`). `stateExpertHints(stateCode)` gives Magellan its specialist
  order for the state (`finderOrderFromHints` in `magellan/discovery.ts`: specialists that
  found links there run first, ones tried 5+ times without a find run last; each discover
  step records the order in its result as `finderOrder`); `hamilton/state-expert-summary.ts` gives the report engine
  the expert's summary. Darwin's peer check reads the peer levels. The step also records the
  state's work list (`work_list_groups`, #1029): its size groups under $10B, furthest below
  the coverage target first, the order Magellan's paid passes take its institutions in
  (`state-expert/work-list.ts`; see Magellan's AGENTS.md).
  The step also keeps dated state notes (#1573, `state-expert/notes.ts`, table
  `state_expert_notes`, read and written through `data-store/state-expert-notes.ts`): a
  `document_type` note naming the most common kinds of stored fee documents in the state
  (Rosetta's `agent_source_texts.document_kind`, at least 10 classified texts) and their usual
  format, written when its text differs from the state's latest one; and a `state_fee_rule`
  note per signed state fee bill (`reg_tracker_items`, Open States), once per bill. Each note
  carries the run id. Every non-dry pass records a `state_expert.notes` event; before the
  migration (20270110000052) it is `skipped` and nothing is written. A dry run writes nothing.
  `/admin/states/<ST>/expert` lists the notes, newest first.

The morning brief counts health/storage warnings alongside console items, includes bounded
redacted reasons and admin action URLs, separates failed from blocked runs, and labels agent
activity as completed steps. Spend includes the remaining monthly budget. Source dates distinguish
successful checks from nonempty loads and attempts; answer evals show planned/completed samples
when recorded and identify small paid samples. Historical snapshots may lack these fields.

## Goal scorecard (#1040)

`goal-scorecard.ts` runs with the daily scoreboard step and stores the goal numbers in
`pipeline_scoreboard_snapshots.detail.goal`. `/admin/scoreboard` and the morning brief show the
same numbers. Each number names its query (`GOAL_QUERIES`) and covers the trailing 7 days:
- benchmark-ready state × size groups under $10B (30 live institutions, or 75% below 40);
- institutions with live fees, and those added (live now, no live fee 7 days ago);
- Deming's pooled accuracy;
- wrong after publish (error take-downs ÷ fees first published, refresh copies and
  housekeeping take-downs left out);
- provider spend per agent against its cap, and per institution added;
- Knox's free and paid passes (fees kept, documents, institutions, cost per fee, share at $0);
- the share of live fees with no stated audience.

A refresh or a rollback never counts as progress. A read that fails is stored as null and
the brief says it could not be read.

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
| No lane does nothing 3 catch-up runs in a row | `emptyStreakLanes` (lanes whose last 3 catch-up runs did nothing) | 0 |
| The backlog check counts only work a step will pick up | `phantomExtractTexts` | 0 |
| Paid steps are not skipped while under budget | `paidStepsSkipped` (24 h) | 0 |
| Spend stays inside the daily cap | `spendUsd` vs. the global `hard_daily_microusd` | ≤ cap |

Also recorded, without a rule: `laneRuns`, `backlogRuns`, `overdueLanes`, `queuedRuns`,
`spendUsd`, `dailyCapUsd`, `banksDueSearch`, `staleLinks`. When the lane's backlog check or a
step's selector changes, add or change the matching number here so the two can't drift apart
unseen. Every agent has the same section in its own AGENTS.md; a new rule goes in that table and
in `agent-health.ts` in the same PR.

## Current versions

The version each rules or reader constant is at now. `scripts/ci-guards.sh guide-version-kill`
fails a PR that changes one of these constants without updating its line here (#1109).

| Constant | Strategy | Version | File |
|---|---|---|---|
| `SCHEDULE_CHECK_VERSION` | — | v1 | `atlas/schedule-check.ts` |
| `ANSWER_KEY_RELABEL_VERSION` | — | v1 | `atlas/answer-key-relabels.ts` |
