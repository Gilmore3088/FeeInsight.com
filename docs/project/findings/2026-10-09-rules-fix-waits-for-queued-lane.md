# A Knox rules fix waited for a queued state lane

**Seen:** 2026-10-09 06:05 UTC. Knox v57 (PR 838, live 05:14) reads Arvest's `$17.00 per item`
overdraft row and Old National's monthly fee names, but neither page had been read at v57 an hour later.

**Why:** the version gate was fine. `selectTextArtifacts` re-reads a $10B+ bank's current copy once
per rules version. But it only runs inside a state lane run (or a direct "Read now" run), and:

- AR's lane was due since 01:22 and IN's since 04:01, behind 8 and about 30 starved lanes (6 lane
  passes an hour), so both waited hours.
- `stateHasDocumentBacklog` does not count large-bank version re-reads, so a version bump never
  makes a lane due by itself.
- The direct path's overdraft-gap tier ($10B+ or market leader, no live overdraft fee) holds a bank
  7 days after any direct run. All 35 such banks were held; 34 had a current page unread at v57.

**Fix:** an overdraft-gap bank whose current page the current Knox rules version has not read runs
again after `PRIORITY_RULES_REREAD_HOURS` (6), keyed `atlas:priority:<id>:knox:<version>`, so each
rules version reaches them through the direct path. Arvest (78) and Old National (41) were added as
requests so they run first.
