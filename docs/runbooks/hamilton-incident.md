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

## Rolling back a Hamilton release (V5 T6)

Pick the first step that contains the problem. Steps 1 and 2 change no data; none of them
deletes a saved answer, report, peer group or watch.

1. **Code, at once: promote the last good deployment.** Vercel, project feeinsight, Deployments.
   Find the production deployment built from the commit before the bad merge (`git log --oneline
   origin/main` names it), open its menu and choose "Promote to Production". Check `/pro/analyze`
   and `/pro/reports` signed in as a Pro account. This needs no PR and is undone the same way.
2. **Switch the feature off, where it has a switch.**
   - Written answers or reports misbehaving: turn the `global` provider stop on in `/admin`
     (automation control). Ask and reports then refuse with one plain line ("Hamilton's AI is
     paused right now while spending is checked...") and record the refusal as `blocked` on the
     provider ledger (`ai_api_usage_events`); peer lists, fee lookups and every screen keep working.
   - Gate repair and partial answers (`HAMILTON_GATE_REPAIR`): off unless the Vercel environment
     variable is `true`, `1` or `on`. Unset it and redeploy; today's gates decide again
     (`route.gate-repair.test.ts`, "with HAMILTON_GATE_REPAIR off").
   - The saved peer group on every screen (#1893): a bank turns it off itself by choosing
     "Automatic peers" under "Peer group for all charts" in Settings; every chart then uses the
     default groups again and the
     group is kept (`customer-isolation.db.test.ts`, "rollback switch"). There is no global switch.
   - Financial performance (#1892), the morning health check (#1921): no switch. Use step 1 or 3.
3. **Then revert on `main`.** One revert PR per bad PR, newest first, never a force-push:
   `git fetch origin main && git checkout -B revert-<pr> origin/main && git revert <merge sha>`,
   run `npx tsc --noEmit -p .`, `npm run guard:legacy` and the affected tests, open the PR, check
   its Vercel preview, merge with the usual receipt. None of the V5 PRs below added a migration,
   so a revert changes code only; data they wrote stays (saved peer groups, health-check steps).
4. **Data is never rolled back by a revert.** A wrong published fee is held on its admin row; a
   migration is undone only by a forward-fix migration with James's yes (CLAUDE.md, Migrations).

### Rehearsal, 2026-10-25

Run on a detached copy of `origin/main` at `41b41ade7`, unwinding the merged V5 PRs newest first
with local commits only (nothing pushed). The receipt with each command and its output is
`/mnt/project-files/hamilton-v5/t6-release/receipts.md`.

| PR | What | Revert |
|---|---|---|
| #2631 | Saved peer group on every screen, Peer group page | Applies cleanly |
| #2617 | Credit union quarters split on filed dollars | Applies cleanly |
| #2611 | Financial performance page | Conflicts in `.github/workflows/test.yml` (its test path in the E2E list) and `role-lessons.ts`: resolve by hand, dropping the test path and the lesson |
| #2624 | Filings reconcile names refiled call reports | Conflicts with later data-quality commits in 13 files: not revert-safe on its own; use step 1, then a forward fix |
| #2608 | Daily filings reconcile (T3) | Conflicts with #2624's follow-ups in 6 files: same as #2624 |
| #2602 | Morning health check | Applies, keeping main's role lessons text |

No unwind touched `supabase/migrations`; the unwound tree type-checks. So a bad Hamilton screen
release (#2631, #2617, #2602) reverts cleanly, #2611 needs two hand edits, and the two filings
reconcile PRs are rolled back by promoting a deployment, not by revert.

## Not covered yet

- The rehearsal above ran locally, not on a Vercel preview, and no deployment was promoted: a
  promote changes production, which is James's call.
- The health check runs once a day, with the brief. A more frequent check or a page would need a
  new cron entry, which is James's call.
