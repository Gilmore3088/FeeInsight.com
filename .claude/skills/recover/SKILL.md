---
name: recover
description: Automated recovery when an agent breaks on prod. Find a step type that keeps failing, fix it by PR, merge on green, and prove the failed work reran. Run by the scheduled recovery check.
---

# Recover a broken agent

James's decision (2026-10-08, "Fix" on the recovery card): when an agent breaks, recovery
fixes it by PR, merges once CI is green, makes sure the failed work reruns, and tells him
after. He is not asked first. The limits below still hold.

## 1. Detect (read-only, Supabase MCP, project `rmhwbbjjctzfaqjyhomu`)

A break is any of these:

**a. Failure streak.** The last 3 or more finished steps of one step type all failed. This
is the same rule as `stepStreakAlerts` in `src/lib/agents/failure-alerts.ts`:

```sql
WITH finished AS (
  SELECT step_key, status, error_summary, updated_at,
         ROW_NUMBER() OVER (PARTITION BY step_key ORDER BY updated_at DESC) AS rn
    FROM agent_run_steps
   WHERE status IN ('completed', 'failed') AND updated_at > NOW() - INTERVAL '24 hours'
), marked AS (
  SELECT finished.*, MIN(rn) FILTER (WHERE status = 'completed') OVER (PARTITION BY step_key) AS first_ok
    FROM finished
)
SELECT step_key, COUNT(*) AS failed, (ARRAY_AGG(error_summary ORDER BY updated_at DESC))[1] AS latest_error,
       MIN(updated_at) AS since, MAX(updated_at) AS latest
  FROM marked WHERE status = 'failed' AND (first_ok IS NULL OR rn < first_ok)
 GROUP BY step_key HAVING COUNT(*) >= 3;
```

**b. Shared failure.** One step type has failed with the same `error_summary` in 3 or more
runs in 24 hours, and the latest of those failures is less than 2 hours old.

**c. Stalled tick.** No `agent_run_steps` row has been updated for 30 minutes while
`agent_runs` has queued runs.

**d. Starved lane.** A lane that is due (`next_run_after` in the past) has not run within its
`freshness_target_hours`:

```sql
SELECT state_code, freshness_target_hours, last_run_at, next_run_after
  FROM agent_state_lanes
 WHERE next_run_after <= NOW()
   AND (last_run_at IS NULL OR last_run_at < NOW() - freshness_target_hours * INTERVAL '1 hour');
```

Lanes come due about an hour after each run, but the queue only gets through about five an
hour, so with 55 lanes most are due and many are 6+ hours overdue while each still runs
every 12 hours or so. That is the queue's normal pace, not a break (2026-10-08: 29 lanes
3+ hours overdue, every one inside its 24-hour target). A lane parked with a future
`next_run_after` (FM until November) is not starved.

If none of these holds, stop. Reply nothing.

## 2. Skip what is already owned

Before fixing, check whether someone already owns the break:
- `list_project_prs`: an open PR whose title or files point at the failing step or its error.
- `list_thread_sessions` (activity in the last 2 hours) and `fetch_thread` on the likely
  owner: a thread already working on it.
- An earlier recovery PR for the same error that is still open.

If someone owns it, don't make a competing PR. Note it in the status checklist, and if it
has been broken for more than 2 hours with no PR, tell the coordinator once.

## 3. Find the cause

- Read the failing step's `error_summary` and its `agent_run_events` (`step.failed` detail
  records `deploy`, the commit it failed on).
- Compare `since` (when the break started) with recent merges (`git log origin/main --since`).
  A break that starts within minutes of a merge is usually that merge.
- Find the code path: the step's module under `src/lib/agents/<agent>/`, then the line
  that throws. Check prod's schema (`information_schema.columns`, generated columns,
  constraints) for database errors.
- Reproduce it in a unit test that fails before the fix.

## 4. Fix

- Work on this thread's own branch. After a merge, `git fetch origin main && git merge
  origin/main`. Never reset, rebase, force-push, push to main or delete branches.
- Keep the fix to what the failure needs. Add the failing test.
- Add an entry to `docs/project/FINDINGS.md` in the same PR.
- Before pushing: the changed area's `vitest`, `npx tsc --noEmit`, `eslint` on the changed
  files, and `npm run guard:legacy`.
- Open the PR, subscribe to its activity, drive it to green, and merge on green
  (CLAUDE.md: fix PRs merge on green).

## 5. Prove the rerun

PR 572's `wakeLanesAfterRecovery` reruns failed state lanes once a new deploy is live and
hasn't repeated the failure. Each rerun writes a `run.recovery_rerun` event. After the fix
deploys:
- check that the step type now completes (count completed since the deploy), and
- check that every failed state reran and its step completed.

A run that isn't a state lane does not rerun by itself. Start it again the same way it was
started (its `run_kind`, `params_json` and `trigger_source`), through its typed agent
module or admin action. Never through hand-written SQL that changes data.

## 6. Tell James

One reply in the recovery thread, after the proof: what broke, since when, how many runs
failed, the PR link, and the after-numbers (for example "publish 12 of 12 completed since
the 13:10 deploy; IA, KS, LA, MO, MS and NM reran and published"). Until the proof is in,
say "merged, proving".

## Limits (always)

- Never delete fees or rows. Archive and log.
- No SQL that changes data and no migration that changes data. If the fix needs either,
  stop and ask James with one-word options.
- No paid model calls and no new paid tools. Don't raise budgets or flip automation
  controls (`global`, `pipeline`, `marketing`).
- Never skip, disable or quarantine a test to get green.
- Don't touch files another open PR or thread owns. Admin Health, Today and nav are the
  admin slimming thread's; go through the coordinator.
- A fix that would change product behaviour, wording or design (not a bug fix) is not
  recovery. Ask James instead.
- Two failed fix attempts on the same break: stop, and tell James what you tried.
