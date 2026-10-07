# Findings

Problems we hit that were structural or infrastructural: what happened, why, the fix, and the
lesson for next time. Newest first. Add an entry the moment you find one.

Template:

```
## YYYY-MM-DD: short name
**What happened:** what someone saw, with real numbers and where they came from.
**Cause:** the root cause, or "not yet known".
**Fix:** PR or issue, and whether it is merged or applied.
**Lesson:** what any session should do differently.
```

## 2026-10-07: The CPI "bank services" series was physicians' services
**Owner:** the Data inventory thread.
**What happened:** the app read BLS series `CUUR0000SEMC01` as "CPI: Checking Account and Other
Bank Services" in the economic context (Hamilton briefing and benchmark), `getCpiContext` and the
research tools. In the CPI item codes, `SEMC` is medical "Professional services" and `SEMC01` is
physicians' services. On prod it reads 439.389 for August 2026, a medical-care index level. The four
regional `CUUR0x00SEMC` series, also loaded as bank context, are medical professional services.
**Cause:** the series id was picked by name, not checked against the BLS catalogue.
**Fix:** `CPI_BANK_SERVICES_SERIES = "CUUR0000SS68021"` (Checking account and other bank services)
and `CPI_FINANCIAL_SERVICES_SERIES = "CUUR0000SEGD05"` (Financial services) in
`src/lib/regulatory/fed.ts`, loaded as required series; every reader uses the constant. Stored
SEMC rows are relabelled as medical series on the next refresh. With a BLS key the step asks for
BLS's own catalog title and records it in the partition detail (`bls_catalog_titles`). The ids were
checked against BLS item-code listings found by search, not against api.bls.gov (blocked from the
sandbox); proof is the step loading both series on prod with no `missing_series`.
**Lesson:** check any external series id against its publisher's catalogue before naming it.

## 2026-10-07: ffiec rows in institution_financial_records mixed units with fdic/ncua
**Owner:** the Data inventory thread.
**What happened:** `institution_financial_records` has three `source` values. `fdic` and `ncua`
rows carry every dollar column in thousands. The 13,215 `ffiec` rows (report dates 2025-09-30,
2025-12-31 and 2026-03-31, all written on 2026-08-10) use other units: balance-sheet columns in
whole dollars (`total_assets` exactly 1,000x), `service_charge_income` not a fixed multiple of the
fdic figure (median about 750,000x, 10th-90th percentile about 146,000x-3,150,000x, some banks 0;
Orrstown, institution 270, 2026-03-31: 946,778,000 against 2,077 in its fdic row), `fee_income_ratio`
195x-750x, `tier1_capital_ratio` about 10% against fdic's 15-28%, and `net_income` null. No rescaling
recovers the right figure. 12,934 of them duplicate an fdic/ncua row for the same institution and quarter
(counts from the Data inventory thread's read-only queries). Readers that did not filter by source
could take an ffiec row as "the latest" quarter, or average and sum both rows: the industry health
medians and growth trends, the revenue index, fee-revenue correlation and tier/charter summaries
(the public /research/fee-revenue-analysis page joins each institution's latest quarter, so an
institution whose latest quarter is an ffiec quarter could appear with the ffiec figures, or twice), fee dependency and revenue-per-institution trends, the latest-quarter lookups behind top revenue,
district and tier revenue, the institution financials and history reads (public institution page,
admin institution and peers pages, API v1 institutions, evidence route), and the admin
financial-coverage counts, call-report freshness and missing-financials check.
**Cause:** a loader that no longer exists wrote the ffiec rows once in its own units. Some readers
filtered or rescaled them (`call-reports.ts`, the institution page's `financial-units.ts`, report
exhibits, the briefing and research tool); most did not.
**Fix:** this change. `src/lib/data-store/financial-sources.ts` holds `FINANCIAL_SOURCES`
(`fdic`, `ncua`) and `financialSourceFilter()`; every read in `src/` now filters to those sources,
the ffiec rescaling in `financial-units.ts` and `annualServiceCharges` is gone, and
`scripts/ci-guards.sh financial-source-kill` fails any `FROM`/`JOIN institution_financial_records`
without a source filter in the next eight lines. The Hamilton studies
(`src/lib/agents/hamilton/studies/drivers.ts`, `fee-dependence.ts`, `inferred-volume.ts`) already
read only `source = 'fdic'` / `'ncua'` rows, so their results were not affected.
**Applied:** with James's typed approval (07:18), the 13,215 rows were copied to
`institution_financial_records_ffiec_archive` (count checked, 13,215) and removed from the live
table at 07:22 UTC on 2026-10-07. The live table now holds fdic (386,056) and ncua (382,278) only.
**Saved items that used ffiec figures** (read-only prod audit, 07:35 UTC; none deleted):
- `hamilton_saved_analyses` bf1a5278 (Texas National Bank of Jacksonville, 1165, 2026-10-05): the
  $20,279,000 service charges, 221.7% fee-income ratio, 9,000,000% change and 9.9% Tier 1 are ffiec.
  The analysis itself calls them a units problem; its headline ($209K, Q2 2026) is fdic.
- `hamilton_saved_analyses` 6c74e9e1 (1165, 2026-10-05): the 9,565,466% change for 2026 Q1 is ffiec
  over fdic. It also calls this a units problem.
- `hamilton_saved_analyses` b1ec5e7b (Angelina Savings Bank, 3827, 2026-10-05): "100% drop ... $0
  service charges" for 2025Q3-2026Q1 is the ffiec rows (0). Its other figures are fdic.
- `hamilton_messages` b5fba6d6 (National Overdraft Benchmark chat reply, 2026-10-06): the bank row
  (average service charges $2,511,310, ratio 15.82) was inflated by ffiec rows through
  `getCharterFeeRevenueSummary`. Recomputed on fdic only today: about $5,966 thousand and 3.13.
  Credit-union figures are unaffected.
These rows have no flag column and re-running them needs James's session, so they are listed here
instead. Cleared: hamilton_reports, the other 19 saved analyses, report_jobs rows, hamilton_signals,
the five Hamilton studies and their placements. Not checkable: report_jobs HTML output files (not
in storage) and whether fdic 2026Q1/Q2 existed between 08-10 and 10-03.
**Also seen (not ffiec, not yet verified):** saved report f2ae49ae prints fdic thousands as dollars
("$209"), and analyses bf1a5278 and b1ec5e7b put institution 1165 in a "micro" peer tier although it
is community_mid, possibly from fdic `total_assets` in thousands read as dollars.
Any new reader must use the source filter; the guard checks this.

## 2026-10-07: Open States allows about ten requests a minute, so state bill runs hit 429
**What happened:** the first two 12-state runs (05:32 and 07:12 UTC) read 16 states and failed 10 with
HTTP 429 (CA, DE, FL, IA, ID, KS, MA, MD, MN, MO in `registry_ingest_partitions`). The failures came after
about ten requests each time, and retries 6 and 12 seconds later were refused too.
**Cause:** the step sent each state's four to six requests back to back. Open States' free tier allows
about ten a minute, inferred from these runs since its docs aren't reachable from the cloud sandbox.
A failed state then waited six hours.
**Fix:** requests are paced 6.5 seconds apart. A run starts no new state after 60 seconds, and a 429 stops
the run and leaves that state due instead of failing it.
**Lesson:** pace any keyed free-tier API to its limit inside the step, and treat a 429 as "come back
later", not as a failed item.

## 2026-10-07: A hand-found link added after a bank's direct run waited a full day
**What happened:** on prod (read-only, 07:22 UTC) Citi's corrected US fee chart (link 2070, added
06:43) and First Horizon's TotalView guide (link 2101, added 07:12) sat unfetched. Both banks had
already had a direct run that morning (Citi 06:25, First Horizon 07:07).
**Cause:** the direct path (PR 408) skipped any bank with a run in the last 24 hours and keyed runs
by bank and day, so a second link the same day reused the finished run.
**Fix:** this PR keys a hand-found run by its link id and lets a link found after the last run start
a new one. Merged, not yet proven until Citi's chart is fetched.
**Lesson:** a retry window should only block retries of the same work; new input is new work.

## 2026-10-07: Enforcement lists rarely record an end date, so "no end date" is not "active"
**What happened:** the Pro enforcement card (PR 372) called every action with no termination date
"active". On prod (read-only, 07:05 UTC) that was 825 of 4,431 OCC and Fed actions: 651 are civil
money penalties alone, which are done once assessed, and 86 are orders from before 2016. Only 88
are orders from the last ten years with no end date. PR 401 had also matched 48 actions to holding
companies by name alone; most were unrelated companies sharing a generic name (State Holding Co of
Thermopolis, WY on an Arkansas bank), found by checking all 28 names after its re-match ran.
**Cause:** the OCC export and the Fed CSV leave the end date blank for penalties and for many old
orders; holding-company names like "Community Bankshares Inc" repeat across states.
**Fix:** PR 410 withdrew name-only matching (merged). This PR shows "no end date on file" only for
orders from the last ten years and puts penalties and older ones under "Past"; Hamilton is told never
to call such an action active.
**Lesson:** a blank field in an agency file is unknown, not a state. Before showing a status or a
match, count how many rows it covers on prod and read a sample of them.

## 2026-10-07: The JavaScript fallback's "37% success" was mostly fee pages that only link to their schedule
**What happened:** the tracker counted `read.js_fallback` at 40 ok of 109 in 6 hours. Read-only
queries on `pipeline_attempts` (05:40 UTC) split it: on pages built by script the fallback read
33 of 36; 66 of the 69 non-ok attempts were `wrong_document` on reopened pages whose link names
the fee page but whose own text has no fees. None were timeouts, bot blocks or empty renders.
Of the 66: their routes found a linked scanned PDF on 9 (6 already read as the bank's own
documents, 3 never read: bogotasavingsbank, 1streetcu, educacu), and most of the rest were landing
pages whose schedule sits behind a link with no ".pdf" ending (Magellan's crawl shows
visionsfcu.org/documents/general/service-charge-fee-schedule-effective-june-2026 and
cu-rockies.org/documents/fee-schedule), plus "available on request" and error pages that are
correctly not fee pages. Two were real fee tables (emb.bank's 30 rows like "Cashier's check | 5.00").
**Cause:** the fallback only followed links ending in ".pdf" or labelled print/download, never
OCR'd a linked scan, and the fee-page check only counted amounts written with "$".
**Fix:** this PR: follow links that name the fee schedule, OCR a linked scan, skip links the bank
already has as documents, count bare amounts in fee table cells (15 rejected texts, all fee
schedule URLs, would now pass), and reopen each such page once per fallback version (144 pages).
**Lesson:** before calling a reader's non-ok outcomes failures, split them by what the page is: a
`wrong_document` on a page with no fees is a correct answer, and the fix is to follow where the
page points, not to count it differently.

## 2026-10-07: Call report rows for closed institutions store no revenue, and the two charters define revenue differently
**What happened:** building the fee dependence study, 4,248 of 7,747 FDIC rows for 2010-12-31 had
`total_revenue` (read-only query on `institution_financial_records`, 05:20 UTC). The rest belong to
institutions no longer in `institution_sources`, which the loaders store with `institution_id` NULL
and only a few columns. Separately, banks' `total_revenue` is net interest income plus noninterest
income (FDIC NIMQ + NONIIQ), while credit unions' is gross interest income plus noninterest income
(NCUA 115 + 117), and the credit union fee line (131) is all fee income, not only deposit service
charges.
**Cause:** the `unmatched` insert in `fdic-financials.ts` and `ncua-financials.ts` keeps only assets,
deposits, loans, net income and service charges; `raw_json` still holds every field. The definitions
follow what each regulator files.
**Fix:** Hamilton's fee dependence study (this PR) reads each filing's raw fields, so closed and
merged institutions count and the series has no survivor bias; it reports banks and credit unions
side by side and never pools them.
**Lesson:** a study over history must read the raw filing fields, not only the matched-row columns,
and must not compare a bank ratio with a credit union ratio as if they were the same measure.

## 2026-10-07: Admin Today read job health from the retired workers' markers
**What happened:** the admin Today page (James's phone, Oct 6 20:16 PDT) said "6 things need you",
including "Atlas daily cycle is overdue, last run Aug 11", "Agent review dispatcher is overdue, last
run Aug 12" and "Hamilton monthly pulse is overdue", while prod showed Atlas lanes completing at
03:26 UTC Oct 7, agent steps finishing every few minutes, the registry sync at 03:17 and a monthly
pulse completed Oct 6 06:07.
**Cause:** `getJobFreshness` read `workers_last_run`, which only the retired Modal workers wrote; its
newest row is Aug 13. The report freshness gate read the same table for its Atlas health check.
**Fix:** job health and the report gate now read `agent_runs`, `agent_run_steps` and `report_jobs`
(this PR). The tick is only overdue while steps are queued.
**Lesson:** when a runtime is retired, grep for every table it wrote and move each reader to the new
ledger in the same change.

## 2026-10-07: postgres.js sends numbers untyped, so a CASE of them is text

Darwin's release review read no lessons on prod: all 32 reviews after PR 351 recorded `lessons: 0` though the
store held 27 lessons for those categories. The query compared `row_number()` with
`CASE ... THEN ${n} ELSE ${m} END`. postgres.js sends JS numbers with no type, Postgres resolves a CASE of
untyped values to text, and `bigint <= text` fails. The loader caught the error and returned no lessons.
Fix: cast numbers used in CASE or COALESCE (`${n}::int`). A loader that falls back on error should log why,
and its first prod run should be checked for a non-zero count, not just the presence of the field.

## 2026-10-07: A fee's own schedule line is not enough context to judge it
**What happened:** building lessons for Darwin's held-fee review from `pipeline_feedback`, a hand
check of 20 random source-check takedowns (24 hours to 02:50 UTC, `wrong_amount`/`threshold`)
read from Knox's one-line excerpt called 13 real prices. Read against the full page by the Accuracy
thread, only 4 were real prices wrongly taken down ("Wire Transfer Outgoing $20.00"; PR 341), 5
were right to come down because the price belonged to a neighbouring row or column ("Deposit
return item $10" was the early-close price; the $5/Mo was the Bill Pay column), 1 is a rate refused
by design and 3 have garbled names.
**Cause:** a single extracted line drops the rows around it, which is where a misplaced price shows.
**Fix:** Darwin's release review now reads the schedule rows around a held fee's line
(`scheduleContext`, 3 rows each side). Its lessons leave out the source check's amount judgements
until PR 341's fixes are proven.
**Lesson:** judge a price against the rows around it in the stored page, never a one-line excerpt;
and check a hand-check's own evidence before reporting a rate from it.

## 2026-10-07: Takedowns were final on the first failure, and most checks had no way back
**What happened:** an audit of every Hamilton takedown path (01:30 UTC Oct 7) found that nothing is
ever hard-deleted. Each of the 9,244 takedowns keeps `rolled_back_at` and a reason, and the
learning sync had logged all of them (10,589 takedown rows, 1,477 restores) in `pipeline_feedback`.
But each check took a fee down the first time it failed, with no second look. Only the source
check, the rules re-check and the newer-copy retire restored fees when a fix made them pass. The
category guard (1,099 takedowns), outlier range (768) and off-taxonomy (94) checks had no way back.
**Cause:** each check was written as a one-shot cleanup, and restore was added later only where a
wrong takedown showed up.
**Fix:** `hamilton/second-look.ts`. A first failure is logged and the fee stays live; a later run,
at least 12 hours on, that fails it again takes it down. Of 1,345 source-check takedowns later
restored, 1,311 came back within 12 hours (453 within one), so the 12-hour wait would have kept
about 97% of them live instead of flickering off and on. Wired into the source check and the category guard, and the
category guard now restores earlier takedowns that today's guard passes (PR 324). The rules
re-check (4,580 takedowns, 184 later restored) gets its second look in PR 320: an independent
check (the source trace or the category guard) must fail too. The outlier range (768 takedowns) and off-taxonomy (94)
checks never had a restore, because their verdict only changes when a range or the taxonomy
changes; they now restore a takedown that passes today (0 qualify as of 02:40 UTC Oct 7). A second
look would add nothing there: the same amount fails the same range 12 hours later.
**Lesson:** every new takedown path goes through `secondLook` and has a restore path.

## 2026-10-07: Hamilton's rules re-check took down fees Darwin had re-filed
**What happened:** First National Bank Alaska's "Insufficient Funds Transfer (Savings Overdraft)
$10.00", a report requester's headline overdraft fee, was verified by Darwin as
`od_protection_transfer`, published, then rolled back as `rules_recheck_unreproduced`. On prod,
140 fees at 128 banks were taken down the same way.
**Cause:** the re-check filed Knox's reads under Knox's hint (overdraft); Darwin's category guard
fails that name under overdraft, so the read was dropped and the live fee looked unreproduced.
Darwin itself files it under `refileCategory`.
**Fix:** the re-check files reads with `refileCategory`, and strategy version 3 re-checks every
document once, which restores what still traces to its text.
**Lesson:** any check that re-reads a fee must file it the way Darwin files it, through the one
shared `refileCategory`.

## 2026-10-07: Darwin's paid pass never ran because other agents used its per-run call cap
**What happened:** at 01:20 UTC there were no `verify.adjudicate` or `verify.release_review`
attempts on prod at all, and no `verify-paid` step had run in 7 days. Every one ended "Paid pass
skipped: Provider call cap exhausted for run N under agent:darwin" before Darwin made a call
(runs 1843, 1849, 1850, 1853 had 29, 24, 25 and 22 calls, all from Knox, Magellan and Rosetta).
**Cause:** `assertRunCaps` compared each agent policy's `max_provider_calls_per_run` (Darwin 10)
with the whole run's `agent_runs.actual_provider_calls`. A state run holds several agents' paid
steps, so the earlier agents spent Darwin's cap for it.
**Fix:** an agent policy's per-run caps count only that agent's completed calls in the run
(`ai_api_usage_events` by `agent_run_id` and `agent_name`). Daily, monthly and global caps are
unchanged and still bind.
**Lesson:** a per-agent cap reads per-agent usage; a run-wide counter is only right for run-wide caps.

## 2026-10-07: Darwin held current-copy fees as duplicates of older copies at the same URL
**What happened:** at about 01:05 UTC, Hamilton's read-only counts found 1,108 live fees whose
Knox row on the bank's current page copy was held as `duplicate_in_batch` with no verified row on
that document. On prod, 1,919 current-copy rows at 199 banks were held that way.
**Cause:** Darwin's in-batch duplicate key used the source URL, not the stored document. When an
older and a newer copy of one page were in the same batch, only the older copy's fee was verified;
the current copy's fee was held as its duplicate and never selected again.
**Fix:** the key names the stored document (`DARWIN_BATCH_KEY_VERSION` 2), and those rows are
selected once more when nothing on their own document is verified as the same fee. Dry run at
01:15 UTC: 1,875 rows at 176 banks re-checked through every normal check; 1,470 of them match a
live fee by name and amount. Nothing live comes down.
**Lesson:** a dedupe key for one fee line names the document, not the URL; a URL has many copies.

## 2026-10-07: Ticks sat idle up to half the time because no step started after 150 s
**What happened:** at 04:00 UTC Oct 7, 43 lane runs were queued and about 6 finished an hour.
The tick audit rows (`api_route_audit_events`, 02:55 to 04:05) show ticks lasting 150 to 294
seconds out of each 300. Steps ran about 170 seconds per tick. A full lane pass is about 4
minutes of steps but took 10 to 15 minutes, because it spread over three ticks.
**Cause:** the tick started no new step 150 seconds after it began, however short the step.
A 6-second publish step waited for the next tick just like a 190-second paid search.
**Fix:** a step starts only when its expected runtime (p99 over 3 days, `STEP_EXPECTED_MS`
in run-store) fits before 270 seconds. Short steps use the end of a tick, and long ones
still start early enough to finish inside the 300-second limit. Runs stay serial, so the
database load per moment is unchanged. A state whose last finished lane run failed now
retries ahead of routine passes.
**Follow-up (04:30):** 22 of the 27 schedules found by hand (`discover.operator_schedule`, among
them Chase, Citi, U.S. Bank, KeyBank, Regions) were still unfetched 3 hours later, because only
their state's lane run fetches them and those runs waited in line. Next in the order after
retries now comes a lane whose state holds a hand-found schedule with status `found`.
**Follow-up (05:40):** after the change, runs per hour stayed at 6 (04:00 to 05:00). Two
causes. A later run in a tick ran only its quick first steps (enhance, state-expert), then
counted as under way and went ahead of the failed-lane retries (TX, CA, MI, NY, WI did this
from 04:39). A later run now starts only when its quick steps and its first real step fit
before the deadline. And a full pass is about 8 to 10 minutes of steps, mostly the paid
search and paid read (140 to 290 seconds each), so serial runs top out near 6 an hour. The
daily rule also put 36 of 55 states on daily full passes for any bank due a paid find (HI
had 1). Daily now needs 25 banks due, or a market leader due, and fewer due runs weekly
(21 daily states on the Oct 7 numbers).
**Follow-up (07:15):** Atlas's direct runs for one institution (PR 408) now fetch hand-found
schedules first, without waiting for their state's lane: Chase went live with 12 fees. The
lane key above then only pushed 15 whole states ahead of higher-scored ones for work the
direct runs already do, so it was removed.
**Lesson:** budget a serial worker by what each step needs, not one flat cut-off. Read the
tick latency in `api_route_audit_events` before guessing where the time goes.

## 2026-10-07: Lane runs waited 1h40m in launch order, so lane priority never applied
**What happened:** at 02:32 UTC Oct 7, 40 state-lane runs were queued and 1 was running.
MN was queued at 00:40 and started at 02:21. NE, queued at 00:40, had not started at 02:35.
In the 3 hours before, lane steps used about 113 minutes. Full passes took about 10 minutes
each, so the executor finished about six an hour.
**Cause:** the scheduler launched up to 3 lanes every 5-minute tick (36 an hour). It only
skipped a state whose own run was still active, so the queue filled to nearly every lane.
The executor took queued runs oldest first. The lane priority order (PR 262, PR 308) only
chose which lanes got launched, and then every lane waited its turn in the queue.
**Fix:** the scheduler launches only while fewer than `MAX_ACTIVE_STATE_LANE_RUNS` (3) lane
runs are queued or running. Each free slot goes to the highest-priority due lane. The
executor finishes a run it has started before starting a new one. After that it takes runs
waiting over an hour, then lanes by priority score. Lanes still cannot all run hourly: 55
lanes at about 10 minutes per full pass is more than an hour of serial work.
**Lesson:** a queue that refills faster than it drains turns any priority into launch order.
Cap what is queued to about one tick's worth of work, and order at the point of execution.

## 2026-10-07: Lane priority scores never left 0 because the query could not be planned
**What happened:** PR 262 (merged 17:07 UTC Oct 6) ranks state lanes by open work, report requests
and near-ready markets. At 00:47 UTC Oct 7 all 55 lanes still had priority_score 0, so Atlas kept
taking states in waiting order. Postgres logs show "operator is not unique: unknown - unknown" at
hh:00:32 every hour from 18:00 through 00:00 UTC: the hourly refresh ran and failed each time.
**Cause:** postgres.js sends JavaScript numbers as untyped parameters, and the near-ready rule wrote
`${MARKET_READY_MIN_RICH} - ${NEAR_READY_GAP}`. Postgres cannot pick a "-" for two unknowns, so the
whole UPDATE failed to plan. The function catches, logs and returns 0, so nothing else noticed.
**Fix:** every number and array in the refresh query now carries a cast (`::int`, `::text[]`); a
unit test fails if one is sent uncast. The fixed query, prepared on prod with untyped parameters
the way postgres.js sends them, plans and scores IL 2274, MO 2173, MA 2169, NJ 2128, CO 2022,
WA 2017, then TX 299.
**Lesson:** in a `sql` template, cast every interpolated number unless a column fixes its type
(`${n}::int`). Arithmetic between two parameters always fails. To test a query, prepare it with
untyped parameters (`PREPARE q AS ...`), not with the numbers pasted in.

## 2026-10-07: None of a week's fee-movement signals were real price changes
**What happened:** the 546 movements in `hamilton_fee_movement_detected` signals from Sep 30 to
Oct 7 were traced back to the documents behind the old and new rows. 502 were the same document
read twice with different amounts (498 before Oct 5), 23 had a different fee name, 10 came from a
copy of a different URL, 6 had no document lineage, and 1 was a byte-identical page. 4 came from a
newer copy of the same URL, but in each of those the old price was still listed on the new copy. None
was a clean price change on the same page.
**Cause:** Hamilton publish signals a movement whenever a newer read supersedes a live row at a new
amount. While fees are loading, those reads are rereads, recategorizations and new copies, not banks
changing prices.
**Fix:** `src/lib/agents/fee-movement-check.ts` keeps a movement only when both rows trace to
different copies of the same page URL, the new copy is newer, and `confirmFeeChange` (the rule Hamilton
and the Monthly Pulse use, in `monthly-pulse.ts`) bears it out. Fee alerts (free and watchlist) and the
Pro digest report only those. On prod, 19 of the 546 pairs pass the same-page filter; 3 of those have
the same fee name, and the two checked by hand (Mount Dora's "Monthly fee", a credit union's "Stop
Payments") were two lines or two layouts of one unchanged schedule. Publish itself still signals every
movement; that call belongs to the Hamilton publish owners.
**Lesson:** a "movement" signal is not evidence of a price change. Check the documents behind it before
telling a reader a fee moved.

## 2026-10-07: Prod's hamilton_watchlists.user_id is not the integer the migration declares
**What happened:** a read-only join `hamilton_watchlists w JOIN users u ON u.id = w.user_id` on prod
failed at 01:28 UTC with "operator does not exist: bigint = text", although
`20260815083600_hamilton_pro_base_tables.sql` creates `user_id integer`.
**Cause:** not yet known; the column was most likely created as text before that migration ran,
and `CREATE TABLE IF NOT EXISTS` left it as it was.
**Fix:** the Pro watchlist alerts and Monday digest (this PR) join on `u.id::text = w.user_id::text`.
Changing the column type is left alone until someone checks its values.
**Lesson:** a migration's `CREATE TABLE IF NOT EXISTS` is not proof of prod's column types; join
`hamilton_watchlists.user_id` through text, or check `information_schema.columns` first.

## 2026-10-07: The source check took down real fees whose price carried a note
**What happened:** a hand check of 24 random source-check takedowns from the last 30 hours (00:55
UTC Oct 7) found at least 6 real fees the bank's page states exactly, among them "Item Returned
for Non-Sufficient Funds / $29.00/presentment (applies to transactions of $10 or more...)", "Debit
Card Replacement / $10.00 per card replacement (normally up to 7 to 10 business days delivery)",
"Non-Customer check cashing (or 1% if check is over $500) / $5" and "Gift Cards ($25 up to $500
Only) | $5 per card". About 8 of the 24 were right to come down (wrong amount, wrong box size, a
cap read as a fee), and the rest could not be judged from the stored text.
**Cause:** `checkFeeAgainstSource` read a price printed under a name only when that line was short,
so a price followed by a note in parentheses never joined its name. It also treated a limit inside
the name's note ("over $500") as the row's price, and scored a figure inside a note
("($25 up to $500 Only)") ahead of the price printed after it.
**Fix:** the shared reader now accepts a price line that carries a note in parentheses. It ignores
figures inside a name's note when the row prints a price outside it, and looks below a name whose
only figures are limits. Hamilton's source check goes to v5, so every institution is checked again
and fees the older check took down are restored when they now trace. Wrong amounts still fail.
**Lesson:** sample takedowns as well as live rows; a strict check costs right fees too.

## 2026-10-07: The category guard was rejecting real check-card, teller's-check and charge-back fees
**What happened:** Darwin's category guard rejects about 100-170 new Knox fees an hour. Sampling
them (read-only, 00:50 UTC Oct 7) showed three groups of real fees it threw away: 82 check-card
replacements ("Visa Check Card Replacement": the card exclusion read "check" as a paper check), 13
"Teller’s Check" fees (the rule allowed "teller's" with a straight quote only) and 55 deposited-item
"Charge Back" fees (the rule knew only "chargeback"). The same check found 7 live rows in deposited
item returns that are card disputes or loan payment chargebacks.
**Fix:** category guard v14 reads curly quotes as straight ones, treats a "check card" as a debit
card (checks, checkbooks, PIN-only reissues and liability notes still fail), and reads "charge back" as a
deposited-item return unless it names a card, dispute or loan; card chargebacks re-file to card
disputes. A guard version bump makes Darwin re-check its rejected rows once, so about 150 rejected
fees get another chance (each still has to pass the source check). The 7 wrong live rows come down.
**Lesson:** a guard that rejects is also a coverage cost; sample its rejects, not just the live rows.

## 2026-10-06: The 7-state answer-key misses are mostly gaps in the keys, and five were real rules gaps
**What happened:** at 23:55 UTC, 425 of 450 live fees at the 38 answer-key banks in CA, FL, GA, IL,
MI, MN and NY matched their key (94.4%; 222 more came from other documents and are not scored).
Reading each of the 25 misses against the bank's own text: about 13 are real fees the key left out
or mapped elsewhere (a $10 late fee, a loan modification fee, a lien release, a replacement card),
and the rest are wrong. Two of the wrong ones are a shared-rule gap seen across all live rows: loan
late fees filed as overdraft (3 live: "Overdraft Loan Late Fee", "Late Payment fee (Overdraft
L-O-C)", "Loan Late Fee ... Overdraft") and "Int’l Wire Fee Out" filed as a domestic wire (2 live,
read before Knox v16 learned "Int'l").
**Fix:** category guard v13 fails a late fee filed as overdraft and an "Int'l" wire filed as domestic
(one price for "Domestic & Int'l" stays domestic), and Darwin re-files both. Knox v24 files a late
fee that names an overdraft line as a late payment fee. The dry run over live rows fails exactly those
5; Hamilton's publish step takes them down.
**Lesson:** an answer-key miss is a lead, not a verdict; check the bank's own line before changing a rule.

## 2026-10-07: Big banks call it a "Schedule of Charges", on the parent company's site
**What happened:** James, 00:52 UTC Oct 7. Citibank (institution 3) has no fee link and 0 live
fees; its consumer schedule is "Schedule_of_Charges_Effective_February_26_2026.pdf" on
citigroup.com, while its website is citi.com. Only the free finders' link phrases knew the
words "schedule of charges"; the page check's fee words and the paid prompts did not, and the
paid finders rejected any answer off the website's own host.
**Cause:** Magellan's fee vocabulary and domain rule were written from small-bank sites.
**Fix:** this PR. "Schedule of Charges", "Schedule of Service Charges", "Account Fee Schedule",
"Consumer Fees" and "Deposit Account Agreement" in the page check, link phrases and paid
prompts; `onBankDomain` (link-coverage.ts, shared by paid find and schedule search) accepts
the website's name plus a corporate word (citigroup.com, citibank.com), not look-alikes
(citizensbank.com).
**Lesson:** test finders against the largest banks' own wording and hosting, not only community banks.

## 2026-10-06: A fee document dated 2019 counted as a finished link
**What happened:** read-only prod query, 18:15 UTC Oct 6. Enterprise Bank & Trust ($17B, MO)
links `/scheduleoffees`, which today serves `.../files/2019-05/2019-05-15.pdf` (1,764
characters). Knox reads "Overdrafts Paid $30" from it, so the link passed every rule in
`link-coverage.ts` and no finder looked for a current schedule. 263 institutions' current
copies carry a year three or more back in their address; 4 of them are $10B+ banks.
**Cause:** link coverage asked what the page says, never how old it is.
**Fix:** this PR. `isStaleDatedLink` / `DOCUMENT_YEAR_SQL`: a current copy dated three or
more years back by its address counts as an incomplete link for the companion finder and the
paid schedule search; the old link and its live fees stay until something newer is found.
**Lesson:** a link that passes the content checks can still be years out of date; check the
date in its address before calling it done.

## 2026-10-06: A source-check version bump re-queued every bank at 40 a step
**What happened:** read-only prod queries, 15:25-15:35 UTC Oct 6. Live fees due a source check
rose from 4,070 (13:25) to 5,055 (15:25, audit tracker), and at 15:30 2,914 of 3,114 banks
(42,886 live fees) were due. 2,883 of them were due only because source check v4 (daily caps,
PR 271) went live at about 15:00: a strategy bump makes every bank due again. Before that,
v3 checks ran 157-247 banks an hour (11:00-14:59) while Knox re-reads and new publishes kept
raising banks' newest fee id, which also makes a bank due, so the backlog grew from 262 to 315
banks. Publish steps run about 12 times an hour at 40 banks each (4-15 s a step).
**Cause:** a fixed 40 banks per publish step could not absorb a full re-check plus the day's
new fees.
**Fix:** `SOURCE_CHECK_INSTITUTION_LIMIT` 40 -> 120 (PR 280). About 1,400 banks an hour, so a
full re-check clears in about 2 hours; the texts a step reads stay small (about 20 KB a bank).
**Lesson:** a version bump on a check that covers every bank needs the check's pace sized to
the whole catalog, or a catch-up pass, in the same PR; count the due backlog after each bump.

## 2026-10-06: Flat foreign transaction fees were mostly ATM, wire and rate rows
**What happened:** read-only prod query, 14:50 UTC Oct 6. Of 45 live `card_foreign_txn` rows
with a dollar amount, 13 were "ATM Foreign Transaction Fee" (a fee for using another bank's
ATM, $1-$5), 3 were wires ("1.1% foreign transaction fee ...: WIRE TRANSFERS" $10/$15,
"Currency Conversion Assessment | Domestic Wire In" $10), 6 were a rate read as dollars
("Debit Card Foreign Transaction 1% of the U.S. dollar amount" $7, "VISA Exchange Rate" $1 with
"Percentage of transaction", "Foreign Transaction" $2 with "2.00% of transaction"), 3 were
foreign currency or check services, one joined a low-balance fee from the next cell, and two
were sentences ("Many Canadian credit cards charge ... 2.5%").
**Cause:** Knox's `card_foreign_txn` pattern matches "foreign transaction" before the ATM
pattern, and the category had no guard, so nothing checked the name or a rate on the line.
**Fix:** category guard v11 guards `card_foreign_txn` (ATM, wire, currency-service, joined-cell
and sentence names fail) and fails a dollar amount whose name states a percent or a rate, or
whose stated terms state a percent (`rate_as_amount`); a rate row has no dollar amount, so it
never fails. Darwin re-files "ATM Foreign Transaction" to `atm_non_network`, and Knox v20 files
it there on the next read. The dry run takes down 28 of the 45 and keeps 17. Two kept rows are still wrong and need
the source, not the name: a credit card box whose "$10.00" belongs to the line above while the
foreign fee is 1%, and "Foreign transaction fee2" $1, whose footnote says it is a foreign-ATM fee. The live rows waited on someone starting the admin category guard repair run, so every publish step now runs the category guard itself (up to 100 rollbacks a step, PR after 280).
The first step (17:56 UTC, run 1787) rolled back 42: the 29 flat foreign fees plus 13 that
failed older rules no repair run had applied since 06:18 (night deposit bag purchases, foreign
returned items, an overdraft loan's annual fee). One of the 13 was wrong: "Foreign Owned ATM
Fees" read as a bank's own ATM; guard v12 lets "foreign-owned ATM" through as non-network.
**Lesson:** a category whose fee is usually a rate needs a check that a dollar amount filed
under it is not the rate's figure; rates belong in the rate columns, never in `amount`.

## 2026-10-06: No bank market can pass the report rule soon, and percentage fees never count
**What happened:** read-only, 14:10 UTC: 6 of 109 state markets pass James's report rule (16
rich institutions of one type in a state), all credit unions. The closest bank market is MA
(12 of 16); OK and IL banks have 9. AK has 5 banks in total and WA 31 with 1 rich, so the
real requesters there (First National Bank Alaska, Banner Bank) cannot pass the state rule.
`card_foreign_txn` is a headline fee live at 42 institutions, while 347 more have a foreign
transaction fee held as `knox_review:percentage`.
**Cause:** the rule counts only same-state, same-type peers. Percentage fees have no path
to the catalog. Requester gaps were wrong or partial links (a business-only PDF; a general
services page without account fees) and Knox misses (wires, prose maintenance fee).
**Fix:** Atlas now runs states with a failing report request and near-ready bank markets
first. The link and extraction gaps went to Magellan and Knox. The rule itself (peer fallback
for small states) and percentage fees are open.
**Lesson:** check whether a market can reach a threshold at all before scheduling toward it.

## 2026-10-06: The spend ledger left out web search charges, so caps undercounted Magellan
**What happened:** read-only, 13:50 UTC: `pipeline_attempts` recorded $8.35 for today's 152
paid web searches; `ai_api_usage_events`, which the budget caps and per-run limits sum, recorded
$4.41 for the same 152 calls. October so far: $16.47 in attempts, $8.75 in the ledger.
**Cause:** `trackAnthropicRequest` priced tokens only. Anthropic also bills $10 per 1,000 server
web searches; `paid-pass.ts` added that to the attempt cost, but the ledger never saw it.
**Fix:** the ledger estimate (`estimateAnthropicCostMicrousd`) counts
`server_tool_use.web_search_requests`, and `paidCallCostMicrousd` uses that same estimate, so the
attempt log and the ledger agree. Covers paid find and website find. Earlier rows stay as written
(about $7.72 under for October), well inside Magellan's $150 cap.
**Lesson:** a charge priced in one place and logged in another drifts; price it once, in the
function the caps read.

## 2026-10-06: Atlas took states in waiting order, not where the work was
**What happened:** after PR 204, a state's median gap between runs was still 135 minutes (live,
13:20 UTC, last 6 h). Every lane's `priority_score` was 0, so Atlas picked whichever lane had
waited longest. Texas (196 banks due a search, 181 not source-checked) waited as long as
Vermont. The daily-pass rule counted 2,024 dead-end banks, which kept 23 states on daily paid
passes that could never turn off. The state experts ranked finder strategies (Texas: site crawl
80%, sitemap 0 of 23), but nothing read the ranking.
**Cause:** `priority_score` was never written, and the daily rule counted every bank missing a
link. `stateExpertHints` had no caller.
**Fix:** the Atlas gaps PR. The hourly sync scores each lane by its banks with open work or a
recent error, and due lanes run highest first; a lane 3 h overdue goes first. Only findable
banks count toward the daily rule (5 states on that count alone: TX, IL, MN, IA, MO), and a
state with paid-find or no-website targets stays daily so the paid steps still run (live
13:45 UTC: 51 states have paid-find targets, 459 banks, plus 582 institutions with no
website). Magellan runs each state's best
finders first. Launches go from 2 to 3 per tick.
**Lesson:** a column the scheduler sorts on must have a writer, and a promise in AGENTS.md
("Magellan uses the hints") needs a caller and a test.

## 2026-10-06: a re-confirmed reader stayed unsubscribed in MailerLite, reported as synced
**What happened:** James's live test. He unsubscribed at 14:34 UTC, signed up again and confirmed
at 14:41. The lead rows showed confirmed and not unsubscribed, but MailerLite subscriber
200589712283404206 stayed "unsubscribed", and the sync returned "synced". The same reader also
ended up in two state groups (FL from the confirm page, AL from an older row's use_case).
**Cause:** MailerLite's upsert (POST /subscribers) does not bring back an unsubscribed address
unless the request says to resubscribe, and it still answers 200. The sync checked only the HTTP
status. A later form with no state re-sent a state read from an old row.
**Fix:** this PR. A sync right after a confirm link sends `resubscribe: true`; every sync checks
the status MailerLite stored and reports "failed" when it differs; a reader joins only the state
they picked last and leaves other state groups; a form with no state leaves the group alone.
**Lesson:** check what an external API stored, not only its status code.

## 2026-10-06: Every daily overdraft cap was taken down, and none of the largest banks had one
**What happened:** of 185 active institutions with $10B or more in assets, 40 had a live overdraft
fee and 0 a daily cap (prod read-only, 14:00 UTC). Nationwide, all 251 dollar caps
(`od_daily_cap`, `nsf_daily_cap`) the source check reviewed were taken down; 16 were live. The
145 large institutions without an overdraft fee were lost mostly before extraction: 130 at
Magellan (76 of them read a product or marketing page, not the fee schedule). Breakdown:
`/mnt/project-files/accuracy/largest-banks-od-gap-2026-10-06.md`.
**Cause:** `checkFeeAgainstSource` reads a row's price as its first figure after the name, so a
cap ("$20.00 | Per Item | Maximum of $120.00 per day") always failed as `amount_is_a_threshold` or
`amount_not_the_fee`. Count limits ("Maximum 3 Overdraft fees per day") had no reader at all.
**Fix:** this PR. The shared check reads a daily cap's figure after cap wording and before "per
day" (source check v4 re-checks and restores; dry run restores 29 caps at 23 institutions, 0
before), and `src/lib/fee-daily-limit.ts` reads count limits for Hamilton's segment answer (dry
run: 11 of the 40 large banks with a live overdraft fee).
**Lesson:** a check that defines a fee's price as "not a limit" must special-case fees whose
value is a limit. Measure coverage on the institutions buyers look for first, not only by state.

## 2026-10-06: Magellan called a link "found" when it was not the consumer fee schedule
**What happened:** read-only prod queries, 14:15-14:30 UTC Oct 6. 187 active institutions'
only fee link is a business-only schedule (882 live fees), e.g. First National Bank Alaska's
`Business-Account-Fee-Schedule.pdf` with `rescue_status = 'rescued'`, so no search tried again.
Of 144 banks over $10B with no live overdraft fee, 94 hold a page with no overdraft price
(Wells Fargo's Clear Access summary, JPMorgan Chase's 2021 press release, product pages), 52
have no link, 7 no website, and 14 hold a text that does price it (Knox's work). Banner Bank's
fee page sends readers to its deposit account agreement, but the companion finder ordered
banks by fewest fee categories, so Banner (14) was never searched: 1,451 eligible banks were
untried at about 207 a day.
**Cause:** "found" meant "passed the fee-page check", which a business schedule or a product
page can pass; nothing asked whether the page prices the fees buyers look for.
**Fix:** this PR. One shared rule, `magellan/link-coverage.ts` (business-only link, no overdraft
price in any stored text, or a text that refers elsewhere). The fee-page check rejects
business-only schedules; business-only links get one re-search that keeps the old link until
a consumer schedule is found; the companion finder takes these banks, report requesters and
$10B+ banks first; a paid schedule search (`schedule-search.ts`) takes $10B+ banks and
requesters from any state, adding the answer as a companion so no live fee is lost. JPMorgan's
8 stored copies of one page were byte-different fetches of the same text; PR 265 already marks
7 of them as history. The $10B+ banks whose every fetch failed (11 with a link and no
successful fetch) mostly answer 403 to the crawler, and several links were wrong anyway (a
product page, a student-loan hub, Bell Bank's link on cincinnati-oh.gov, a page-not-found);
with no stored text they count as "no overdraft price" and enter the paid schedule search.
**Lesson:** judge a found page by what it must contain (an overdraft price for a consumer
schedule), not only by whether it looks like a fee page.

## 2026-10-06: A page kept every copy Magellan ever stored, with no "current" mark
**What happened:** 18,374 `source_documents` rows cover 8,233 pages (institution + URL),
read-only prod query 13:45 UTC Oct 6. Of the older rows, 6,936 are failed fetches and 3,061 are
older successful copies at 1,712 banks, and 12,835 live catalog fees cite one of them.
**Cause:** fetch inserts a new row when a page's content changes and nothing marked which copy
is current, so each reader worked out "newest" its own way.
**Fix:** this PR: `source_documents.superseded_by_id` (migration `20270110000004`) marks older
successful copies of a page; Magellan's fetch keeps it current (`magellan/current-copy.ts`).
Rows are only marked, never deleted, so every fee keeps its source link. Knox re-reads the
current copy and supersedes the old fees.
**Lesson:** when an agent stores history, it also stores which row is current, in one field
every reader shares.

## 2026-10-06: Institutions with no website were never searched
**What happened:** 585 active institutions have no `website_url` (510 credit unions, 75 banks; 45
in TX, 27 in CA, prod read-only query 13:30 UTC). Every finder and the paid pass start from the
website, so these were skipped forever.
**Cause:** the FDIC registry step fills `website_url` only when FDIC lists one, and the NCUA step
stores none. Some state-chartered credit unions also carry a cut-off name ("CALIFORNIA", "HAVEN").
**Fix:** Magellan's paid step now searches for the official homepage and saves it only after the
homepage names the institution plus its city or charter number (`magellan/website-find.ts`).
Rejected candidates stay on the attempt for a person. Cut-off names still need a registry fix.
**Lesson:** every finder assumes a website; count the rows a precondition excludes before
assuming a finder covers a state.

## 2026-10-06: Right price, wrong category is most of what keeps states under 95%
**What happened:** after source check v3 finished every bank (10:25 UTC), Texas measured 96.7%
(145 of 150 live fees, hand-checked) but the seven answer-key states stayed at 93.8% (393 of 419,
`/mnt/project-files/accuracy/states-live-misses-2026-10-06-1320.csv`). 25 of the 26 misses had the
right price. About 9 of them are the answer key's own gaps (a fee keyed "unmapped" or under the
row next to it), about 9 are taxonomy calls (returned item: NSF or deposited item), and 8 are real.
**Cause:** the source check confirms a fee's name and price in the schedule, never its category.
Three Knox name rules filed real fees wrongly: "Int'l"/"out of country" wires as domestic,
"Checkbook Balancing" as check printing, and "NSF Fee (applies when overdraft...)" as overdraft.
**Fix:** Knox rules v16 (this PR). Read-only dry run over the 2,073 live fee names those rules can
touch: 62 live fees change rule category; 21 of them are live under the wrong category today
(6 wires, 12 checkbook balancing, 3 NSF), and the other 41 already sit in the right one. No live
fee moves to a worse category. Answer-key gates: seven states 681 to 683 right and 58 to 55 wrong;
Texas 460 to 461 right and 18 to 17 wrong.
**Lesson:** a price check cannot catch category errors. Measure category separately, and fix the
answer key when it is the thing that is wrong before counting a miss.

## 2026-10-06: James's request email carried the paid report link
**What happened:** the funnel re-audit found the report check line in James's request email and in
`leads.use_case` included the live private report URL. That email's Reply-To is the requester, so a
normal reply would hand them the paid report for free.
**Cause:** the line was written when James sent the link by hand after agreeing a price.
**Fix:** `describeQuoteCheck` no longer includes the link; only a Stripe payment issues it
(funnel fixes PR 239). Links already stored in older rows' `use_case` are not removed.
**Lesson:** anything in an email with the requester as Reply-To can reach the requester; never put
a paid deliverable in it.

## 2026-10-06: Server actions sat outside the API rate limits
**What happened:** the funnel audit found free signup (`register`, a server action) had a honeypot
but no rate limit, while every lead form had one. API limits only cover routes in
`API_ROUTE_POLICIES`, and a policy test requires each of those to be an `/api` route file, so a
server action could not be added there.
**Cause:** the limiter counted audit rows per API route bucket; nothing wrote audit rows for actions.
**Fix:** `src/lib/api-hardening/action-rate-limit.ts` gives an action its own policy, writes one audit
row per attempt and counts them (signup: 8 per 10 minutes per connection, like the lead forms).
Funnel fixes PR (this branch).
**Lesson:** a public server action that creates rows or sends email needs
`isServerActionRateLimited` with its own policy, the same as an API route.

## 2026-10-06: Rosetta re-downloaded links that kept timing out or blocking it
**What happened:** the Rosetta audit (read-only queries on prod, early 2026-10-06 UTC) counted 3,086 failed downloads in 24 hours. PR 155 stopped the 404 repeats (none after 01:00 UTC), but 26 tries on 14 documents that failed with 403s, timeouts and network errors kept coming back. The fee-page check also counted only "$" amounts, so a page that writes fees as "75¢" or "$.50" scored fewer amounts than it has.
**Cause:** a timeout, network error or server error was "transient" with no limit, so the same document was downloaded every run. A 403 was handed back only when it repeated, and only while the bank's link still pointed at it. The amount pattern was `\$\s?[0-9]`.
**Fix:** this PR. The third failed download of a document in 7 days (403, 429, 5xx, timeout, network error) sends the bank back to Magellan, and the document is not downloaded again until 7 days pass. The fee-page check now also counts "$.50", "75¢" and "50 cents". Neither change takes down a live fee.
**Lesson:** every retryable outcome needs a cap. "Transient" without a limit is an endless loop.

## 2026-10-06: Out-of-date fee links were never searched again
**What happened:** 437 active banks' fee links are 3+ years old by their own "Effective" date or the year in their address (read-only query on prod, 07:30 UTC). Chase's stored link is a 2021 news article about overdraft fees. A bank with any link was never re-searched unless the link died.
**Cause:** discovery only selects banks with no link or a failed one; nothing looked at a link's age.
**Fix:** freshness search in `magellan/discovery.ts` (this PR): one re-search per stale bank in spare capacity, an hourly slot at a time (48 ms per slot); the link changes only when a different page passes the fee-page check.
**Lesson:** a link that still loads is not a current schedule. Check age, not just reachability.

## 2026-10-06: Ask Hamilton failed on the preview and saved an empty answer
**What happened:** At 03:01 UTC James asked a question on the PR 89 preview. The route audit
(`api_route_audit_events`) shows `/api/research/hamilton` answered 503 in 160 ms, and
`ai_api_usage_events` shows no provider call. The page showed a red error and an empty
"Hamilton's view" card, and it said "Analysis saved to workspace".
**Cause:** Vercel preview deployments have no `ANTHROPIC_API_KEY`, so the route stops before any model
call. The page's `onFinish` ran on the failed reply and saved an empty analysis, and its error text
didn't say why.
**Fix:** PR 89 ignores failed or empty replies (no answer shown, nothing saved) and says plainly when
the AI isn't switched on for a preview. The Ask screen was rebuilt as a memo. A preview still can't
answer questions; feeinsight.com can.
**Lesson:** Test paid-model screens on production, or add a preview-scoped key in Vercel if James
wants previews to answer. Never save or show a reply the stream marked as an error.

## 2026-10-06: A paid user could be offered checkout a second time
**What happened:** the full funnel audit (finding 9) traced a path where someone who had just paid
opened a Pro page before Stripe's webhook marked them active. The Pro gate sent them to
/subscribe, which offered checkout again with no word on why they were there (finding 12). No
double charge is known; the path was found by reading the code.
**Cause:** only /account/welcome asked Stripe directly whether a user had paid. Every other page
trusted the webhook-written status, and /subscribe never explained the redirect.
**Fix:** PR 201 (merged): `activateIfPaid` in `src/lib/subscription-activation.ts` runs on
/subscribe before plans are shown, so a paid user goes straight back to the page they opened. PR 89
dropped its own copy of the check in favour of this one, and its /pro redirects now pass a reason
that /subscribe shows in one line ("activating" for a Stripe customer, otherwise "pro_required").
**Lesson:** any page that can sell must first check whether the person has already paid.

## 2026-10-05: A supply price was published as a Night Deposit fee
**What happened:** Hamilton's briefing for Texas National Bank of Jacksonville led with "Night
Deposit $3.00 against a $5.00 median". The $3.00 row in `published_fee_catalog` is "Zipper Bags",
the price of deposit bags the bank sells, filed under `night_deposit`.
**Cause:** not yet traced; most likely the category rule lets product and supply prices that sit
near a fee name into that category.
**Fix:** none yet; reported to Improving Hamilton for whoever owns Knox and Darwin.
**Lesson:** a headline fee should be checked against its row's fee name before it leads a page.

## 2026-10-06: Magellan stopped at a homepage that blocks bots, and searched misspelled websites
**What happened:** the Magellan audit (MG-7, MG-8) found about 120 bank homepages a day answer
our crawler with 403 or a bot page, so `discover.homepage_links` finds nothing; and 43 active banks
have malformed `website_url` values (16 "www" with no dot, such as "wwwbank.com" or "www.bankcom";
27 odd domain endings). Those counts are the audit's; they were not re-measured here.
**Cause:** `discovery.ts` returned `blocked` as soon as the homepage answered 401/403, so the site
map specialist, which needs no homepage, never ran. A 200 challenge page was searched as if it
were the homepage. Discovery read `website_url` as stored: "wwwbank.com" is a valid host, so it
was fetched and failed as unreachable (retried every 12 hours) instead of being fixed. There is
no other stored website to fall back on: the FDIC registry step reads `WEBADDR` but only fills an
empty `website_url`, and the NCUA step stores no website at all.
**Fix:** discovery method version 4. A 401/403 or a challenge page now runs the known link and the
site map (robots.txt `Sitemap:` lines, else `/sitemap.xml`, then `/sitemap_index.xml`, with
robots.txt Disallow rules respected and fee-named PDFs opened); a find is code
`found_blocked_homepage` with `detail.rescue = 'blocked_homepage'`, and every attempt carries
`detail.homepage_blocked`. A 429 still stops. The website is repaired first
(`website-repair.ts`, attempt `discover.website_repair`), saved unless a correction locks the
bank, and an unreadable one is `needs_human` (`website_unrepairable`). Branch
`magellan/mg7-mg8-blocked-homepage-url-repair`, not merged.
**Lesson:** a specialist that needs no homepage must not sit behind the homepage fetch. If a
registry website should back up a bad stored one, the registry steps must store it in its own
column; today they do not.

## 2026-10-06: Product pages became banks' fee links
**What happened:** the Magellan audit (read-only queries on prod, Oct 6) found 853 of 4,451 fee
links were account or product pages ("/personal/checking"), not fee schedules; those banks had a
median of 4 live fees against 15 for fee-named links. In a random sample of 40 links, 9 were
product pages. In the two days before, 57% of 960 new finds were product or rates pages.
**Cause:** the fee-page check accepted any HTML page with two fee words, counted on the raw page
including its menu and footer, where "Fee Schedule | Truth in Savings" appears on every page of a
bank's site. A checking page quoting its monthly charge passed.
**Fix:** this PR counts fee words on the page's own content only and requires, below the 3 fee
line bar, an address that names the fee page or a strong label plus a listed fee; product pages
are rejected (`product_page`). Banks that already hold a product-page link get one upgrade search;
a find replaces the link and keeps the product page as a companion account page. Dry run before
merge (read-only, 06:35 UTC): 784 unlocked banks qualify, 131 of them with live fees; links stay
until a real schedule is found.
**Lesson:** never judge a page by words that sit in the site's shared menu or footer.

## 2026-10-06: Almost a third of sampled "fee schedule" texts are not fee schedules
**What happened:** building answer keys for CA, FL, GA, IL, MI, MN and NY, 18 of 56 sampled stored
texts (newest completed `agent_source_texts` per bank, 1,500 to 60,000 characters) turned out not to
be fee schedules: product pages, rate pages, a disclosure, a funds-availability policy, a homepage.
Three are plain wrong stores: FL 11295 is a 404 page, IL 1644 is empty (0 bytes), NY 7750 is the
credit union's homepage while its URL is a registration-guide PDF. NY was worst: 6 of 8.
**Cause:** not yet known per text; the sample counts are hand-read, not a full measure.
**Fix:** none yet; the Knox gate scores only the 38 real schedules. Reported to the Magellan thread.
**Lesson:** a stored text is not proof the bank's schedule was found; measure share of real
schedules per state before trusting a state's coverage.

## 2026-10-06: A fee the rules re-check took down could never come back under the same name
**What happened:** the Hamilton audit saw real fees taken down as `rules_recheck_unreproduced`
(4,122 on prod at 06:00 UTC, read-only query) with no way back. Only 443 of them are live again, all
under a new name.
**Cause:** the re-check only rolls back. It asks Knox to re-extract a text with missing fees, but
Knox's raw-row dedupe index (`raw_fee_observations_knox_agentic_dedup_idx`: document, lower(name),
price) refuses the same raw row, so a fee re-read under the same name inserts nothing. A document
whose live fees were all taken down was never re-checked again either.
**Fix:** this PR: re-check version 2 restores such a fee (same text, name, category and price, still
traces to the text, no live copy). A real-code dry run over 60 sampled documents (145 taken-down
fees) found 1 candidate, already live elsewhere, so today it restores close to nothing; it matters
after the next rules fix.
**Lesson:** any step that takes data down needs its way back in the same change, checked against
the dedupe rules of the stage that would otherwise re-create it.

## 2026-10-06: Companion pages picked up a HELOC PDF and pages named "Download"
**What happened:** 25 minutes after the companion finder went live (06:39 UTC, read-only queries on
prod), 25 fees from companion pages were live. One came from a HELOC disclosure: Frontier CU
(institution 8455) published "early_closure" at $1,214.50 (published id 60403) from
`heloc-important-terms-disclosures`, a link labelled "Download". Santander's three CFTC
derivatives annexes were stored as consumer documents. Pages were named after their link text:
PNC's "Product Details" and "Features and Fees", Frontier's "Download" and "See Rates".
**Cause:** the finder's not-a-fee-document list had "loans" and "mortgage" but not "HELOC",
"home equity", "line of credit" or "derivatives", and a fee-ish word in the path ("disclosures")
made the PDF a fee document. Account names fell back to the URL only for "Learn more"-style labels.
**Fix:** this PR. The finder skips HELOC, home equity, line of credit, introductory rate, lending,
swap, derivatives and blog links, and names "Download"/"Features and Fees"/"Product Details" links
from their URL. Every companion fetch re-applies today's rules to the pages already stored for
its state: a page that is now ruled out is retired with reason `not_consumer_fee_page`, a
link-text name is replaced. Each Hamilton publish step then rolls back live fees from retired
pages (reason `companion_page_retired`) and rejects their verified rows, with a
`hamilton.companion_fees_rolled_back` run event. Dry run on prod: 5 pages retired, 1 live fee
(60403) taken down. The sentence-fragment and $0 "free/includes" fees from account pages
(60485, 60393, 60386, 60377, 60409, 60387) are Knox/Darwin rules, routed to the 95% thread.
**Lesson:** a finder rule must reach pages found before it. Any new exclusion goes in
`second-document.ts` and the companion review applies it to every state on its next fetch.

## 2026-10-06: Dead fee links were re-fetched forever and never re-searched
**What happened:** the Magellan audit (05:05 UTC, read-only queries on prod) found 75 active banks whose
fee link last returned HTTP 404 and 39 that returned 403, still holding that link; 29 of the 404s had
failed two or more fetches in a row (one 11 times). Separately, 42 banks' fee links redirected to a
homepage in the week to 2026-10-06 (for example a credit union's old fee PDF now landing on a renamed
credit union's home page), and Magellan stored each homepage as the bank's fee document.
**Cause:** a failed fetch only counted a failure and retried later (24 hours, then weekly). Discovery
searches banks with no fee link, plus (PR 165) a failed link whose `last_crawl_at` is over 30 days
old and holds no live fee. That PR 165 path never reaches a link the fetch queue keeps retrying,
because every retry resets `last_crawl_at`: none of the 75 was older than 30 days. Rosetta sends a
dead link back only for a document it re-reads (PR 155). A redirect was followed blindly, and the
final address (the homepage) became the profile's fetch address.
**Fix:** this PR closes the gap at the fetch itself, with the same hand-back Rosetta uses: a 404/410,
or a deep link that redirects to a homepage, clears the fee link (unless a person locked it), records
the URL as rejected and marks the bank due a search (`failure_reason = 'magellan_dead_link'`). A 403
is left alone because a bot block can pass. PR 165's discovery condition stays for old crawler links.
**Lesson:** every stage that learns a link is gone must hand the bank back to discovery; a retry
loop on a dead address is a silent failure.

## 2026-10-06: Slow bank sites were cut off at the same point on every discovery search
**What happened:** the Magellan audit (read-only, 6 Oct) counted 513 active banks with a website and no
fee link whose last free search ended `retry_after` because the `discover` step ran out of time partway
through the bank. Every 12 hours they were searched again from the first specialist and stopped at
about the same place, so the later specialists (hub pages, guessed paths, peer hint, site crawl) never
ran for them.
**Cause:** a search had no memory between steps. Each bank gets 45 s (`INSTITUTION_BUDGET_MS`), less when
it starts late in the step (the step stops at 100 s), and `retry_after` banks sort last in the batch, so
they usually got the squeezed budget. The next search repeated the specialists already done (homepage,
robots.txt, site map), spent the same time there and stopped in the same place. Once the profile showed
two failures in a row (`OUT_OF_TIME_RETRIES`) the next cut-off made the bank a miss, which waits a month,
and then the loop began again.
**Fix:** MG-6 (branch in this PR, not merged): a search cut short writes `detail.resume` on its last
`pipeline_attempts` row (specialists finished, where the clock stopped, how many cut-off searches). The
next search of that bank skips the finished specialists and starts at the next one. A specialist the
clock stops inside twice on a full budget is skipped; after 12 cut-off searches the bank is a miss. The
first cut-off bank in each step goes to the front and gets the whole 45 s; other banks keep their place
and the step's budget is unchanged (no Vercel plan change). No migration.
**Lesson:** work that can outlast one function call needs a saved place to continue from, or the same
budget is spent on the same first steps every time.

## 2026-10-06: Report requests never stored their "ready to quote" line
**What happened:** the end-to-end test request (lead 18, 05:39 UTC) and James's own request (lead 17,
5 Oct) were stored without the "Report check: ..." line that /api/leads should append, so /admin/leads
could not say whether a requested report can be built. Both emails went out (the API answered
`notification: sent, confirmation: sent`).
**Cause:** `leads.id` is bigint and the Postgres driver returns bigint as a string. The route kept the
id only when `typeof id === "number"`, so it was always null: the quote line update and the
failed-email marking (`handleLeadDeliveryOutcome`) never had a row id.
**Fix:** the route parses the id from a string or a number; test added. PR on branch claude/project-thread-uc3vox.
**Lesson:** bigint columns arrive as strings; never gate on `typeof id === "number"` for a bigint id.

## 2026-10-06: Knox reads the same web page several times, and checks nothing he writes
**What happened:** the Knox audit (read-only prod queries, 05:00-05:30 UTC) found 632 fee pages stored
as 2 to 10 separate `source_documents`. Knox extracts every copy: 14,895 extra raw rows, of which Darwin
dropped 9,782 as duplicates. 4,972 live fees at 430 banks come from an older copy of a page that has a
newer one; 89 of them have a price the newest copy does not show. Separately, pass 2 specialists keep only
rows that already pass Darwin's checks, so Darwin cannot catch them: 21% of their approved fees were
pulled later (1,027 name not on the page, 738 wrong number) against 12% for the line rules. Accuracy:
86.0% on 578 fees at 29 Texas answer-key banks (54% of each schedule found); 76 of 103 right in a national
random sample of stored rows, 9 of 103 still wrong when the same lines are replayed through rules v11.
**Cause:** Knox's "read each text once" and older-text retirement are keyed on one document, not on the
page's address. Knox never runs `checkFeeAgainstSource` on his own rows.
**Fix:** rules v12 (PR 207) reads price-first table rows ("$20.00 | Domestic outgoing wire", which the
rules re-check could not reproduce) and stops two misreads seen in the sample: a limit, threshold or refundable
deposit after a price ("Money Orders ($1,000 Limit)") and a column label cell ("Fee Rush Card Fee |
Amount $50") hiding the fee name. One document per page and a Knox self-check are open, waiting for James.
**Lesson:** a dedupe or retirement rule must be keyed on what is really the same thing (the page), not on
the row id that stored it. A specialist that pre-filters by the next agent's rules removes that agent's check.

## 2026-10-06: Every state lane stayed awake with nothing to do, so busy states waited two hours
**What happened:** the Atlas audit (read-only queries on prod, 05:00 UTC) found no state lane ever
went to sleep. The scheduler starts 2 lanes per 5-minute tick (24 an hour) for 55 lanes, so each
state ran every 130 minutes (median gap over 24 hours) instead of hourly; 32 lanes were overdue
at 05:01 and none was queued. 108 of 444 backlog runs in 24 hours found nothing to read, extract,
verify, publish, discover or fetch, while Texas had 229 banks due a free search.
**Cause:** `stateHasDocumentBacklog` counted 1,536 thin texts as "to re-extract", but 1,506 of them
are texts Knox already extracted under another document id, which Knox's own selector skips
forever. The check and the step disagreed, so the lane looped.
**Fix:** this PR: the backlog check skips the same duplicate texts Knox skips, and an idle lane
checks again within 12 hours instead of sleeping until next month (so a missed search coming due
or a link going stale still wakes it). 22 lanes with no work now sleep and give their slots to
the 31 with work.
**Lesson:** a lane's "is there work" check must use the same filters as the step that does the
work. When a step's selector changes, change the backlog check with it.

## 2026-10-06: Darwin passed fees the bank's own schedule does not state
**What happened:** of the Darwin-verified fees published and later taken down (read-only query on prod,
04:50 UTC), 2,740 failed Hamilton's source check (1,370 name not in the text, 1,064 amount not the fee,
304 amount is a threshold), 2,685 of them published in the last 24 hours. Another 4,032 were rolled
back when newer Knox rules no longer read them, and 454 failed the category guard. 37,709 Darwin-verified
fees are live.
**Cause:** Darwin checked a fee's name, category, range and peers but never read the document. The
check that reads it (`checkFeeAgainstSource`) ran only after publication, as Hamilton's takedown sweep.
**Fix:** this PR: Darwin runs the shared source check against the fee's own stored text before verifying
it (reason code `not_in_source`, rejected). Hamilton's sweep stays as the safety net for live fees.
**Lesson:** a check that can stop a wrong fee before it goes live belongs at the gate, not only in a
sweep afterwards.

## 2026-10-06: The live board showed a Darwin backlog that did not exist
**What happened:** /admin/live showed 2,838 banks waiting at Darwin (04:30 UTC, read-only query on prod).
Every one of the 18,843 Knox rows behind that number already had a Darwin decision under the current
rules (`verify.rules` v3): 9,756 duplicates of a fee verified in the same batch, 5,322 rejected for
category mismatch, 2,374 held as outside the category's range, 1,391 held as peer outliers. Zero rows
were unchecked. Darwin's classify step ran 523 times in 24 hours with a median of 0.9 s (p90 8.2 s);
its queue wait (median 329 s) matched Knox's and Hamilton's.
**Cause:** the board's Darwin count (`getFlowWaiting` in `src/lib/agents/flow.ts`) counted every raw
row missing from `verified_fee_observations`. Rejected, held and duplicate rows never get there, so
they counted as waiting forever.
**Fix:** this PR: the count skips rows that already have a `verify.rules` attempt at the current version,
the same test Darwin's own batch query uses.
**Lesson:** a "waiting" count must use the stage's own done-marker (its `pipeline_attempts` row), not
"missing from the next table", or every rejection reads as backlog.

## 2026-10-06: Banks that publish fees across several pages kept only one page's fees
**What happened:** James spotted Triangle FCU (MS, institution 5829): 4 live fees (wires in $10 and
out $20, cashier's check $5, check cashing $10), all from its "Additional Services" page, while
its Freedom and Value Checking pages and a courtesy pay PDF ($25 per item) carry the rest.
Read-only queries on prod at 03:25 UTC: 2,066 of 2,662 institutions with live fees have only
ever had one URL fetched; only 604 of 2,637 have a live monthly maintenance fee; 143 have an
account or product page as their only fee link, 87 of them with fewer than 5 fee categories
(Fremont Bank, Primis, Arizona Financial FCU, Minnwest).
**Cause:** discovery stops at the first page that passes the fee-page check (Triangle: the site
crawl at 03:11 UTC accepted Additional Services and never opened the checking pages), and only
banks with no fee link are searched again. The second-document finder (PR 75) kept at most one
extra document and had found 4 ever; nothing fetched what it found. The rest of the pipeline
assumed one current document per bank: Rosetta read only the newest document, a newer document
could send the main link back to discovery, and Hamilton let a newer document outdate another
document's line for the same fee.
**Fix:** this PR. Companion finder (`discover.second_document` v2) keeps up to 8 account pages
and fee documents per bank, including the site's own search for "fee schedule"; companion fetch
stores each as its own document stream (`source_documents.companion_source_id`, migration
20270109000000); Rosetta reads the newest document of each stream; Hamilton compares document
age only within a stream. Each page keeps its account name (`institution_additional_sources.account_name`).
**Lesson:** "one fee page per bank" is not true for small institutions. Check fee coverage per
bank (categories, monthly fee present), not only whether a fee link exists.

## 2026-10-06: Texas fee schedules went months without a re-fetch
**What happened:** the Texas state report failed its 90-day freshness check (`src/lib/report-engine/freshness.ts`):
the median `institution_sources.last_crawl_at` for Texas was 181 days at 03:05 UTC (read-only query on prod).
Of 741 Texas rows, 479 were last crawled over 90 days ago; 189 active fee links had not been fetched
in 30+ days, and 695 such links existed across 13 states.
**Cause:** stale links were only re-fetched in a state's full pass, 50 at a time in Texas, while the
hourly backlog fetch took only newly found links. About 300 of the stale Texas rows have no fee link
at all; their old crawl date still counts toward the freshness median.
**Fix:** this PR: the hourly backlog fetch (free) also re-fetches links last fetched over 30 days ago,
and a state with such links counts as having a backlog.
**Lesson:** a freshness check that reads `last_crawl_at` needs a schedule that actually refreshes it;
check crawl-age spread per state, not only the national median.

## 2026-10-06: Report PDFs printed an empty State Index and wasted pages
**What happened:** James showed two report PDFs from /admin/hamilton/reports. The State Index PDF
said its template was "under development": `state-fee-index.ts` was a stub and the `state_index`
case in `assemble-and-render.ts` passed it no data. Every report also wasted pages: the cream page
background printed as a box on each page, the cover's `min-height: 90vh` left the next section's
heading alone at the bottom of the cover, and forced breaks (`.chapter-divider { break-before: page }`,
`pageBreak()` calls) left pages mostly blank (a fixture render of the National Quarterly went from
13 pages to 10).
**Cause:** the state report was never built for print, and the print rules forced page breaks
instead of keeping headings with their content.
**Fix:** branch `claude/state-pdf-report`. The State Index renders from the public state report's
own readers and helpers (moved to `src/lib/research-report/`), with no model calls. Print rules in
`report-templates/base/styles.ts`: white page, a one-page cover with `break-after: page`, headings
`break-after: avoid`, no forced chapter breaks, short tables kept whole and long ones split between rows.
**Lesson:** check a report's print layout by printing a fixture render in Chromium and looking at
every page; a template that compiles can still print blank or half-empty pages.

## 2026-10-06: Two merged migrations did not reach prod because prod had a higher number
**What happened:** PRs 170 and 173 merged at 02:00 UTC with `20270107000001_hamilton_decision_workspace.sql`
and `20270107000002_financial_nsf_revenue.sql`. Minutes later prod had neither the
`hamilton_decisions` table nor the `nsf_revenue` column (read-only query on prod). Prod's
history already held `20270108000000_branch_deposits_market_indexes`, which is on the open
`claude/hamilton-improvements-69gnln` branch (PR 93) but not on `main`.
**Cause:** a migration was recorded on prod from a branch before it merged, so `main`'s new
files numbered below it are "older than the last applied migration" and the deploy does not run them.
**Fix:** renumbered both files to `20270108000001` and `20270108000002` (PR 186). That was not
enough: after PR 186 merged (02:05 UTC) prod still had neither change, and Supabase's `main`
branch shows status `MIGRATIONS_FAILED`, last updated 2026-10-05 20:48 UTC (Supabase
`list_branches`). The GitHub deploy is not applying merged migrations at all. Meanwhile PR 173's
NCUA writer failed on prod at 02:07 UTC with `column "nsf_revenue" ... does not exist` (Postgres
log). **Real cause:** prod's history (74 versions) lists `20270108000000`, but `main` had no file for it
(it lives on the PR 93 branch). The Supabase deploy stops when prod lists a version the repo lacks,
so no deploy has succeeded since the integration was turned on. Adding that already-applied file to
`main` (PR 189) lets the deploy run the two new ones.
**Lesson:** every version in prod's `supabase_migrations.schema_migrations` needs its file on
`main`, and a new migration is numbered above both. After merging a migration, confirm on prod that
it ran before merging code that depends on it; ship the column before the code that writes it.

## 2026-10-06: New call-report fields need a re-pull; credit unions split overdraft and NSF
**What happened:** Hamilton needs per-fee income for overdraft and NSF. Banks file one combined
overdraft-and-NSF line (RIAD H032, banks over $1B only, not in the FDIC API). Credit unions file
overdraft fee income (IS0048) and NSF fee income (IS0049) separately on the NCUA 5300 (FS220P).
**Cause:** the NCUA step keeps only the accounts it maps in `raw_json`, so a new account can't be
read from stored rows, and finished quarters were not due again for a year.
**Fix:** the NCUA parser reads both accounts into `overdraft_revenue` and new `nsf_revenue`, and
the registry scheduler re-pulls succeeded quarters recorded under an older parser version
(`REGISTRY_PARSER_VERSIONS`), as ordinary visible runs, newest first.
**Lesson:** when a parser learns a new field, bump its version so history fills in through runs.
**Follow-up (04:10 UTC Oct 6, read-only check):** `overdraft_revenue` and `nsf_revenue` are still
empty on every fdic and ncua row from 2025 Q1 to 2026 Q2, so no screen can show overdraft or NSF
income yet. Hamilton's My fees says so under its filing exhibits rather than leaving a blank.

## 2026-10-06: Supabase Preview fails on any PR that adds a migration
**What happened:** PR 170's "Supabase Preview" check failed with status MIGRATIONS_FAILED, and the
`main` preview branch shows the same status. The preview log stops at
`20260408_enable_rls_all_tables.sql`: relation "agent_run_results" does not exist.
**Cause:** a preview branch replays every file in `supabase/migrations/` on an empty database. The
third file alters tables that later files (or hand-run SQL) created, so history cannot replay from
scratch. Prod is unaffected: it only runs files newer than its recorded history.
**Fix:** none yet. Treat this check as not a signal for migration PRs until the old files can be
replayed (or the preview is turned off); judge a migration by reading it against prod's schema.
**Lesson:** a migration history must replay on an empty database for preview branches to work.

## 2026-10-06: Fed districts are assigned by headquarters state, not by county
**What happened:** the St. Louis district report covered only Missouri and Arkansas: 415
institutions monitored, 113 with published fees, and 11 of the 15 headline fees had the 20
institutions a median needs (live read of `institution_sources` and `published_fee_catalog`,
23:40 UTC Oct 5). The real Eighth District also covers parts of Illinois, Indiana, Kentucky,
Mississippi and Tennessee.
**Cause:** `fed_district` comes from `STATE_TO_DISTRICT` in `src/lib/fed-districts.ts`, one
district per headquarters state. States split between districts go wholly to one district.
**Fix:** not fixed. PR 166's methodology section says districts are assigned by headquarters
state. A county-level assignment would need county FIPS on each institution.
**Lesson:** when a report names a Fed district, say which states it covers, and expect thin
coverage in districts whose split states went elsewhere.

## 2026-10-06: Knox said "no fees" while Darwin checked two
**What happened:** at 01:00 UTC the live board showed Evergreen Federal Bank (OR) as "Found no
fees in the document" in Knox and "Checked 2 fees: all passed" in Darwin, in the same run (1239).
**Cause:** a reporting gap, not bad data. From that one document (16915) Knox wrote six rows: two
free fees with a category (e-statements, notary, $0), which go to Darwin, and four unclassified
lines held for review. Knox's `inserted` count only covers priced fees, so its step said 0. Darwin
checked exactly the two free rows (raw 204906, 204907). Oregon Coast Bank's "no fees" was true:
its page (16916) is a checking product page with no fee lines, and Knox wrote nothing.
**Fix:** Knox reports `freeInserted` and `heldInserted` per document and `freeFees` per step; the
board counts free fees as pulled and says how many lines were held for review.
**Lesson:** a count shown next to another agent's count must include every row that agent hands on.

## 2026-10-05: Rosetta kept re-downloading dead links, and the live board miscounted
**What happened:** James's screen recording of /admin/live (22:36 UTC) showed banks failing in
Rosetta with "page not found" that had no working document, the same bank more than once, and
counts that disagreed between Knox, Darwin and Hamilton. Prod (read-only, 22:40 UTC): Rosetta
logged 1,677 read 404s on 247 documents in 24 hours (LINKBANK's two old copies 9 and 10 times
each). 480 of the 572 unread "success" documents had a newer download for the same bank.
**Cause:** Rosetta picked any `source_documents` row with status `success`, including old
February-April rows with no vault copy whose bank Magellan had since failed to download (404).
It fetched the dead link, sent the bank back to Magellan, and picked the same row again next
pass, because 404 is not a permanent outcome. On the board, Darwin's and Hamilton's per-bank
counts came from the step's first ten fee rows (`sample_results`), not its real totals (one
Darwin step checked 74 fees but the board saw 10), and a bank with several documents showed once
per document.
**Fix:** PR 155. Rosetta reads only a bank's current document and skips a no-copy row whose
link already returned 404/410; Rosetta's "banks in line" uses the same rule (1,408 to 640). Fee
steps record `institution_results` with every bank's real totals; each board column shows a bank
once; "On the site" shows the bank's live fee total.
**Lesson:** a picker over a history table must say which row is current. Board numbers must come
from totals, never from a sample written for debugging.

## 2026-10-05: Credit union capital ratio shown as about 1,100%
**What happened:** Pro institution pages, the API and Hamilton's briefings showed credit union
"Tier 1 capital ratio" around 1,100% (a $1.1B credit union showed 1,090 for Q2 2026). The NCUA
median is 1,054 to 1,254 in every year from 2010 to 2026 (read-only query, 22:40 UTC).
**Cause:** the NCUA pull stores the 5300 net worth ratio (ACCT_998) as filed, in basis points,
while FDIC ratios are percent. The medians match net worth / assets x 100 (10.5 to 12.5).
**Fix:** a fix PR converts it once in `src/lib/data-store/financial.ts`
(`capitalRatioPct`), so every reader gets percent, and labels it "Net worth ratio" for credit unions.
Stored rows are unchanged.
**Lesson:** check each regulator field's unit against an independent figure before showing it;
a ratio that is right for banks may be in different units for credit unions.

## 2026-10-05: The public API gave away what its docs called Pro-only
**What happened:** the API docs and spec said the free tier gets 6 spotlight categories and that
category detail and institution detail (per-bank fees, call reports, complaints) need a Pro or
Enterprise key. The code (`src/app/api/v1/*/route.ts`) checked none of it, so anonymous callers got
everything. The "100 requests/month" was also counted per endpoint, unlimited keys sent
`X-RateLimit-Limit: Infinity`, a database hiccup in usage tracking showed as "Rate limit exceeded",
and bad inputs (`state=Texas`, `limit=0`) were ignored or caused errors.
**Cause:** the docs were written ahead of the code, and each route had its own copy of the checks.
**Fix:** the API audit PR (shared `src/lib/api-v1.ts`, route tests).
**Lesson:** when docs promise a limit, add a route test that proves it.

## 2026-10-05: Footnote numbers glued to live fee names
**What happened:** SoFi's fee sheet published "Outgoing domestic wire transfer3" and "Return Item
fee2". At 23:25 UTC, 155 live fees at 66 institutions had a footnote number glued to the name
(read-only regex count on `published_fee_catalog`; box sizes like "10x10" are excluded).
**Cause:** Knox's line rules (pass 1) kept a PDF's superscript footnote, which the text layer
flattens into a digit. The table and family specialists (pass 2) already stripped it; pass 1 did not.
**Fix:** Knox rules v8 strips it in `nameFrom`, so every extractor gets clean names (fix PR off main,
merged once green). The 155 names already live need a one-time rename: a `sql-to-run` issue.
**Lesson:** when two extractors share a cleanup, put it in the shared helper, not in one of them.

## 2026-10-05: Public pages showed different counts and medians on the same day
**What happened:** an outside audit saw the homepage say 2,115 institutions, 58 fee types and a $28
overdraft median while the fee index, directory and research hub said 2,144 and 60, research said
$29, and the overdraft page said $30 from 798 institutions (the index listed 777).
**Cause:** three caches with different lifetimes (hourly headline counts, per-publish category
summaries, the fee_index_cache memo) each caught the catalog at a different moment while the sweep
was publishing; the overdraft page also computed its own median over raw rows with $0 removed.
**Fix:** PR 135: one public snapshot (`getPublicSnapshot` in `src/lib/public-stats.ts`) that every
public page reads, plus one per-institution population for the chart.
**Lesson:** a public figure has one reader. New public pages read the snapshot, never their own
aggregate or cache, and say what the number measures and when it was taken.

## 2026-10-06: Banks showing several different overdraft or NSF fees
**What happened:** James saw Siskiyou FCU and University FCU with three different fees each on
the national index. Read-only queries at 00:50 UTC Oct 6: 82 banks have more than one live
overdraft amount and 218 have more than one NSF amount.
**Cause:** mostly different fees filed under one category: savings or loan overdraft protection,
collection and recurring charges, balance thresholds ("cushion before overdraft fee $50") as
overdraft; third-party, foreign, self-to-self, card re-activation and returned loan payments as
NSF (106 live rows). The rest are real variants on the bank's page (18/65 or business accounts,
ATM vs check, tiers by item amount), stale page versions are rare (9 of 2,832 fees from an older
copy of a page lost their price), and "University Federal Credit Union" is two credit unions (ME
and CA). Siskiyou now has one live $14 overdraft; its $25 and $30 rows came down at 18:38 Oct 5.
UCU California prints NSF $14 for personal and $30 for organizational accounts; Knox does not yet
tag the business section, so both count.
**Fix:** category guard v6 rejects those names (PR on `claude/state-accuracy-95-0psznq`); the
admin catalog shows the value the index counts (highest overdraft tier) with the range below.
Live rows come down with /admin/atlas/details > Misfiled fees.
**Lesson:** more than one live amount per bank and category is a signal to check, not an error
by itself; read the names before assuming duplicates.

## 2026-10-05: Big Texas banks stuck behind bad links
**What happened:** of the 14 largest banks in Texas National Bank of Jacksonville's five counties,
only 5 had a live overdraft fee. Read-only queries at 23:50 UTC showed four different gaps:
- Southside Bank's link is "southside.com/404", left by the old crawler and failed since April.
- Chase's link is a 2021 investor news release, which reads fine but is not its fee schedule.
- Texas Bank and Trust prints overdraft as an item-amount tier table ("$20.01 - $30.00: $20.00
  fee") under "Overdraft Item Fee: based on item amount"; Knox reads the tiers as ranges.
- Austin Bank's fee card is a two-column PDF; the overdraft name wraps over three lines of the
  right column, so Knox pairs the wrong words with the prices.
**Cause:** discovery only searches banks with no link, so a dead link the old crawler stored
(121 banks, 20 in Texas, with no live fee) waits for the fetch queue, and nothing ruled out a news
article. The tier table and the two-column PDF are Knox layouts it does not read yet.
**Fix:** discovery now also searches a link whose last document failed, untouched for 30 days,
with no live fee; the fee-page check rejects news, press and investor-relations articles (PR 165).
The two Knox layouts are not fixed yet: changing Knox re-checks every live Knox fee, so it needs a
dry run first.
**Lesson:** a stored link is not a found page; check that it ever produced a live fee.

## 2026-10-05: Deposit bag prices published as night deposit fees
**What happened:** the Pro page showed Texas National Bank of Jacksonville's night deposit fee as
$3.00; the source line is "Zipper Bags $3.00", a supply the bank sells. A read-only query at 23:45
UTC found 262 of 339 live night deposit fees (189 institutions, 14 in Texas) are bag prices.
**Cause:** Knox's rule files "deposit bags" and "zipper bags" under night deposit (on purpose, so
the line is recognized), and no category guard covered night deposit, so Darwin and Hamilton let
them through.
**Fix:** the category guard (v5) now rejects bag and supply prices under night deposit, keeping lost
or replaced keys, bag rentals and per-month charges. New rows stop at Darwin; live ones come down
with /admin/atlas/details > Misfiled fees (dry run first).
**Lesson:** a Knox pattern that recognizes a non-fee line needs a guard rule that rejects it.

## 2026-10-05: Shutdown months stored as 0 in economic series
**What happened:** state report trend charts showed Texas unemployment dropping to 0% and back
(found by the Hamilton Pro page thread).
**Cause:** BLS never published some October 2025 shutdown months, and those months are stored in
`fed_economic_indicators` as 0 instead of being left out.
**Fix:** the state report economy reader treats a stored 0 as a missing month for every series
except the fed funds rate, which can really be near 0 (fix PR off main, merged once green).
**Lesson:** a 0 from an outside feed can mean "no data"; check whether 0 is possible for that series.

## 2026-10-05: API credit ran out and stopped all paid work
**What happened:** at 21:45 UTC Rosetta got "Your credit balance is too low" from the Anthropic
API. The provider guard turned on the provider stop (`automation_control` key `global`), which
also blocked Hamilton (a customer report at 22:15 was refused). Spend that day was $14.92, under
the app's own $20 cap, so the account balance, not the app cap, was the limit.
**Cause:** the Anthropic account balance hit zero.
**Fix:** James added $500 of credit (22:18). Adding credit does not clear the stop: an admin must
click Mark billing resolved, then Resume automation, on /admin (issue 153, step 0).
**Lesson:** after topping up credit, check the provider stop on /admin; it stays on by design.

## 2026-10-05: The live source check took down correct fees
**What happened:** between 18:46 and 20:15 UTC the Hamilton source check took down 1,956 live fees
in states other than Texas and California, 903 of them as `amount_is_a_threshold` (read-only query
on `published_fee_records.rolled_back_reason`). Spot checks found correct fees among them:
"Title Draft $50.00 Incoming Wire Fee (domestic) $18.00" took down the $18 wire fee.
**Cause:** the check compared every fee on a line to the line's first price. Many stored schedules
put several fees on one line, or flatten the whole schedule into one paragraph. The hand-checked
Texas sample it was tuned on had one fee per line, so the gap didn't show.
**Fix:** PR 132 gives each fee the price after its own name and restores earlier takedowns that
now trace, on the next hourly passes.
**Lesson:** test a rule that changes live data on a sample from several states and layouts, and
run it as a dry run (counts and samples) before it writes.

## 2026-10-05: The first source check took down correct fees
**What happened:** by 20:15 UTC the live source check had taken down 1,956 fees outside Texas and
California, 903 of them as "amount_is_a_threshold". Spot checks found many were correct (Stop
Payment $32, Incoming Wire $18, NSF/Overdraft $32). Source: PR 132.
**Cause:** on a source line carrying several fees, version 1 compared every fee to the line's first
price and called the rest thresholds.
**Fix:** PR 132 (merged 23:10 UTC): each price belongs to the words before it; version 2 re-checks
every institution and restores fees that now trace, logged as `hamilton.source_check` events.
**Lesson:** test a bulk takedown on lines with several fees before it runs nationwide, and keep
takedowns reversible.

## 2026-10-05: Public reports stopped being produced
**What happened:** no National Quarterly, Monthly Pulse or State Index report has been made since
Aug 10. `report_jobs` holds 12 finished files (Apr 7 to Aug 10, from the old runtime) and
`published_reports` has 0 rows (read-only query, 19:58 UTC).
**Cause:** the Generate button records an agent run, then stops with "render worker implementation
is pending", because nothing calls `src/lib/report-engine/assemble-and-render.ts`. No cron
schedules a quarterly or monthly report, though `src/lib/admin-queries.ts` still expects one.
**Fix:** not yet fixed or assigned.
**Lesson:** a retired runtime needs a replacement for every output it produced, and each scheduled
output needs a visible "last produced" date.

## 2026-10-05: CLAUDE.md went stale
**What happened:** CLAUDE.md told every session that all 25 reports were ready to review and send
(they are on hold) and listed OCR, provider-assisted extraction and report rendering as unbuilt
(all exist).
**Cause:** status and next steps were written into the standing-instructions file and never updated.
**Fix:** PR 122 removes the status section and adds `docs/project/` for state that changes.
**Lesson:** CLAUDE.md holds rules that stay true. Day-to-day state goes in a checkpoint.

## 2026-10-05: Offline accuracy was 96.5%, live accuracy was about 47%
**What happened:** Knox scored 96.5% (357 of 370) on a fresh Texas holdout (PR 91). A hand check of
201 live Texas fees at 22 institutions found 94 matching, 76 with no stored source, 22 wrong and
9 one-of-several (`live-tx-sample-2026-10-05.csv` in the shared files).
**Cause:** live fees include legacy imported rows with no source document and rows extracted by
older rules; the holdout only measured today's extractor on clean pages.
**Fix:** accuracy redefined on live fees (see DECISIONS); PR 119 checks live fees against their
source with `checkFeeAgainstSource`, relinks imported fees, and takes down the untraceable ones.
**Lesson:** measure what customers see. Report live accuracy on fresh random samples.

## 2026-10-05: Texar FCU showed a $50.01 overdraft fee
**What happened:** the real tiers are $5, $20 and $35; $50.01 was the balance threshold in the
label cell ("Negative from $50.01 and more | $35"). 17 live fees nationwide had the same error.
**Cause:** Knox took a figure in the label cell as the price. Darwin only checks that an amount is
plausible, so it can't catch a wrong-cell pick.
**Fix:** PR 114 (Knox rules v6, merged). Issue 115 takes down the 17 fees.
**Lesson:** a plausible amount is not a verified amount. Check the fee against its source line.

## 2026-10-05: SoFi's fee schedule was never found
**What happened:** SoFi Bank showed "web page, no fees, 13 pages ruled out" while its real schedule
is a PDF. The "13 pages" was one URL appended 13 times. 811 institutions were stuck the same way
(743 with no live fees), counted live at 18:20 UTC.
**Cause:** discovery ruled out SoFi's marketing fees page and never followed its "Fee Sheet" link;
the homepage blocks our bot.
**Fix:** PR 116 (merged): follow fee links on ruled-out pages first, add "fee sheet" as a phrase,
store each ruled-out URL once and ban it for 90 days instead of forever.
**Lesson:** a ruled-out page can still point to the right document. Rejections must expire.

## 2026-10-05: Migration files didn't match prod's history
**What happened:** 14 repo migration files had different version numbers from prod's
`supabase_migrations.schema_migrations`, 2 numbers were duplicated, and 9 hand-run files were
never recorded. Connecting Supabase's GitHub deploy would have re-run applied SQL.
**Cause:** SQL was run by hand in the SQL editor without recording history, and files were named freely.
**Fix:** PR 112 (merged) renamed the files and added `migration-version-kill`; issue 113 recorded
the 9 (prod now has 74 rows, latest 20270108000000).
**Lesson:** a hand-run migration must also record its history row. Follow the naming rule in CLAUDE.md.

## 2026-10-05: Database connection slots filled up after the upgrade
**What happened:** 17:31 UTC, "reserved for SUPERUSER" errors; 105 idle sessions from 31 app
instances held every slot.
**Cause:** Vercel freezes idle function instances, so the database client's idle timeout never fires.
**Fix:** PR 109 (merged 17:46) sets a server-side `idle_session_timeout` of 60 s on each connection.
At 18:03 UTC there were 3 idle connections and no connection-full errors since 17:35.
**Lesson:** client-side timeouts don't run on frozen serverless instances; enforce them on the server.

## 2026-10-05: Every Vercel build loaded the production database
**What happened:** ~14:51 UTC the database stopped answering. Each build prerendered about 120
data pages against prod.
**Cause:** data pages were statically prerendered at build time.
**Fix:** PR 101 (builds don't prerender data pages) and PR 102 (public API and Pro categories read
cached summaries), both merged.
**Lesson:** builds must never depend on the production database.

## 2026-10-04: The database was starved by pipeline write churn
**What happened:** the public site and admin slowed to a crawl; one-row index lookups took 15-25 s,
and the fee summary query took 60-95 s on the Micro instance.
**Cause:** parallel state lanes (since PR 69) plus a tick that rewrote every institution every
5 minutes, and each publish expiring every public cache. Root cause of the daily jams was Micro's
memory (224 MB buffers) forcing disk reads.
**Fix:** PRs 64, 76, 77 and 81 (merged); compute upgraded to Medium, after which the fee summary
query took 0.12 s.
**Lesson:** watch database load before adding pipeline parallelism.

## 2026-10-05: Fake price changes in fee history
**What happened:** 554 of 556 recorded fee "replacements" were not real price changes.
**Cause:** Hamilton recorded a change whenever a fee row was replaced, not when the price moved.
**Fix:** PR 78 (merged) records a change only for the same fee at a new amount in a newer
document; issue 95 cleaned history (687 rows to 133).
**Lesson:** a record that claims something happened must check that it did.

## 2026-10-05: Run summaries are boilerplate
**What happened:** every completed run's summary is the same stock text; James pasted it thinking
it was a repair result.
**Cause:** `agent_runs.summary` is a fixed footer; the real result is in `agent_run_steps.summary`.
**Fix:** not yet fixed or assigned.
**Lesson:** when pointing James to a run, quote the step summary.

## 2026-10-05: Discovery stopped and state memory stayed empty
**What happened:** discovery stopped at 04:41 UTC.
**Cause:** state lanes take one full pass per month, and every state's October pass had already
run on code with no state-expert step.
**Fix:** PR 84 (merged 18:02) counts only full passes that include a state-expert step.
**Lesson:** a cadence change must say how it treats passes that ran before it.

## 2026-10-06: Paid passes skipped after the tick got bigger
**What happened:** from 22:26 UTC on Oct 5 to 00:22 UTC on Oct 6, 13 paid passes (discover-paid,
read-paid, extract-paid) were recorded as skipped, and the Crew page showed "4 agent ticks were
blocked in the last hour".
**Cause:** PR 149 raised the tick to 10 runs x 10 steps. The budget check treated that as 100
possible paid calls against the tick policy's cap of 30 and refused paid steps for the whole tick,
and a refused paid step is skipped for good.
**Fix:** PR for this finding: the check now gives paid steps to only as many runs as the cap covers
(3 at 30 calls and 10 steps); the other runs do free steps and leave their paid step queued.
**Lesson:** a change to tick size must be checked against the tick budget policy.

## 2026-10-06: Preview builds logged false "missing_key" thesis failures
**What happened:** the Crew page reported 3 of 5 `pro.thesis` steps failing with `missing_key`
while production theses succeeded.
**Cause (inferred from timing, not traced to a deployment):** preview deployments and builds use the
production database but have no `ANTHROPIC_API_KEY`, and rendering the Hamilton page there logged a
failed thesis to the shared run ledger.
**Fix:** same PR: without a key outside production the thesis is not attempted or logged.
Production still logs a missing key.
**Lesson:** anything a preview writes to the shared ledger shows on the production Crew page.

## 2026-10-06: Fee catalog chart counted rows and could not be traced
**What happened:** James saw the NSF and overdraft charts run out to $60 and $65 with nothing
there, and could not find who sat in the $50 to $55 bar. The page showed ten "recent changes",
some repeated, and no way to list institutions by amount.
**Cause:** the admin chart counted fee rows, not institutions, and drew a fixed 12 bars that could
run past the highest value. The stat cards called the row count "Institutions". The change list
held old-pipeline rows that compared one bank's tiers with each other. Of the 13 live overdraft and NSF rows at
$45 or more, 9 were wrong: safe deposit box sizes, an international wire, a check printing line,
a "$50 maximum per day" cap, a "$50 or less" threshold and a two-column misread (Hawaii Community FCU
charges $25).
**Fix:** same PR: the chart counts each institution once at its counted value, ends at the data,
and each bar opens the Institutions tab filtered to its amounts. The table has an amount range,
one-click common amounts, the fee's name and a link to the bank's schedule. The change list keeps
one row per price move whose new price is still live. Category guard v7 rejects box sizes, wires,
check printing, annual fees and thresholds under overdraft and NSF (12 live rows).
**Still open:** a cap read instead of the per-item price (Bath State Bank) and two-column misreads
need Knox fixes.

## 2026-10-06: Monthly service charges written as prose held as unclassified
**What happened:** Knox held Evergreen Federal Bank's "$500 minimum daily balance, otherwise $8
service charge per statement cycle" for review instead of reading an $8 monthly maintenance fee.
A read-only count at 01:10 UTC Oct 6 found 9,915 lines held as unclassified at 2,401 institutions.
Most are real fees with no report category (returned mail, shared branch, excess withdrawals,
termination). 243 lines state a monthly service charge in prose, at 116 institutions, and only 16
of those institutions had a live maintenance fee. 166 more are "inactivity" or "dormancy" charges.
**Cause:** Knox names a price from the words before it. Prose puts the fee's name after the price
("avoid the $10 monthly fee"), and the dormant-account rule matched "inactive" and "dormant" but
not "inactivity" or "dormancy".
**Fix:** same PR: Knox rules v9 reads a monthly service charge stated in prose when the line passes
the maintenance guard (no savings, business, statement, withdrawal, card or box charge), and names
inactivity and dormancy charges as dormant-account fees. The version bump makes Hamilton's rules
re-check and Knox's re-extract gate read documents again; the new fees go through Darwin as usual.
**Still open:** held lines with no report category stay held; a new category is a taxonomy decision.

## 2026-10-06: A daily cap and a box price read as NSF fees
**What happened:** the NSF tail at $50 included Bath State Bank ("$25 per return item ($50 maximum
per day)" read as a $50 fee) and Hawaii Community FCU (the next column's "5" X 10" X 22" box ....
$50.00" paired with "NSF Fee").
**Cause:** Knox treated a figure named a maximum after an earlier price as a second fee, and the
table reader paired a fee name with a value cell that named a fee of its own (a box size).
**Fix:** same PR: Knox rules v10, table v3 and overdraft/NSF family v3. A "$X maximum" after an
earlier price or rate on the line is that fee's cap, and is read as a daily cap when it says "per
day"; a lone "$10.00 maximum" stays the fee's own price. A value cell a rule names on its own is
left to the line rules. Read-only check at 02:25 UTC Oct 6: 8 live fees came from a "$X maximum"
figure; the version bump re-checks them and the 4 that follow an earlier price or rate will stop reproducing.

## 2026-10-06: Tier tables and two-column PDFs hid Texas overdraft fees
**What happened:** Texas Bank and Trust and Austin Bank had no live overdraft fee although both
schedules state one.
**Cause:** Texas Bank and Trust prices overdraft by item amount ("Overdraft Item Fee: based on item
amount", then "$10.01 - $20.00: $10.00 fee" rows) and no rule read those rows. Austin Bank's
two-column PDF splits "* Overdraft Fee, per item, per presentment (applies to ... means) ....
$30.00" across three lines of its right column, so no single line held both the name and the price.
**Fix:** same PR: Knox rules v11 reads item-amount tier rows under an overdraft or NSF heading as
one fee per priced tier (the index counts overdraft at its highest tier), and rebuilds the columns
of a "left | right" text to join a fee name with the lowercase lines that continue it up to its
price. Both only add fees, and every one still passes Darwin's guard.

## 2026-10-06: The fee catalog listed the same fee twice at one institution
**What happened:** opening an institution on a fee catalog page could show the same fee, with the
same name and price, two or more times, which read as conflicting data.
**Cause:** some schedules print a fee in more than one place (a fee table and an account section),
and each listing is its own live row. Read-only check at 03:00 UTC Oct 6: same institution, same
name (ignoring case) and same amount gave extra live rows of 95 counter check, 52 rush card, 49 NSF,
48 stop payment, 31 overdraft and 27 bill pay. The index already counts one value per institution,
so the published numbers were not affected.
**Fix:** same PR: the catalog's institution table merges a fee listed more than once with the same
name and price into one line marked "listed N times". Live rows are unchanged.

## 2026-10-06: Texas live fees were never source-checked
**What happened:** a fresh random sample of 150 live Texas fees (03:20 UTC Oct 6) found 136 that
match the bank's own schedule (90.7%), 8 wrong and 6 with no source document at all. Texas had 107
live fees with no source document, all old imported rows.
**Cause:** the source check that takes down untraceable fees ran only in publish steps that had a
state or an institution. Most publish steps have neither, and the Texas lane ran one with a state
three times since the check shipped, so 119 of 183 Texas institutions with live fees (499 of 2,662
nationally, holding 7,888 live fees) had never been checked.
**Fix:** same PR: every publish step source-checks a batch of 40 institutions, any state's when the
step has none, institutions never checked first. A read-only dry run of the check over the 7,797
never-checked live fees (495 institutions, all states) first predicted 709 takedowns; spot checks
found reader misses, fixed in the same PR (dot leaders before a bare amount, a "$10 minimum" before
the real price, a range inside a name's note, a heading over rows that carry their own names, box
sizes like "5 x 10", and price-first lists). After the fixes 557 would come down at 182
institutions: 195 imported fees with no source document, 15 with no amount, 245 whose amount is not
the price on the matching row, 56 whose name is not in the schedule, 46 whose amount is a limit.
**Lesson:** dry-run a takedown rule over the rows it has never touched before turning it on.
**Guard (follow-up PR):** the admin home page alert banner now lists, by state, institutions
holding a live fee published over 12 hours ago and not source-checked since, so a gap in any state
shows within a day instead of waiting for an accuracy sample. Read-only at 04:50 UTC Oct 6 it lists
248 institutions (TX 66, CA 50, NY 45, PA 36, MI 21, OH 14, IL 10, WI 6), shrinking as every
publish step works through them.

## 2026-10-06: Generated reports waited behind the whole pipeline queue
**What happened:** National Index and Monthly Pulse runs started from /admin/hamilton/reports at
03:03 UTC Oct 6 sat "pending" with no step started.
**Cause:** the agent tick takes queued runs oldest first. The state backlog adds two lane runs every
five minutes and finishes about two, so about 20 lane runs (roughly 50 minutes of work) were always
queued ahead of any new report run. Read-only check at 03:08 UTC: 17 lane runs queued ahead of the two
report runs.
**Fix:** same PR: the tick takes queued report runs before pipeline runs; the rest keeps its order.

## 2026-10-06: The National report carried fixed claims and advice, and misstated fee income
**What happened:** the Q4 2026 National report (run 1309) was titled "The Death of Fee-Based
Differentiation", showed "5 Truths", "SO WHAT" boxes and a "What Winning Institutions Do Next"
page, showed service charges as "$0.0B", and said 2,075 institutions.
**Cause:** the title, the truths' wording, every box and the playbook were fixed text in
`templates/national-quarterly.ts`, and the section prompts told Hamilton the conclusion (for
example "the data confirms fee revenue is dominated by NSF/overdraft", which call reports cannot
show). Call-report income is in thousands of dollars but was divided as dollars. NCUA 5300 fee
income is year to date, and `getRevenueTrend` summed it as quarterly: Q2 2026 read $14.49B and a
64% bank share; per quarter it is $11.97B and 78% (read-only check, 03:40 UTC). The institution
count was the largest single category's count, not the site's count (2,669).
**Fix:** same PR: headings and cards state payload figures only; no fixed claims, advice or
playbook; prompts ask for what the data shows and never for advice (Hamilton voice 3.3.0);
NCUA income converted to quarters; thousands formatted correctly; the count comes from
`getPublicStatsSummary`.

## 2026-10-06: Recorded fee changes are mostly not price changes
**What happened:** of 9 increases and decreases in `fee_change_records` in the last 30 days, 7
were not changes: a page that lists two prices for one fee (Canyon View FCU returned deposit $3
and $10, First National Bank of Mount Dora monthly fee $5 and $32, Morgantown notary $5 and $10)
or two different fees in one category (True North "Express Checking Plus" $5 against "True
Options" $10). Only New Hampshire FCU's two changes hold up (Oct 2024 schedule to Aug 2026).
**Cause:** the publisher records a change when a newer document carries the fee at a new amount,
even when that document also states the old amount.
**Fix:** the Monthly Pulse now reports a change only when the old and new rows share a fee name,
the earlier schedule states the old price, and the newest schedule states the new price but not
the old one (`checkFeeAgainstSource`). The publisher still records the extra rows; fixing it there
is still open.

## 2026-10-06: The shared source check misreads one-line dotted-leader schedules
**What happened:** on Commonwealth FCU's schedule, which is stored as one long line ("Greater
than $100.00 ..... $10.00 Returned Deposited Item ..... $32.00"), `checkFeeAgainstSource` says
"Returned Deposited Item" is $10 and that $32 is "amount_not_the_fee".
**Cause:** in dotted-leader layouts the price follows the name, but the check took the amount just
before the name. Not fixed yet; it affects any schedule stored without line breaks.

## 2026-10-06: A fee listed at two prices on one schedule was recorded as a price change
**What happened:** 9 fee-price changes were recorded since Oct 1 (read-only check, 04:00 UTC Oct 6).
Four came from schedules that list the same fee name at both prices (two products or two tiers):
Morgantown's notary fee $5 to $10, Mount Dora's monthly fee $5 to $32, Canyon View's returned
deposit $3 to $10 and Commonwealth's overdraft $4 to $32. Two more (True North, First Community)
were recorded before publish required the same fee name. Commonwealth's returned deposited item $10
to $32 comes from two documents with one price each and may be real. The two New Hampshire FCU
changes are real.
**Cause:** Hamilton's publish replaced a live fee with a same-named line from a newer document and
recorded the difference as a change, without asking whether either schedule lists both prices.
Five live fees were closed this way; at Mount Dora the $5 monthly fee is no longer live.
**Fix:** same PR: before replacing a live fee, publish checks both documents' extracted lines. If the
newer one also lists the old price under that name, or the older one lists the new price, the new
line is published as an additional line and no change is recorded. Applies to every state. Repairing
the five closed rows and the false change records is SQL for James (sql-to-run issue).

## 2026-10-06: Darwin's category guard let other banks' customers' ATM fees and gift card extras through
**What happened:** the Texas accuracy sample (136 of 150 correct) found 8 fees in the wrong category.
A read-only check of all live rows in those categories found 61 the same way: 34 non-network ATM
fees that are really the surcharge a credit union charges non-members at its own ATMs or its own and
in-network ATMs, 12 gift card purchases that are reload, inactivity or unrelated fees, 5 card
replacements that are gift card replacements, 4 monthly fees that are per-transaction charges or
earnings-credit notes, and 6 card disputes that are deposited-item or loan chargebacks.
**Fix:** same PR: category guard v8 adds those exclusions and guards gift card purchase and card
dispute. Darwin applies it to new rows; James clicks /admin/atlas/details > Misfiled fees > Dry run,
then Roll back, after the deploy to take the 61 live rows down.

## 2026-10-06: Hamilton's workspace showed one peer group and none of the national data
**What happened:** James saw "very little national data like NCUA reports, filings". The workspace
engine's `getFeeResearch` returned only the narrowest peer group for a fee, with
`revenueLine: null`, no national, Fed district or state view, none of the bank's own call report
income and no rules. The Briefing had no industry income and no regulator items.
**Fix:** each fee now carries four market layers (national, Fed district, state, charter and size)
with percentiles where at least 5 institutions publish it; the bank's own service charge income by
quarter (NCUA year-to-date split into quarters); the filed overdraft and NSF income line when one
exists; the notice and disclosure rules that apply; and fee-related regulator releases. The
Briefing adds national service charge income and a rule_change item for each fee-related release.
**Still empty, honestly:** no institution has overdraft or NSF income stored yet (credit union
lines land with the NCUA re-pull; bank RIAD H032 isn't loaded). The regulator feed
(`reg_articles`, FDIC/Fed/OCC/CFPB press releases since 2025-01-28) has no release in the last
year whose title mentions fees, overdraft, NSF, Reg E or Reg DD, so only the standing rules show.
**Also open:** the Briefing's competitor moves read `fee_change_records` directly, which has the
same two-price problem as the Pulse (entry above). `getDistrictFeeRevenue` in
`data-store/call-reports.ts` still sums NCUA year-to-date income as one quarter.

## 2026-10-06: Darwin rejected real fees Knox filed under a neighbouring category, and never re-checked them
**What happened:** of the Knox fees that never reached verified, 5,322 were rejected because the name
did not fit the category (Darwin thread, read-only, 04:30 UTC Oct 6). A read-only pass over the
never-verified Knox names (05:10 UTC) found about 925 that are real fees whose own name says the
neighbouring category: 356 overdraft transfers filed as overdraft, 248 international wires filed as
domestic, 195 ATM/debit card replacements filed as ATM fees, 70 "Paid NSF" items (overdrafts) and 51
returned deposited items filed as NSF, 5 NSF sweeps. Separately, 27 of 239 live minimum-balance fees
were the balance to open an account, earn APY or avoid a fee, not a fee.
**Cause:** Darwin only accepted or rejected the hinted category. And `CATEGORY_GUARD_VERSION` said a bump
re-checks rows an older guard rejected, but Darwin never read it: a row decided under `verify.rules` v3
was never selected again, so no guard fix could recover a wrongly rejected fee.
**Fix:** same PR: `refileCategory` (fee-category-guard.ts) re-files a row to the category its own name
names, only when that category's guard accepts it; Darwin checks the row under that category. Darwin
records the guard version with each decision and re-selects a category rejection once when the guard
version rises (now v9, which also adds a minimum-balance rule). Other decided rows stay closed, so
`duplicate_in_batch` rows are never re-verified.
**Lesson:** a "bump to re-check" version constant needs a test that the re-check really happens.

## 2026-10-06: Rosetta rejected fee pages whose fees load by script
**What happened:** the Rosetta audit compared stored text with 91 Texas fee schedules read
independently. Two of them (atfcu.org/fees, firstcommand.com/.../fees/) were real schedules that
Rosetta filed as "not a fee schedule": their static HTML held only menus (2,452 and 2,960
characters, 0 and 1 dollar amounts) because the fee table loads by script. Rosetta tries its free
JavaScript fallbacks (embedded data, linked PDF, print version) only for an app shell of at most
1,500 characters, so these pages were rejected instead, the link was cleared and banned from
discovery for 90 days. Live, read-only (05:10 UTC): 504 rejected HTML texts at 317 institutions
have a link naming a fee page and at most one dollar amount; 221 of those institutions have no
live fees.
**Fix:** same PR: a page whose own link names the fee page ("/fees", "fee-schedule",
"schedule-of-charges") and whose static text shows no fee schedule gets the free fallbacks first,
whatever its length. Applies to every state's next read of such a page. Texts already rejected
are not re-read by this PR (that needs a re-read rule; see the Rosetta scorecard).

## 2026-10-06: Source-check fixes never reached fees already checked or taken down
**What happened:** the Hamilton publish audit (05:10 UTC Oct 6) found 6,626 live fees at 410
institutions not yet source-checked, and fees taken down by older readers that were never re-checked.
For example, about 934 safe deposit box rentals were down although PR 195 taught the reader box sizes.
Read-only at 05:15 UTC: 5,864 live fees at 363 institutions were unchecked, and the check covered
about 170 institutions an hour.
**Cause:** a state publish step checked only its own state, so most steps found little to check while
other states waited. The check's fingerprint changes only when a new fee is published, so a reader fix
never re-checked an institution or restored its takedowns.
**Fix:** same PR: a state step checks its own state first, then fills its 40 from any state, never-checked
institutions first. The source-check strategy goes to version 3, so every institution (2,922 due) is
checked again with the current reader, restoring fees that now trace. The comment on the version says to
bump it whenever `checkFeeAgainstSource` changes. The due query takes about 110 ms on prod. Spot checks of
a read-only dry run found two layouts the reader misread, fixed in the same PR: a line under a heading that
names most of the fee ("WIRE TRANSFERS (OUTGOING)" / "DOMESTIC WIRE | $35") and a price under the name
that starts with "•" or "~". Dry run over all 43,577 live and taken-down fees: 1,477 restored (927 box
sizes; 19 of 20 sampled box restores right), 445 taken down, of which 401 are at never-checked
institutions the normal check reaches anyway and 44 are new from the bump. Paced at 40 institutions per
publish step, about 720 an hour, so the re-check finishes in about four hours.
**Lesson:** a check keyed on its input must also key on its own rules version, or improving the rules
changes nothing already decided.

## 2026-10-06: Supabase Preview failed on every migration PR
**What happened:** the Supabase Preview check failed on every PR that added a migration (173, 189, 196)
with `relation "agent_run_results" does not exist`.
**Cause:** a preview branch builds a fresh database from `supabase/migrations/`, but production's first
tables were created before that history began. A local replay on an empty Postgres failed in 41 of 77 files.
**Fix:** PR 196 (James approved editing applied files): the oldest file opens with the public schema
dumped from production on 2026-10-04, run only on a database without `institution_sources`; the eight
files that rewrote pre-2026-08-13 legacy tables skip themselves on such a database. The full history now
replays on an empty database. Production never re-runs applied versions, so nothing changes there.
Details in `docs/runbooks/supabase-migration-baseline.md`.

## 2026-10-06: Banks below the 3-fee rule stayed on the site after takedowns
**What happened:** the Hamilton publish audit (read-only, 05:35 UTC) found 163 banks with fewer than 3
distinct live fees: 93 showing one fee (110 fees), 70 showing two (157 fees). 120 got there through
takedowns (source check, rules re-check, category guard); 82 had fees live before the rule existed.
They showed on the site and counted in every median as full banks.
**Cause:** the 3-fee rule (PR 66) gated only a bank's first publish. Nothing re-applied it when
takedowns removed fees later.
**Fix:** same PR: `published_fee_catalog` shows a bank's live fees only while it has at least 3 distinct
canonical fee keys live (migration 20270110000000, view only, no data change). The rows stay live in
`published_fee_records`, so the publish gate still counts them and the bank reappears on its own.
Magellan's thin-bank finder now reads `published_fee_records`, since the catalog hides the banks it
looks for.
**Lesson:** a publish rule that only gates entry drifts once takedowns run; put the rule where readers
read.

## 2026-10-06: Re-reading one fee schedule recorded false price changes
**What happened:** building the National report's fee-change chapter (read-only check, 07:05 UTC), three
of the five price changes recorded since July 8 came from two readings of the same schedule edition:
Net Federal Credit Union stop payment $35 to $30 (both readings "Effective February 1, 2026") and
Commonwealth Federal Credit Union returned deposited item $10 to $32 (both readings carry the same
"RFD 3-24-2026" form stamp; the older reading put "$10.00" from the line above in front of the fee).
The Monthly Pulse rule confirmed both.
**Cause:** the confirm rule checks each reading line by line. A PDF read twice can come out in a
different column order, pairing a fee with its neighbour's price, and both readings then "state" a price.
**Fix:** same PR as the report chapters (PR 220): `confirmFeeChange` drops a change when both texts
state exactly the same dollar amounts (one edition read twice) or when the earlier schedule already
stated the new price. Of the five recorded changes, the two at New Hampshire Federal Credit Union
(October 2024 schedule to August 2026 schedule) remain.
**Lesson:** a change between two readings needs proof the document itself changed, not only that each
reading parses.

## 2026-10-06: Free allowances and conditions published as $0 fees
**What happened:** the companion-pages thread found about 6 wrong fees in the first 25 live
companion fees. Several were $0 lines that state an allowance or a condition rather than a
price ("2 free cashiers checks monthly", "Monthly Service Charge if any of the following
qualifications are met", "you won't be charged overdraft item fees if...").
**Cause:** Knox's $0 check (`notAZeroPrice`) knew only "N per year/month" allowances and the
bank's own ATMs.
**Fix:** same PR: `extract.rules` v13 also treats "N free", "first N", "if ...", "unless",
"qualifications", "to waive", "won't be charged" and "not available on" as not a $0 price
("do not charge a fee" still is). The version bump makes the rules re-check take these down
everywhere. Read-only on prod: 24 live Knox $0 fees match; about 22 are wrong by hand (the
notary "fees may differ if..." line is a likely right one lost). The Texas and seven-state
answer-key gates in PR 213 still pass with no right fee lost. A rule on sentence-shaped names
was measured and not added: 446 live names end in "of" ("An overdraft fee of"), and most carry
the bank's real price.
**Lesson:** judge a name-shape rule by the live prices it would remove, not by the bad names it
catches.

## 2026-10-06: Re-reading one fee schedule recorded false price changes
**What happened:** building the National report's fee-change chapter (read-only check, 07:05 UTC), three
of the five price changes recorded since July 8 came from two readings of the same schedule edition:
Net Federal Credit Union stop payment $35 to $30 (both readings "Effective February 1, 2026") and
Commonwealth Federal Credit Union returned deposited item $10 to $32 (both readings carry the same
"RFD 3-24-2026" form stamp; the older reading put "$10.00" from the line above in front of the fee).
The Monthly Pulse rule confirmed both.
**Cause:** the confirm rule checks each reading line by line. A PDF read twice can come out in a
different column order, pairing a fee with its neighbour's price, and both readings then "state" a price.
**Fix:** PR 235 (also carried in PR 220): `confirmFeeChange` drops a change when both texts
state exactly the same dollar amounts (one edition read twice) or when the earlier schedule already
stated the new price. The Hamilton Briefing's competitor moves now read only these confirmed
changes, so a misread schedule no longer shows as a competitor's price move. Of the five recorded changes, the two at New Hampshire Federal Credit Union
(October 2024 schedule to August 2026 schedule) remain.
**Lesson:** a change between two readings needs proof the document itself changed, not only that each
reading parses.

## 2026-10-06: Single-quarter income reads doubled credit-union income
**What happened:** a read-only check (07:30 UTC) found the district, size-tier, top-institution,
peer-ranking and institution-trend income reads summed NCUA 5300 service charges as reported. For
Q2 2026 that was $5.16B for credit unions against $2.64B earned in the quarter.
**Cause:** NCUA income lines are year to date; FDIC lines are quarterly. getRevenueTrend and the peer
medians already split NCUA into quarters, but the single-quarter reads in `call-reports.ts` did not.
**Fix:** same PR: those reads join each credit union's prior quarter in the same year and use the
difference (Q1 stands alone; a missing prior quarter leaves the row out). Read-only; no data change.
**Lesson:** a unit rule fixed in one query must live in a shared helper, or the next query repeats the bug.

## 2026-10-06: Knox named stacked fees after the line under the name
**What happened:** Rosetta's read of Community Bank (Longview, TX, `cbanktexas.com/limit-and-fees`)
and Wells Fargo's account fee summaries found fees Knox missed or misnamed: overdraft and NSF were
published as "(for each overdraft item, ...)", and the debit card replacement, temporary checks,
returned deposited items, non-Wells Fargo ATM $3 and $5, and money order $5 were missed.
**Cause:** Knox's stacked-line pairing (`table-rows.ts`, `families.ts`) took the line right above
a price as its name, so a qualifier line between name and price ("(for each ...)", "(up to
$1,000)", "If checks are not on order") either became the name or broke the pair. Wells Fargo's
section heading ran to 9 words, past the 6-word heading limit, so "Cash withdrawals - Within U.S."
had no category to borrow.
**Fix:** same PR (Knox v15): a qualifier line keeps the name above it, table headings may run to 10
words, "At <Bank> ATMs" is not read as out-of-network, and two name patterns. Answer-key gates:
Texas 455 to 460 right, seven states 677 to 681, wrong reads 77 to 76, no right fee lost. Dry run
on 117 sampled live documents: 1,956 reads kept, 7 new (all checked right by hand), 1 replaced (a
statement copy read as $15 "Consumer", which is the business price, now $5; that document has no
fee in `published_fee_catalog`).
**Still open:** hold statements, special statement cutoff, account activity printouts and a debit
card's monthly charge have no category in `fee-taxonomy.ts`; the answer keys file them as
unmapped. They stay out until the taxonomy has a place for them.
**Lesson:** pages built as name / note / price stacks are common on bank summary pages; pair
across the note rather than adding names per bank.

## 2026-10-06: Every credit union's overdraft and NSF income was stored as $0 for 2026 Q2
**What happened:** after the 08:07 UTC NCUA re-pull, all 4,299 credit-union rows for 2026-06-30 in
`institution_financial_records` had `overdraft_revenue = 0` and `nsf_revenue = 0`. The stored raw
values (`raw_json.ACCT_IS0048`, `ACCT_IS0049`) were `"0"` for every row, including the three largest
credit unions, which charge these fees (read-only query on prod, 08:20 UTC). Earlier quarters had not
been re-pulled yet and carry no IS0048 value at all.
**Cause (confirmed 09:05 UTC from the re-pull's run log):** NCUA's public file is the source. Only
`FS220P.txt` carries IS0048 and IS0049, and it holds zero for every credit union in every quarter from
2025 Q1 to 2026 Q2. No file overwrote a real figure. The public 5300 data does not carry credit-union
overdraft or NSF income, so Hamilton must not show it as a reported line until NCUA publishes nonzero values.
**Fix:** a quarter where no credit union reports a nonzero value stores these two accounts as NULL,
never zero; a zero or blank in a second file no longer overwrites a reported figure; every FS220 file
is read; and the run log records which files carry IS0048 and IS0049 (`detail.account_files`) and
which accounts were blanked. Parser version 3 makes the scheduler re-pull every quarter.
**Lesson:** a new call-report account that is zero for every filer is a missing value, not a fact;
check the share of nonzero values before any chart or estimate uses it.

## 2026-10-06: Rosetta banned 312 banks' script-loaded fee pages before it could read them
**What happened:** a read-only dry run found 493 html texts at 312 banks marked `wrong_document`
whose own link names the fee page (`/fees`, `fee-schedule`) and whose static text shows at most one
amount. 220 of those banks have no live fee; all 312 links sat on the 90-day ban list, and 127 banks
were left with no fee link at all.
**Cause:** these pages load their fees by script. They were rejected on their menus-only static
text before the free script fallback (`read.js_fallback`, PR 206) existed, and the ban kept every
later read away. Only 12 of them were ever tried by the fallback.
**Fix:** same PR: the read step reopens up to 100 of them per step (`reopenScriptLoadedFeePages` in
`rosetta/read.ts`, chosen by James, "All 312"): ban lifted, link restored only for banks with none,
a visible `read.reopen` attempt per text, and one more read through the script fallback. No live
fee changes; a page that still is not a fee page is rejected again the normal way.
**Lesson:** when a reader learns a new route, texts rejected by the old reader need one pass
under the new one; a ban written by a judgment the code no longer makes outlives its reason.

## 2026-10-06: Knox sent Darwin fees the shared accuracy check can't trace
**What happened:** the Knox audit found Knox never checked its own reads against the line they
came from; only the paid pass did. Darwin rejects such reads as `not_in_source` (PR 200), so
they reached the raw tier and died there, and a fee read twice could keep the untraceable name.
**Fix:** same PR (Knox v17): the free team runs `checkFeeAgainstSource` on every find and $0 row.
Untraceable ones are held for review as `untraced`, and a traceable reading of the same fee wins.
On the answer keys, counted the way Darwin publishes, v17 matches or beats main's v16 (Texas 444
right / 15 wrong both; seven states 660 / 48 against 659 / 48). Dry run on 117 sampled live documents:
the rules re-check would keep 1,413 of 1,437 live fees against 1,416 today. The 3 that come down
are a $5 business counter-check price read as consumer (document 12657) and two safe deposit
fees at document 10091 that are live under shifted names ("Drill box fee" at $25, a
disclaimer at $200); Hamilton's source check applies the same rule and would pull them too.
**Then fixed in the shared check** (`src/lib/custom-report/source-check.ts`, same PR): it now reads
- a dot-leader name with the price that opens the next line, not the price in front of it;
- a price past a note line ("(up to $1,000)", "If checks are not on order");
- FREE/NONE on a line that also states other prices, as that segment's price. It is not read
  as the price when it is an allowance ("(2 FREE PER MONTH) | $1.00"), one column of a table
  whose next column prices the fee ("NSF | NONE | $14.00"), or the free word of a later name;
- a cap stated after the row's own price ("$35 per item, maximum of $175 per day") for a fee
  named as the cap.

Answer keys before and after: Texas 444 to 446 right, held out 43 to 43, seven states 660 to 665,
wrong unchanged (15, 6, 48). Dry run, read-only:
- The rules re-check keeps 1,415 of 1,437 sampled live fees; it kept 1,413 before this fix and
  keeps 1,416 on main.
- Of 704 live fees with names, 3 more trace and 0 stop tracing.
- Of 70 fees the source check took down, 4 trace again, all FREE rows on flattened lines.
- Of 24 fees Darwin rejected as `not_in_source`, 1 traces.

Most takedowns and rejections stay down because the price really isn't on the row, which is
correct.
**Lesson:** an extractor should apply the publish gate's own check before it hands a fee on,
so a disagreement shows up as a held row, not a silent rejection two agents later.

## 2026-10-06: Published fee names carried table separators and fragments
**What happened:** Knox named a fee with the whole text of its cell run, so live names read
"Copy of Paid Check | Per Item", "/Item Cashier's Check", "b. Non-Sufficient Funds (NSF)" or
ended in dot leaders. In a read-only sample of 117 live documents, 136 candidate names were untidy.
**Fix:** `tidyFeeName` (`src/lib/agents/knox/layout.ts`) cleans every free read's name, down to 3
untidy in the same sample with the gates unchanged. Hamilton's `decidePriorFee` and the rules
re-check restore compare tidied names, so a price change on a line live under its old untidy
name supersedes it instead of publishing beside it.
**Lesson:** when a normalizer changes what an agent writes, every place that matches new rows
to old ones must apply it too, or the change makes duplicates.

## 2026-10-06: Knox held low-balance fees written as account rows or prose
**What happened:** about 800 held lines mention a balance condition, and many are low-balance
charges Knox could not name: "Money Market Checking | $10.00 monthly for average balances below $1,000", "A club fee
of $8.00 will be imposed every statement cycle if the balance ... falls below $3,000",
"Average Daily Balance below $2,500 | $10.00/month", "MININUM BALANCE FEE ..... $5".
**Cause:** the low-balance name pattern needed "minimum balance ... fee" in the name; a prose
sentence names the fee after "a ... fee of $X", and the maintenance guard (correctly) refuses
money market and club accounts as monthly maintenance.
**Fix:** Knox v18 (rules 18) files them as `minimum_balance`, named by the bank's words and the
condition, with the fee and condition in one sentence and the balance never read as the price.
Gates rise (Texas 446 to 448, seven states 665 to 668, wrong reads 48 to 47). Read-only dry
run: no sampled live fee changes; on the 11,851 held lines' excerpts, 67 more get a priced
category. Some held prose still fails the shared check because the price comes before the
name inside a sentence ("avoid the $20.00 monthly maintenance fee"); those stay held.
**Lesson:** a guard that rightly refuses a category should send the row to the category that
does fit, not leave it unclassified.

## 2026-10-06: Knox's held lines never got the newer rules
**What happened:** 11,889 raw rows at 3,016 banks sit held as `knox_review:unclassified`, out of
Darwin's reach. Today's rules categorize many of them: "Courtesy Pay Fee | $30" (raw 118567) is an
overdraft fee and "Inactivity fee $5.00 per month" (raw 109417) a dormant-account fee, but both
stayed held.
**Cause:** Knox never extracts the same text twice, and the dedupe index on
(document, fee name, amount) made a later categorized insert of the same line `DO NOTHING`. A
line held by an older rules version stayed held for good.
**Fix:** the extract step re-reads held unclassified lines from the document's current text with
today's rules (`knox/held-recheck.ts`, 300 per step, marked by rules version so each line is read
once per version), and a categorized insert that meets a held row takes it over. Read-only dry run
on all 11,783 current-text held lines: 1,529 get a category and go to Darwin (top: dormant 230,
early closure 168, monthly maintenance 143, NSF 113, copies 106); nothing live is taken down.
**Lesson:** a dedupe key that ignores a row's state lets the first, weakest answer win forever;
when a reader improves, re-read what it set aside, not just what it never saw.

## 2026-10-06: Rosetta never heard whether its texts' fees held up
**What happened:** Rosetta learned only whether a reader opened a file. Scored by fees that
stayed live (read-only, Oct 6), 298 of 3,400 judged texts (9%) lost fees to takedowns the text can cause:
they lost at least 3 fees and a quarter of their judged fees. Survival by reader:
read.html_dom 90.7%, read.pdf_layout 89.5%, legacy html 88.9%, legacy pdf 81.4%, free OCR
93.2%, paid transcription 97.9%.
**Cause:** no path from Hamilton's takedowns back to the reader that wrote the text, so a reader
whose fees kept being pulled was used again on the same document.
**Fix:** same PR (`rosetta/text-survival.ts`, James approved the learning plan "build whole
thing"): daily per-text judgements in `pipeline_feedback`, one read a rung up the reader ladder
for a lost text (or a bank whose primary reader keeps losing), paid transcription for PDFs both
free readers lost. Dry run before merge: 200 current documents re-read (79 PDFs with OCR, 19
pages with the JavaScript fallbacks, 102 legacy texts with the current reader), 1,935 live fees
on them, 1 PDF for the paid pass now. A new text replaces the old only when it lists at least as
many fees, so no live fee is taken down by the re-read itself.
**Lesson:** an agent should be scored by what survives downstream, not by whether it ran.


## 2026-10-06: Large banks' overdraft fees were missed, misfiled or misnamed
**What happened:** a check of large banks' overdraft fees found Knox missing or mangling them:
"Overdrafts Paid" and "Overdrafts (OD)" (Enterprise, United Bank VA, Trustmark) were not read;
"Insufficient Funds Fee – Item Paid" (Santander) was filed as NSF; "We charge a fee of $37.00
each time we pay an overdraft" (First Merchants) was named "We charge a fee of"; Navy Federal's
$20 went live as "†Standard Practices and Fees: We will charge a fee of" and the rules re-check
took it down; a dot-leader row gave the next fee the first price's terms as its name (Glacier,
Mechanics); ESL's fee cards tiered "based on the value of the item" were not read; and Ent's
"Courtesy Pay" / "$30.00 | everyday debit card transactions ..." failed the shared check because
a price line under a name had to be 40 characters or less.
**Cause:** the overdraft rule matched only the singular; nothing read a paid item as an
overdraft; a sentence-form fee took its name from the words before the price; the second price
on a line took every word since the first price; the shared check treated a long price line as
another row, and rejected every tier, even one named by its own band.
**Fix:** Knox v19 (rules 19). The plural names the fee only when it opens the name or a fee word
follows ("transfer to cover overdrafts" and "overdrafts up to $500" stay out); a paid
insufficient-funds item is overdraft; a sentence-form fee is named by what it charges for
("Overdraft fee (each time we pay an overdraft)"), with "one per day" kept in the name since the
daily-cap categories hold dollars; a lowercase run before a title is the earlier price's terms;
fee cards tiered by item value are read per tier. The shared check reads a price line whose
first cell is the price and the rest a lowercase note, and accepts a tier whose name carries its
own band (balance bands without one stay `tiered_fee`). Gates unchanged (Texas 452 of 467, seven
states 673 of 720); live dry run 1,416 of 1,437 kept, same as v18; old vs new check on the
704-fee live sample and the 94 takedowns: no change. Held lines: 8 more overdraft reads, all
correct. The overdraft guard (accuracy thread) still rejects "Item Paid", so Santander waits on it.
**Lesson:** a rule written from one bank's wording misses the same fee in a plural or a
sentence; test new rules on the held lines before trusting them.

## 2026-10-06: a paid report could open blank
**What happened:** the private institution report is recomputed from live data on every view.
The readiness check runs at quote and at checkout, but a market that thinned out after payment
showed the buyer "This market is being refreshed" with no numbers (value funnel audit).
**Fix:** migration 20270110000005 saves the report's market data on the request when checkout
starts; `loadMarketReport` (`src/lib/custom-report/report-data.ts`) serves that saved copy, dated,
when the live market no longer passes.
**Lesson:** what a customer paid for has to be stored, not recomputed.

## 2026-10-06: Fees a bank removed from its page stayed live
**What happened:** the Hamilton publish audit found live fees read from an older copy of a page when
Magellan had since fetched a newer, different copy. The source check reads each document's own text,
so a fee that disappeared from the newer copy still traced to the older copy and stayed live. Read-only
count at 13:25 UTC: 12,924 live fees in 1,103 older documents at 965 banks have a newer copy Rosetta
read.
**Cause:** each changed fetch is a new `source_documents` row, and nothing compared a live fee against
the newest copy of its page (AGENTS.md listed this as not built).
**Fix:** same PR: `hamilton/newer-copy-retire.ts` checks a batch of older documents per publish step
against their newest copy and retires a fee only when its line is gone, with a restore path. A first
version that trusted the shared reader alone would have retired 45 fees; every one sampled was still on
the page, flattened differently (rows glued together, the price column lost, a stray quote mark). The
check now also looks for the fee's words anywhere in the newer copy. Dry run over all 1,103 documents:
12,652 fees still stated, 265 still named but not read at their price (kept), 1 retired ("Escheating to
State $2", replaced on the page by a $5 dormant letter fee), and 169 newer copies not recognizably the
same schedule (a navigation page among them), which retire nothing.
**Lesson:** a newer copy of a page is often a worse rendering of the same schedule. Comparing two
copies with a line reader measures the renderer, not the bank; a line is gone only when its words are.
Open for Knox and Magellan: about half of these newer copies have no Knox read yet (446 of 969 had
any raw rows at 13:22 UTC), so price changes in them do not publish.

## 2026-10-06: Percentage fees could not publish
**What happened:** a foreign transaction fee is "1% of the transaction", but every fee tier had
only a dollar `amount`, so Knox held each rate as `knox_review:percentage` (515 foreign
transaction rows across 358 banks at 14:40 UTC). Only 42 banks had a live foreign transaction
fee, and most of those 42 were dollar ATM or wire fees filed under it.
**Fix:** rate columns on all three tiers (`amount_kind`, `rate_percent`, `rate_min_amount`,
`rate_max_amount`, `rate_basis`), a rate twin of the shared trace check
(`checkRateAgainstSource`), and `published_fee_rate_catalog` beside the dollar catalog. Offline
dry run on the held foreign transaction and cash advance rows with their stored texts: 322
foreign transaction rates verify at 239 banks (median 1%), 40 cash advance rates at 35 banks
(median 3%); 214 of the 239 banks already have 2 other live fees, so their rate publishes.
Coin counting and late payment rates were added the same day, and a heading just above a row
may supply its fee word ("Coin Counting Fees" / "Coin Counting | 10% of total"). Final dry run:
foreign transaction 392 rates at 284 banks (median 1%), cash advance 61 at 53 (3%), coin counting
134 at 99 (5%), late payment 139 at 103 (5%).
**Lesson:** many "percent" lines on a schedule are interest or dividend rates, not fees (Knox
filed some under atm_non_network), so a rate publishes only in an allow-listed category, on a
row that says fee or charge and does not say APY, APR, interest or dividend.


## 2026-10-06: The e2e schema snapshot lags prod
**What happened:** CI's end-to-end test builds its database from `tests/e2e/production-schema.sql`
(taken 2026-10-04). A PR that reads a new column fails there even when its migration is right,
and the snapshot's `published_fee_catalog` still lacks PR 215's 3-fee rule, so the test's
one-fee peer banks would vanish under the real view.
**Fix:** PR 278 appends its columns to the snapshot. Open: refresh the whole snapshot from prod,
and give the test's peer banks 3 fees each so it runs under the real catalog rule.

## 2026-10-06: Knox held every percentage fee, often under a sentence fragment
**What happened:** with rate columns in place, Knox still wrote every rate as a held
`knox_review:percentage` row with no amount, 1,023 of them in the four rate categories, many
named by a fragment ("A 1% Currency Conversion Fee will be assessed on", "for customers").
**Fix:** `src/lib/agents/knox/percent.ts`. A held rate in an allow-listed category whose rate
traces with `checkRateAgainstSource` goes to Darwin as a rate fee, named from the category's own
words; "up to" rates, interest rates, two-rate lines and out-of-range rates stay held. Held rows
are re-read in place by `recheckHeldRates`. Knox v21 also reads the card's currency fee and
coin counting under the other names banks give them. Answer keys: 20 rate reads, 18 keyed and 2
real fees the keys leave out (0.2% currency conversion, 0.9% cross-border); flat gates and the
live dry run (1,416 of 1,437 kept) unchanged. Dry run on the 1,001 held rows with their
stored excerpts: 287 foreign transaction rates at 217 banks (median 1%), 106 late payment at 82
(median 5%), 39 cash advance, 37 coin counting.
**Still open:** 52 of 68 keyed rates still don't publish: about half are never read as a
rate (prose, rates split across lines), and the rest are "up to", two-rate or interest lines;
coin counting rows ("Coin Counting | 10% of total") fail the rate
check because the row has no fee or charge word.
**Lesson:** a new column is not a new fee until the extractor writes it; score the writer on the
answer keys, not only on the held rows it was built from.

## 2026-10-06: Knox never read its own corrections
**What happened:** Darwin and Hamilton write every category rejection and verification to the
shared learning store (`pipeline_feedback`, 5,835 Darwin category rejects at 15:30 UTC), but Knox
never read it. Fixes came only as hand rules, and a hand rule can regress: v19's plural
"overdrafts" rule filed "Overdraft Transfers" under overdraft again, a name the guards had
already rejected at 13 banks and verified as od_protection_transfer at 7.
**Fix:** `src/lib/agents/knox/lessons.ts`. Each extract step reads the store's clear lessons (47
at 15:30 UTC: statement copies, overdraft transfers, outgoing international wires, ATM card
replacements, paid NSF items) and re-files an exact name that today's rules still put in the
rejected category, flagged `knox_lesson:`. The rules re-check accepts the rejected-category read
for such a row. Answer keys: 2 fees re-filed, 1 fixed, 0 broken; flat gates unchanged. Only new
reads change, so no live fee is taken down.
**Lesson:** an agent that writes corrections to a shared store must also read them, or the same
mistake comes back with the next rule change.

## 2026-10-06: Large banks' schedules priced an overdraft fee Knox never read
**What happened:** the largest-banks thread found 11 banks whose stored schedules price an
overdraft fee that isn't live. Run on the overdraft lines of 10 of them, today's rules read 4
correctly (Santander, First Merchants, Enterprise, Navy Federal). ESL's fee depends on the item's
size and its tier table was not in the lines checked. The misses:
- a fee stated in a sentence to "customers" (OceanFirst);
- one-line PDF dot-leader schedules, split mid-leader so the name lost its price (Glacier,
  United);
- a long description row with its price in the last cell (Dollar Bank);
- a long conditional name (Mechanics);
- a two-column table (Trustmark).

The re-read queue was also broken: see "Knox kept reading older copies of a page".
**Fix:** Knox v22 (`src/lib/agents/knox/rules.ts`, `families.ts`) and the shared check's long
rows (`src/lib/custom-report/source-check.ts`). Run on the same lines, v22 reads 9 of the 10.
Answer keys rise slightly (Texas 454 of 468 from 452 of 467; seven states 674 of 720 from 673 of
719), and the live dry run keeps the same 1,414 of 1,437 fees.
**Still open:** Trustmark's two-column table ("Overdrafts (OD)" above "• Personal | $36.00"). The
specialists don't pair a heading with a row whose own cell is an account type.
**Lesson:** score a rule change on the specific banks a report depends on, not only on the
answer keys; the answer keys had none of these layouts.


## 2026-10-06: Knox kept reading older copies of a page
**What happened:** Magellan marks one current document per page (`superseded_by_id`, PR 265),
and its contract says Knox reads the current copy, but Knox's text selection never checked
it. At 17:55 UTC, 2,520 texts on older copies had a current copy with its own text (934 were
read again in the last 24 hours), and 8,689 unverified Knox rows from older copies were still
queued for Darwin, where a stale price competes with today's.
**Fix:** `src/lib/agents/knox/extract.ts`. Knox skips an older copy once the current copy has
a text, and each extract step retires up to 2,000 unverified older-copy rows
(`superseded_by_newer_copy`) for categories Knox already read from the current copy. Read-only
count on prod: 3,887 rows at 419 banks qualify today, 3,412 of them at the same price as the
current copy's row. The other 4,802 wait (their current copy is not read yet, or does not show
that category), so no fee is lost to a weaker newer read. Verified and live fees are untouched.
**Also found:** a page re-fetched with unchanged text was never read again. Knox skipped it as
"the same text under another document id was already extracted", and the older copy that held
the rows was itself blocked by its identical siblings. Navy Federal's re-check had reported 21
missing fees on its page at every rules version since v7, but no re-read followed. Separately,
the re-extract triggers (a thin text, or the rules re-check) only reach documents with live
fees. So 9 of the largest banks' stored schedules priced an overdraft fee that was never live.
Now an older copy's rows never block the current copy, and $10B+ banks' current pages are
re-read once per rules version, first in line. Read-only check at 18:20 UTC: the current pages
of all 11 flagged banks are selected, and 1,977 texts in total (183 at $10B+ banks) are due.
**Lesson:** when one agent adds a "current" marker, check every reader of the table honours it;
a comment saying "Knox reads the current copy" was not the same as Knox doing it.


## 2026-10-06: Knox's learning stopped at names many banks share
**What happened:** the learning reader only learned a name verified at 2 or more banks, so a name
one bank prints its own way never learned, however often it was corrected there. Names the
guards rejected with no verified fee anywhere ("Zipper Bags", rejected at 25 banks) never learned
at all. Knox's confidence was a fixed formula, so a table-read night deposit fee (6 of 58 still
live in the last 14 days) scored the same as a rule-read overdraft fee. And a new layout read thin
document by document with nothing tying the thin reads together.
**Fix:** per-bank lessons in `lessons.ts` (369 at 307 banks); a weekly label queue at
/admin/knox/labels for the names the store can't settle (`label-queue.ts`); shadow calibrated
confidence in the audit text from 14-day survival by strategy and category (`calibration.ts`,
59 of 221 groups would fall below Hamilton's 0.8 floor); and a layout signature on every extract
attempt with thin reads counted per signature (`layout-signature.ts`). Answer keys with the
fixture banks' own lessons (guard and Darwin verdicts only, not the keys themselves): 7 states
674 to 678 right and 66 to 63 category errors on v22; Texas unchanged. Only new reads change; no live
fee is taken down, and stored confidence is unchanged.
**Lesson:** a learning store that only learns from agreement across banks misses most of what it
is told; one bank's own verdicts are the strongest evidence for that bank.


## 2026-10-07: Two page layouts hid Trustmark's and ESL's overdraft fees
**What happened:** Trustmark's fee schedule PDF prints two columns, and the stored text flattens
them row by row, so the right column's "Overdrafts (OD)" heading ends a left-column row and its
"• Personal | $36.00" sub-row sits on the next line. ESL's checking page prints each fee as a card
("Fee TypeCourtesy Pay Overdraft Fee", a description, then "Fee$5.00"). Knox read neither:
Trustmark's NSF and overdraft ($36) were missed, and ESL's prices were held under the name "Fee".
The shared accuracy check would also have failed both, since name and price are on different lines.
**Fix:** Knox v23 (`table-rows.ts` right-column headings; card joining before the specialists) and
the shared check (`joinLabeledFeeCards`, and a right-column heading over the bulleted line under
it) read both. Answer keys and the live dry run are unchanged, and the shared check accepts
exactly the same pairs as before on every other text tried.
**Still open:** ESL's own fees index page keeps its fees in collapsed sections the stored text
does not hold; that needs a fuller fetch (Magellan or Rosetta), not a Knox rule.
**Lesson:** a layout seen at one bank is worth a rule only when the shared check can read it the
same way; otherwise Knox's find is held as untraced and never reaches Darwin.


## 2026-10-07: A bot check or script shell became a page's current copy and hid its readable text
**What happened:** 87 live fees sat on 5 pages whose current copy had no usable text, so Knox and
the source check had nothing to read. None was a scan. Three newer copies were a bot check ("Please
wait while your request is being verified", tvfcu.com, bankofbotetourt.com) or a bare title
(koolaufcu.org); two were 188- and 233-byte script shells (tcu37.com, yourgcu.org). Each page's
older copy had a full completed text (3,125 to 40,272 characters) carrying those fees.
**Cause:** `markCurrentCopy` made every successful fetch the page's current copy, so a fetch the
site blocked or answered with an empty shell superseded the readable copy, and an unchanged
re-fetch of the same block page would have done it again.
**Fix:** same PR. A copy whose text Rosetta read as not a fee page and under 300 characters is a
thin copy; `markCurrentCopy` hands the place to the page's latest readable copy instead, and
Rosetta's read step runs `restoreReadableCopies` each pass (`thin_copies_set_aside` in its step
detail). Read-only dry run: 6 pages qualify (these 5 plus one with no live fees).
**Lesson:** "newest" is not "current" unless the newer copy is at least readable.

## 2026-10-07: The accuracy check split one-line PDF schedules inside their dot leaders
**What happened:** some PDF schedules are stored as a single line holding every row
("Stop Payment………………. $35.00 Dormant Account Fee……. $7.00/Month ..."). The shared check
(`source-check.ts`) splits long lines into sentences after every period, and the last period of
each dot leader counted as one. So each fee's name ended one piece and its price began the next.
Knox read West Shore Bank's stop payment, cashier's check, dormant, overdraft and late charge
correctly, then held every one as untraced. The bank stayed hidden behind the 3-fee rule.
**Fix:** the shared check no longer splits inside a leader (Knox's own splitter already worked
this way since v22). Knox v25 also files a box size in inches as a safe deposit box.
**Also found:** of the 108 hidden banks under $10B, 61 have no fee schedule stored at all
(checking, rate or Truth-in-Savings pages), so they went to Magellan. 49 have 128 Knox rows that
Darwin hasn't judged yet.
**Lesson:** Knox and the shared check must split text the same way. When one learns a layout,
change the other in the same PR.

**Same day, newer page copies:** 898 live fees on older page copies had no matching Knox row on the
page's current copy, though the current text still carried the amount. The causes:
- about 370 were read on the current copy under another category;
- about 110 were held there;
- 211 were read on a second document holding the identical text;
- the remaining ~200 sat on current copies last read at rules v1 to v7.

Nothing re-read a current copy, because the re-read triggers only reach thin texts, flagged texts
and $10B+ banks. Knox now reads a current copy again once per rules version while an older copy
still carries live fees.

## 2026-10-07: 14,133 live fees still pointed at a superseded copy of their page
**What happened:** when Magellan fetches a newer copy of a fee page, Knox reads it and Darwin
verifies its rows. A line whose amount did not change is skipped by Hamilton's publish rules as
"identical fee already published", so the live fee kept its old document, old source date and old
published date. On 7 Oct, 14,133 live fees at 1,051 banks pointed at a superseded copy; for 8,607
of them (669 banks) the current copy states the same fee under the same name at the same amount,
verified by Darwin and never published.
**Fix:** every publish step moves up to 300 of those fees to the current copy
(`hamilton/refresh-copy.ts`): it publishes the current copy's verified row under today's publish
rules and category guard, and closes the old row as `refreshed by #<new id>`. Amounts are
unchanged, so no price change is recorded and no fee comes down without its replacement.
**The other ~5,500, sorted (prod, read-only, 7 Oct ~01:05 UTC):** 2,104 are read by Knox from the
current copy at the same name and amount but not yet verified by Darwin (1,108 held as
`duplicate_in_batch`, 782 not reached yet, 172 peer outliers); 683 have a same-amount row Darwin did
not verify or filed under another variant; 934 are not in the current copy's Knox rows, but the
current copy's text still carries the amount for all but 1 (a Knox miss, not a dropped fee); 1,206
sit on a current copy with no Knox rows: 972 of them because the current copy's text is identical
(Knox skips text it has read), 147 because Knox read nothing from changed text, 87 because the copy
has no stored text; 10 are real price changes. So none of the groups shows stale prices at scale.
The identical-text copies are fixed here too: `moveRowsToIdenticalCopy` moves the superseded copy's
rows to the identical current copy (912 live fees at 55 banks; one superseded copy per current copy).
**Lesson:** a dedupe that only asks "is this value already live?" also has to ask "from which
copy?", or freshness silently stops moving.

## 2026-10-07: 87 imported live fees had no source document
**What happened:** the April import (`migration_v10`) wrote some fee lines twice, once with the
schedule's document and once without, and published the copy without one. The source check traced
them to the schedule but its relink is skipped when the slot is taken (an imported row is unique per
source, document and name), so they stayed live with no document. 82 of the 87 have a twin at the
same amount that was never verified; the other 5 have a twin at a different amount (separate lines).
**Fix:** every publish step points such a fee's verified row at its twin once the twin's document
states the fee (`linkImportedFeesToTwins` in `hamilton/source-check.ts`). Nothing is published or
taken down.
**Lesson:** a uniqueness guard that skips a write silently needs a fallback, or the skipped rows
stay broken without anyone seeing them.

## 2026-10-07: The newer-copy check could judge a copy Knox never read
**What happened:** Knox reads a stored text once, so a newer copy whose text is byte-identical to
one it already read (same `text_hash`, for example Wailuku FCU documents 2917 and 16048) has no fee
rows of its own. The newer-copy check judged fees by the newer copy's text only, so it never retired
anything on identical text, but nothing stopped it from judging a copy Knox had not read, or retiring
a fee Knox did read from the newer text under another category or as a held row.
**Fix:** the check skips pairs whose texts are identical, waits until Knox has rows for the newer
text (from any copy with the same `text_hash`), and never retires a fee whose name or amount Knox
read from that text. These guards only retire less (version 1 retired one fee in total), so the
strategy version is unchanged. Retires stay logged with a reason and restorable.
## 2026-10-07: the free companion finder never reached most hidden banks
**What happened:** the companion finder (`second-document.ts`) only takes banks in the step's own
state. On 6-7 Oct it checked 507 banks in 30 smaller states and found pages at 353 (1,307 pages, $0),
while 488 discovery steps ran but only 111 gave it any bank: a state checked this month leaves the
step idle. Of the ~2,200 banks the catalog hides (fewer than 3 live categories), only 253 had ever
been checked (197 with a page found); 1,606 product-page or no-overdraft banks had not, most of them
in states the lanes had not reached (most in Texas 144, Illinois 108, California 97, Ohio 86). Knox's list of
61 hidden banks was 37 of them.
**Fix:** spare slots now go to hidden banks from any state (`hiddenOnly` top-up in
`selectThinBanks`), same order: requesters, $10B+, incomplete links, fewest categories. Free, no
provider call.
**Lesson:** a per-state queue needs a cross-state fallback, or its capacity idles while the backlog
sits in states it has not reached.

## 2026-10-07: Two-column schedules hid wire and stop payment fees behind footnote text
**What happened:** First National Bank Alaska, a report requester, had 7 of 15 headline fees live and
needed 9. Its schedule is stored as two columns flattened row by row, so the right column's
footnotes sit beside the left column's headings ("Wire Transfer Fees | being returned NSF."). Knox
read those lines as rows, not headings, so "Domestic Outgoing | $35.00" and "International
Outgoing | $50.00" had nothing to name them, and the stop payment rows were held. One line
priced both NSF and overdraft ("NSFs/Overdrafts | $33.00") and was filed as NSF only. A balance
requirement was held as an unclassified fee, and a savings transfer was filed as an overdraft fee.
**Fix:** Knox v27 sets the heading from a priceless two-cell line whose right cell is prose, files a
joined NSF/overdraft price under both, never holds a balance requirement, and reads an
"Insufficient Funds Transfer" as an overdraft protection transfer.
**Lesson:** a flattened second column can sit on any line, including a heading's. The heading
test has to look at the left cell on its own.

## 2026-10-07: one page stored under two spellings kept two current copies
**What happened:** Magellan marks a page's older copies as history only when the address matches
exactly. "https://www.wailukufcu.com:443/about/rates-and-fees" and ".../about/rates-and-fees/" are
the same page, so both stayed current. The newer copy's text was identical, Knox reads a text only
once, and the newer copy got 0 fee rows while 41 live fees stayed on the older spelling, which
nothing marked as older. Prod (read-only, 7 Oct ~01:30 UTC): 109 current copies at about 108 banks
have a newer copy of the same page under another spelling (port :443, trailing slash, `#fragment`,
www or not), with 666 live fees on them; 77 have identical text.
**Fix:** `markCurrentCopy` also matches the page by host (no www or port) and path (no trailing
slash or fragment), and `supersedeSamePageCopies` backfills existing pairs in each fetch step. Both
start in shadow mode (`SAME_PAGE_SUPERSEDE_LIVE = false`), logging `magellan.same_page_copies`
events; switching on is a one-line follow-up after the logged pairs are checked. Hamilton's
newer-copy check and identical-copy move then handle the fees, as for any superseded copy.
**Switched on (follow-up PR):** five shadow fetch steps on prod (01:50 to 02:20 UTC, 7 Oct) logged the
same 109 pairs each time, every one a true respelling (www, :443, http, trailing slash, #fragment),
including Knox's examples (barcons.org 3307 to 16035, bankofprotection 1106 to 15935). No current copy
was a thin copy; 98 were read and 11 were wrong-document pages in both spellings. 277 live fees sit
on the older copies (the PR said 667; a recount by distinct live fee gave 277). Superseding changes no fee: Hamilton's refresh moves a live fee only when the
current copy reads the same line, and its newer-copy check still pairs exact addresses, so no fee is
taken down by this. The ranking now puts thin copies last. Knox counted 155 pages and 462 documents
because it included failed and already-superseded copies; only current copies need linking.
**Proven on prod:** run 1936's fetch step (02:51 UTC, 7 Oct) logged "Superseded 110 current cop(ies)";
docs 3307, 1106 and 2917 now point at 16035, 15935 and 16048. Of the 277 live fees on the older copies,
none was taken down after the switch (checked 03:10 UTC).
**Lesson:** "same page" has to mean the same normalized address everywhere, not the same string.

## 2026-10-07: the paid schedule search sent SQL with a comparison cut short
**What happened:** PR 314 rewrote the schedule-search query and lost the `''` after
`btrim(inst.fee_schedule_url) <>`. Every `discover-paid` step failed with "syntax error at or near
AND" from 01:21 UTC Oct 7 (4 failures before the fix). The unit tests mock the database, so they
never parsed the SQL.
**Fix:** the `''` is back, and a test now checks that no SQL sent by the schedule search leaves a
comparison without its right-hand side. The fixed query was run read-only on prod and returned its
12 rows.
**Lesson:** when a test mocks the database, run a hand-edited query once on prod (read-only) before
merging.

## 2026-10-07: transfer limits were live as prices
**What happened:** Knox read limit lines as fees and nothing downstream caught them, because the
categories involved (Zelle, mobile deposit, bill pay, cash advance) have no amount range and fall
back to the $2,500 default. Live examples: "Zelle® transfer limit" $1,000, "Mobile Deposit Checks
are limited to" $1,000, "Cash Advance: Customer" read from "$2,500 Limit". Prod dry run (read-only,
7 Oct ~01:50 UTC): 22 live fees.
**Fix:** Hamilton's limit guard (`hamilton/limit-guard.ts`) rolls them back each publish step,
archived with a `limit_as_fee:` reason, and refuses new ones at publish. Knox is fixing the read.
**Lesson:** a category without an amount range accepts any figure; a limit and a price only differ
in the words next to the figure.

## 2026-10-07: three gaps in Hamilton's own bookkeeping
**What happened:** (1) The feedback sync named a check after each takedown reason, so PR 311's
refresh closes ("refreshed by #69017") wrote 632 learning rows, each with its own check name and a
`wrong` signal, though a refresh means Knox and Darwin were right; 6 more came from "older document
than #N". (2) The newer-copy check and the rules re-check restore older rows without a new highest
fee id, so the source check, which re-checks a bank only when that id changes, left restored fees
unchecked. (3) The rules re-check judged a fee against the document's latest text when its own text
was gone, so it could take a fee down for what another text says: 438 of 2,158 re-check takedowns
made 6-30 hours after publishing (Oct 5-7). The rest were newer Knox versions reading the same text
differently (the burst on Oct 5, 16:00-23:00 UTC, followed a Knox release); only 20 were the
hint-category case PR 316 fixes.
**Fix:** reasons that point at a row get one check name (`hamilton.refresh_copy`,
`hamilton.duplicate_collapse`) with the id in evidence, refreshes count as `right`, and the sync
relabels the old rows (kept, old name in evidence). Restores leave a marker the source check's due
query honors. The re-check only takes a fee down for its own text, and brings back the up to 552
takedowns (195 banks) it judged against another text, each re-judged by the source check.
Then a second look before any re-check takedown (coordinator, 7 Oct): a fee Knox's newer rules no
longer read from its own text comes down only if its name and price no longer trace there or the
category guard rejects it. Sample of 60 past re-check takedowns (read-only, text near each fee):
40 would have stayed live. Some of those 40 are wrong fees the category guard does not cover (a
safe deposit size row filed as a cash advance, "Printed Account History" as an ACH return), so
they wait for the next Knox version instead of coming down.
**Lesson:** an identifier never belongs in a name something groups by, and a "due" test keyed on
the highest id misses anything that comes back with an old id.

## 2026-10-07: Rosetta's free readers looked worse than they were, and reopened pages were never read
**What happened:** a red-team check found free OCR succeeding on 30 of 146 documents, the
JavaScript fallback on 104 of 229 pages, and 95 of the pages PR 253 reopened banned again.
**Causes:**
- OCR: 96 of the 146 were text-layer PDFs the text-survival ladder (PR 257) sent to OCR.
  OCR reads only page images, so they had none or only a logo; it replaced none of their
  texts. On real scans it read 22 of 50.
- JavaScript fallback: 79 of the 229 were pages with plenty of their own text that just
  isn't a fee schedule (home pages and "not found" pages at guessed `/fees` links). The
  fallback found nothing on all 79 and logged `js_required`, as if they were script pages.
  On real script pages it read 67 of 113.
- Reopen: the read step reads only a bank's newest document. 380 of the 464 reopened pages
  had a newer document at the same bank, so they were never re-read; 190 of them are
  still the current copy of their page. The 95 re-banned pages were read again and still
  failed (49 wrong page, 4 script-only). Reopening stopped at 16:07 Oct 6 because every
  eligible page had been reopened once.
**Fix:** same PR. A text-layer PDF whose text lost fees goes straight to the paid pass (no
OCR rung). The fallback logs `wrong_document` for a page with its own text. A reopened page
that is the current copy of its page gets its one read even when the bank has a newer
document, and only current copies are reopened.
**Lesson:** a success rate is only meaningful over inputs the reader could ever handle.
Check which inputs a ladder or reopen sends before reading its score.
## 2026-10-07: Fed districts were assigned by state, and Arizona was in the wrong one
**What happened:** every institution in a state carried one Fed district, set long ago from a state
table that put Arizona in District 11 (Dallas) instead of 12 (San Francisco) and West Virginia in 4
instead of mostly 5. Split states (Missouri, Tennessee, Kentucky, Pennsylvania and others) were all
assigned to a single district. FDIC sends each bank's real district (its FED field, set by the head
office's county) on every universe refresh, but the update kept the stored value
(`COALESCE(s.fed_district, r.fed_district)`), so FDIC's value never landed. NCUA has no district
field, so credit unions were never corrected either.
**Fix:** the FDIC universe step now takes FDIC's district, then gives credit unions and closed banks
the district most active banks in their city have (else their state's). A parser version bump makes it
run on the next registry tick (`registry/fdic-universe.ts`).
**Lesson:** `COALESCE(stored, fresh)` freezes the first value forever; refreshed regulator fields go
`COALESCE(fresh, stored)`.

## 2026-10-07: Knox's learning reader never loaded a lesson after PR 300
**What happened:** PR 300 added per-bank lessons to the lessons query in `knox/lessons.ts` and
left an extra ")" after the `tally` step. Postgres rejected the query on every extract run.
`loadKnoxLessons` caught the error inside its savepoint and returned no lessons, so Knox re-filed
nothing (the audit red team counted 0 lesson refiles in 110 extract runs). Darwin kept rejecting the
same names under the same wrong categories ("Statement Copy" as a paper statement, "Overdraft
Transfer" as an overdraft).
**Fix:** the paren is gone. The same query, run read-only on prod, returns 79 global lessons and
567 per-bank lessons. A test now checks that the query's parentheses balance.
**Lesson:** a reader that swallows its own errors needs a test of the SQL it sends, because a
silent empty result looks the same as "nothing to learn".

## 2026-10-07: Knox's calibration counted every takedown as a misread
**What happened:** Knox's shadow calibration (`knox/calibration.ts`) scores each strategy and
category by how many of its recent published fees are still live. It counted every rollback as a
misread, including rules re-checks (4,467 in 14 days), newer copies (915), duplicates (174) and
takedowns Hamilton later restored. Overall survival read 85.6%, and the learning signal mixed
Knox's mistakes with changes elsewhere in the pipeline.
**Fix:** calibration v2 counts a takedown against a read only when it says Knox misread the fee
(`source_check_untraceable`, `amount_outside_category_range`, `category_guard`) and was not later
restored. Other rollbacks are left out. Survival is now 95.1%. Night deposit (42%) and minimum
balance (62%) are still the weakest reads.
**Lesson:** a learning signal has to say whose mistake it records.

## 2026-10-07: a price charged per $100 of the item was published as a flat fee
**What happened:** a spot check of 10 fees source check v5 restored found two at one credit union
("Cashier Check - All Others (per $100.00) $1.00", same for money orders) live as a flat $1. A
query of live flat fees found one more: a check-cashing row "(NOT ON US- PER $100)" that took the
$30 of a 3x5 safe deposit box printed beside it.
**Cause:** Knox's rules strip dollar figures from a name, leaving "(per )", and keep the price.
`checkFeeAgainstSource` read "(per $100.00)" as a note on the name (v5), so nothing objected.
**Fix:** the shared check refuses a price whose own label says "per $N" (`priced_per_amount`);
source check v6 re-checks every institution, so the live ones get the second look and then come
down, archived. Knox, Darwin and Hamilton all read through the same check, so new reads stop too.
**Lesson:** a figure in a fee's label is either a band, a limit or a basis; the reader has to
decide which before it calls the price flat.

## 2026-10-07: the source check took down real prices in five layouts
**What happened:** Darwin hand-checked 20 recent `source_check_untraceable` takedowns: 13 looked
like real prices. Re-running today's reader over all 424 such takedowns from the last 24 hours
found two causes. First, v5 had re-checked only 1,523 of 3,296 institutions, so many fees its fixes
already read were still down. Second, five layouts it still could not read: "$.50" (no leading
zero), a price with a unit and a qualifier under its name ("$5.00 per month for each acct.,
following ..."), "Fee $35.00" under a name, "failure to maintain $1,000 daily balance | $3.00"
(the balance read as a band), and a name wrapped onto the next line ("Replacement Key (1 key |
$25.00" / "lost)") whose open parenthesis made the price look like a note.
A second pass over two samples of the fees still down found more: a column heading repeated
on every row ("Name" / "Fees & Charges" / "$2.00", one credit union's whole schedule), an
"Area | Per | Fee" table one cell per line, "Fee @$20 per hour", a free allowance in a note
("(first 6 free)" / "$1.00"), "$200+", "<$100" and a plural "(s)" read as a note.
**Fix:** the shared reader reads all of these (source check v6); 99 of the 384 takedowns with stored
text now trace. Spot checks: 19 of 20 restored fees real (the miss: "$5.00 or 2% cash advance"
shown as its $5 minimum), 34 of 36 from the second pass real. Of Darwin's 13, 4 now trace; 5 are
right to stay down on the full page (Darwin judged from Knox's excerpt: the price belonged to the
next row or column); 1 is a rate per $50 (refused by design); 3 have garbled names. Of a fresh
random 20 still down, 15 are rightly down; the 5 misses are two-column layouts and names glued to
a neighbouring fee, which the reader does not untangle yet. v6 re-checks banks with source-check takedowns first, so the restore
runs through the normal check, logged, with `hamilton.restore` rows in `pipeline_feedback`. The
12-hour second look (PR 324) has gated every source-check takedown since 02:32 UTC.
**Lesson:** after a reader version bump, count how far the re-check has got before judging what
it restores; and sample takedowns, not just live fees, each time the reader changes.
**Follow-up (v7):** a two-column page flattened row by row interleaves two fee lists
("CHECK CASHING ... 15% | PROCESSING OF LEVIES**" / "($15.00 Minimum) | IRS or Court-ordered
Garnishments ... $100.00"), so a right-column fee's name and price sit on rows of other fees. The
reader now also reads each column top to bottom when most two-cell rows carry words in both cells
(a table's "Name | $2.00 per page" price cell is never split off), and joins a name that runs onto
the next row ("PROCESSING OF LEVIES IR"). Over the same 424 takedowns, 6 more trace (105): 5 real,
1 a non-customer price. Still not read: two columns interleaved inside one cell ("Overnight Rush
Check or Zelle | ..." / "$14.95/ ea.") and names glued to the previous fee's "Free for age 60+".

## 2026-10-07: Limits went live as prices, and the paid reader read superseded copies
**What happened:** the audit red team found about 55 live fees that are limits, such as "Zelle
transfer limit $1,000", "Mobile Deposit Checks are limited to $1,000", "No Bounce Courtesy Pay
Limit $600" and "cash Advance limit is $500". Knox's rules filed the line under the fee the name
mentions, and the price beside it was the limit. Separately, the paid reader had no filter for
superseded copies: since 18:37 Oct 6, 59 of 270 paid reads were older copies whose current copy
already had text, costing $1.62. Its priced-line count also missed "$.50" and "75¢", and so did the
shared check, so those prices never traced.
**Fix:** Knox v28 drops a read whose name ends on a limit (`namesALimit`), except for cap
categories and fees for going past a limit. The paid reader rejects the same rows and now uses the
free reader's superseded-copy filter. The shared check reads "$.50" and "75¢".
**Lesson:** a price beside a name is the fee only when the name names a charge. Words like
"limit", "limited to" and "maximum load" mean the figure is a ceiling.

## 2026-10-07: Magellan's outcome ledger judged one 24th of each state, and never taught from companion pages
**What happened:** the ledger (`magellan.link_yield`) is what lets Magellan learn which links work. Each
discover step judged only banks whose id mod 24 matched the UTC hour, inside the step's state. A state
lane runs about once a day, often at the same hour, so it judged the same 24th of the state every time.
On prod, 781 banks had ever been judged, and only 19 of the 714 companion links Knox had read. The free
platform finders also learned paths only from each bank's main link, so a schedule found by the paid
search, the companion finder or a person (`institution_additional_sources`) never taught them anything.
The freshness search had the same slot inside its state filter.
**Fix:** a state's step judges and checks its whole state (`stepSlot`); steps without a state keep the
hourly slot. The platform learner now counts judged `consumer_supplement` companions like main links
(live +2, thin -1, wrong or dead -2); an unjudged companion counts for nothing until it is read.
**Lesson:** a rotation meant to spread load has to be checked against how often its caller runs. Hand
fixes only help the next bank when they flow into what the finders learn from.

## 2026-10-07: business fee schedules stayed banks' consumer links, and their prices went live as consumer fees
**What happened:** Hamilton's audit found Launch CU ($15 NSF) and Community CU of Florida ($30) showing
prices from their business fee schedules. Both main links are business-only PDFs the old crawler chose
(no Magellan attempt on either). Magellan's business search, which looks for the consumer schedule, only
ran in spare discovery capacity, so in states with many banks lacking a link it never ran: 41 of 187
business-link banks had been searched, 2 replaced. The paid schedule search took business links only
for $10B+ banks and report requesters. The outcome ledger judged a business link by its live fees, so a
business schedule with many fees counted as a good link and taught the finders its path.
On prod (read-only, 7 Oct), 1,028 live fees at 91 banks are read from business-only documents; 61 of
those fees have a live consumer fee in the same category at the same bank.
**Fix (Magellan):** three discovery slots per step are kept for business-only links; the paid schedule
search takes any business-link bank once the free search missed (36 banks today); the ledger judges a
business-only main link as wrong (`business_schedule`, -2 for its path), so the finders learn not to pick
such pages. The live business-schedule fees are Hamilton's to archive through its second look (never
deleted); the dry-run counts above went to the Hamilton publish thread.
**Lesson:** a link that produces many fees is not a good link if they are the wrong customer's fees.


## 2026-10-07: Fee names ran on into their price
**What happened:** the audit red team counted 3,599 of 48,297 live Knox fees with a messy name: 1,819
joined with "|", 1,338 over 80 characters and 1,025 ending on a dangling word ("Replacement Card Fee
of", "ATM Fee for", "Debit Card Replacement A fee of"). 1,642 of the piped names predate the v17
name tidy (Oct 6) and only change when Knox reads that page again. The tidy itself kept the words
that led into the price, and kept the previous row's "None" price cell in the name.
**Fix:** Knox v29's `tidyFeeName` drops a trailing connector from names of eight words or fewer, a
leading article, and everything up to a "None"/"Free" cell between names. Longer sentences keep
their ending, since the category guard reads "fee of" as the sign of a fee sentence.
**Lesson:** a name is tidied for the reader, but the category guard still reads it, so a tidy rule
has to be checked against the guard and the answer keys, not only by eye.

## 2026-10-07: a rules change could not take back a category it had given a held line
**What happened:** Knox v26 folded held lines into existing categories. Its first prod pass (runs
1927, 1929, 1930) promoted 60 lines. Six of them went to the wrong category, and two of those were
verified and published within minutes (published 69934, 69503). Nothing re-read a line after it was
promoted, so the next rules version could stop new misfiles but could not pull back these.
**Fix:** PR 336. Knox v30 narrows the fold. `recheckPromotedRows` puts unverified promotions that
today's rules no longer file the same back on hold, logged as `wrong` and never deleted; rate fees are
skipped. Category guard v15 rejects the two live rows, so Hamilton's rules re-check takes them down.
Dry run on 794 unverified promotions: 7 go back on hold.
**Lesson:** sample real prod output right after a rules change ships, and give every automatic
promotion a way back.


## 2026-10-07: Hamilton read a fee missing from the index as "no fee"
**What happened:** a live Pro answer for Space Coast Federal Credit Union (saved 02:31 UTC Oct 7) to
"Who in our state changed their NSF fee this year?" said "Your schedule shows no NSF fee" and weighed
"a no-NSF position". The index has no NSF row for Space Coast at all, which only means the fee is not
in the index. The memo also opened with what the data could not say. Its local comparison used
business fee schedules for Launch Credit Union and Community Credit Union of Florida.
**Fix:** engine 1.9.1 heads a missing fee "Your NSF / returned item fee is not in the index yet". The
memo writer is told that `own: null` is never a fee of $0, and is asked again when it calls a missing
fee "no-fee" or opens its summary with a limit. A recorded fee change now counts only when both prices
were read from the same page.
**Lesson:** missing data and a $0 price must never share wording. The business-schedule rows are a
consumer/business split for the fee readers, not something Hamilton can fix.

## 2026-10-07: Darwin's dispute threshold was too loose to bring takedowns back
**What happened:** 4,467 live fees were taken down by the rules re-check before the second look
existed; 3,783 still have their own text and 3,156 have no live copy of the same category and price.
Restoring those that pass the second look and that Darwin's category model does not dispute
(probability above 0.05) was hand-checked on a random 20 (read-only, text near each fee): 16 right.
Misses were a fax service filed as account research, an in-network ATM filed as non-network, a
price from the next column, and a refundable key deposit. Each tighter filter was checked on a
fresh random 20: 17, 15, 16, 16 right. Misses included two-column rows ("Legal Processing ... | Stop
payments ... $35"), $0 in-house services, "Minimum balance of $25", "UPS Fee + $1", "Copy of Money
Order check" as a money order, and a safe deposit size row joined to "Credit card cash advance".
**Fix:** the restore bar (`hamilton/restore-guard.ts`): the model's top category must be the
fee's own at probability 0.8 or more (first pipe cell too, no other cell disputed), the price must
sit on the fee's own row, and $0, minimum-balance, refundable, limit, markup, cut-off and copy-of
rows stay down. A fresh random 20 that passed it: 19 right (bar 18); the miss, a reproduction of
cashier's checks filed as a cashier's check, led to the copy-of rule. About half of the ~1,400 rows
the database-side part of the bar keeps passed the full bar in two samples (24 of 50), so roughly
700 should come back; that is an estimate, and the first run's `restored_by_reason` gives the count.
**Lesson:** a dispute threshold tuned to flag fees is not a bar for restoring them; restoring
needs positive agreement, measured on fresh samples rather than the sample a filter was tuned on.

## 2026-10-07: Limit wordings v28 missed
**What happened:** v29's first prod run (02:55 UTC, 50 pages, 241 rows) still raised six limits as
fees: four "the limit will increase to $500/$1,500" rows filed as overdraft and "Daily ATM Limits
($/#)" at $505. v28's `namesALimit` only knew a limit followed by "is/are/to/of", and a trailing
note only when it began "per/daily/each/for". A sixth row, "Money Market Minimum Balance Fee if"
at $2,500, is a balance threshold read as a fee and is not fixed here.
**Fix:** Knox v30 adds "will increase to" / "will be increased (raised) to" after a limit and a
"($/#)" note to `namesALimit`.
**Lesson:** prove a rules change on its first prod run, not only on the answer keys: prod pages carry
wordings the keyed schedules lack.
**Follow-up (v31):** v30's first prod run (03:21 UTC, 362 rows) had none of these wordings but read
an ATM rebate cap ("The maximum rebate per 12-month cycle" $180/$240) as a fee; v31 reads a maximum
rebate, refund or reimbursement as a limit.

## 2026-10-07: Knox's lessons ignored restores
**What happened:** Hamilton publish found that Knox's lessons read every `wrong_category` takedown as
wrong without checking whether Hamilton later restored the fee. The 1,603 `restored_after_takedown`
rows (and the restore bar's, PR 320) were not read at all. Knox never learned from the kinds that are
restored most (not_on_schedule, wrong_amount, threshold, unreproduced), because the lesson reader
only reads category verdicts. A first draft that dropped every restored takedown would have removed
26 correct lessons. Those fees were taken down as domestic wires and restored as international wires,
so the restore confirmed the takedown.
**Fix:** lessons v3 (`lessons.ts`, `label-queue.ts`) count a restored fee as verified under the
category it came back with, and drop a takedown only when the fee was restored under that same
category. On prod this adds 30 lessons and drops none.
**Lesson:** a restore can change a fee's category, so check it against the category of the
verdict it overturns, not just the fee id.

## 2026-10-07: Paid schedule search re-paid for banks whose answer never opens
**What happened:** the paid schedule search treated a timeout as "not searched", so every paid step
searched Morgan Stanley Private Bank and Northern Trust again. The model named the schedule each time,
but the bank's site timed out when we opened it. That made 35 and 34 paid calls in 9 hours. In October
71 timeouts on 3 banks cost $3.87, a fifth of the step's $15.86, and took 2 of the 10 priority slots
in every step.
**Fix:** `MAX_TRANSIENT_TRIES` (3): a bank whose month holds 3 tries that timed out or were refused is
searched again next month. Budget stops don't count.
**Lesson:** a retry rule for transient failures needs a count, or a site that always fails is retried
forever.

## 2026-10-07: Error pages saved as fee links never went back to discovery
**What happened:** three banks' fee links are the site's own error page: Northern Trust
(`/united-states/page-not-found`), Service 1st FCU (`/404/`) and Bank of Hays (`.../wcErrors/404.html`).
Magellan sends a link back to discovery only on a 404, a 410 or a redirect home. Northern Trust's page
timed out on every fetch, so it kept the link, and the paid schedule search re-searched it.
**Fix:** `isErrorPageLink` (`link-coverage.ts`): the fetch step treats such a link as gone however the
fetch went. It keeps the URL in `rejected_source_urls`, clears the link and marks the bank due a search,
the same path as a 404. Discovery rejects error-page addresses as finds. None of the three has live fees.
**Lesson:** judge a link by its address as well as by the response; a blocked site never returns the 404.

## 2026-10-07: free OCR read scanned pages sideways and upside down
**What happened:** the audit tracker scored Rosetta's OCR at 7 of 45 OK over 12 hours. 43 of the
45 ran before PR 331 and 31 of those were text PDFs the old ladder sent to OCR (PR 331 stopped
that). The real scans that failed mostly came back with plenty of characters at confidence 25 to 45
(Certificate disclosures at edufcu.org and cmecreditunion.org). OCR took each page's largest image
as stored, but scanners often store a page bottom row first or sideways and let the PDF's placement
matrix or the page's /Rotate turn it back. Tesseract was reading mirrored or sideways text. A test
set of 8 scans in those layouts read 3 of 8 before and 8 of 8 after.
**Fix:** `ocr.ts` version 2 follows the placement matrix and /Rotate and turns each page image the way
the page shows it. A page that still reads poorly is probed at the other quarter turns, for paper
fed in sideways. Scans an older OCR version rejected or found empty get one read with the new one.
Still unexplained: three one-page scans returned 0 characters at confidence 0 (802cu.com,
csbnetbank.com, onomeafcu.org). The cloud container cannot fetch bank sites, so their bytes were not
checked.
**Lesson:** an image inside a PDF is not the page; read it through the matrix that draws it.

## 2026-10-07: 79 reopened pages were selected every run and never read
**What happened:** after PR 331, 90 reopened pages were read within an hour, but 88 others never
were. 79 of those 88 still had their earlier failure in the bank playbook's do-not-retry list. The
read step selected them, the router skipped them as a known failure, and a skip writes nothing, so
they stayed eligible and were selected again every run. Reopening a page lifted its URL ban but not
the playbook entry.
**Fix:** the selection marks a page reopened and not read since (`reopen_pending`). For that one read,
the router ignores do-not-retry entries for its bytes. The read's own attempt then settles it.
**Lesson:** when a router skip writes nothing, check that a skipped row can't be selected forever.

## 2026-10-07: The rules re-check restored fees with no check when their text was gone
**What happened:** a fee the rules re-check had taken down came back live, with no category
guard, schedule check or category model, whenever the text it was read from was no longer stored
(`rules-recheck.ts`, restore reason `text_gone`). 84 live fees at 16 banks came back that way,
among them NY answer-key misses: an international wire filed as bill pay, "Letter of Protest" as a
gift card, a $0 "ATM services are UNLIMITED" and a check photocopy filed as document reproduction.
Each restore also wrote a `restored_after_takedown` lesson that told Knox the takedown was wrong.
The re-check's "latest" text was also the last by text hash, not the newest read.
**Fix:** that restore now needs the restore bar (`disputedRestoreVerdict`) on the document's newest
text; texts are ordered by read id. `restore-recheck.ts` gives the 84 the same bar on a second look
(archive, never delete), and Knox's lesson readers skip the lessons those unchecked restores wrote.
**Lesson:** every path that puts a fee live passes the same checks as publish; a restore is a
publish.

## 2026-10-07: business-only fee schedules fed the consumer benchmarks
**What happened:** 979 live fees at 86 banks (Oct 7, prod) were read from schedules whose address
names business, commercial, corporate or treasury accounts, the same test Magellan's
`isBusinessOnlyLink` uses. They counted in national, state and district medians, peer ranges and the
paid report's rival columns as if they were consumer prices. Dry run: national monthly maintenance
$5.36 to $5.00, NSF $30.00 to $29.95; most state moves were $0.50 to $2.50 in either direction.
**Fix:** a read-model filter, not a data change. `STATS_ROW_FILTER` (fee-stats rule 6) and the
local-market and custom-report rival reads leave those rows out; the bank's own page still shows
them. `STATS_METHOD_VERSION` 4 makes cached index rows rebuild. Undo by reverting the filter.
**Lesson:** a fee's source document decides whose price it is, so the statistics contract checks the
source, not only that one exists.

## 2026-10-07: Bank overdraft income was never loaded, and credit union lines stop after 2024
**What happened:** `institution_financial_records.overdraft_revenue` had 0 rows for banks; credit
unions had it for the four 2024 quarters only (17,597 rows, 1,670 above zero). Hamilton's revenue
line for overdraft and NSF fees was empty for every bank.
**Cause:** banks: RIAD H032 (consumer overdraft-related service charges, banks of $1B or more) is not
in the FDIC BankFind API, and no loader read the FFIEC bulk call report. The earlier loader was a
Modal job that never ran here. Credit unions: NCUA retired accounts IS0048 and IS0049 from the
March 2025 call report; the 2025 and 2026 files carry the columns but no values (registry detail
`fee_income_accounts_unreported`). That is the source's limit, not a loader gap.
**Fix:** registry step `registry-ffiec-overdraft` (`src/lib/regulatory/ffiec.ts`,
`magellan/registry/ffiec-overdraft.ts`) posts the FFIEC CDR bulk form, reads Schedule RI H032 by
RSSD, and writes the quarterly figure onto the bank's FDIC row. H032 is year to date, so a quarter
is stored only when every earlier quarter of that year is on file; partitions run oldest quarter
first within each year. No migration.
**Lesson:** a field Hamilton reads needs a loader proven on prod, not only a reader. When a regulator
retires a line, say so in the data notes rather than leaving it to look like a gap.

## 2026-10-07: Banks on the community bank leverage ratio showed 0% total capital
**What happened:** in Q2 2026, 1,808 of 4,313 banks had no tier 1 risk-based ratio and a total
capital ratio of exactly 0; all but 7 are under $10B.
**Cause:** banks that elect the community bank leverage ratio framework do not file risk-based
ratios. BankFind returns null for RBC1RWAJ and 0 for RBCRWAJ. The parser stored the 0, the bank page
showed it and the peer median counted it. The missing tier 1 ratio itself is correct.
**Fix:** the FDIC parser stores null total capital when tier 1 is null and total capital is 0; the
bank page and peer median skip a stored 0. Older rows correct themselves as quarters refresh.
**Lesson:** a regulator's 0 can mean "not filed". Check a field's zeros against the filing rules
before storing them as values.

## 2026-10-07: The FFIEC overdraft step ran out of memory on prod
**What happened:** after PR 369 merged, `registry-ffiec-overdraft` failed for 2026Q1 (04:32 UTC)
and 2026Q2 (05:07 UTC) about a second into each run, with "Array buffer allocation failed". No H032
values were written.
**Cause:** the step buffered the whole all-schedules bulk zip and unzipped it in one call, which
sizes each output buffer from the zip headers. Which of the two allocations failed was not
confirmed, because the cloud sandbox cannot download from FFIEC. Unit tests used small zips, so
they did not catch it. A failed registry step also leaves its partition `scheduled`, and that
partition is retried only after the 6-hour claim expires.
**Fix:** `unzipScheduleRi` reads the download as a stream, inflates only the Schedule RI files,
and grows each buffer with the data. The whole zip is never held in memory.
**Lesson:** a loader for a bulk file has to stream it. A test with a small fixture does not prove
that the loader will fit in a function's memory.
**Follow-up (05:42 UTC):** once streaming worked, the step got through the download and then failed
with "operator does not exist: text = date". `institution_financial_records.report_date` is text
('2026-06-30'), and the update cast its parameters to date. The update now compares text with text,
and a test fails if the update casts to date.

## 2026-10-07: State bills would have taken about four days to cover 52 states
**What happened:** the state bills step merged at 04:24 UTC with one partition per state. By 05:10
only Alaska had run.
**Cause:** the registry scheduler starts one step every five minutes. It works round-robin across about
20 sources and picks the first partition that is due. A source with 52 small partitions gets one
turn per round, behind every other source's history and retries.
**Fix:** state bills now has one scheduled partition, `current`. Each run reads the next 12 states
whose weekly check is due and records each state under its own partition row. The step comes back
within the hour while states are still due, so all 52 are covered in five runs.
**Lesson:** for a registry source with many small, quick items, batch them inside one partition.
Use per-item partitions only when each item is a heavy download.

## 2026-10-07: Product-page and out-of-date links waited behind banks without a link
**What happened:** the tracker found that 22.8% of active fee links are product pages, and that 201 banks' main
link is a document from 2023 or earlier. Magellan searches both kinds, but only in a discovery step's spare
capacity, after banks without a link. A step stops starting banks after 75 seconds, so in a state with a long
no-link backlog they were never reached. On prod, 1,208 of 5,232 links (23%) were product pages and 129 of them
had been searched at the current version. 260 links named 2023 or earlier and 18 had been searched. Separately,
58 banks whose link answered 404 before the fetch step learned to clear gone links (6 Oct) were waiting out
the 30-day stale-link rule.
**Fix:** each step reserves 3 slots for product pages and 2 for out-of-date links, beside the 3 business slots,
and searches them right after the cut-off bank resuming its search. A 404 or 410 with no live fee is due at once.
**Lesson:** "spare capacity" work needs a reserved share and a place near the front, or a time-boxed step never
reaches it.

## 2026-10-07: Magellan never learned from fees taken down for being wrong
**What happened:** Hamilton's source check takes fees down as `not_on_schedule`, `wrong_amount` or
`threshold`. The link they came from stayed "good" in Magellan's ledger as long as 3 other fees stayed live.
Nothing sent the bank back to a search, so a wrong page could only be fixed by hand. First-look
takedowns can't be used as they are: 13 of 20 recent source-check takedowns were real prices.
**Fix:** the ledger reads the second look's verdict (`takedown_confirmed`, from Knox PR 393's reader
contract and `hamilton/second-look.ts`). A link with 3 or more confirmed wrong fees and no more live
fees than that is judged `confirmed_wrong_fees`, and its path's score drops. The freshness search then
looks for another page for it, once per judgement. On a first-look proxy this would reach 84 banks.
Confirmed rows start landing about 14:40 UTC on 7 Oct.
**Lesson:** feed agents the confirmed verdict, not the first look, or they learn the checker's mistakes.

## 2026-10-07: Articles and press releases were stored as fee sources
**What happened:** nothing stopped a finder from taking a bank's article about fees as its fee source.
Space Coast CU had a live $4.73 out-of-network ATM fee read from its blog post "common checking account
fees to avoid", a national average; its schedule says $2.50. On prod (read-only, 05:55 UTC) 27 stored
documents at 12 banks sit under article, blog or news folders, with 23 live fees at 3 banks; 21 of those
are MTC Federal CU's real "/articles/schedule-of-fees/". Three banks' fee links are articles: Axos
(an "insights" article), Bank of Bennington (a closing-cost promotion) and JPMorgan Chase (a 2021 press release).
**Fix:** `isArticleLink` (link-coverage.ts) names such addresses unless the path names a fee document.
Every finder rejects them (`article_page`), and the upgrade search picks banks whose link is one and
does not keep the article once the schedule is found. Live fees from article pages are left to
Hamilton's second look, under the never-delete rule.
**Lesson:** a page about fees is not a fee schedule. Judge a source by what kind of page it is, not
only by whether it mentions fees.

## 2026-10-07: Knox re-read fees that were already taken down
**What happened:** a takedown left no trace Knox could read, so a new copy of the same page brought
the fee back. The raw dedupe is per document. In the 48 hours to Oct 7 05:50 UTC Knox re-read 208
fees whose takedown still stood (152 from the source check, 56 for a price outside the category's
range). It sent 49 of them back to Darwin, and 6 were published again.
**Fix:** Knox reads `takedown_confirmed` rows, the second look's verdict, for checks that say the
read was wrong. It holds a matching re-read for review instead of sending it to Darwin, and
records the count on the extract event. First-look takedowns don't teach: Darwin found 13 of 20
recent source-check takedowns were real prices.
**Lesson:** every verdict needs a reader in the agent that made the mistake. A verdict that is only
logged changes nothing.

## 2026-10-07: Never-searched banks waited for their own state's lane
**What happened:** discovery searches only the lane's own state. On prod (read-only, 06:05 UTC)
1,855 active institutions with no fee link had never been searched (437 of them have no website).
Most were in big states: TX 304, IL 232, PA 149, MN 137, NY 127. In the 24 hours to 06:05, finders gave
2,006 banks their first search, and 65 of 405 discover steps ended in under 30 seconds with nothing
left to search in their state.
**Fix:** a state step with slots left over takes never-searched banks from any state, largest
first (`selectNeverSearchedElsewhere`, 45 ms on prod).
**Lesson:** a queue split by state is only as fast as the slowest state's lane. Let idle capacity
take work from anywhere.

## 2026-10-07: Banks a headline fee short were never searched for a second document
**What happened:** the companion finder searched only banks with fewer than 8 fee categories or a
weak link. Banks near the report bar whose schedule leaves out monthly maintenance or the overdraft
item fee were never searched. Knox confirmed it for three banks: Coulee Bank (15 categories, no
maintenance price on its schedule), Spencer Savings (16, no overdraft item price) and Community Bank PA
(22, overdraft item fees refunded). On prod 2,029 banks with 8 or more live categories lack one of the two.
**Fix:** a bank with no live monthly maintenance or overdraft fee now qualifies for the companion
search. Banks of 8+ categories missing one come right after weak links. In PA alone that adds 97 banks.
**Lesson:** a complete-looking schedule can still leave out the fees a report needs. Search for the
account disclosure when a headline fee is missing, not only when the page is thin.


## Darwin's category review trusted Knox's amount (2026-10-07)
`verify.adjudicate` v1 judged a fee from its name and amount alone. Against the answer keys it was right on
27 of 37 disagreements, but it accepted prices that belonged to a neighbouring row ("Check Printing (fee
depends on style)" at $3) or were a balance threshold ($50 inactivity "balance is less than"). The prod
`answer_key_institutions` table is empty; the answer keys live in `src/lib/agents/knox/__fixtures__/`.
v2 sends the schedule rows around each fee and the source check's verdict on its amount.

## The answer-key tables on prod are empty (2026-10-07)
`answer_key_institutions` and `answer_key_fees` have no rows, so no `answer_key` lessons reach the learning
store: Darwin's category model and Knox's lessons never trained on the hand-keyed schedules they cite. The 81
hand-keyed texts (2,885 fees) exist only as Knox test fixtures. Darwin's verdict score reads a compact copy
(`src/lib/agents/darwin/answer-key-fees.json`, kept in step by its test). Loading the keys into the tables
(through the admin answer-key page or a typed agent step) is still open.
## 2026-10-07: Live fee names stored before Knox tidied its reads stayed run-on
**What happened:** the audit tracker counted about 1,780 live fee names joined with "|" and about 680
that end on a lead-in word. On prod (05:30 UTC Oct 7) there were 52,055 live fees: 1,756 piped, 870
ending on "of", "is", "for" and similar, and 1,407 longer than 80 characters.
**Cause:** `tidyFeeName` (Knox v17, v29) fixes new reads only. Rows published earlier kept the name
as read ("Stop Payment | Item", "/mo. | Dormant Fee", "An overdraft fee of"), and nothing
re-tidied them.
**Fix:** `src/lib/agents/knox/name-retidy.ts` runs in each publish step on a batch of 40 banks. A
live name takes its tidy name only when it still traces in the fee's own schedule (if it did before),
still passes the category guard, and does not collide with another live fee of the bank. The old
name is kept as a `name_retidied` row in `pipeline_feedback`; raw and verified rows are unchanged.
Dry run on 27 banks: 76 of 121 messy names renamed, 0 that would stop tracing.
**Lesson:** a reader fix needs a matching pass over what it already published.

## 2026-10-07: A blank-reading "Fee Schedule" page was swapped for a CD disclosure
**What happened:** Rosetta sets aside a page that reads no amounts or needs JavaScript, and Magellan
then saves whatever page next passes its check. Five Rivers Bank's fee page became a 12-month
time-deposit truth-in-savings sheet on Oct 5. On prod (06:15 UTC Oct 7) 223 banks had a fee-named page
set aside that way; 65 of them now link a page that is not fee-named. 20 active banks link a CD,
certificate or time-deposit disclosure.
**Fix:** finders reject one product's disclosure (`single_product_disclosure`), such links go to the
upgrade search, and a bank whose fee-named page was set aside for a blank read gets it back as its main
link once when the weaker page gives no live fee (it stays as a companion), so Rosetta's newer readers try it. About 43 banks qualify.
**Lesson:** a page that reads blank is a reading problem first. Swap it only for a page that is at least
as clearly the fee schedule.

## 2026-10-07: Magellan's errors were judged per link but never reviewed per finder
**What happened:** the outcome ledger judged each link, but nothing added up which finder produced the
bad ones or folded in Darwin's verdicts. On prod the site crawl finder had 35 wrong of 75 judged links
and the hub-page finder 36 of 104; both kept their place in the finder order.
**Fix:** after every chunk of 50 judged links, an error review scores the chunk per finder against the
ledger, Darwin and the answer key, writes it to `pipeline_feedback`, and a finder wrong in two
reviews in a row runs last until it recovers.
**Lesson:** per-item judgements need a regular roll-up that feeds back into what the agent does next.

## 2026-10-07: Companion pages that held no fees were never judged
**What happened:** Knox and Rosetta flagged 37 documents Magellan had saved as fee sources that hold no
fees: checking and savings product pages, rates pages, funds-availability notices, overdraft opt-in forms,
Zelle terms and a join page. 34 came from the companion finder and 3 were main links from the site crawl.
The companion finder kept an account page with a single fee line. On prod only 77 of 781 account pages with
1 or 2 fee lines gave live fees, against 23-40% for 3 or more. The ledger never judged 399 of 1,359
companions, because it matched documents by address and a companion's stored address often differs from
the fetched one (http to https, a redirect).
**Fix:** account pages now need 3 fee lines and agreements 2. Non-fee documents are skipped by name. The
ledger also matches a companion's documents by `companion_source_id`, so these links get judged and feed
the error review.
**Lesson:** a learning loop only learns from what it can see. Check that every output has a judged row
before trusting the scores.

## 2026-10-07: Rosetta had no per-batch error review
**What happened:** Rosetta learned only from fees taken down later (text survival), so a read that
gave Knox nothing, or rejected a real schedule, taught nothing. James asked for a fix per error type
and a review after every N reads.
**Measured (prod, read-only, the 200 latest reads 6 to 36 hours old at 06:25 UTC Oct 7):** batches of
50 had 19, 7, 6 and 7 misses (38%, 14%, 12%, 14%). 37 of the 39 were completed texts Knox found no
fee in; 2 were unread. No short texts, no rejected page later proven a fee page. Counting only Knox
rows written after the read overstates the misses, because Knox dedupes rereads, so the review
counts every Knox fee from the document. A no-fee text is a miss either way: a real schedule Knox
could not read (an earlier 30-hour window had several fee-schedule pages and a 2,626-char PDF), or a
page that passed the fee-page check without being one (in this window the 4 fee-named links were
funds-availability, checking and rates pages; the other 33 were not sampled).
**Fix:** `rosetta/batch-review.ts` reviews each settled batch of 50, writes every miss as a lesson
with its fix (`evidence.remedy`) and one error-rate row per batch. The reread selection and the paid
pass read those lessons. See rosetta/AGENTS.md "Batch review".
**Lesson:** count Knox yield per document, not per read: deduped rereads look like empty reads.
**Follow-up (07:20 UTC Oct 7):** the first 28 live batches walked reads back to Oct 3, and 61 of
the 76 web pages sent for a JavaScript reread were replaced copies the reader never selects. The
review now judges only each bank's current document from the last 3 days.

## 2026-10-07: The Census income step recorded a published vintage as "not published"
**What happened:** at 05:17 UTC `registry-census-acs` recorded the 2024 ACS 5-year vintage, released
in December 2025, as "not published yet" and scheduled no retry until October 14. No tract or ZIP
income loaded.
**Cause:** the fetch treated any reply that was not JSON data as an unpublished vintage. Census
answers a key, quota or outage problem with a page, not data, so a real error was filed as normal.
The actual reply is not known, because the cloud sandbox cannot reach api.census.gov.
**Fix:** only a 404 counts as unpublished. Any other reply without data fails the step and puts the
first 200 characters of the reply in the run ledger. The parser version is now 2, and the scheduler
re-pulls `empty` partitions recorded under an older parser, so 2024 runs again without waiting a week.
**Lesson:** an "empty" result must be one the source states, never a guess from a parse failure.

## 2026-10-07: Plural "Wires" and balance-named account rows were missed by Knox
**What happened:** Space Coast CU (James's demo bank) had 7 live fees. Its 1,279-character page lists 22 prices.
**Cause:**
- The directional wire patterns required the singular "wire", so "Incoming Wires | $10" was read as no fee.
- "(Outside U.S.)" fell through the international rewrite, because `\b` does not match after a dot.
- An account row named with its balance ("(below $2,500) | $15/mo.") was held as unclassified.
- Two names in one row were glued into one name.
**Fix:** Knox v32 covers each of these. The answer keys gained 2 right and no wrong reads.
**Still open:** size grids and wrapped prices need the shared source check (`checkFeeAgainstSource`) to read them first.

## 2026-10-07: The answer key was never on prod

- **Problem.** `answer_key_institutions` and `answer_key_fees` had no rows on prod. The hand-keyed keys
  (Texas and the 7-state set) lived only in `/mnt/project-files/answer-key/` and the Knox gate fixtures, so
  no `answer_key` lesson ever reached `pipeline_feedback`, Atlas's answer-key score had nothing to score,
  and Darwin's batch scoring had to bundle its own copy.
- **Fix.** Seed migration `20270110000018_answer_key_seed.sql`: 62 banks keyed line by line by the Knox thread
  (status `confirmed`, `confirmed_by = 'knox-hand-key'`: checked against the stored text, not yet by a person)
  with 2,321 fee rows, and 55 banks from the 2026-10-04 prefill draft left `prefilled` (710 rows) for a person
  to confirm on /admin/answer-key. 525 keyed rows with no taxonomy key ("unmapped") are left out. One
  document per bank (the table's rule): where a bank had two keyed copies, the current one; 20 older copies
  are not loaded. Learning rows from Knox-keyed fees say `reported_by = 'knox'`, not `human`.
- **Watch.** Inserts only and idempotent; it never touches a bank already in the key.

## 2026-10-07: Knox had no per-batch error review

- **Problem.** Knox's error rate was only measured by hand. James asked for "a way to review errors
  after chunks of N". A hand query over chunks of 500 Knox reads that were 24 hours old showed rates
  from 0.0% to 13.9%. 175 batches have run since Oct 4; the newest two are 0.3%.
- **Fix.** `knox/batch-review.ts` runs in every extract step. It scores each full, settled batch of
  500 reads against Darwin's verdicts, Hamilton's read takedowns and the confirmed answer key. It writes
  each miss and one batch row with the rate and its top miss patterns to `pipeline_feedback`.
- **Watch.** A reject whose only reason is `rules_recheck_unreproduced` is a newer Knox version
  replacing the read, so it is counted as superseded. Counting it as a miss put Oct 4's first batch
  at 58% wrong.

## 2026-10-07: Fee links led to foreign banks of the same name

- **Problem.** SouthEast Bank (TN) had a companion document on southeastbank.com.bd, a
  Bangladesh bank's schedule priced in taka, and Citi's link was Citi Bangladesh's schedule
  on citigroup.com. Nothing in Magellan's checks looked at the country or the currency.
- **Fix.** Magellan refuses links on foreign country domains (unless the bank's own website
  is on that domain) and pages priced mostly in another currency (`foreign_schedule`).
- **Watch.** Fees already read from those two documents are Knox's and Hamilton's to take
  down through the 12-hour second look; this fix stops new ones.

## 2026-10-07: Dead-end banks waited a month after Magellan improved

- **Problem.** 60 Tennessee banks with a website were `dead` and the state lane was hours
  away. A dead end is searched again after 30 days, or at once when the discovery method
  version changes, but the version was not bumped for the 7 Oct finder fixes, and a state
  could not be re-searched outside its lane.
- **Fix.** Discovery method 5, and a direct state re-search run (Atlas
  `priority-state-research.ts`) for states that must not wait. Each miss now leaves a
  `magellan.search_miss` lesson.

## 2026-10-07: Bank sites that refuse our fetcher had no way in

- **Problem.** 51 banks' fee links return HTTP 403 to Magellan's fetcher (Pinnacle's pnfp.com,
  Citizens, Flagstar, Columbia), and the paid web search's answers for Huntington and KeyBank
  failed the same way, so those banks stayed without a schedule. The JS fallback uses the same
  fetcher, and Firecrawl is off-limits.
- **Fix.** `magellan/blocked-fetch.ts` asks Anthropic's server-side web fetch for the exact
  link (bank's own host only), inside Magellan's paid step and cap.
- **Watch.** Whether Anthropic's fetcher gets past each bank's bot wall is only known on prod
  (the cloud sandbox cannot reach bank sites). Several 403 links are not on the bank's site
  (an LPL disclosure, a car-price site); they are wrong links and are skipped.

## 2026-10-07: Tennessee banks held back by thin reads are mostly product pages

- **Problem.** 48 open Tennessee banks have Darwin-verified fees that Hamilton holds back: Knox read
  only 1 or 2 fee types from each, below the 3-fee publish bar. All were last read at v2-v22. Hand
  checks of 5 current copies (Heritage Bank & Trust, Union Bank, Peoples Bank of the South,
  BankTennessee, First Vision) show checking product pages listing only 1-3 kinds of fee. So the reads
  are short because the pages are, not because Knox stopped early.
- **Fix.** The 44 with a read copy are queued for a v32 re-read after the priority banks
  (`KNOX_PRIORITY_REREAD_IDS`). The 3-fee bar stays.
- **Watch.** The real lever is finding each bank's fee schedule. Two known schedules were never read:
  Resound CU (document 16143) and Enbright CU (PDF document 10293). Two links are wrong:
  - Tsu FCU (5080) points at a Tennessee State University tuition page.
  - SouthEast Bank (371) also holds copies of a Bangladesh bank's schedule.

## 2026-10-07: CFPB fee complaints were over-counted, cut short, and missing for big banks

**What happened:** Checking the complaint data for the peer benchmark found four problems.

**Cause:**
- "Fee-related" counted every "Managing an account" complaint, which is mostly deposits, withdrawals and errors.
- The step kept only each institution's top 15 issues, which dropped 23,855 complaints in 2025.
- It deleted only the institutions it touched. That left 56,389 old-loader complaints at 259 institutions, some on wrong matches.
- Short names ("PNC", "TD", "BMO", "U S", "M T") always went to review. FFIEC also writes holding companies as "BCORP" and "FINL", so U.S. Bank, PNC, TD, BMO, M&T, Citizens and First Citizens had no complaints linked. Only 77 of 160 $10B+ banks were linked.

**Fix:**
- A shared fee definition (`src/lib/complaints/fee-issues.ts`) counts only the issues within deposit and card products. "Managing an account" counts only through its "Fee problem" sub-issue.
- The step stores all issues and replaces the whole year.
- A short name is accepted for one $10B+ parent. A full holding-company name is matched first.
- The CFPB parser version is now 2, so every year re-pulls.

**Also:** `institution_financial_records.total_deposits` is in thousands for `fdic` and `ncua` rows but in dollars for `ffiec` rows. Readers must filter by source.

**Unverified:** whether CFPB's search API returns sub-issue buckets. The run ledger records `sub_issues_loaded`.

## 2026-10-07: Checking account lineup fields were never captured
**What happened:** none of the 1,914 monthly maintenance fees on prod named its product, the
balance that avoids the fee, the opening deposit, or the waiver (audit:
`data-inventory/account-lineup-audit-2026-10-07.md`).
**Cause:**
- No fee tier had a column for them, and `published_fee_catalog.account_product_type` was a
  hard-coded `NULL::text`.
- Knox's paid prompt asked for `conditions` but kept only a `waivable` flag and threw the text
  away. It also told the model to skip balance requirements.
- The rule candidate had no field for a product, threshold or waiver.
**Fix:** migration `20270110000020_account_lineup_fields.sql` adds `product_name`,
`min_balance_to_avoid`, `min_opening_deposit` and `waiver_text` to `raw_fee_observations`. The
catalog reads `account_product_type` from `product_name` and adds the other three at its end.
Knox (paid v2; the rules version stays v32 so the Knox thread's v32 backlog re-reads carry them) fills them for `monthly_maintenance` only, grounded in the text by
`knox/lineup.ts`: a figure must appear in the text and a phrase must be found there, or it is null.
Rows already on file gain the fields only when Knox reads their document again.
