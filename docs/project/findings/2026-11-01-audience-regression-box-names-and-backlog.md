# 2026-11-01: unknown audience rose from 4.73% to 6.71%: renamed box sizes and a relabel that stopped

**What happened:** the share of live fees with no stated audience (`fee_audience = 'unknown'`) rose
from 4.73% on Oct 21 to 6.71% on Nov 1 (scoreboard `unstatedAudience`, 5,907 of 87,978). Of the
7,705 fees in `published_fee_catalog` created from Oct 21 to Nov 1, 2,116 (27.5%) are unknown
(read-only prod queries, Nov 1 ~20:30 UTC). Every one has a null `audience_evidence`, so Darwin made
no decision and the trigger copied Knox's raw `unknown`. Knox's raw audience is `unknown` on nearly
every row, and that is by design: Knox suggests, Darwin decides. So the question is where Darwin
stopped deciding. There are two causes.

| Cause | Unknown fees published Oct 21 - Nov 1 | Of how many published | Unknown share |
|---|---|---|---|
| A. Verified before the relabel chain ended (Oct 17 23:23 UTC), published after | 859 | 978 | 87.8% |
| B. Verified after it: safe deposit boxes | 1,018 | 1,720 | 59.2% |
| B. Verified after it: every other fee | 239 | 5,007 | 4.8% |
| All | 2,116 | 7,705 | 27.5% |

Cause A also covers 94 box fees: of A's 859, 94 are boxes and 765 are other fees. Across both causes,
1,112 of the 2,116 unknown fees are boxes.

**Cause B: Knox v99 renamed box sizes, and the audience reader was not taught the new name.**
Knox v99 (#2545, merged Oct 22 13:44 UTC, #2064) names a box row printed as its size alone "Safe
Deposit Box <size>": the row "3X5 | $20.00" under "ANNUAL SAFE DEPOSIT BOX FEE" is now "Safe Deposit
Box 3X5". The shared source check and Hamilton's same-line check were taught to trace that name by
the row's own words (`asReadBoxName`, `leadsBoxRow`). Darwin's audience reader
(`suggestAudience` -> `feeLineIndex` in `knox/audience-context.ts`) was not. It looks for the
name's first four words, "safe deposit box 3x5", which no line prints. In a schedule that also
prices a business item, a fee whose own line is not found stays unknown (`feeIndex < 0`), so every
renamed box there went live unknown. Before the rename, the bare "3X5" was found and read as
`both` (`mixed_schedule_unqualified`). Verify-time unknown share by Darwin's verify day: 3.6-4.7%
on Oct 18-21, then 22.0% on Oct 22, 15.5% on Oct 23, 14.8% on Oct 24, and 7-12% since. Safe deposit
box fees went from 512 published (45 unknown) when verified Oct 18-21 to 2,147 (1,024 unknown) when
verified from Oct 22. The rename also gave new verified rows to boxes that were already live under
their bare size. Infuze CU (document 29554) has both "5x5" `both` and "Safe Deposit Box 5x5"
`unknown` live at $20.00. That copy is a separate root cause; it goes on the tracker.

**Cause A: the audience relabel read only live fees, once.** Migration 47 lets the verified tier
keep Darwin's decision. Every fee verified before it kept `unknown` on its verified row. The relabel
(#1059, `darwin/audience-relabel.ts`) gave live ones Darwin's decision, and its v4 chain finished on
Oct 17 at 23:23 UTC (`done: true`). The scheduler then reports `done` forever. Verified rows that were
still waiting to publish were never read. 77,929 such rows (11,424 documents) still carry
`unknown`, 76,938 of them verified before the chain ended. Every one that Hamilton publishes goes
live unknown, so Hamilton is not the cause. On Oct 26-27 Hamilton published a batch of them: Winchester
Savings' "Schedule-of-Service-Charges-CONSUMER" (verified Oct 10, published Oct 27), and Connect
Bank's general schedule with no business prices, which would read `consumer`.

**Fix:**
- Knox's audience reader can find the box row the renamed fee came from (`boxRowIndex` in
  `feeLineIndex`, option `boxRows`). The row must lead with the size at the fee's own price, which
  is the shared check's own test (`leadsBoxRow`). On the two stored schedules in the test (First
  State 4546, Infuze 29554) all 12 renamed boxes read `both` (`mixed_schedule_unqualified`), as the
  bare sizes did. Admit-only: it finds a line for a fee that found none, and changes no fee whose
  line was found. It changes the audience new verifications publish, so it sits behind the same
  switch as the relabel (`AUDIENCE_V5_LIVE` in `darwin/audience.ts`, off): until it is on,
  verification reads a renamed box exactly as `main` did.
- Darwin's relabel v5 also reads verified rows waiting to publish. It uses verification's reader,
  and reads a fee's own exclusive price clause only on the text Knox read the fee from (same
  artifact and text hash as the raw row's capture). Where such a clause exists on another text, or
  in the excerpt Knox kept on the raw row (`extraction_note` / `conditions`), verification would
  defer, so the relabel leaves the fee unknown (`own_clause_unbound`). Live rows are touched by
  `lineage_ref` at write and at rollback, so a row relabelled while waiting and published later
  still gets its decision, or its rollback. It ships OFF: `AUDIENCE_RELABEL_V5_LIVE` is
  `AUDIENCE_V5_LIVE`, so the v5 chain runs as a full dry run (`dry_run_full`). That run writes
  nothing and leaves totals on the run ledger (`audience_relabel.dry_run_totals`), split into live
  fees and waiting rows: how many of each it read, the changes it would make to each
  (`by_change_live`, `by_change_waiting`), and how many of those the box row decides
  (`box_row_changes_live`, `box_row_changes_waiting`, the dry-run count for the Knox half of the
  switch). Turning it on writes the decisions: live rows through the verified row and the trigger,
  waiting rows on the verified row only. Every write is recorded first, so a rollback restores it.

**Dry run (read-only, Nov 1):** the v5 chain reads 6,682 live unknown fees (1,789 documents;
1,072 are renamed boxes), 21,124 live mixed-schedule `both` fees (moved only by a schedule title, as
in v4), and 77,929 waiting unknown verified rows (11,424 documents; 1,084 renamed boxes). A
reviewer's independent count: live 27,810 fees on 2,674 documents, waiting 77,942 on 11,426, and
97.3% of waiting rows bound to the newest text. The stored texts of these documents total about
22 MB, too much for a read-only SQL session, so how many it decides is not measured yet. The v5
dry run counts it on prod, live and waiting apart. A 24-fee sample was run locally with today's
code on stored texts copied from prod (the PR lists it). Of the 24 live unknown fees, 12 renamed
boxes read `both` and 12 Connect Bank fees read `consumer` (`default_general_schedule`). None stayed
unknown.

**Target:** with the switch on, new verifications go back to the Oct 18-21 rate (about 4%). The
remaining live excess is the 1,112 boxes and the 859 backlog fees, and v5 re-reads both, so the
share should fall back under 5%. That is not measured; the v5 dry run's live totals will say.

**Guard:** `src/lib/agents/knox/audience-box-size.test.ts` (stored First State and Infuze texts;
renamed boxes read as the bare sizes did with the switch on, and as `main` did with it off) and
`src/lib/agents/darwin/audience-relabel.test.ts` (v5 reads waiting rows, ships as a dry run, splits
its totals into live and waiting, decides with the own-clause rule and the kept excerpt).

**Agent lesson:** knox/issue-2064-a-rename-teaches-every-reader, darwin/a-tier-backfill-reads-the-queue-too

**Lesson:** a rename that teaches the source check how to trace the new name must teach every
reader that locates a fee by its name: the audience reader, the same-line check and anything else
calling `feeLineIndex`. A one-off pass over "live" rows does not cover rows still in the queue. A
backfill for a tier must also read the rows that will reach that tier later.
