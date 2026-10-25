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

## Not covered yet

- The rollback rehearsal on a preview (#1921's last item) has not been run.
- The health check runs once a day, with the brief. A more frequent check or a page would need a
  new cron entry, which is James's call.
