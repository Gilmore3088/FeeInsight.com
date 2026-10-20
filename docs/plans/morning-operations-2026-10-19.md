# Morning operations: coverage, gaps and execution plan

Owner: Atlas for coordination; each source/quality change stays with its existing agent.
Tracker: [#2196](https://github.com/Gilmore3088/FeeInsight.com/issues/2196), under Foundation #1048.
Baseline: main `77a05bdb`, checked against GitHub issues/PR metadata and read-only production
queries on 2026-10-19 at approximately 12:57 UTC. A merged PR is evidence of code delivery,
not evidence of the current production deployment or successful recovery.

## Budget and lane diagnosis

The raised limits are present in production:

| Policy | Enforced cap | Observed usage |
|---|---|---|
| Global | $75/day, $500/month | about $16.00 today, $338.66 this month |
| Magellan | $225/month | $188.30 this month, $14.05 today |
| Agent tick | 30 calls and $3 per run/tick | independent of the global daily cap |

Both global provider automation and the deterministic pipeline are enabled. LA and TX
completed paid discovery today. No budget-block audit records were returned for the preceding
24 hours. These observations do not establish the upstream provider account's own remaining
credit, but they show that paid Magellan work is currently progressing under the app caps.

The live queue had all three active lane slots occupied: LA 9447 and TX 9451 awaiting publish,
MA 9484 awaiting discover. Publication needs an estimated 225 seconds; recent deferral receipts
had only 103–164 seconds remaining. Thirty-nine lane next-run timestamps were over six hours
old. The age count excludes active queued/running lanes in the health endpoint, so it is not
simply the count of these three active runs. A higher spending cap does not create tick time.

A follow-up at about 13:08 UTC showed Texas publication completed at 13:04:50 after starting
13:01:15, confirming progress under the raised cap. Publish-sweeps run 9491 still had a running
step started at 12:51:14 with no completion. Investigate stale-step recovery and lock/query
state in #2199; do not treat elapsed time on an unfinished step as a measured completed runtime.

Separately, the queue selector rejects a lane beginning a capped tick at an optional paid step,
preventing the existing executor from recording a skip and reaching later free work. This is a
reproduced code defect, but no active lane was stopped at a paid step in the observed snapshot.
Do not present its repair as proof that the current publication backlog has cleared.

Historical lane failures in the previous three days included four extraction deadlocks and
15 classification statement timeouts (the latter last seen Oct 17). Recheck current lock/query
evidence before treating the old classification failures as an ongoing regression.

## Existing coverage

The relevant merged PRs below are already on the baseline. The 18 open PRs returned by the
repository query concern product, pages, reports and API documentation; none supplies the
budget-continuation fix below. Recheck ownership and exact main before every implementation.

| Morning finding | Existing implementation/issues | Remaining work |
|---|---|---|
| Overdue lanes | #2017 moved hourly sync out of the tick; #2180 bounds scoreboard continuation | Optional paid-step continuation #2198; publication execution-time investigation #2199. Preserve the existing recovery and age ordering. |
| Financial-record storage | #1849 per-table guards; #1965 cold-file infrastructure, #1870 closed for code delivery | Measured financial-record budget #2205. Cold export and pruning remain separate controlled actions. |
| Duplicate alarm / wrong after publish | #2143 preserves audience identity; #2130 preserves newer-copy identity and decisions; #2193 narrows learned takedown identity | Existing #1069, #1876, #1348 and #1673 need sample-specific verification and upstream prevention. No broad cleanup based on count alone. |
| No eligible reference banks | #2174 adds durable document eligibility; #1862 closed | Re-establish valid current reference banks and run measurements; exclusion is not a passing accuracy result. |
| Legacy automated audit | #2119 adds versioned receipts, deduplication and confidence gates; #2132 documents weekly whole-institution checks | #2061 live-source audit, #2055 audit-miss routing, #2062 unread feedback, #2066 weekly detection gaps remain open. Keep legacy history separate. |
| Hamilton figures / partial eval | #2031 fixes false overdraft-rule figures and respects time budget | #2029, #2030, #1858; inspect the failed paid written-answer case and expand the paid sample before claiming reliability. |
| Audience asterisks | #1059 owns classification; audience-aware duplicate/refresh fixes have landed | Verify classification coverage and retained unknowns. No mass relabel without evidence. |
| Coverage / URL losses | #1252 prioritizes state-size gaps; #1030 and #1051 own discovery/thin-source work | Explain 59 institution drops and 56 fewer URLs by lifecycle reason; target retained, correctly sourced coverage. |
| Public-source health | #1948 introduces source status; #1867 is the empty-source recheck | Failure receipts/backoff #2200; source-specific fixes below. |
| Morning report usability | Existing #2062 covers unread-error alerts; #1104 Sunday maintenance | Consistent counts, failure reasons/actions and measurement/budget clarity #2206. |

### Public-data sources

| Source | Coverage already present | Latest evidence / next action |
|---|---|---|
| BEA personal income | #1943 retries when the supplied key appears; #1874 is closed | Twenty failed steps in the last day: `BEA: Unknown error.` Diagnose request/error envelope under #2201; do not ask for the already supplied key again. |
| BLS OEWS | Existing ZIP/XLSX parser | Four recent `invalid zip data` failures; 2019 previously loaded 13,070 rows. Identify failing year/level and response/archive in #2203. |
| Branch census tracts | Existing address and coordinate geocoding | Four HTTP 400 failures sending x=9.538, y=138.097. Validate source coordinates and isolate bad records in #2202. Never blindly swap ambiguous coordinates. |
| CRA | #1805 owns official-agency alternatives | Ratings and multiple lending-year ZIPs currently return 403. Verify each official alternative before building; retain honest missing-source status. |
| UBPR | #1934 added form diagnostics; #1806 closed for that implementation | Current failure is now HTTP 403 at the bulk page, not the old HTML Download response. Verify deployment/access under #2204. |
| World Bank remittances | #1940 discovers and parses the official workbook | Official workbook currently returns 403; #2204 tracks access/official alternatives, not another speculative parser rewrite. |
| NIC / Y-9C | #1934 records missing-source status and the limited FDIC holding-company fallback | Access remains unavailable; fallback does not supply parent history/Y-9C filings. |
| GLEIF / industry events | Existing loaders; #1867 / #1783 | Live failures include GLEIF HTTP 400 filter requests and an SBA package HTTP 404. Verify input/official addresses as source-specific slices of the existing recheck. |
| Other empty sources in the brief | #1867 / #1783 | Inventory each latest attempt, last nonempty load, row/match counts and stated reason: LEHD, Making Ends Meet, FDIC survey/rates, FFIEC tracts, NY Fed SCE, payday, Urban and Wire. Empty checks do not establish loaded coverage. |
| State bill news | #1872 terms review; explicit licence hold | Keep the hold until the terms decision exists. |
| State nonbank lenders / public depositories | Source contracts exist, no planned partitions | Decide and implement confirmed source coverage under #1783; report unsupported scheduling explicitly rather than treating it as a transient failure. |

All registry errors should reach their partition record. In the observed data, several failing
sources had only scheduled partition rows while agent steps carried their transport errors.
This is why #2200 must be reconciled with source-specific recovery rather than hiding failures
behind a recent empty check. Heavy-step runtime estimates remain existing issue #1820.

## Ordered work and acceptance

1. **#2198, first implementation:** permit only the four standard optional paid passes in
   state lanes to reach the skip path when queued deterministic work follows. Keep mandatory
   paid reports/guides, paid-only jobs, controls, scope and provider accounting intact. A real
   PostgreSQL regression must fail on main, then show skipped paid receipts, completed free work
   and zero provider calls/cost. Include the test in required CI.
2. **#2199:** measure preceding run work, first-step reservations and the publish lock across
   multiple ticks. Reproduce publication starvation, reserve room for the oldest runnable lane,
   and verify a full state rotation with no uncontrolled concurrency increase. Diagnose the
   extraction deadlocks with their own lock-order evidence.
3. **#2200–#2204, #1867, #1805 and #1820:** fix partition failure/backoff receipts, then repair
   individual inputs/transports from real responses. Confirm one nonempty correctly scaled
   partition and rerun affected periods. A permanent blocked source may instead end with an
   explicit unavailable status and a supported next action. No proxies or spoofed agents.
4. **#2205:** measure heap/index/TOAST and source/quarter growth, define required hot history,
   and add a budget justified by those measurements. Do not delete or export data to silence
   the alert.
5. **#2206:** reconcile the actionable count; include safe bounded error/action/link; label
   runs versus steps and failed versus blocked; distinguish attempt/nonempty dates; report eval
   completeness and sample sizes; show monthly remainder. Preserve intentional holds.
6. **Existing quality owners:** verify duplicate/identity repairs, qualify references, route
   audit misses to their producing step, run fresh live checks, then target coverage gains.

The user has authorized investigation and implementation. This plan changes no live budget,
control, fee or permission setting, and enables no shadow repair/export/prune. Production-data
changes retain the repository's separate authorization requirement.

## First implementation validation

The new PostgreSQL suite reproduced five failures against unchanged main: all four optional
passes were excluded and a capped runnable lane could not get the one available selection slot.
Three controls passed: pipeline pause, scoreboard scope exclusion, and normal paid execution.
The fixed suite also covers a custom lane containing mandatory provider work and a concurrent
executor advancing the step before the skip claim. The PostgreSQL suite and existing scoreboard
SQL/route/run-store tests pass all 101 tests. TypeScript, repository guards and lint pass (the full
lint run reports 75 warnings, no errors). The required agentic and full unit checks are recorded
in the PR; no live recovery is claimed from fixture results.
