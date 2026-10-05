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
**Fix:** this PR. Rosetta reads only a bank's current document and skips a no-copy row whose
link already returned 404/410; Rosetta's "banks in line" uses the same rule (1,408 to 640). Fee
steps record `institution_results` with every bank's real totals; each board column shows a bank
once; "On the site" shows the bank's live fee total.
**Lesson:** a picker over a history table must say which row is current. Board numbers must come
from totals, never from a sample written for debugging.

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
