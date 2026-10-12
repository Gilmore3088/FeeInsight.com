# Deming Guide

Deming is the quality and evaluation tooling of the Agentic OS PRD (section 7). It keeps the
pipeline's confirmed mistakes as test cases and checks that the deployed rules still catch them.
It runs as Atlas steps (agent `atlas`); it is deterministic and makes no model calls.

## What it owns

- `eval_cases` (migration `20270110000036`): one labeled example per row, in five datasets
  (`golden`, `adversarial`, `regression`, `holdout`, `fresh_audit`). Today only `regression` is
  written. A case's `input` is frozen at insert and never rewritten; cases are never deleted.
- `severity.ts`: the critical / major / minor / info scale. An unknown check is `major`.
- `checkers.ts`: offline replayers. Only checks with a pure rule (`hamilton.limit_guard`,
  `hamilton.source_check`) replay; other cases stay `candidate` instead of passing a test that
  never ran.
- `regression.ts`: the `deming-regression` step in Atlas's daily scoreboard run
  (`/api/admin/crew/scoreboard`). It turns every `takedown_confirmed` fee that is still down into a
  case, replays every replayable case, retires a case whose fee was restored, and reports any
  active case the rules no longer catch as a regression.
- `__fixtures__/regression-cases.json` + `regression-gate.test.ts`: the CI gate. Every case must
  still be caught with its expected reason. Refresh it from `eval_cases where status = 'active'`
  and `input->>'kind' = 'limit_guard'`; source-check cases carry whole documents, so prod's daily
  replay gates those.

## Fresh audit (accuracy)

- `fresh-audit.ts`: the `deming-fresh-audit` step in Atlas's daily run. It draws a seeded sample
  of `FRESH_AUDIT_SAMPLE` (200) live dollar fees from `published_fee_catalog` and checks each one
  against the bank's own stored schedule. A fee is right only when the amount (`traceLiveFee`, the
  shared source check), the category (`checkFeeCategory`), the evidence (the bank's own schedule,
  not an article or product page), the fee line ($0 rows must be priced lines) and the name all
  hold. A fee with no stored text is unknown, never right or wrong. Below
  `FRESH_AUDIT_MIN_SCORABLE` scorable fees there is no percentage. Read-only.
- This is the accuracy measure `CLAUDE.md` defines. The target is 95%, averaged over a week.
- The step's detail (counts per check, up to 50 misses, the seed and sample ids) is in its
  `step.finished` event. `goal-scorecard.ts` pools the last 7 days of audits into the scorecard's
  accuracy: right ÷ scorable, a 95% Wilson range (about ±3–4 points at 200 fees), misses per check,
  and one dated row per audit. Each daily scoreboard snapshot stores this in `detail.goal.accuracy`,
  so the dated results outlive the run history.
- Misses are not yet written as `fresh_audit` eval cases, and not yet sent to their owners
  (another bank's document to Magellan, a bad name to Knox). `eval_cases.label_provenance` has no
  value for an automated audit, so that needs a migration and James's decision (#1119).

## Benchmark health check

- `benchmark-health.ts` (`BENCHMARK_HEALTH_VERSION` v1): the `deming-benchmark-health` step in
  Atlas's daily scoreboard run (#1064), the statistical checks in the fee-benchmarking skill.
  For each national fee category it records the institutions behind the median and the 95% range
  by order statistics. For each state × size group under $10B it records covered and total
  institutions, coverage share, whether the group meets James's target (30, or 75% below 40),
  the fallback level (state, Fed district at the same size, or the whole state), and a bias flag
  when the covered banks' median assets are at least twice the uncovered ones'.
- **Alarm:** a category that keeps less than 70% of its institutions since the previous check
  (on the same `STATS_METHOD_VERSION`) is named in the step summary as an ALARM.
- Read-only, deterministic, no model calls. It is pause-exempt like the other reporting steps.

## Boundaries

- Deming never writes fee rows, flags or takedowns. It reads `pipeline_feedback` and the fee tiers.
- A label comes from `takedown_confirmed`, a human, or the answer key; never from a model alone.
- Holdout cases must never feed a rule or a prompt (PRD 7.3).

## Current versions

The version each rules or reader constant is at now. `scripts/ci-guards.sh guide-version-kill`
fails a PR that changes one of these constants without updating its line here (#1109).

| Constant | Strategy | Version | File |
|---|---|---|---|
| `FRESH_AUDIT_VERSION` | — | v3 | `deming/fresh-audit.ts` |
| `DEMING_REGRESSION_VERSION` | — | v1 | `deming/regression.ts` |
| `BENCHMARK_HEALTH_VERSION` | — | v1 | `deming/benchmark-health.ts` |
