# 2026-11-02: The replay ledger kept every superseded version open, so its backlog only grew

**What happened:** the Quality page's replay backlog read 35 open jobs and 160,140 queued records on
Nov 2 and had grown from 31 / 142,924. Bayes's own step summary that day read "6 open with 9615
records queued, 3 stuck". A read-only diagnosis (SELECT only on prod, about 16:00-17:00 UTC Nov 2)
found that 27 of the 35 open jobs (141,985 of the 160,140 queued) were rows for older versions that
nothing counts any more.

**Root cause:** `replay_jobs` is keyed `<manifest>@<version>` (`changeKey()`), and `loadManifests()`
builds each manifest at the code's current version only. A version bump makes the next Bayes run
insert a new row (`knox.rules@160`) and never count the old one (`knox.rules@147`) again. Nothing
closed the old row, so it stayed `open` (or `stuck`) with the queue it had at its last count. The
Quality read (`src/lib/data-store/agent-quality.ts`) selected every row with no filter to current
versions, and the total summed them. The superseded rows also count the same units again: all 16
`knox.rules@N` rows count the same ~15,000 current-copy texts, because `done` for an older version is
`version >= N` and its `queued` comes from the same `countKnoxRereadsDue` selection. With
`KNOX_RULES_STRATEGY` bumped 26 times in the week to Nov 2, the table sum grew by one frozen row per
bump while the live queue held at about 8,500-9,600.

**Fix (`BAYES_LEDGER_VERSION` v2, no migration):**
- After counting the current manifests, `runBayesLedger` closes every `open` or `stuck` row whose
  manifest the code declares at another change key: status `closed`, note
  `superseded by <current change key>`, and one appended `replay_job_checks` row. The row keeps its
  last counts as history. The closed rows are listed in the step detail (`superseded`) and named in
  the step summary, so they show in the run ledger. A second run finds nothing more to close. Rows of
  manifests the code no longer declares, and `not_counted` or `closed` rows, are left as they are.
  `replay_jobs_status_check` allows only open, closed, stuck and not_counted, so a separate
  `superseded` status would need a migration; the code reuses `closed` plus the note.
- The Quality read marks a row superseded when its note says so or a newer row of the same manifest
  was counted after it. The page totals open, stuck and queued from current rows only, and lists
  superseded rows apart, collapsed, as history.

**Dry run (prod, read-only, Nov 2, against the code's current keys, with `knox.rules` at v163):**
the first v2 run would close 30 rows whose last counts sum to 158,872 queued: `knox.rules` 16 rows
(v64-v160, 152,231), `knox.name_retidy` 5 (6,164), `hamilton.current_copy` 3 (424),
`magellan.registry.ubpr-peer-groups` 2 (45), and one each of `bea-personal-income` (5), `cra@1`,
`ffiec-call-detail@3` and `branch-census-tracts@1` (1 each). It counts `knox.rules@160` because the
code is at v163, which no run has counted yet. Left open: 5 current rows (1,268 queued) plus the new
`knox.rules@163` row, whose count is not known until the run; 3 stuck magellan rows (4) stay stuck.

**Not changed here:** the work itself. Knox's once-per-version re-reads (44% of a week's reads
repeated a read from days earlier) and `KNOX_REREAD_BACKLOG_LIVE` (off, needs James's yes) are what
set the real queue; Bayes only counts. No fee rows are written.

**Guard:** `src/lib/agents/bayes/ledger.test.ts`, `src/lib/agents/bayes/ledger.db.test.ts`,
`src/lib/data-store/agent-quality.test.ts`. Agent lesson:
`atlas/replay-ledger-closes-superseded-versions` (Bayes runs as an Atlas step and keeps no role
lessons of its own).
