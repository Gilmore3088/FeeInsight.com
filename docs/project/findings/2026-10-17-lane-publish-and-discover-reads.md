# Lane publish and discover steps spent about 30 s each on one read

**Found:** 2026-10-17, auditing state-lane step times after the classify fix (#1793).

**What happened.** Over 24 h to 12:45 UTC Oct 17, completed lane steps averaged classify 127 s,
publish 103 s, discover 87 s and extract 30 s (`agent_run_steps`, workflow lanes). Publish had grown
from 60 s on Oct 12 to 114 s on Oct 17, and discover from 38 s to 85 s. Lanes run one at a time, so
every second here delays the next state.

**Cause 1: Hamilton publish selection (`selectVerifiedFees`, `hamilton/publish.ts`).** The 3-fee
rough cut counted each institution's distinct fees in a subquery correlated to every verified row.
Postgres evaluated it on the verified-row scan, before the "not yet published" and "undecided"
tests: 164,222 times in the national fill that every lane with a short queue runs. That alone took
32 s (EXPLAIN ANALYZE on prod).

**Fix.** One grouped count per institution in a materialized CTE (`deep`), scoped to the state or
bank when the call is. Same rows on prod (count and md5 of the ordered ids), core selection:
national 27.0 s to 3.8 s (146 rows), TX 2.4 s to 0.28 s (10 rows). The 4,115 institutions passing
the count are identical both ways.

**Cause 2: Magellan's thin-bank finder (`selectThinBanks`, `magellan/second-document.ts`).** The
hidden-bank top-up (national) regex-scans up to 60k characters of each bank's stored texts for an
overdraft price. Postgres pushed that test onto the institution scan, before the cheap filters
(fewer than 3 live categories, not tried in 30 days): 5,141 banks at about 6 ms each to keep 65.

**Fix.** A materialized `candidates` CTE applies the cheap filters first; the text tests run only
on its rows. Same 65 rows in the same order on prod (md5 of id, incomplete flag and categories):
30.0 s to 1.4 s.

**Not changed.** `loadKnoxLessons` (pg_stat_statements: 542 calls, 53 s mean) now runs in 2.8 s
on prod; the mean is from before its Oct 8 rewrite and the `pipeline_feedback_kind_idx` index
(#1745). pg_stat_statements was last reset on Oct 5, so its means mix old and new code.

**Still slow, needs a schema decision.** The national publish fill still checks about 75k
already-decided verified rows against `pipeline_attempts` on every lane (about 4-10 s). A marker
on the verified row for the publish rule version that decided it would remove that scan.

**Guard:** `src/lib/agents/hamilton/publish.test.ts:870` (publish counts each institution's fees once in a materialized grouped read, never in a subquery correlated per verified row); `src/lib/agents/magellan/second-document.test.ts:135` runs the stored-text tests only on banks that pass the cheap filters
