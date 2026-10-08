# Work queue

The queue is GitHub issues in this repository labeled `growth`. GitHub is the audit trail: every
job, its evidence, who did it and what came of it stays on the issue. James can add a job from
his phone with the "Growth task" issue template.

## Labels

| Label | Meaning |
|---|---|
| `growth` | Every GrowthOS issue |
| `growth:new` | Filed by SHERLOCK or James, not yet triaged by DRAPER |
| `growth:ready` | Triaged and assigned; carries one agent label |
| `growth:review` | Output waiting on James (a PR or a draft) |
| `growth:backlog` | Assigned to an agent that is not active yet |
| `agent:draper`, `agent:sherlock`, `agent:ernest`, `agent:norman`, `agent:nielsen`, `agent:edison`, `agent:carnegie` | Owner |
| `guard:pass`, `guard:fail` | Result of the editorial policy check on a public-facing output |

## Issue body

Every agent-filed issue uses the same sections, so DRAPER and James can scan them:

1. **Evidence:** link and date, or the prod query with its time and result.
2. **Job:** one sentence, verb first.
3. **Owner:** one agent.
4. **KPI:** the one metric this should move (`metrics/kpi-definitions.md`).
5. **Review level:** automatic, review required, or explicit authorization.
6. **Done when:** what proves it on prod (a count, a live page, an event firing), never "merged".

## Rules

- One job per issue. Before filing, search open `growth` issues for the same evidence link or
  title; comment there instead of filing a duplicate.
- An agent closes only its own issues, with the outcome and its evidence. "Merged" is not an
  outcome; "live, measured" is.
- No issue body contains an email address, a contact's name or anything private about a person.

## Dry-run mode

Until James says go, runs write what they would file to `growth-os/runs/<date>-<agent>.md`
instead of creating issues, and the labels are not created.
