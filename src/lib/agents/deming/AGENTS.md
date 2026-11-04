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

## Fixed answer-key cohort (2026-11-02)

`fixed-cohort.ts` scores the 62 confirmed answer keys frozen on Nov 2 (`FIXED_COHORT_ID`, by id and
a fingerprint of each key's scored fees) every day in `score-answer-key`, whatever the eligibility
check says that day. Live dollar and rate fees at each institution are compared with the key by
scorer v3's `predictionMatches`: precision over live predictions, recall over key fees. An
institution it cannot score (key changed or removed, read failed) is counted as unscored with its
reason, never dropped. The score is one `deming.fixed_cohort_accuracy` event, the step's
`fixed_cohort` detail and `goal.fixedCohort` in each daily snapshot (`fixed-cohort-history.ts`).
A new cohort is a new id on James's word, never an edit. See
[the finding](../../../../docs/project/findings/2026-11-02-fixed-answer-key-cohort.md).

## Live-source diagnostic (#2061)

`live-source-audit.ts` adds a separate diagnostic of an immutable daily sample of 500 live dollar
fees. Each fee is checked against a fresh copy of the bank page it was read from. The queue-only
daily route freezes the frame after its existing measurement/snapshot steps. Non-exempt finite tick
work fetches the pages and gives each fee a verdict with `checkFeeAgainstSource`: supported,
mismatch (a price contradiction, or a category-guard refusal counted apart), or not found on the
page. A fee is unknown when its page did not load, when a plain fetch returned a script shell far
thinner than the stored copy, or when its price's witness is restricted, and the reason is recorded. A fee the page did not support, served from changed bytes, asks Magellan to
copy the page so the pipeline reads it again. Late completion is archived into the original dated
snapshot, and the live score (supported over every fee whose page loaded) is shown in the
accuracy history by draw. Checker versions are recorded on each verdict, not in the draw's
identity, so a deploy does not restart the draw (2026-11-02). The diagnostic changes no answer key
or fee and cannot certify missing-fee recall or launch accuracy. See [LIVE-SOURCE-AUDIT.md](LIVE-SOURCE-AUDIT.md). James's weekly 50 whole
institutions remains the only human launch workflow.

## What it owns

- `eval_cases` (migration `20270110000036`): one labeled example per row, in five datasets
  (`golden`, `adversarial`, `regression`, `holdout`, `fresh_audit`). Today only `regression` is
  written. A case's `input` is frozen at insert and never rewritten; cases are never deleted.
- `severity.ts`: the critical / major / minor / info scale. An unknown check is `major`.
- `checkers.ts`: pure offline checkers. Runtime generic replay admits `hamilton.limit_guard` and
  `hamilton.category_guard` (#2064); a takedown frozen as `unreplayable` before its check had a
  replayer replays by its check name from the fee's frozen category, name, amount and conditions,
  without the schedule's NSF price, so a catch that needed it stays a candidate.
  `hamilton.business_schedule` takedowns (a business fee shown as a consumer one) replay as
  `audience` cases against today's audience rules in the pipeline's order: Darwin's decision from
  the fee's name, its document's address and the document's newest completed text, then, for a fee
  Darwin leaves unknown, Hamilton's business-schedule read (`readsAsBusinessSchedule`, or a
  business-only footnote on the fee's line). A Darwin read of consumer or both is a let-through; a
  case with no stored text is not judged. A business-schedule restore never retires its case.
  Wrong-document takedowns (`hamilton.product_page`, `hamilton.article_page`,
  `darwin.non_deposit_document`) replay today's rule on the case's document's address (the
  non-deposit rule also on the opening of its stored text); `hamilton.same_line_duplicate`
  takedowns replay on whether the line they repeat (or its replacement) is still on the catalog: a
  copy live beside it is a regression, a copy whose line is gone waits as a candidate (#2064).
  Another bank's document (`darwin.document_owner`, `hamilton.unconfirmed_document_host`) has no
  pure rule and stays candidate. Missed fees replay in `knox-misses.ts`, not here. A legacy
  `source_check` body remains historical and unavailable. The prospective source-bound
  corrective protocol below has its own paired replay; other error families are not counted as
  evaluated merely because a checker name exists.
- `regression.ts`: the `deming-regression` step in Atlas's daily scoreboard run
  (`/api/admin/crew/scoreboard`). It enrolls supported limit takedowns and eligible prospective
  human corrective contexts, retains unbound source takedowns as availability-only diagnostics,
  retires a limit case whose fee was restored while the guard still catches it, and reports an
  active evaluated rule failure as a regression. Every fee-fields case, the limit guard's own
  included, reads its fee as live only in the category it was taken down from; an active case live
  again while its rule passes it is a regression that names the check whose restore put it back
  (`restoredBy`). A case retires as accepted only through a reviewed `ACCEPTED_TAKEDOWNS` entry
  tied to its check's version (#2064). Historical source cases are preserved without supplying replay denominators.
  Each corrective read runs under a 2 s statement cap; admission and replay listings check stored
  bodies 50 corrections per statement, in listing order. A failed or timed-out phase leaves its rows
  unknown and writes one `step.warning` run event per phase (`corrective.warnings` in the detail).
- `__fixtures__/regression-cases.json` + `regression-gate.test.ts`: the CI gate. Every case must
  still be caught with its expected reason. It holds limit-guard and category-guard cases
  (`regression-fixture.ts`). The daily step reports its drift from today's active cases
  (`ci_fixture` in the step detail); rebuild it from the read-only `REGRESSION_FIXTURE_SQL` with
  `REGRESSION_FIXTURE_ROWS=<file> npx vitest run src/lib/agents/deming/regression-fixture.test.ts`. New corrective replay writes bounded run-generated ledger
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

## Error classes (#2063)

- `error-classes.ts`: the `deming-error-classes` step in Atlas's daily scoreboard run, after the
  error loop. It groups the last 7 days of confirmed errors (a `wrong` or `missed` row with weight
  about a fee that went live, or recorded by a person; Deming's own audit misses count) by stage,
  kind and pattern: the fee category for a fee-level row, the reader and document type for a read
  error, else the document kind. A pattern at two or more banks is a class, owned by the agent that
  runs its stage; rows with no pattern are counted, never a class. Each class keeps one weight-0
  `error_class` ledger row, opened the first day it is seen and updated with each later day's
  counts, date, examples and a GitHub-ready title and body. The morning brief lists the largest classes, so the data lane works classes, not fees.
- Name families (#2063): fee-level rows (extract, verify, publish) also group by the family of the
  fee's name, the category Knox's name rules file it under (`classifyPatternKey`, `name:<key>`),
  else Knox's lesson family of two words or more (`lessonFamily`, `name_words:<words>`). "Wire
  Transfer - Outgoing Domestic" and "Outgoing domestic wire" are one class whatever category each
  bank's fee was filed under. A family that only restates one category's class is skipped; the
  others carry the categories they span. They are a second view of the same rows and never change
  the confirmed counts; the step's detail shows `name_family_classes` and `name_rows_read`.
- Live wrong amounts at extract (#2067; `amount-patterns.ts`) group by the text layout around the
  fee, not its category: price-first rows paired with the wrong row, an opening deposit read as the
  fee, a cap or minimum, a figure in the name, a footnote glued to a $0 price, a price from the
  next line, several columns. Each row is re-checked with today's shared `checkFeeAgainstSource`
  (a `tiered_fee` verdict traces, as in Knox's self-check): a class it refuses no longer traces
  wherever the check runs; a class it still passes (`passes_today`) is the next extraction rule to
  write, with its Darwin dry-run count. Every row is judged at the read it flagged, not the live
  row a later hand correction rewrote in place: a hand amount correction's row at its `old_amount`
  and `old_name`, any other row at the `amount` and `evidence.fee_name` its writer stored when it
  filed (`COALESCE(old_amount, f.amount, fp.amount)`).

## Weekly live-check gaps (#2066)

- `scripts/live-batch-gaps.mjs` (read-only audit) traces every miss of James's weekly live check to
  the step that caused it and tags it: caught and routed to that step's agent (an error row on the
  fee that the agent reads, per `learning/feedback-kinds.ts`), caught but not routed, not caught (a
  gap; every missing fee is one), or unresolved. It prints one read-only SELECT for the production
  SQL tool, then tags the results file from its output. The gap count goes beside accuracy on the
  weekly scorecard; a miss whose class has no planted case gets one. 2026-W43: 445 of 532 misses
  not caught, 56 caught but not routed, 11 routed, 20 unresolved.
- A miss is routed only when the owning agent's reader of that row's own stage and check reads it
  (`feedbackRowReaders`, the registry's `readerScopes`), not when any reader of the kind sits in the
  agent's folder. Re-tagged that way, W43 reads 10 routed and 57 caught but not routed.
- The classes W43 found with no catch are planted (`planted-errors.ts`): hourly shown flat (caught
  by Darwin's hourly re-check, read by no Knox file), an annual rent, a price ladder, a name read
  across two columns, and a wrong category the guard passes. Each is a listed gap until a check
  closes it.

## Planted error loop (#2065)

- `planted-errors.ts` and its test plant one of each error class the 2026-10-19 learning audit
  named (wrong document, lost text, a limit read as a fee, the wrong category, the wrong audience,
  a duplicate, a missed fee) and walk each through the loop with the real code: detected by the
  check that runs on live fees, recorded at the stage that caused it, read by a registered reader
  file of the owning agent that names the rows, re-run through the owning step, and judged fixed
  by the daily re-check. A link the loop lacks is listed in `KNOWN_GAPS` with the issue that owns
  it; CI fails on an unlisted broken link and on a listed gap that now holds. Each new error class
  gets a planted case. Pure, no database.

## Did the change work (#1106)

- `change-outcomes.ts`: the `deming-change-outcomes` step, last in Atlas's daily scoreboard run.
- `error-fixes.ts`: the error loop (#2058). A process-fix PR names the error rows it fixes in
  `error-fixes.json` (stage, merge day, for an extract fix the Knox rules version that carries the
  fix, and `pipeline_feedback` kinds, checks or ids). Each stage is re-run by its own step
  (`error-fix-targets.ts`, a light module the fixed steps import): a read fix makes Rosetta's read
  step reopen each named document (`read.reopen` attempt naming the fix, once per fix and bytes),
  an extract fix waits for Knox's read at the fixed rules version, a verify fix puts each named live
  fee in Darwin's verified recheck (`ERROR_FIX_RECHECK_LIMIT` a step, its `verify.recheck` attempt
  carries `error_fix_pr`), and a publish fix waits for a direct run's publish step for the bank.
  Every re-run but extract's must come on or after the merge day. Only rows raised by a check the
  fresh audit re-runs (`ERROR_FIX_CHECKS`) are named, so a fee still carrying the error fails that
  same check, plus, for a verify fix, `darwin.verified_recheck`, judged by the recheck's own verdict
  (`STAGE_RERUN_CHECKS`; a still-live named fee with no verdict yet stays unknown). Each judged fee
  must also pass `checkFeeAgainstSource` on its own document, which the fresh audit skips when it
  relinks a fee. Atlas's direct path re-runs each named row's active bank once, as a request dated
  the merge day (a verify fix asks only when the named fee is down); the
  `deming-error-fix-recheck` step, after the change check, judges each row whose bank a completed
  run has re-run through the fixed step and writes a weight-0 ledger row:
  `error_fix_closed` (the fee now matches) or `error_fix_still_wrong` (once; it is judged again
  daily). The re-run must have extracted the error's own document when the row names one. Once the
  named fee is down (a takedown names a fee already down), only a live fee in its category that the
  re-run extracted after the error, from that document, is judged: a fee live all along proves
  nothing, and a fee taken down with nothing extracted in its place is `not_reproduced`, open, never
  closed. A row with no stored text, a named fee still live as a rate, or one with no category
  stays open. Atlas's fix request ends only on an extract at the entry's Knox version
  (`minExtractVersion`). A completed run is not proof its output went live (verify or publish may
  have stopped at a limit); the re-check judges the live catalog, so such a row stays open.
- `answer-key-rekey.ts`: the `deming-answer-key-rekey` provider step (James, 2026-11-01). It reads
  each confirmed answer-key bank's current stored document twice, with different models and
  differently framed instructions, and reconciles the reads in code. A fee is agreed only when both
  reads give the same type, kind and amount and each quoted line is in the document. It records
  agreed fees, one-read-only fees, unproven fees and the comparison with the old key as one
  `answer_key_rekey.bank_done` event per bank. Batch 2026-11-01 is a dry run: $15 cap (its own
  `agent:answer_key_rekey` line, billed to Knox's key), no key writes. The tick queues one run at a time
  (`answer-key-rekey-schedule.ts`) until every bank is read or the cap is reached.
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
  `scoreAnswerKeys` too), so the replay and the Knox gate cannot drift. A key under a retired
  category the fold gives no home is `not_scored` (`gateKeyExclusion`): Darwin always refuses it.
- The step detail carries the miss rate by category and by document type. A bank with no completed
  text of its key document is counted apart (`banks_no_text`), never as Knox's miss; a price that
  varies is not scored, as in the gate.
- A run that passes `KNOX_MISSES_BUDGET_MS` leaves the remaining banks for the next day: the banks
  it did not reach (`banks_left_ids` in its detail) go first, then the rest by their oldest case
  check, a bank with no case counting as checked at the previous run. A case the gate no longer
  scores is still replayed (`not_scored`), so its check time moves. It writes only `eval_cases`; no fee row, no model calls; pause-exempt.

## Playbook contradiction check

- `playbook-contradictions.ts` (`PLAYBOOK_CHECK_VERSION` v2): the `deming-playbook-check` step in
  Atlas's daily scoreboard run (#1105). One read-only SELECT over `institution_source_profiles`
  and each one's current text. Per institution it counts a playbook that contradicts itself: the
  current source on its own rejected list, on its own do-not-retry list for a fetch failure, or
  judged the wrong document by a discovery strategy; a fee schedule expected to hold fewer than
  `THIN_DOCUMENT_MAX_FEES` fees; a product page expected to hold `PAID_MIN_PRICED_LINES` or more.
  It lists up to 20 institutions per contradiction in the step detail. v2 (#1105): the rejected
  list holds `{ url, reason, at }` objects, so the check matches their `url`
  (`onRejectedListSql` in `learning/rejected-sources.ts`); v1 tested for a bare string and counted
  0 every day while 26 profiles had one (Oct 26).
- Not contradictions: the second-document finder and its site searches record the bank's current
  link as the input they searched *from* (`SEARCH_FROM_STRATEGIES`), so their `wrong_document` /
  `no_candidates` entry means "found nothing better". They are reported as
  `search_from_entries`, as is `layout_never_recorded` (Knox's free rules read writes the layout
  fingerprint since #1105, so the pile drains as texts are read again).
- Read-only, deterministic, no model calls, pause-exempt. It changes no row.

## Daily data-quality checks

- `data-quality.ts` (`DATA_QUALITY_VERSION` v1): the `deming-data-quality` step in Atlas's daily
  scoreboard run, before `scoreboard-snapshot` (#1065). It runs the SQL checks of the
  `data-quality-audit` and `audit-data` skills every day; the skills point here instead of
  describing a manual run. The sampled source trace those skills ask for is the fresh audit above.
- Over the live dollar fees (`published_fee_catalog`) and, apart, the live rate fees
  (`published_fee_rate_catalog`), never pooled: duplicates (rows beyond the first for one fee
  line, the identity Hamilton's duplicate collapse closes: institution, category, variant, product,
  audience, amount kind, amount or rate with caps and basis, name with case and outer spaces
  ignored, counted only when the stated frequency classes agree; the step detail says so as
  `duplicates_identity: "fee_line"`, and change outcomes never compare a data-quality number
  across identities; rows that only share institution, category and amount are counted apart as
  `same_amount`, not graded, since two products or services at one price are not a duplicate,
  2026-10-20), stale fees (document last fetched or checked over
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
- `deming-filings-reconcile` (#1925, Hamilton V5 T3; `filings-reconcile.ts`,
  `FILINGS_RECONCILE_VERSION` v3): a step in the same run, after `deming-source-health`. It compares
  the figures the institution page and Hamilton show (`institution_financial_records`) with the
  stored filing lines (`institution_call_report_items`) over the newest 12 quarter ends, for 150
  banks and 150 credit unions drawn each day by md5(id || date): bank assets, deposits, service
  charges and revenue (year to date made a quarter); credit-union fee, overdraft and NSF income,
  year to date. A pair matches within $1K or 0.05%. Explained differences are counted apart: a
  quarter in which the bank absorbed another (FDIC history 810, #2025), a negative differenced
  quarter, and deposits of a foreign-office filer. Assets more than 10% apart mark an identity
  suspect. The summary names unexplained differences as an ALARM; the detail lists up to 25
  mismatches and the shown figures with no stored filing line (`NOT_COVERED`).
  v2: a bank quarter whose assets or year to date disagree is a `filing_version_skew` (the feeds
  hold different versions of a refiled report). It names which feed is newer from the FFIEC POR
  last-updated time (item `filing_last_updated`) against the BankFind row's `fetched_at`
  (`ffiec_newer`, `bankfind_fetched_after_refiling` or `unknown`) and is explained only while FFIEC
  is newer by under 14 days. A quarter whose year to date agrees but whose prior quarter differs is
  a `prior_quarter_knock_on`, explained only when that prior quarter is reported. A negative
  differenced line is not explained when the prior quarter differs between the feeds.
  v3 (#2625): a structure-history 713 (offices acquired in a merger) and 510 (main office change)
  on one date also mark a merger quarter, as when a bank merges into a different, smaller charter.
- Read-only, deterministic, no model calls, pause-exempt: five indexed SELECTs per charter under
  a 20 s statement timeout; a failed read is reported as an error, never as a clean result.

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

## Shadow lab

`npm run test:shadow-lab` replays frozen source texts from committed fixtures through today's pure
stages: the document gate, Knox's free read, Darwin's per-row verify checks and Hamilton's publish
gate. It also replays one experiment (`SHADOW_LAB_EXPERIMENT`, default `excerpt-at-publish`; see
`EXPERIMENTS` in `shadow-lab/variants.ts`) on the same inputs. It writes
`test-results/shadow-lab/comparison.json` and `report.md`. Each failed expectation is charged to the
first stage that got it wrong.
- A miss at Knox's read is charged by evidence on the key's own line (`isKeyLine` in
  `shadow-lab/metrics.ts`: the same words in the same order, prices and layout aside):
  `held_unclassified` (the line held with no category), `read_other_category` (the line filed under
  another category), then `read_other_amount`, `other_line_same_price` and `not_read`. A key with no
  stored line is matched on price alone.
- Answer-key fees today's pipeline cannot find (a retired category the fold as it stands gives no
  home, `gateKeyExclusion`) leave recall and are listed by case in the report, never dropped
  silently. A listed key the fold should place is a fold defect (#1092), not a fee with no home.
- It runs offline: the replay stops if `DATABASE_URL` or `E2E_DATABASE_URL` is set, and every
  `ai-provider` call is refused and counted.
- It measures and never gates. CI's unit shards run only its fast tests, and no rate has a
  threshold.
- No production path changes on its evidence alone: switching an experiment on is its own PR, with
  Darwin's live re-check and a dry-run count.
- `shadow-lab/frozen-inputs.json` pins each case's input hash, and a changed input is left out as
  corrupt. After a deliberate fixture change, refreeze with
  `SHADOW_LAB_FREEZE=1 npm run test:shadow-lab`.
- To add a scenario, map a committed fixture to cases in `shadow-lab/scenarios.ts`. Never invent
  text: a failure with no committed source text goes in `NOT_REPLAYABLE`.
- The ratchet gate (`shadow-lab/ratchet-gate.test.ts`, in `npm run test:quality-gates`) is the
  one part that blocks. Today's pipeline must still meet every expectation in
  `shadow-lab/ratchet-baseline.json`. A change that meets more must lock the gain in with
  `SHADOW_LAB_REBASE=1 npx vitest run src/lib/agents/deming/shadow-lab/ratchet-gate.test.ts` in the
  same PR. Losing one on purpose takes the same refresh and a reason in the PR (DECISIONS,
  2026-10-21).
- The `live_audit` cases replay a weekly live accuracy audit (#2064; W43 in
  `__fixtures__/live-audit-2026-w43.json`, mapped in `shadow-lab/live-audit.ts`). One case is one
  saved source text the audit names. Each audit row adds expectations by its verdict:
  - MATCH: publish at the live category and price, under a name that matches the live name.
  - BAD_NAME: publish at the live category and price, under the corrected name. A correction that
    is an instruction ("Name the account") gives no name.
  - MISSING: publish at the corrected (or audited) category and the schedule's one dollar figure.
  - WRONG_AMOUNT: forbid the live price and expect the schedule's one figure. When the schedule
    states the live price, forbid it only without its hourly or half-hour unit. Otherwise the row
    is a tier or condition error the lab does not score.
  - WRONG_CATEGORY and NOT_A_FEE: forbid the live category and price, and expect a canonical
    correction.
  - A category and price another matched row confirms in the same schedule is never forbidden.
    STALE_SOURCE, WRONG_DOCUMENT, WRONG_AUDIENCE and CANT_VERIFY rows, rows with no saved text,
    rates and multi-figure amounts are counted under "Not replayable" by verdict and reason.
  "Names: published fees whose name matches the schedule" scores the publish-time name
  (`shadow-lab/names.ts`): at least half the expected name's own words, and no leading cut or
  condition fragment.
- To add the next weekly audit: derive a new `__fixtures__/live-audit-<year>-w<week>.json` from
  the audit CSV by hand, in the same shape: `about` with source, date and per-verdict counts;
  `documents` with each saved source text; `rows` without notes or local paths. Commit only the
  JSON, never a script in `scripts/`. Point `live-audit.ts` at it (or read both), refreeze, and
  lock the gains in with `SHADOW_LAB_REBASE=1`. Check that the baseline diff only adds lines.
- The `missed_fees` cases read holdout answer keys. Use them to see which stage loses fees. Write
  and test a rule against tuning keys or new fixtures, never against holdout text.

## Full-pipeline reconciliation (James, 2026-11-03)

`deming/reconcile/` re-runs today's pipeline over a batch of banks and compares it, fee by fee, with
what is live, so whole pipeline steps get fixed instead of single fees.

- **Shadow run.** Each bank's current documents (the newest stored text of every page no newer copy
  supersedes) go through the shadow lab's `currentVariant` in memory: Knox's free read, Darwin's
  verify checks, Hamilton's publish gate, then Darwin's prospective audience (`darwinAudience`).
  Knox's learned lessons, Darwin's peer check and Rosetta's conversion are not replayed: the stored
  text is read as it is. Nothing is written to a fee tier.
- **Diff.** Live (`published_fee_catalog`, dollar fees) against shadow: `same`, `amount_changed`,
  `category_changed`, `audience_changed`, `new_in_shadow`, `missing_in_shadow` (`diff.ts diffBank`).
- **Reconciliation rule** (`decide`), checked against the bank's own document: the answer key where
  the bank has one; then the shared check (`checkFeeAgainstSource`) on a current document; then the
  publish category guard; otherwise a tie sent to review. Never "the newer read wins".
- **Root cause** (`chargeCause`): each difference is charged to the step whose output is wrong on
  the losing side (stale copy: Magellan; no text: Rosetta; old or today's misread: Knox; refused at
  verify or audience: Darwin; gated at publish: Hamilton).
- **Grade** (`grade.ts`): live and shadow on the same banks with the daily review's measures:
  precision and recall against confirmed answer keys (also on the banks eligible today), unknown
  audience share, the share that loses its reconciliation (wrong after publish) and the share the
  shared check finds on a current document.
- **Runs.** `scheduleReconcileRun` (tick) queues one `deming-reconcile` run at a time while
  `RECONCILE_BATCH_ID` has banks left; each step takes up to 12 banks and records one
  `deming.reconcile_bank` event per bank and one `deming.reconcile_grade` event. The first batch is
  the 62 frozen answer-key banks. A full batch over every bank with live fees, and applying any
  reconciled winner to live fees, wait for James's yes (or the sampled-clean rule).

## Switch dry runs (#1092)

One read-only command prints every production count an off-by-default switch waits on, so James
can decide each switch from its output without a per-switch ask:

```
DATABASE_URL=<prod URL> npm run audit:switch-dry-runs
DATABASE_URL=<prod URL> npm run audit:switch-dry-runs -- --json > switch-dry-runs.json
```

- It runs in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction. It sends one
  `SET LOCAL statement_timeout`, one `SHOW transaction_read_only` (it stops unless the answer is
  `on`), and SELECT reads. It makes no provider calls and uses no network beyond the database
  (`src/lib/data-store/switch-dry-runs.ts`).
- Output is totals plus a capped sample per list. Flags:
  - `--sample N` (default 20);
  - `--row-cap N` (default 50,000; a read that hits it says so);
  - `--max-documents N` (default 3,000): the dash-list scan's bound, applied before any stored text
    is read; the output prints the bound and the next `--scan-offset` when it is reached;
  - `--scan-offset N` (default 0): the next batch of dash-list candidates;
  - `--accuracy-sample N` (default 500);
  - `--institution ID[,ID]` (sections 1 to 7 and 9 for those institutions only).
- **Load.** The run holds one repeatable-read snapshot for its whole length, which holds back vacuum,
  and its cap and limit reads scan whole tables (each statement stops at 10 minutes). Run it
  off-peak, or on a replica if one exists. For a first pass, scope it to a few institutions, for
  example State key 10272's (Crow Wing Power CU):
  `DATABASE_URL=... npm run audit:switch-dry-runs -- --institution <id>`. Then run it unscoped,
  paging the dash-list scan with `--scan-offset`.
- The sections (`switch-dry-runs/`). Each is a pure counter with a hand-counted fixture test, and
  `src/lib/data-store/switch-dry-runs.db.test.ts` runs the reads on the production schema.
  1. `DAILY_CAP_LINES_LIVE` (#2768). Every od_daily_cap or nsf_daily_cap row is checked against its
     own document's newest text, with `dailyCapLines` off and then on, the way its own path checks
     it:
     - a published row (live or removed) as Hamilton's source check does: `checkFeeAgainstSource`
       on the whole text, with a tiered price counting as traced;
     - any other row as Darwin's verify does: `statedInOwnSource`, which reads an ancillary
       product's own block.

     Rows count once per fee line (`cap-lines.ts`): institution, page (`feePageKey`), category,
     Hamilton's `normalizedFeeName` and amount. A newer copy of a page carries the same line, and
     two caps of one name at two prices stay two lines. Each line that newly traces is one of:
     - a gain: nothing of that name is live at the institution;
     - already live at the same price;
     - a live price change: the page's same-named cap is live at another price, and
       `decidePriorFee` supersedes it or publishes beside it;
     - beside a live price elsewhere: the only same-named live cap is on another page of the
       institution, at another price, and Hamilton publishes beside it;
     - live price stays: `decidePriorFee` keeps the live cap unchanged (`older_document`,
       `identical`).

     The last three are sampled with the old and new amounts and the decision.

     A gain whose furthest row is verified but unpublished is labelled as Darwin's judgement, since
     the publish gate is not replayed. Each live cap that newly traces is also judged by Darwin's
     verified recheck (`recheckOf`) on the line it would read with the switch on. A takedown is
     counted only when the recheck keeps the row today and fails it with the switch on. Rows that
     already fail today on Knox's excerpt are listed apart as not caused by the switch.
  2. `DASH_LIST_ROWS_LIVE` (#2834). Candidates are chosen by institution: every current copy, and
     every document a live fee cites, that prints a "$X - Name" line. Institutions with live fees
     come first. Each candidate is replayed through the shadow lab stages, once as today and once
     with the switch on. It prints:
     - the live fees the switch stops reading;
     - the live fees neither reading reproduces, as not assessed;
     - the new reads `decidePriorFee` would publish beside a same-named live fee of the same
       category and audience at another price. A read's audience is Knox's `feeApplicability`,
       then Darwin's `darwinAudience`;
     - a check of State key 10272's live "Stop Payment (single check)" $35.

     It also prints the steps it cannot replay (`DASH_LIST_NOT_REPLAYED`), in the text and in the
     JSON.
  3. `excerpt-at-publish`. This experiment maps to no live switch, because the publish row carries
     no raw `conditions`. The section counts:
     - live fees the limit guard holds only with Knox's excerpt;
     - fees still down that the live limit sweep took down with an excerpt-only reading. Fees
       that are live again (same institution, category and amount, with a name that matches by
       `normalizedFeeName`) are left out and counted apart.
  4. `SECTION_PATH_LIVE` (#1092, `section-path.ts`). The dash list section's candidate scan (same
     bound and offset), kept to documents whose newest text names an audience (`SECTION_PATH_PG`).
     Each live dollar fee on such a document is read against that text with the switch off and on by
     Darwin's audience decision (`darwinAudience`, own-price clause on): the fees whose decision
     changes, by published audience and new decision, and how many the audience relabel would write
     (from `unknown`; from `both` only for a title source, which `section_path` is not yet). The
     switch holds nothing, so there is no takedown count.
  5. `FOOTNOTED_ATM_HEADING_LIVE` (#1092, `fee-fold-atm-heading.ts`). Every balance inquiry (Knox's
     hint, or a verified or published balance_inquiry) is re-filed against its own document's newest
     text with the switch off and on, as Darwin's verify, Hamilton's rules re-check and Hamilton's
     fold step file it (`refileCategory` with `foldContext`, read in each mode). It counts the live and
     verified fees the fold step would re-file into atm_non_network (only those the guard and Darwin's
     amount checks accept). A raw-only row changes only what Knox's next read files. The takedown count
     reads every live atm_non_network fee Hamilton's rules re-check reads (`fr.source = 'knox'`, not
     `knox_paid_extraction`, `amount_kind = 'flat'`), whatever Knox hinted. Each is judged on the text
     its `text_hash` names (else the newest), switch off and on, by the re-check's own pairing and
     verdict (`claimDocumentLines`, `liveRowVerdict` in `hamilton/rules-recheck.ts`). A fee that fails
     only with the switch on would come down after the second look; one the second look keeps
     (disputed) and one that fails today are counted apart.
  6. `HELD_VOCABULARY_RELABEL_LIVE` (#1092, Knox v161, `held-vocabulary.ts`). The same candidate scan,
     kept to documents whose newest text prints a word the held-name vocabulary reads
     (`HELD_VOCABULARY_PG`). Each text is read by today's free team with the vocabulary off and on;
     the vocabulary only adds reads. A live dollar fee of the document with an added read at its price
     is one the live-correction paths (Knox's re-read of Darwin's requests, Darwin's re-read category
     and re-file checks, the live name re-tidy) could re-file (another category) or rename (its own)
     with the switch on: an upper bound, by live and added category. Added reads at a category and
     price no live fee of the document has are counted apart: they publish through Darwin whatever
     the switch says. The shadow-lab experiment `held-name-vocabulary-off` reads every stage as
     those paths read while the switch is off.
  7. `ZERO_WAIVER_ROW_TAKEDOWN_LIVE` (#1092, Knox v163, `zero-waiver-row.ts`). Every live flat $0
     fee Darwin's waiver-row re-check selects with its own SQL (`zeroWaiverRowRowsSql`), judged by the
     re-check's own function (`findZeroWaiverRows`) on the text Knox read, a chunk of texts at a time:
     the count of live fees the switch would take down (each after its second look), by kind and
     category, and the selected fees with no stored text, which are not judged.
  8. `HTML_ROW_PAIRING_LIVE` (#1092, #2951, Rosetta `read.html_dom`). Exposure only: the current HTML
     documents and the live fees on them that a flip would reach once re-read; the change itself is
     measured on the answer-key documents' bytes (shadow-lab experiment `html-row-pairing`).
  9. `SERVICE_MAINTENANCE_TAKEDOWN_LIVE` (#1092, Knox v174, `service-maintenance-heading.ts`). Every
     live flat monthly maintenance fee Darwin's service-heading re-check selects with its own SQL
     (`serviceMaintenanceRowsSql`), judged by the re-check's own function (`findServiceMaintenance`) on the
     text Knox read where it prints a service's words, a chunk of texts at a time: the count of live fees the
     switch would take down (each after its second look), $0 and priced, by the services the heading names,
     and the selected fees with no stored text or no service word, which are not judged; a fee the shared
     check traces to no line is counted unconfirmed and never taken down, and the rows past `--row-cap`
     (read a page at a time by fee id) are counted unjudged. A match main's `onlineServiceMonthlyFee` (#2963) also matches is covered by `NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE` and reported apart, not as this switch's takedown.
  10. `PDF_TEXT_DIRECTION_LIVE` (#1092, Rosetta `read.pdf_layout`, `pdf-text-direction.ts`). Exposure
     only, within the institution scope like sections 1-7 and 9: the current documents whose newest
     text the PDF reader wrote (the flip's `PDF_READ_VERSION` bump re-reads each once) and their live
     fees, and of those read since Nov 3 (`detail.pdf_read`), how many a read found a sideways page in
     (`detail.pdf_text_direction`) and the live fees on them. The audit has no PDF bytes, so it never
     diffs a text; the change is measured on the answer-key documents' bytes (shadow-lab experiment
     `pdf-text-direction`).
  11. `HTML_CELL_LIST_PAIRING_LIVE` (#1092, Rosetta `read.html_dom`, `html-cell-list-pairing.ts`).
     Exposure only, within the institution scope like sections 1-7, 9 and 10: section 8's current
     HTML-read documents (the flip's `HTML_READ_VERSION` bump re-reads each once), and of those the
     documents with a stored table row in the switch's one-line shape (two cells, no dollar amount in
     the first, two or more in the second; `HTML_CELL_LIST_EXPOSURE_SQL`), with the rows and the live
     fees on them. Stored rows keep cell text, not list markup, so it never says which rows would
     split; the change is measured on the answer-key documents' bytes (shadow-lab experiment
     `html-cell-list-pairing`) and on St. Cloud's archived page (`cell-list-proxy.test.ts`).
  12. Live accuracy. Deming's fresh audit is re-run on today's seed (`fresh-audit.ts`). It leads
     with the daily receipt's own figure (right / scorable), then the amount-and-category-only
     share (`traceLiveFee`, `checkFeeCategory`). This is a stored-copy measure, not a check
     against the bank's current schedule.
- A new switch that waits on a production count adds its counter here in the same PR
  (deming/issue-1092-a-switch-ships-its-dry-run-count).

## Golden-set gate (#2533, #2535; Nov 2)

Two CI halves run in one step of unit shard 1 (`.github/workflows/test.yml`), with no database and
no model call:

- **Pipeline gate** (`golden-gate.ts`, `golden-gate.test.ts`). A PR that changes a file the replay
  imports (the static import closure of `golden-gate.ts`, computed each run), anything under
  `src/lib/agents/`, `src/lib/custom-report/source-check.ts`, or a golden-set fixture is measured on
  the golden set at the PR head's code values, twice: as published, and after every replayed
  database sweep at its code value. It fails on any number worse than main's committed baseline
  (`__fixtures__/golden-gate-baseline.json`, read from the merge base), with tolerance zero: no
  expected fee main finds lost, no member publishing or letting through more known-wrong fees, no
  rate falling. No switch name is needed. A PR that moves a number commits the regenerated baseline
  (`GOLDEN_GATE_WRITE=1 npx vitest run src/lib/agents/deming/golden-gate.test.ts`); the diff shows
  each member that moved. Every other PR skips the measure in seconds.
- **Switch receipts** (`switch-gate.test.ts`). Each `*_LIVE` switch a PR's changed lines name
  replays off then on. Read switches toggle in the replayed read (`SWITCH_REPLAYS`); database
  sweeps (Darwin takedowns and re-files) run their decision function over the golden set's own
  publications (`sweep-replay.ts`), so a sweep that would take down or re-file a fee the answer key
  says is right fails. A switch with no replay states why in `NOT_REPLAYABLE_REASONS`
  (`switch-replay-reasons.ts`, one line per switch, sorted by name); the inventory fails a switch
  with neither, and the gate fails a PR that
  turns a switch on (code constant flipped or added `true`) with no replay unless the same PR adds
  or rewords that switch's reason line.
- **Main drift check.** On a push to main that changes a gated file, main's code is measured
  against main's own committed baseline (`GOLDEN_GATE_MAIN=1`), so two PRs that each passed on an
  older main and together moved the numbers fail on the merge commit that caused it; the message
  gives the regenerate command.
- Every receipt names the members it could not measure offline (the answer-key banks with no
  stored reference text) instead of skipping them silently.
- The diff check sees only switches turned on in code. A switch turned on through a Vercel
  environment variable never appears in a PR diff, so no receipt runs for it; run
  `SWITCH_GATE_SWITCHES=<name>` by hand before setting one.
- A new switch ships with a replay (an override parameter on the read path, or a sweep entry whose
  probe in `switch-gate.test.ts` shows the sweep acting differently with it on) or a stated reason
  (deming/golden-set-gates-every-pipeline-change).
- **Switch inventory** (`switch-inventory.ts`, `switch-inventory.test.ts`). `npm run
  switch-inventory` prints every `*_LIVE` name's row (kind, code default, prod state, first commit,
  replay, retire flag) and the counts, computed from the code each time; the table is never
  committed, so switch PRs share no derived file. The only committed per-switch data is what code
  cannot give: `switch-inventory-facts.ts`, one line per switch (first commit, documented prod state
  of an environment switch, a note). A new switch needs no line there. The test fails a facts line
  for a name that is no longer a switch, an entry spread over lines, or a duplicate
  (deming/derived-tables-are-printed-not-committed).

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
| `RECONCILE_VERSION` | — | v1 | `deming/reconcile/run.ts` |
| `FRESH_AUDIT_VERSION` | — | v10 | `deming/fresh-audit.ts` |
| `DEMING_REGRESSION_VERSION` | — | v2 | `deming/regression.ts` |
| `BENCHMARK_HEALTH_VERSION` | — | v1 | `deming/benchmark-health.ts` |
| `PLAYBOOK_CHECK_VERSION` | — | v2 | `deming/playbook-contradictions.ts` |
| `AMOUNT_PATTERN_VERSION` | — | v1 | `deming/amount-patterns.ts` |
| `DATA_QUALITY_VERSION` | — | v1 | `deming/data-quality.ts` |
| `KNOX_MISSES_VERSION` | — | v1 | `deming/knox-misses.ts` |
| `MONTHLY_REVIEW_VERSION` | — | v1 | `deming/monthly-review.ts` |
| `SHADOW_LAB_VERSION` | — | v1 | `deming/shadow-lab/compare.ts` |
| `LIVE_SOURCE_AUDIT_VERDICT_VERSION` | — | v2 | `deming/live-source-audit.ts` |
| `FIXED_COHORT_SCORER_VERSION` | — | v3 | `deming/fixed-cohort-history.ts` |

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
