# Automated audit confidence and history (#2071)

This series measures support for **published dollar fees in stored documents**, using the
deployed source, category and name checks. It is not an independent live-site assessment, a
measure of missed fees, rate-fee accuracy, or evidence that a stored schedule is current.
Live-site validation and answer-key eligibility remain #2061 and #1862. The
[weekly live fee accuracy plan](../../../../docs/plans/weekly-live-fee-accuracy-plan.md) (#1923)
defines the separate 50-institution draw, current-source decisions, missing-fee denominators,
institution-cluster confidence bound and correction/retest protocol. It is a written method,
not an execution or launch-accuracy receipt; #1063's broader automation work also remains open.

The launch accuracy measurement is James's single weekly live batch of **50 whole institutions**,
run as five prompts of ten across big banks, community banks and credit unions and the four Census
regions. It checks every published fee against the bank's current schedule and records missing
tracked categories. The data lane takes all misses. This diagnostic's “met” status cannot satisfy
that launch gate and must never generate extra manual row checks, answer-key confirmations or
additional live batches for James (DECISIONS, 2026-10-19).

## Automated sample and decision

The daily run requests 500 rows, uniformly ordered by `md5(catalog_id || UTC date)`.
It records the seed, every sampled fee ID and every verdict, including missing-text unknowns.
One receipt per seed and scoring series is counted: a retry replaces the day's earlier receipt.
Within a week, a repeated published fee counts once, with its newest verdict. A newer unknown
does not inherit an earlier pass. Unknowns are displayed but excluded from the scorable denominator.

A percentage can be displayed at 30 scorable fees. The target can be **met** only at **3,400
unique scorable fees** in one scoring series, and only when the **unrounded lower end of the
two-sided 95% Wilson interval is at least 99.5%**. Otherwise it is explicitly insufficient or
not met. A point estimate of 99.5% never suffices. For example, 1,393/1,400 gives a lower bound
of about 98.97%, not evidence of meeting the target.

Sizing: at p=0.995 and n=3,400, the 95% Wilson interval is approximately
99.2007%–99.6876%, with a half-width of 0.2435 percentage points (less than 0.25).
500 draws × 7 days provides 3,500 nominal observations; repeats, missing text, skipped days or
a scoring change can leave fewer than 3,400 eligible. The system reports that shortfall rather
than extrapolating. This is a precision budget at the target, not a promise that 3,400 observations
will prove it: observed support must exceed the target enough for its lower bound to reach it.

The interval is a fee-level binomial diagnostic. Shared sources and institution layouts can
correlate errors, and the same validators participate in publication and audit. Neither a high
score nor its interval certifies independent correctness. Rate fees and missing/unpublished fees
require separate evaluation. Increasing the sample makes no provider calls and changes no fee.

## Versions, history and retest

The scoring-series key is reporting-protocol / audit / category-guard / source-check /
name-check version. A change to an audit predicate without a separately versioned dependency
must bump `FRESH_AUDIT_VERSION`. Changes to receipt aggregation or sample interpretation bump
`ACCURACY_REPORTING_VERSION`. A version change starts a separate history segment. Old results
are not rewritten, joined to today's series, or credited as a data improvement by the seven-day
change-outcome check. An unchanged series may accumulate new daily draws after a data fix.

Daily receipts live in existing `agent_run_events.step.finished` detail and are copied into
`pipeline_scoreboard_snapshots.detail.goal.accuracy.daily`. The history query reads those dated
receipts from snapshots, so the weekly record outlives run-event retention. Calendar weeks start
Monday UTC; the current week says “so far”. The trailing-seven-day goal and calendar-week history
are labelled separately. Repeated copies of a rolling window do not add evidence. The admin page
and quality-ledger email show twelve weeks and mark scoring changes, including an intraweek change.
Legacy receipts without checker versions or full per-fee outcomes remain visible as legacy
aggregate counts, with no interval or “met” claim; versions are never guessed from current code.

The automated audit records suspected errors through the existing candidate/feedback path;
it does not make a human-confirmed label or directly correct fees. Retest the cause fix against
the same frozen source and confirmed case, then let future same-series random draws measure
the changed output. Repeated manual reruns of one daily sample cannot increase confidence.
Use the required weekly 50-institution live batch for current-site evidence and missing-fee recall before any product accuracy claim; do not ask James for extra confirmations.
