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

## 2026-10-06: A paid user could be offered checkout a second time
**What happened:** the full funnel audit (finding 9) traced a path where someone who had just paid
opened a Pro page before Stripe's webhook marked them active. The Pro gate sent them to
/subscribe, which offered checkout again with no word on why they were there (finding 12). No
double charge is known; the path was found by reading the code.
**Cause:** only /account/welcome asked Stripe directly whether a user had paid. Every other page
trusted the webhook-written status, and /subscribe never explained the redirect.
**Fix:** PR 89 moves that check to `src/lib/billing/activate-if-paid.ts`, and /subscribe runs it
before showing plans. A paid user goes straight back to the page they opened, and someone sent
from Pro sees why. Not merged yet.
**Lesson:** any page that can sell must first check whether the person has already paid.

## 2026-10-05: A supply price was published as a Night Deposit fee
**What happened:** Hamilton's briefing for Texas National Bank of Jacksonville led with "Night
Deposit $3.00 against a $5.00 median". The $3.00 row in `published_fee_catalog` is "Zipper Bags",
the price of deposit bags the bank sells, filed under `night_deposit`.
**Cause:** not yet traced; most likely the category rule lets product and supply prices that sit
near a fee name into that category.
**Fix:** none yet; reported to Improving Hamilton for whoever owns Knox and Darwin.
**Lesson:** a headline fee should be checked against its row's fee name before it leads a page.

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
