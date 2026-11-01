# Automated audit confidence and history (#2071)

This series measures support for **published dollar fees in stored documents**, using the
deployed source, category and name checks. It is not an independent live-site assessment, a
measure of missed fees, rate-fee accuracy, or evidence that a stored schedule is current.
The separate [live-source diagnostic](LIVE-SOURCE-AUDIT.md) (#2061) observes a frozen sample
against fresh official-path evidence. Its supported/contradicted/unknown receipts remain a
shared-validator diagnostic, without missing-fee recall, independence or launch certification. The separate [answer-key reference guard](REFERENCE-ELIGIBILITY.md)
(#1862) controls current-key diagnostic inputs and teaching without certifying live correctness. The
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

## What a fee must carry (fresh audit v10)

Since v10 a fee is right only when the published fee carries what its own source line prints beside
the price: the unit (per hour, per half hour, per page, per $100, a pack), the period (per month, per
year; scored only when the stored frequency is known), the conditions (plus tax or other charges, a
balance waiver, a counted allowance, greater-of), the tier (first-then, additional, a size band, a
balance band) and the audience. The terms come from the line the shared source check traced
(`checkFeeAgainstSource(..., { terms: true })`, `source-line-terms.ts`); `terms-check.ts` decides
whether the name or stored frequency carries each. A dropped term is a `qualifier` miss
(`deming.terms_lost`). It is an audit verdict only: nothing is published, held or taken down for it.

## Agreement with the human live check

`w43-agreement.ts` replays this audit on James's frozen W43 live check
(`__fixtures__/live-audit-2026-w43.json`) and compares its verdict with his on every row it can score;
`robot-human-agreement.json` is the receipt (scorecard query `goal.deming_robot_human_agreement_w43`).
Its test fails when the receipt differs from the replay or agreement falls below `floor_agree`. A
change to the audit that moves agreement updates the receipt in the same PR. Measured Nov 1: v9 agreed
on 335 of 466 rows (71.9%), v10 on 79.2–83.9% (369–391; the high end leaves the period unscored, the
replay lacking the stored frequency), against a 95% target. The receipt lists the classes it still
disagrees on.

The range measures flattened text only. The fixture's 43 saved texts hold 41 "|" characters in all, so
the pipe-table paths of the terms reader (an empty price cell, a basis cell, the name cell before the
price) are effectively unmeasured by it; they are covered by the unit tests in `terms-check.test.ts`.

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
