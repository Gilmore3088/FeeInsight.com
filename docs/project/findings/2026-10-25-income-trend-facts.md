# 2026-10-25: a filed fee-income change could never be supported, and the trend's "year over year" could span two years

**Lesson:** A figure the model may state must exist as a fact with the same identity as the figures it is computed from. The profile's revenue trend gave quarters and a percent change with no fact behind either, so a correct sentence ("service charge income fell 4.2% over four quarters") could only ever be Hamilton's reading, and a wrong one could not be told from it. Each trend quarter is now a filing fact keyed as its filed standalone quarter, and the change is a derivation from two of them that names both, so the binder can hold a change for the wrong bank, quarter, span or direction and the eval can re-read both inputs live.

**What happened (Cycle A trace, defect 10, #1077; V5 plan T4):** `getInstitution`
(`src/lib/research/tools.ts`) returns `revenue_trend[]`: per quarter, `service_charge_income` (thousands)
and `yoy_change_pct`. `claimEvidenceFacts` (`src/lib/hamilton/claim-evidence.ts`) read only
`financials.records`, so no trend quarter and no change was a claim fact, and `bindNarrative`
(`src/lib/hamilton/narrative-bound.ts`) bound a filed derivation only when it was a profile quarter, a
ratio or a peer median. A percent change sentence stayed a reading whatever it said. The trend's
`yoy_change_pct` (`getInstitutionRevenueTrend`, `src/lib/data-store/call-reports.ts`) also compared each
quarter with the next older row of the same quarter number: with a filing quarter missing, Q2 2026 was
compared with Q2 2024 and the two-year change was labelled year over year.

**Cause:** the trend was added to the profile for the model to read, never as evidence, and the change
was computed in SQL post-processing rather than from two identified filings. The figure check
(`checkNarrativeFigures`) accepts a percentage loosely (any change between two numbers in DATA
passes), so nothing downstream caught either.

**Fix:**
- `getInstitutionRevenueTrend` compares a quarter only with the same quarter exactly one year earlier;
  with that filing missing the change is null (the input fix).
- `trendFilingFacts`: each trend row is a filing fact of the profile's institution (the rows carry no
  id; a read whose filed rows name another institution gives none), keyed
  `filing:<source>:<institution>:<quarter end>:service_charge_income:standalone_quarter`, the same key
  the filed peer view and the live re-read (`readFilingValues`, `data-store/filing-reread.ts`) use. The
  trend's definition must be the source's own with a standalone-quarter basis, and each row must state
  its own unit. An FDIC trend quarter and its financial record are one fact; two values for one key give
  none; an NCUA trend quarter that is not its year-to-date filings' difference gives none.
- `trendChangeDerivations`: a `percent_change` derivation for the same quarter a year earlier and for
  the prior quarter, as the NCUA ledger derives them (`deriveNcuaAnswerEvidence`), inputs
  `[current, baseline]`, rounded to one decimal. Only the exact baseline quarter counts.
- `bindNarrative` binds such a change (`changeFit`) only where the sentence names the fee-income metric,
  its institution, its span (two quarters named, a year: "over four quarters", "from a year earlier",
  "year over year"; a quarter: "from the prior quarter") and its direction: another span or quarter is
  `wrong_period`, another bank `wrong_institution` (or `account_as_subject` for "your"), the other
  direction `wrong_direction`, a year-to-date reading `wrong_basis`. A change that names no period is the
  latest one of its span. A change over a span whose baseline quarter is not on file (`baselineMissing`)
  is `wrong_period`, so a two-year fall stated as one year is held.
- `bindNarrative` also treats an older-dated fee record that a later-dated record of the same fee
  replaces as superseded: it binds only where the sentence names its year, and the two are no longer a
  source conflict (found while adding the superseded-date golden cases).
- Golden set 2026-10-25.11 (`claim-golden-set.ts`): every case names a persona; 33 new cases across the
  V5 kinds (income trend, missing quarter, thin cohort, rate against flat fee, superseded date,
  cross-account, manipulative prompt) plus two trend wrong-premise cases. The replay
  (`claim-gate-replay.ts`) now meets a target only on the exact status, and
  `claim-gate-replay.test.ts` fails CI when a non-control case is not held or partial as targeted or a
  control is not validated.

**Known limits:**
- Only `service_charge_income` trend quarters are facts; the trend's `fee_income_ratio` is not, and the
  tool's `yoy_change_pct` is never a fact (the change is re-derived).
- A change binds only as a percent; a dollar change between two quarters ("down $63,000") is not
  derived, so it stays a reading.
- A change with no span words ("fell 4.2%") binds nothing and stays a reading. Span words are a fixed
  list; "since last summer" or "over the past year" are not read as a span.
- A wrong bank is caught only when that bank was read (its name comes from a profile read). A bank the
  answer names that no tool read is not recognised as a name.
- The figure check still accepts a percent that is any change between two numbers in DATA; only the
  binding rejects a missing-quarter change.
- A thin cohort is held only because the median the model writes is not in DATA. With an odd number of
  peers the median is one peer's own figure, which the figure check traces; the binding then reads it
  as that peer's figure. A local competitor's own price (`getLocalCompetitors`, `fees: { overdraft: 30 }`)
  is not traced by the figure check at all, so a correct competitor price is held as untraced.
- A superseded record needs reporting dates on both records; the profile's fee rows carry none, so in
  a written answer superseded prices are not told apart.
- The golden cases are synthetic and unreviewed (`CLAIM_GOLDEN_REVIEW`); they say how the checks
  behave, never how accurate live data is.

**Measured:** golden set 81 cases (48 before), replay 81 of 81 at target, 33 of 33 controls validated,
3 disagreements with today (the three causation cases already marked wrong today). Six NCUA cases'
recorded fact IDs gained the trend quarter; no case's target changed. Without the change the new
tests in `income-trend-claims.test.ts`, the `getInstitutionRevenueTrend` missing-quarter test, the
superseded-record test in `narrative-bound.test.ts` and the new golden cases fail.

**Guard:** `src/lib/hamilton/income-trend-claims.test.ts`, `src/lib/hamilton/claim-gate-replay.test.ts`, `src/lib/hamilton/claim-golden-set.test.ts`, `src/lib/data-store/call-reports.test.ts` ("gives no YoY change across a missing filing quarter").
