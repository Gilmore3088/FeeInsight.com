# Deming Guide

Deming is the quality and evaluation tooling of the Agentic OS PRD (section 7). It keeps the
pipeline's confirmed mistakes as test cases and checks that the deployed rules still catch them.
It runs as Atlas steps (agent `atlas`); it is deterministic and makes no model calls.

## Answer-key reference boundary (2026-10-19, #1862)

`score-answer-key` observes at most six official-path documents per due key through the pinned
fee-source transport (8 seconds/request, 120 seconds total, three workers), then records dedicated
`answer_key.eligibility` events under the real score run/step. Every score/training/replay/cache
consumer uses one shared durable snapshot, never request-time bank fetches. Exact document,
confirmed-fee and source inventory identities are checked again atomically before persistence.
Unknown/missing/stale/malformed/persist-failed references are excluded; no older eligible fallback.

Scorer v3 matching is unchanged. Protocol/cohort identities separate measurement history from
reference edits, and all-excluded runs explicitly record no measurement. Historical unbound cases
are retained, excluded and counted; they are not relabelled `key_fee_removed`. Only actually removed
confirmed key fees retire cases. Frozen tuning/holdout provenance is a separate dataset, with no
runtime judgment when its original document identity cannot be established. See
[reference eligibility](REFERENCE-ELIGIBILITY.md); no additional James checks or confirmations.

## Live-source diagnostic (#2061)

`live-source-audit.ts` adds a separate, versioned diagnostic of an immutable daily sample against
fresh official-path evidence. The queue-only daily route freezes the frame after its existing
measurement/snapshot steps. Non-exempt finite tick work observes, records unknowns and positive
contradictions, consumes exact-document Magellan side-copy requests, and archives late completion
into the original dated snapshot. It changes no answer key or fee and cannot certify missing-fee
recall or launch accuracy. See [LIVE-SOURCE-AUDIT.md](LIVE-SOURCE-AUDIT.md). James's weekly 50 whole
institutions remains the only human launch workflow.

## What it owns

- `eval_cases` (migration `20270110000036`): one labeled example per row, in five datasets
  (`golden`, `adversarial`, `regression`, `holdout`, `fresh_audit`). Today only `regression` is
  written. A case's `input` is frozen at insert and never rewritten; cases are never deleted.
- `severity.ts`: the critical / major / minor / info scale. An unknown check is `major`.
- `checkers.ts`: pure offline checkers. Runtime generic replay admits `hamilton.limit_guard`;
  a legacy `source_check` body remains historical and unavailable. The prospective source-bound
  corrective protocol below has its own paired replay; other error families are not counted as
  evaluated merely because a checker name exists.
- `regression.ts`: the `deming-regression` step in Atlas's daily scoreboard run
  (`/api/admin/crew/scoreboard`). It enrolls supported limit takedowns and eligible prospective
  human corrective contexts, retains unbound source takedowns as availability-only diagnostics,
  retires a limit case whose fee was restored, and reports an active evaluated rule failure as a
  regression. Historical source cases are preserved without supplying replay denominators.
  Each corrective read runs under a 2 s statement cap; admission and replay listings check stored
  bodies 50 corrections per statement, in listing order. A failed or timed-out phase leaves its rows
  unknown and writes one `step.warning` run event per phase (`corrective.warnings` in the detail).
- `__fixtures__/regression-cases.json` + `regression-gate.test.ts`: the CI gate. Every case must
  still be caught with its expected reason. Refresh it from `eval_cases where status = 'active'`
  and `input->>'kind' = 'limit_guard'`. New corrective replay writes bounded run-generated ledger
  artifacts; the production-artifact-to-repository/CI import handoff remains unimplemented.
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

## Monthly agent review (#1107)

- `monthly-review.ts` (`MONTHLY_REVIEW_VERSION` v1): the `deming-monthly-review` step in Atlas's
  daily scoreboard run, before `deming-sunday-maintenance`. It runs on the 1st of the month (UTC)
  only, the same gate as the Sunday email. Each of the four agents reviewed on 2026-10-12
  (Magellan, Rosetta, Knox, Hamilton the publisher; `docs/plans/*-review-2026-10-12.md`) has a
  list of named read-only SQL measures, each with a direction (higher or lower is better) and a
  move limit. A baseline is the review's own figure, or null where the review states none.
- Each measure runs in its own savepoint with a 30-second statement timeout; a failed or timed-out
  read is stored as unknown (null with its error), never 0. A measure starts only while it can
  finish inside the step's 110-second budget at that timeout; the rest are unknown for the month.
- The answer-key measures read the newest score through `getLatestAnswerKeyScoreRun`: a run on
  another reference cohort is unknown, never a score. Each reading carries its basis (scorer
  version and cohort), and a month or baseline on a different basis is shown but never compared
  or alarmed against. The 2026-10-12 answer-key figures were scored at v1, so they never alarm.
- A measure that moves the wrong way past its limit since last month (or, with no last month, since
  the 2026-10-12 figure) is an ALARM in the step summary, on /admin/agents/health and in the next
  Sunday email. The app has no GitHub access: an alarm is added to that agent's tracker by hand.
- The step detail (`review`) is the history: last month is read back from the newest earlier
  ledger row. Read-only, deterministic, no model calls, pause-exempt.

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
| `FRESH_AUDIT_VERSION` | — | v7 | `deming/fresh-audit.ts` |
| `DEMING_REGRESSION_VERSION` | — | v1 | `deming/regression.ts` |
| `BENCHMARK_HEALTH_VERSION` | — | v1 | `deming/benchmark-health.ts` |
| `PLAYBOOK_CHECK_VERSION` | — | v1 | `deming/playbook-contradictions.ts` |
| `DATA_QUALITY_VERSION` | — | v1 | `deming/data-quality.ts` |
| `KNOX_MISSES_VERSION` | — | v1 | `deming/knox-misses.ts` |
| `MONTHLY_REVIEW_VERSION` | — | v1 | `deming/monthly-review.ts` |

### Prospective corrective source contexts (#2064, protocol 2)

A new authorized admin price/name correction may seal one complete named, checked normalization
in its initial uncommitted `published_fee_corrections.source_check.deming_source_v2`. The observer
uses a real savepoint: a learning snapshot failure leaves the already-authorized fee action intact.
No committed correction or historical case is retrofitted. The receipt records the actual canonical
fields and run/step/event/human-feedback origin, not a caller's actor/validation flag. The original
extraction binding stays unknown; a later validated edition is a corrective/publication context,
never a proved original Knox miss. The source hash in the generic original-input column stays NULL.

The consumed corrective loader admits metadata before LIMIT 300, including live original origins
at first enrollment. Exactly one full document, <=200000 codepoints/800000 UTF8 bytes, <=8192-byte
metadata and <=1MiB encoded case are supported. Invalid metadata does not occupy the batch. Only
an ordered whole-case prefix within each 8MiB payload/write/replay budget is loaded, without clipping
or substituting smaller later cases. SQL statements retain 2s/100ms statement/lock limits; these
bounds are not an O(1), absolute CPU or minimum-drain-latency guarantee. Read failure is unknown.

Enrolled replay pins the actual canonical immutable receipt and semantic fields. Routine old-event
trimming, step removal and the correction run FK becoming NULL do not erase that authority; missing
or altered canonical evidence remains unavailable. Legacy generic source cases are unchanged history,
excluded before the trusted replay ceiling. Unbound temporal source takedowns consume no new key.
Golden/limit producers keep their own policy. The paired checker must refuse the old value AND accept
the corrected positive; both accepted or corrected refused are not catches. This measures expected
rule behavior against the human corrective context, not independent accuracy or complete applicability.
Unknown original/product context is not silently declared general or original-extraction evidence.

Actual replay inputs/outcomes can produce bounded `deming.fixture.v2` ledger chunks (<=2MiB including
event envelope, <=8MiB total). Optional chunk failure rolls back the artifact, not the correction;
a later run can regenerate it. Saved counts distinguish unavailable, deferred and historical totals.
**Production-artifact-to-CI import is not implemented.** All-error coverage/routing, other label-authority
policies, generic multi-document/original-input snapshots and historical case repair remain separate
open #2064 obligations. No new queue, source/provider request, switch, replay or human task is added.

The selected corrective edition also freezes `agent_source_texts.source_hash` and requires its
nonempty equality to the named document's `content_hash`, checked again in the final seal and
initial enrollment. This is an internal stored edition association, not independent PDF-byte
verification or original-extraction binding. Missing, null, mismatched or changed association
leaves optional learning unavailable while preserving the authorized correction.
