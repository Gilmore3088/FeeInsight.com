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

**Fix:** `src/lib/agents/knox/reread-backlog.ts` gives each extract step up to 10 slots
(`KNOX_REREAD_BACKLOG_PER_STEP`) out of its own limit for current texts last read below today's
version. Texts behind live fees go first (on their own document or on an older copy of the page),
then the oldest version, then the most live fees. Reading the current copy moves a superseded
copy's live fees through the normal verify path. Magellan's live-source refetch takes a page whose
cited current document is unchecked for 90 days as a refetch request
(`selectStaleLiveSources`, `refetchRequestDays`). Both sit behind `KNOX_REREAD_BACKLOG_LIVE`
(off). While it is off, each extract step only reports the scoped backlog and what it would read.

**Sizing:** extract steps averaged 74 a day (Oct 26-Nov 1) and 29.2 reads per step at a mean of
299 ms per read (Oct 30-Nov 1). The step is priced at 165 s and ran 150-213 s on average. The
backlog's rows replace the tail of the usual batch instead of adding reads, so the step's read
count and price stay where they were. The planner query took 1.4 s unscoped on prod (12.7 s
before the older-copy lookup moved into a CTE). At most 740 backlog reads a day, the 7,103
behind-live texts take at least 9.6 days and all 14,104 at least 19.1 days. Both are lower
bounds: a state lane whose state has no backlog left leaves its slots unused, and the usual
triggers keep reading some of these texts too. Each rules bump puts every text back below the
new version. The backlog then keeps going round, always oldest first, so how stale a live fee's
last read can get is bounded by the sweep time, not by luck.

**Lesson:** a re-read trigger that fires at every version bump needs a standing share for the
work it never reaches. A priority key that bumps refill can starve everything below it, as #2423
already showed. A one-off floor (`KNOX_STALE_READ_BELOW_VERSION`) only drains the texts below that
floor, so a rolling, oldest-first slice per step is what keeps every live fee's read recent.

**Guard:** `src/lib/agents/knox/reread-backlog.test.ts` (order, scope, twin dedupe, merge within
the step's limit, the switch off reading nothing extra, the switch on reading backlog rows first, and
a planner failure never failing the step) and `src/lib/agents/magellan/live-source-refetch.test.ts`
(refetch requests only when asked; off by default).
