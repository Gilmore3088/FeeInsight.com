# 2026-10-26: the ungraded peer v1/v2 holds do not back v5's release (#1694)

**Lesson:** A grade made on one period's holds says nothing about another period's. Before a
check's new version re-decides older holds, grade a sample of those holds against the banks'
stored text, and replay today's rules on the sample to count the misreads that would get through.
The peer v1/v2 holds (Oct 5–10) came from older Knox reads, and outside v5's hold categories
10 of the 30 graded rows were misreads, against 21 of the 236 v3/v4 holds v5 was built on (all categories).

**What happened:** peer check v5 (#1691) re-decides an old `peer_outlier` hold only when its run's
`verify.peer_range` attempt was v3 or v4 (`DARWIN_PEER_GRADED_VERSIONS`). #1694 asked whether the
v1/v2 holds could be added. Read-only production counts on 2026-10-26: 2,124 raw rows are still
held by a v1/v2 peer hold, with no verified row, and would be selected again (312 from v1, 1,812
from v2). Of them, 222 are in `PEER_HOLD_CATEGORIES` and 1,902 are not. 1,710 of the 1,902 sit on
their bank's current copy, and 1,274 have a newer Knox read of the same document.

**The grade:** 60 rows, 5 per day in and 5 per day outside the hold categories for each of Oct 5 to
Oct 10 (the rows of each day and category in random order, `md5(fee_raw_id || 'oct26')`). Each was
read against its document's latest completed `agent_source_texts` text. The rows are listed in
`/mnt/project-files/triage/peer-v1v2-grade-oct26.md`.

| Group | Real fee | Misread | Unsure |
|---|---|---|---|
| Outside the hold categories (30) | 17 | 10 | 3 |
| In the hold categories (30) | 17 | 11 | 2 |
| All (60) | 34 | 21 | 5 |
| v4 holds, Oct 16 grade (123) | 103 | 14 | 6 |
| v3 holds, Oct 16 grade (113) | 103 | 7 | 3 |

The sample is 5 rows a day, so these are sample rates, not a weighted estimate for all 1,902 rows.

**Replay under today's rules** (the verify step's pure checks run over the 60 rows and their stored
texts: category, name rules, source check, tier perk; learned envelopes and peer levels were not
loaded):
- Outside the hold categories, 27 of the 30 rows pass every rule, so v5 would verify them. 6 of
  those 27 are misreads (22% of the sample). Today's rules stop 3 misreads (a price in the name, two not in source),
  and a re-file now reads one (542647) at the right category.
- In the hold categories, 7 rows fail a rule first. The other 23 reach the peer check, where v5
  still holds a state outlier, so the rows stay held as they are now.

**What the misreads show about the peer check:** the peer check was right to hold them; they are
outliers because they are misreads. v5 stopped holding outliers outside six categories because, in
the v3/v4 holds, those were nearly all real fees at an unusual price. In the v1/v2 holds they are
not. The misreads that get through are old Knox reads: another service filed under the fee
("Invalid Address Fee (per returned item)" as NSF; "FAX outgoing" as account research; a remote
deposit scanner's and a cash management service's "Monthly Service" as monthly maintenance), and a
neighbour's price ("NSF $5.00/transfer", the transfer fee; a spaced "$ 5 5 . 0 0" box read as $5).

**Fix:** none to the peer check. `DARWIN_PEER_GRADED_VERSIONS` stays `[3, 4]`, so the v1/v2 holds
stay held, and its comment records this grade. Darwin's lesson
`darwin/issue-1694-grade-the-holds-you-re-decide` records the method. These rows should get a
new decision from a newer Knox read of their document, not from v5 re-deciding an old read.
Retiring them is a production-data change and needs James's yes.

**Agent lesson:** darwin/issue-1694-grade-the-holds-you-re-decide
