# Project memory

This folder is the project's durable memory. Every Claude session reads it before starting
work, and James reviews changes to it in PRs like any other code.

| File | What goes in it | When to write |
|---|---|---|
| `LESSONS.md` | The front door: one line per decision and per finding, grouped by theme, plus a pointer to each agent's `role-lessons.ts`. `lessons-index-kill` fails a PR that adds a finding or decision without its line. | In the same PR as each new finding file or DECISIONS.md entry. |
| `checkpoints/YYYY-MM-DD.md` | Where the project stands that day: live counts, what shipped, what's blocked and on whom, what's next, and the change hit rate (the share of changes that moved the number they named, from the latest `deming-change-outcomes` run; #1106). | Daily, by the checkpoint routine. A session may add to today's file. |
| `findings/YYYY-MM-DD-short-slug.md` | Problems we hit that were structural or infrastructural, with cause, fix and lesson. One file per finding (`findings/README.md`). Each names what stops a repeat: a `**Guard:**` line (test, CI guard, scorecard alarm or checklist line) or, when an agent caused it, an `**Agent lesson:** <agent>/<lesson-id>` line; `findings-file-kill` fails a new or changed finding without one. `FINDINGS.md` keeps entries through 2026-10-09 and takes no new ones. | The moment a session finds one, in the same PR as the fix (or its own PR if there's no fix yet), with its one-line entry in `LESSONS.md`. |
| `DECISIONS.md` | Decisions James made, dated, with why and what they mean for the work. | When James decides something that changes how work is done, with its line in `LESSONS.md` in the same PR. |
| `CHANGELOG.md` | Merged changes in plain language, newest day first. | Daily, by the checkpoint routine, from merged PRs. |

## Rules
- Real numbers only. Every count names where it came from (a query, a PR, a file). If a number
  wasn't measured, write "not measured", never an estimate dressed as a fact.
- Newest entries go at the top (findings: one new file each). Never rewrite an old entry; if it turned out wrong, add a new
  entry that says so and link back. Adding a missing `**Guard:**` or `**Agent lesson:**` line to an old finding is fine.
- Times are UTC. Dates are written YYYY-MM-DD.
- No secrets, keys, or private contact details.
- Keep each entry short: what happened, why, what to do differently.

## Where other things live
- Standing rules for every session: `/CLAUDE.md`.
- Agent roster and data boundaries: `/AGENTS.md` and `src/lib/agents/*/AGENTS.md`.
- Working files (scorecards, answer keys, audits): the project's shared files folder, outside the repo.
- SQL James runs by hand: GitHub issues labeled `sql-to-run`.
