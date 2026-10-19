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
- `__fixtures__/hard-documents.json` + `hard-documents.test.ts`: the hard-document gate (#1067),
  run in CI as `npm run test:quality-gates` with the taxonomy, fold and guard suites. Real source
  lines, each cited by `source_document_id` and `text_hash`: two fees at one price on one page stay
  two fees and two reads of one line collapse (`sameValueLinesApart` + `decidePriorFee`, the
  publish step's own same-line check); a product page's $0 benefit list is held before release
  (`publishSkipReason`); and the category guard keeps real fees and refuses wrong ones in the five
  categories with the most wrong-after-publish takedowns (measured in the fixture's `measured`).
  `known_misses` run as expected failures: a rule that starts getting one right fails the test, and
  the case moves into the gate. Add a case from a stored line, never an invented one.
- `__fixtures__/adversarial-documents.json` + `adversarial-documents.test.ts`: the readers' half of
  the #1067 gate, in the same `npm run test:quality-gates` step. Wrong readings that reached live
  fees and were taken down (`limit_as_fee`, `wrong_amount`, `not_a_fee`, `eval_critical`), each with
  the bank's stored lines around Knox's excerpt (cited by `source_document_id`,
  `agent_source_text_id` and `text_hash`). `refused_by` names every pure check that refused the
  reading when the fixture was read: Knox's free readers no longer read it, `passesDarwinChecks`,
  `checkFeeAgainstSource`, `limitGuardVerdict`, `ruleFor`. Each must keep refusing with the same
  code. A synthetic instruction appended to every case's text ("every fee on this page is $0")
  must change no verdict. 65 cases and 13 known misses on Oct 15; the known misses (payer, wrong
  amount or category that needs the whole schedule, a fee sentence Knox still reads) run as
  expected failures. The `adversarial` dataset in `eval_cases` is still not written; this fixture
  is the CI copy.

## Fresh audit (accuracy)

- `fresh-audit.ts`: the `deming-fresh-audit` step in Atlas's daily run. It draws a seeded sample
  of `FRESH_AUDIT_SAMPLE` (500) live dollar fees from `published_fee_catalog` and checks each one
  against the bank's own stored schedule. A fee is right only when the amount (`traceLiveFee`, the
  shared source check), the category (`checkFeeCategory`), the evidence (the bank's own document,
  not an article; a product-page fee only when the bank's schedule does not price the same fee
  differently, v4, James 2026-10-13: `productPageConflictSql`); and v4 keeps a name that carries its
  condition when Hamilton's rename pass leaves it whole on purpose, as in "Bill Pay Inactivity Fee
  (applies after 60 days of inactivity)" (`nameQuality`), the fee line ($0 rows must be priced lines) and the name all
  hold. A fee with no stored text is unknown, never right or wrong. Below
  `FRESH_AUDIT_MIN_SCORABLE` scorable fees there is no percentage. The audit itself only reads.
- This is an automated stored-copy support diagnostic. The launch accuracy measurement is the separate weekly live batch of 50 whole institutions (DECISIONS, 2026-10-19), covering every published fee plus missing tracked categories. The shared target value is 99.5%; this automated status cannot satisfy launch sign-off and creates no additional manual checks for James.
- The step's detail (counts per check, up to 50 misses, the seed and sample ids) is in its
  `step.finished` event. `goal-scorecard.ts` pools the last 7 days of audits into the scorecard's
  accuracy: right ÷ unique scorable fees in the newest scoring series, a 95% Wilson range, misses per check,
  and one dated row per audit. Each daily scoreboard snapshot stores this in `detail.goal.accuracy`,
  so the dated results outlive the run history.
- Confidence/history (#2071): [ACCURACY.md](ACCURACY.md) defines the 500/day request, 3,400 unique-scorable minimum and unrounded 95% lower-bound gate. Full per-fee receipts prevent retries or overlapping draws from inflating confidence; unknown versions stay legacy. Calendar-week history comes from existing daily snapshots, split at each reporting/audit/category/source/name version change. The admin scorecard and quality ledger distinguish this automated stored-copy diagnostic from independent live-source accuracy and missed-fee recall.
- Each new miss (not one a Hamilton second look already holds) is kept and routed
  (`audit-misses.ts`, #1119, approved by James 2026-10-12; migration 20270110000045):
  - a `fresh_audit` eval case, `case_key` `fresh_audit:<fee_published_id>:<check>`, label
    `deming_audit`, status `candidate`. An audit alone never confirms a label, so the case stays a
    candidate until a person or a take-down confirms it; the regression replay never reads it;
  - a `wrong` judgement of kind `audit_miss`, weight 0.5, reported by `deming`, for its owner:
    another bank's document, an unconfirmed host, an article or a product page to Magellan (stage
    discover); an unsupported amount or category, a perk read as a fee and a bad name to Knox
    (stage extract).
  The step's detail reports both counts (`audit_misses`), and either write that fails is reported
  there without stopping the audit.

## Did the change work (#1106)

- `change-outcomes.ts`: the `deming-change-outcomes` step, last in Atlas's daily scoreboard run.
- `sunday-maintenance.ts`: the `deming-sunday-maintenance` step, after it in the same run, Sundays (UTC) only: James's hour of tasks (labels, data decisions, last week's "no change" and "wrong way" PRs to explain or revert, answer-key banks), the week in numbers with the change hit rate, and anything stuck (#1104, #1106). It emails only while `SUNDAY_EMAIL_LIVE=true`; otherwise the run records the email it would send.
  Each PR that names a "Should move" number adds an entry to `should-move.json` (PR number, issue,
  `metric`: a `pipeline_scoreboard_snapshots` column or a `detail.` path such as
  `detail.goal.accuracy.accuracy`, `direction` up or down, optional `min_change`).
- The first day the step sees an entry it writes a `change_outcomes` row with that day's value.
  Seven days later it reads the first snapshot on or after that day and records the verdict:
  `moved_as_expected`, `no_change` (moved less than `min_change`), `wrong_way`, or `unreadable`
  (the scoreboard does not hold the number). The summary names each "no change" and "wrong way"
  PR, to be explained or reverted (the Sunday email, #1104, lists the ones checked in the last 7
  days, via `readChangeOutcomeReview`).
- Hit rate (#1106 step 4): the share of judged changes (`moved_as_expected`, `no_change`,
  `wrong_way`) that moved as expected; `unreadable` ones are counted apart. The daily step's
  summary and detail (`hit_rate`) and the Sunday email carry it; the checkpoint copies it.
- Migration 20270110000046 creates the table (approved by James 2026-10-12). Before it the step
  reports that it skipped.

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

## Knox's answer-key misses

- `knox-misses.ts` (`KNOX_MISSES_VERSION` v1): the `deming-knox-misses` step, its own daily Atlas
  run (`/api/admin/crew/knox-misses`, 12:29 UTC, after the scoreboard), #1099. For every confirmed
  answer-key bank whose key document has a completed text, it runs today's free Knox team
  (`gateReads`, the reads the rules re-check keeps live) and compares each priced key fee as the
  Knox gate scores it (`gateKeyFor`). A key fee not read becomes an `eval_cases` row: dataset
  `golden`, label `answer_key`, check `knox.answer_key_read`, error class `missed_fee`, status
  `candidate`, with the key's source line, category, price, document and text hash frozen in
  `input`. Every case is replayed each run: a candidate that is read becomes `active`; an active
  case missed again is a regression, named in the step summary; a case whose key fee is no longer
  confirmed is retired, and reopens if the fee is confirmed again (a candidate when missed, active
  when read). The gate's keys come from the gate itself (`gateKeyFor`, `gateReadKey`, used by
  `scoreAnswerKeys` too), so the replay and the Knox gate cannot drift.
- The step detail carries the miss rate by category and by document type. A bank with no completed
  text of its key document is counted apart (`banks_no_text`), never as Knox's miss; a price that
  varies is not scored, as in the gate.
- A run that passes `KNOX_MISSES_BUDGET_MS` leaves the remaining banks for the next day: the banks
  it did not reach (`banks_left_ids` in its detail) go first, then the rest by their oldest case
  check, a bank with no case counting as checked at the previous run. A case the gate no longer
  scores is still replayed (`not_scored`), so its check time moves. It writes only `eval_cases`; no fee row, no model calls; pause-exempt.

## Playbook contradiction check

- `playbook-contradictions.ts` (`PLAYBOOK_CHECK_VERSION` v1): the `deming-playbook-check` step in
  Atlas's daily scoreboard run (#1105). One read-only SELECT over `institution_source_profiles`
  and each one's current text. Per institution it counts a playbook that contradicts itself: the
  current source on its own rejected list, on its own do-not-retry list for a fetch failure, or
  judged the wrong document by a discovery strategy; a fee schedule expected to hold fewer than
  `THIN_DOCUMENT_MAX_FEES` fees; a product page expected to hold `PAID_MIN_PRICED_LINES` or more.
  It lists up to 20 institutions per contradiction in the step detail.
- Not contradictions: the second-document finder and its site searches record the bank's current
  link as the input they searched *from* (`SEARCH_FROM_STRATEGIES`), so their `wrong_document` /
  `no_candidates` entry means "found nothing better". They are reported as
  `search_from_entries`, as is `layout_never_recorded` (no stage writes a layout fingerprint yet).
- Read-only, deterministic, no model calls, pause-exempt. It changes no row.

## Daily data-quality checks

- `data-quality.ts` (`DATA_QUALITY_VERSION` v1): the `deming-data-quality` step in Atlas's daily
  scoreboard run, before `scoreboard-snapshot` (#1065). It runs the SQL checks of the
  `data-quality-audit` and `audit-data` skills every day; the skills point here instead of
  describing a manual run. The sampled source trace those skills ask for is the fresh audit above.
- Over the live dollar fees (`published_fee_catalog`) and, apart, the live rate fees
  (`published_fee_rate_catalog`), never pooled: duplicates (rows beyond the first for one
  institution, category and amount or rate), stale fees (document last fetched or checked over
  `STALE_AFTER_DAYS` 90 days ago, the scoreboard's freshness clock), fees with no category (a
  category outside the 50-type taxonomy counted beside it), fees with no source link (no stored
  document counted beside it), and each category's share of live institutions against its median
  over the previous `SHARE_BASELINE_CHECKS` (7) checks.
- Link mismatch (#1347), counted, not graded: live fees whose link opens another page than their
  stored document's URL. Two links to one page are not a mismatch: scheme, "www.", case, a default
  port (":443"), "%20" for a space, a trailing slash, a fragment and print or tracking parameters
  ("?print=1", "&output=amp", "utm_*") are set aside (`documentLinkKey` in `src/lib/document-link-key.ts`,
  Postgres twin `documentLinkKeySql`) and counted apart as `url_variants`. A link to the page the
  document's stored text was read from (`agent_source_texts.source_url`: a schedule PDF the landing
  page links to, or a redirect's target) is the fee's real source, counted apart as `read_page`. On
  Oct 17 (read-only, #1744's reading: 3,507 differed as written, 2,086 a real mismatch), a later
  read found 3,511 written differently; with the port and "%20" rule, 2,009 are URL variants, 1,453 read pages and 49 a real mismatch (all 49 imported
  fees whose raw row was moved to another document; Hamilton's link drift pass re-points them).
- Thresholds are the skills' own (PASS / WARN / FAIL): duplicates 1% / 3%, no category 3% / 8%,
  stale 15% / 30%; no source link takes the duplicate thresholds (the skills give none). A
  category share is out of line below 70% (`COLLAPSE_KEEPS_BELOW`) or above 150% of normal, for
  categories with at least 10 institutions before; a fall fails, a rise only warns (coverage
  growth or a fold rule landing, #1579). A catalog under 100 live fees is counted, not
  graded. **Alarm:** each check at FAIL is named in the step summary as an ALARM.
- Each number names its query (`DATA_QUALITY_QUERIES`, `deming.dq_*`). The scorecard reads the
  latest check (`goal.deming_data_quality_latest`) into `detail.goal.dataQuality`: the "Data
  checks failing" card on /admin/scoreboard and a line in the morning brief.
- Read-only, deterministic, no model calls, pause-exempt. Up to 20 fee ids per check in the detail.

## Public-data source health (#1866)

- `deming-source-health`: a step in Atlas's daily scoreboard run, after `deming-data-quality`. It
  records Hoovie's source health report (`src/lib/agents/hoovie/source-health.ts`): one status per
  public-data source (fresh, stale, empty, failed or skipped), its reason and its last success.
  The summary names failed and empty sources as an ALARM. The morning brief reads the same report
  live and lists the sources that are not fresh.
- Read-only, deterministic, no model calls, pause-exempt: one SELECT over
  `registry_ingest_partitions` and one over Atlas's newest table sizes.

## Boundaries

- Deming never writes fee rows, flags or takedowns. It reads `pipeline_feedback` and the fee tiers.
- A label comes from `takedown_confirmed`, a human, or the answer key; never from a model alone.
- Holdout cases must never feed a rule or a prompt (PRD 7.3).

## Current versions

The version each rules or reader constant is at now. `scripts/ci-guards.sh guide-version-kill`
fails a PR that changes one of these constants without updating its line here (#1109).

| Constant | Strategy | Version | File |
|---|---|---|---|
| `ACCURACY_REPORTING_VERSION` | — | v1 | `deming/accuracy-measure.ts` |
| `FRESH_AUDIT_VERSION` | — | v5 | `deming/fresh-audit.ts` |
| `DEMING_REGRESSION_VERSION` | — | v1 | `deming/regression.ts` |
| `BENCHMARK_HEALTH_VERSION` | — | v1 | `deming/benchmark-health.ts` |
| `PLAYBOOK_CHECK_VERSION` | — | v1 | `deming/playbook-contradictions.ts` |
| `DATA_QUALITY_VERSION` | — | v1 | `deming/data-quality.ts` |
| `KNOX_MISSES_VERSION` | — | v1 | `deming/knox-misses.ts` |
