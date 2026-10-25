# Hamilton incident process (#1921)

A short process for when Hamilton, the paid workspace, is broken for Pro readers. The full
containment table and the rollback steps are in the release runbook,
[`docs/project/findings/2026-10-17-hamilton-release-runbook.md`](../project/findings/2026-10-17-hamilton-release-runbook.md).
This file says who acts, how customers are told, and in what order.

## How an incident is found

- **The morning health check.** Every morning brief (the daily-brief run, 12:00 UTC) runs
  Hamilton's health check, `src/lib/hamilton/health-check.ts`. It has three probes, none of which
  calls a model or writes a row:
  - **database:** the connection answers, and every table Hamilton reads or saves to exists and
    can be read.
  - **ask:** the Ask engine answers "How does our overdraft fee compare?" for one institution that
    publishes an overdraft fee.
  - **export:** the analysis PDF renders from a fixed synthetic answer.

  A failed probe is listed first under "things need you" in the email, and the subject says
  "Hamilton check failed". Each probe's verdict and timing is saved on the daily-brief run's step
  (`hamilton_health` in its detail), so the admin run ledger shows it too.
- **A customer report** to hello@bankfeeindex.com.
- **A failed release journey** (`npm run test:hamilton-journeys`, see the release runbook).

## Who acts

| Role | Who | Does |
|---|---|---|
| Owner | James | Declares the incident, approves anything the standing rules gate (data changes, migrations, provider spend), and tells customers. |
| Responder | The Hamilton lane builder session, or James | Contains, finds the cause, opens the fix PR. |

James is the only person who emails customers. A session never sends customer email
(outreach and marketing sends stay parked).

## Steps

1. **Confirm.** Read the failed probe's reason on the daily-brief run's step in the admin run
   ledger. Then try the same path by hand: sign in as a Pro account, ask the same question on
   `/pro/analyze`, or download an analysis PDF. The brief runs once a day, so a same-day re-check
   is by hand.
2. **Contain first, fix second.** Use the release runbook's "Failure containment" table:
   - a bad deploy: promote the last good production deployment in Vercel (code only, no data
     changes), then open a revert PR on `main` (never a force-push);
   - provider trouble: turn on the `global` provider stop in `/admin`; deterministic answers keep
     working;
   - a wrong published fee: hold it on its admin row;
   - the database down: check Supabase status and the connection pool. There is no app rollback.
3. **Tell customers** (James) when Pro readers were affected for more than about an hour, or saw a
   wrong figure. Use the template below. Never name internal agents or pipeline steps.
4. **Fix the cause** in its own PR, per the "fix the input and the process" rule. Re-run the
   journeys on the fix's preview.
5. **Record it.** Add a findings file, `docs/project/findings/YYYY-MM-DD-hamilton-<slug>.md`, with
   what happened, the times, the deployment and commit SHAs, and the cause. File follow-ups under
   the Hamilton tracker (#975).

## Customer notice template

> Subject: Hamilton service notice
>
> Between [start time] and [end time] UTC on [date], [what readers saw, for example: Ask answers
> did not load, or PDF downloads failed]. [Your saved research and answers were not changed.]
> It is fixed now. [If a figure was wrong: The [fee] figure for [institution] showed [wrong
> value]; the correct figure is [value], from the bank's current fee schedule.]
>
> If anything still looks wrong, reply to this email and we will look at it the same day.
>
> Fee Insight, hello@bankfeeindex.com

Every number in the notice needs a source, as on the site. If the start time is not known, say so.

## Spend caps, faults and report runs (V5 O1)

Every Hamilton request that makes paid model calls runs as one task
(`src/lib/hamilton/task-budget.ts`). Before each call, after the `global` provider stop, the
credit circuit and the `api_budget_policies` caps (all unchanged), it checks:

| Task | Calls | Tokens (in + out + cache write) | Cost |
|---|---|---|---|
| Ask (written answer, memo) | 6 | 400,000 | $2.00 |
| Report | 16 | 400,000 | $4.00 |
| Simulate | 3 | 60,000 | $0.50 |
| Chat | 2 | 250,000 | $1.50 |
| Briefing (no paid call yet) | 3 | 120,000 | $1.00 |
| One reader, per UTC day, all tasks | 120 | 3,000,000 | $10.00 |

The caps are code constants (no environment variable, no table row). They sit above the largest
single calls in `ai_api_usage_events` for the 60 days to 2026-10-25 (written answer $0.67 and 148k
tokens, report section $0.18 and 23k tokens, chat $0.39), and the reader's day sits below
`agent:hamilton`'s $20 daily policy. A refused call writes a `blocked` row in
`ai_api_usage_events` (metadata `budget_reason_code`, `hamilton_budget_scope`,
`hamilton_budget_measure`) and, for a
report, a `budget.blocked` event on its run. The reader sees a plain line ("Hamilton stopped this
request because it reached the limit for a single request..." or "You've reached today's limit
for Hamilton's written work..."). If the day's usage cannot be read, the call is refused.

**Faults** (`src/lib/hamilton/task-faults.ts`): a provider error, a timeout or an unusable reply
is retried once; a reply too large to read, a usage or billing limit, a budget cap, the provider
stop and an unfinished reply are never retried. Each report section keeps its own fault. A section
that still fails ends its run `failed`, with the fault kind on the step (`section.failed` event)
and on the run.

**Report runs** (`src/lib/hamilton/report-run.ts`): each Pro report is one `pro_request` run at
stage `pro.report`, with a step per section and a save step. A finished section is saved on its
step before the next starts; a request inside the lease (5.5 minutes, renewed at each section) is
told the report is still being written. The report's id is fixed when the run opens, so a replay
never saves a second copy, and the report row is written only after every section passed. A
failed run's finished sections carry into a new run of the same request for an hour.

If the request is killed (a deploy, a timeout, a closed tab), its run and its current step are
left `running`. Once the lease lapses, `sweepInterruptedReportRuns` closes them without waiting for
the reader: the step it was on is marked `failed` ("Interrupted: ..."), later steps `skipped`, and
the run `failed` (`run.interrupted` event, `closed_by_sweep` in its params), or `completed` when
the report had already been saved, in which case the next request for it gets that report back
once. The sweep runs on every agents tick (the stale-step reaper), on every pipeline health read
(`/api/admin/job-health`) and before every report opens, so an interrupted report never counts as
a stale running step. If a checkpoint write fails mid-report, the report is still written and
saved under the run's id, and the run is still closed (`checkpoints_degraded` in its detail).

To check a stuck or failed report: in the admin run ledger, open the reader's `pro.report` run.
Its steps show which section stopped and why; its events show `section.saved`, `section.failed`,
`budget.blocked`, `run.interrupted`, `run.resumed`.

## Switches and rollback

| Switch | Off (unset) means | Proof |
|---|---|---|
| `global` provider stop (`/admin`) | Paid calls refused; deterministic answers keep working | `task-budget.test.ts`: the stop is checked first and no task check runs |
| `HAMILTON_GATE_REPAIR` | No repair call; the first draft and its verdict stand | `rollback-rehearsal.test.ts`, `output-gate-repair.test.ts` |
| `HAMILTON_REPORT_FINDING_READING` | A saved answer's reading is not printed in reports | `rollback-rehearsal.test.ts`, `report-actions.test.ts` |
| `HAMILTON_MODEL` | The default model in `ai-provider.ts` | `rollback-rehearsal.test.ts` |

Turning a switch off is a Vercel environment change plus a redeploy (James's call). The O1 work has
no switch and no migration: roll it back by promoting the previous deployment and reverting its PR.
Code outside a task, or a report with no run ledger, behaves as before O1 (both tested in
`rollback-rehearsal.test.ts`). Rehearsed by tests on 2026-10-25 (local, synthetic data); not yet
on a preview.

## Not covered yet

- The rollback rehearsal on a preview (#1921's last item) has not been run. The switch tests
  above are local evidence, not that rehearsal.
- The health check runs once a day, with the brief. A more frequent check or a page would need a
  new cron entry, which is James's call.
