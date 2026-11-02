# 2026-11-02: rule changes rarely reach old texts (pipeline wiring audit, gap 10)

**What happened:** the Nov 2 pipeline wiring audit found that Knox rules fixes reach few of the
texts already on file. Read-only prod queries on Nov 2 (Knox rules v155):

- 14,104 current text fingerprints (current copy, completed text, one per text per bank) were last
  read below v155: 7,103 behind live fees and 7,001 with none. Behind live fees, by the version
  that last read them: 26 never read, 1,454 below v97, 2,034 at v97-v119, 1,924 at v120-v139 and
  1,665 at v140-v154.
- 2,352 superseded copies still carry 6,859 live fees. 1,980 of them (5,875 fees) have a current
  copy with a readable text, so Knox can read the fees across. 1,468 of the 7,103 texts above are
  such current copies. For 338 more the current copy's text is a wrong document (712 fees), which
  is a Magellan and Hamilton question, not a Knox one.
- 92 current documents behind live fees had not been checked in 90+ days. Another 519 superseded
  copies behind live fees were also 90+ days old; the current-copy read handles those.
- On Nov 1, 782 of 2,060 `extract.rules` reads repeated a read made at v140 or later, 737 repeated
  one made at v97-v139, 378 reached a text last read below v97 and 163 were first reads.

**Cause:** Knox reads a text again only when one of its triggers asks (`textArtifactQuery` in
`src/lib/agents/knox/extract.ts`). Three of them fire at every rules bump: priority banks and market
leaders, $10B+ banks, and an older copy still live. The order puts priority banks first, then
texts below `KNOX_STALE_READ_BELOW_VERSION` (v97, the fix in #2423), then large banks, then the
newest text. The rules moved from v137 to v155 in the week to Nov 2, so the same texts came back to
the front at each bump. A text read at v97-v154 that tripped no trigger kept its old read. The
"older copy still live" trigger fired too, but sorted behind everything else. Magellan's
live-source refetch (#1200) skips the plain fetch's own address and any page with a newer copy, so
a cited document whose check date never moved stayed unchecked.

**Fix:** `src/lib/agents/knox/reread-backlog.ts` gives each extract step slots for current texts
last read below today's version. The usual batch keeps at least `limit - 10` rows
(`KNOX_REREAD_BACKLOG_PER_STEP`; all of them when the limit is 10 or less), and the backlog takes
the rest, up to 20 (`KNOX_REREAD_BACKLOG_MAX_PER_STEP`), so a step never reads past its limit.
Texts behind live fees go first (on their own document or on an older copy of the page), then the
oldest version, then the most live fees. Reading the current copy moves a superseded copy's live
fees through the normal verify path. With the switch on, Magellan's live-source refetch also
selects a page whose cited current document is unchecked for 90 days (`selectStaleLiveSources`,
`refetchRequestDays`). Both sit behind `KNOX_REREAD_BACKLOG_LIVE` (off). While it is off, state-lane
extract steps report the scoped backlog and what they would read; one-bank repair runs skip the
count. The planner and the market-leader read run in their own savepoint with a statement timeout
(5 s and 10 s), because the extract step runs inside the run-ledger transaction: a JavaScript catch
alone would leave that transaction aborted and fail every later statement in the step. A failed
count says "not counted", never 0. Retiring live fees whose line is missing from a current copy read
at the current version is another thread's work (the wiring audit thread); this backlog feeds it.

**Sizing:** 518 extract steps ran Oct 26-Nov 1. 317 were state lanes (under one a day per state,
0.6-1.0) and the rest one-bank repair runs. Steps read 29.2 texts on average at a mean of 299 ms
per read (p95 916 ms), against a lane limit of 50. The step is priced at 165 s and ran 150-213 s on
average. The planner query took 0.55 s for Texas, the largest lane, scoped to the lane (1.4 s
unscoped, 12.7 s before the older-copy lookup moved into a CTE); off, it runs on about 45 lane steps
a day and on no repair run. A full lane batch gives up 10 of its usual rows; an average lane step
(29 of 50) takes up to 20 backlog rows from spare room, which adds up to about 3 s of reads to a
mean step. At 20 rows a lane step, per state: Texas (526 behind-live texts, 1,031 in all, 0.86 lane
steps a day) clears its behind-live share in about 31 days and everything in about 60; Illinois in about
21 and 43, Ohio in about 21 and 37; 47 of 55 lanes in under 15 days for their behind-live share. These are estimates from the week's
lane cadence; a lane that runs more often, the usual triggers and one-bank runs' spare slots all
shorten them. Each rules bump puts every text back below the new version, and the backlog keeps
going round, oldest first, so how stale a live fee's last read can get is bounded by that sweep.

**Lesson:** a re-read trigger that fires at every version bump needs a standing share for the
work it never reaches. A priority key that bumps refill can starve everything below it, as #2423
already showed. A one-off floor (`KNOX_STALE_READ_BELOW_VERSION`) only drains the texts below that
floor, so a rolling, oldest-first slice per step is what keeps every live fee's read recent.

**Guard:** `src/lib/agents/knox/reread-backlog.test.ts` (order, scope, slots, twin dedupe, merge
within the step's limit, the switch off reading nothing extra, the switch on reading backlog rows
after the usual batch and only in the step's spare time, an uncounted backlog never shown as 0), `src/lib/agents/knox/reread-backlog.db.test.ts` (a
failing or timed-out planner inside a real transaction leaves it usable, timeout restored) and `src/lib/agents/magellan/live-source-refetch.test.ts`
(refetch requests only when asked; off by default).

**Readiness follow-up (Nov 2, before the switch goes on):** a readiness check found four blockers,
fixed in the follow-up PR:

- *Time.* State-lane extract steps (7 days, 524 runs) took 178.5 s on average, p50 186.7 s, p95
  258.5 s and at most 288.4 s, against the step's priced 165 s (`STEP_EXPECTED_MS.extract`), the
  tick's 270 s finish budget and the route's 300 s maxDuration; 30 failed, 26 on a statement
  timeout. Up to 20 backlog reads (about 0.3 s each) and the 5 s planner would push the p95 over.
  Now backlog rows are read after the usual batch, and no backlog read starts once the step has run
  200 s (`KNOX_REREAD_BACKLOG_STOP_AFTER_MS`) or once what is left of the step's priced time
  (`expectedStepMs`, passed by run-store) cannot hold the backlog reads still to go at the step's
  observed time a read (floor 300 ms, `KNOX_REREAD_BACKLOG_READ_MS`). The planner is skipped when the
  budget cannot hold its timeout and its slots (`not counted`, `no_time`). The step detail reports
  `skippedForTime`, `timeStop`, and the elapsed time and time a read when the backlog came up.
  The extract step has no phase timings, so how much of the step's time is reading and how much is
  the re-checks after it is not known; these fields start that record.
- *Order.* `LEAST(newest.copy_at, pages.oldest_current_check)` skips NULL, so with requests on a page
  with no stored copy took its check date and lost its NULLS FIRST place. Now
  `CASE WHEN newest.copy_at IS NULL THEN NULL ELSE LEAST(...) END`.
- *Scope.* The request clause could select a held-only page (Darwin's request, #2905) that Knox's
  unchecked count leaves out. It now asks only for pages with live fees, and the oldest current
  check it reads counts only documents live fees cite.
- *Tests.* `src/lib/agents/magellan/live-source-refetch.db.test.ts` seeds real PostgreSQL: off mode
  returns main's selection; on mode takes a page whose cited current document is unchecked 120 days
  though it is the plain fetch address with a newer copy; a page with no copy sorts first; held-only
  pages are not taken by the request clause. Four of its five cases fail on main's query.
