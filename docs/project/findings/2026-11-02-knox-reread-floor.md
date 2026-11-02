# 2026-11-02: Knox re-read the same pages at every rules bump while old pages behind live fees waited

**What happened:** Knox's extract step re-reads a stored text when one of its triggers asks. Five
of them (a thin or empty read, a $10B+ bank's page, a current copy whose older copy still carries
live fees, a priority bank or market leader, and Hamilton's rules re-check finding fees that are not
live) came back **once per rules version**: the only thing that stopped a repeat was an attempt at the
exact current `KNOX_RULES_STRATEGY.version`. The version moved v137 to v163 in the 7 days to Nov 2
(11 versions on Nov 2 alone), so each bump queued those classes again, and the step's order put
priority banks, the v97 stale floor and $10B+ banks first. Fixes reached live fees slowly.

Read-only counts on prod (Nov 2, about 18:00 UTC; the 7-day window moves, so they differ slightly
from the 13,704 the replay-backlog review counted earlier that day):

- 13,664 `extract.rules` reads in 7 days; 5,929 to 6,001 of them (about 44%) re-read a text already
  read that week (the range is how ties at the same timestamp are ordered).
- 9,276 reads had a read at v97 or later in the 14 days before them; 4,540 had one at v137 or later.
- Only 3,783 reads reached a text last read below v97, 1,661 of them behind live fees: about 540 a day.
- Due now (the step's own selection, simplified: the lineup, twin and priority triggers left out),
  9,067 texts: behind live fees 60 never read, 1,481 last read below v97, 639 at v97-v136 and 1,468
  at v137-v162; not behind live fees 62, 1,733, 962 and 2,662.
- Of 14,391 current text fingerprints, 2,712 were last read below v97, 1,379 of them behind live fees.

**Root cause:** the process, not the rules. "Once per rules version" made every version bump a full
re-queue of the same pages, and "behind live fees" was not part of the order at all, so a page whose
re-read could change a live fee waited behind pages whose re-read could not.

**Fix:** (`src/lib/agents/knox/extract.ts`, one local commit, no migration)

1. **A re-read floor.** `KNOX_REREAD_BELOW_VERSION` (v167, the rules version the floor was built at) and
   `KNOX_REREAD_REFRESH_DAYS` (14). The once-per-version classes are read again only when the text
   has no rules read at or above the floor inside the last 14 days. A bump no longer re-queues them;
   raising the floor does, and the 14-day refresh means nothing waits for a raise. It is one AND term
   on the selection, `(floor due OR missing fees)`, so the rules re-check's missing-fees pages stay
   once per version (they name fees today's rules read that are not live). A run for one institution
   (a person or Atlas asked for it by name, including error-fix re-runs) has no floor.
   - v167 keeps every page those classes held due for the one pass at today's rules it was already
     owed (first written at v164, main's version that day; restacked on Knox v167, the missed-fees fix,
     after #2953 took v165 and #2957 v166); only later bumps stop re-queuing. 14 days: of 14,391 current fingerprints, 705 were at
     $10B+ banks, 1,453 had an older copy still live and 4,151 were thin, at most 6,309 together
     (priority banks' pages not counted), so a refresh costs at most about 450 reads a day, about half
     the roughly 850 a day spent on same-week repeats, and those reads queue behind older live ones.
2. **Behind-live-oldest-first order.** After the priority-bank order (James's 2026-10-08/09 decisions),
   texts behind live fees (on their own document or on an older copy of the page) come first, the
   oldest rules read first and a never-read text before any read; then the old order (stale first,
   $10B+ banks, newest text). Live fees are read once into two CTEs scoped to the lane, like the
   re-read backlog's planner.
3. **Bayes stays in step.** `countKnoxRereadsDue` runs the step's own query (the floor term included),
   so the `knox.rules` queue is what Knox will select; it also counts the texts the floor holds, which
   the manifest reports as `knox_read_at_floor_recently` beside `knox_keeps_older_read`.

"Categories touched by recent fixes" was not used: rules versions carry no machine-readable category,
and the error-fix registry names feedback rows, not texts, so it is not cheaply joinable in the
selection. The missing-fees trigger is the cheap signal that a fix reaches a page, and it keeps its
once-per-version rule.

**Query cost (prod, EXPLAIN ANALYZE, read-only, simplified to the same triggers):** the old selection
took 9.0 s unscoped; the new one 5.9 s. A first draft with the floor nested inside the triggers took
35 s: the planner ran the costly triggers twice per text. The final form keeps the floor as its own
AND term of cheap hashed lookups, which Postgres pushes into the scan.

**Estimates (labelled; not measured outcomes):**

- Last week under the new selection, with the floor at the version the week started at (v137) and a
  14-day refresh, about 3,500 reads (3,512) would not have been made: a repeat inside 14 days of a read
  at or above the floor, not flagged by the rules re-check, not a one-institution run. The missing-fees
  flag was matched loosely (any flagged re-check of the page in the 14 days), so 3,512 is a lower
  bound. With the floor at v97 the same count is 6,836. Same-week repeats would fall from about 6,000
  to at most about 2,500.
- Freed reads go first to texts behind live fees, oldest first. The week read 1,661 old-version texts
  behind live fees; 1,481 such texts are still due, so with at least 3,512 freed reads the week could
  have read about 3,100 old-version texts behind live fees instead of 1,661 (upper bound: the backlog
  is the limit, not the capacity).
- At about 1,950 reads a day (13,664 / 7), the 1,541 behind-live texts never read or read below v97 are
  first in line: about 1 day. Every old-version text (3,214 text rows due, behind live or not) is
  reached after about 5,400 reads in the new order: about 3 days, against about 6 days at the old
  540 a day while each bump re-queued the once-per-version classes. State lanes read only their own
  state, so a small state's share drains at its lane's pace.

**What it does not do:** it changes which texts Knox re-reads and when, not what a read finds. No
live fee is held, re-filed or taken down by it: a re-read only adds raw rows (the raw dedupe index
keeps existing ones), which go through Darwin and Hamilton as before. `KNOX_REREAD_BACKLOG_LIVE` is
untouched.

**Guard:** `src/lib/agents/knox/extract.test.ts` (floor term, missing-fees exception, one-institution
runs, order, count parity) and `src/lib/agents/knox/reread-floor.db.test.ts` (real Postgres: a page
read at the floor two days ago is held, one read 20 days ago and one below the floor are read, a
missing-fees page is read, the behind-live stale page comes first, and Bayes's count moves with the
selection). Agent lesson: knox/reread-floor-not-per-version-2026-11-02.
