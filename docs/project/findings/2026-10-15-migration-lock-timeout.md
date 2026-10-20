# Migration 048 was cancelled by its own 5-second lock timeout, then applied on retry

**Date:** 2026-10-15
**Found by:** builder session, confirming #1337 on prod. Corrected after the #1340 review.

## What happened
- #1337 merged at 01:02:41 UTC. The Supabase GitHub link ran migration `20270110000048` (a nullable `raw_fee_observations.extraction_note` column, appended to both catalog views).
- The ALTER started at 01:03:21.042 and was cancelled at 01:03:26.042: `canceling statement due to lock timeout`.
- Four readers queued behind it, waiting 1.8 to 5.0 seconds.
- The file and its history row run as one transaction, so nothing was applied. At that point `schema_migrations` still ended at 047 and the column did not exist (it was applied on retry; see Outcome).
- **Cause:** an open transaction held a lock on the table, and the ACCESS EXCLUSIVE lock could not be taken within 5 seconds. The logs do not name the holding session.

## Outcome
- The next push to `main` was #1341, merged at about 01:15 UTC. On that push the link retried 048 unchanged, still with the 5-second limit.
- The ALTER ran at 01:16:16 and succeeded.
- Read-only checks after the retry:
  - `schema_migrations` ends at `20270110000048`.
  - `raw_fee_observations.extraction_note` exists.
  - Both catalog views have the column and keep the ACL `{postgres, service_role}`.
- The migration file stays as applied. A file that has been applied is not edited afterwards.
- The retry succeeded because no long transaction held the table at that moment. That is chance, not a fix.

## Why a longer timeout alone is not enough
A lock lasts for the holder's whole transaction, not just one statement, and pipeline steps run inside one transaction (`withTransaction`, `run-store.ts`). In the 12 hours to about 01:10 UTC:

| Measure | Value |
|---|---|
| Publish steps, p50 / p90 / max | 64 s / 71 s / 155 s |
| Extract steps, p50 / p90 | 21 s / 48 s |
| Share of time a publish or extract step was open | 33% |
| Share of time a step stayed open more than 20 s past a given moment | 19.7% |
| Statements of 10 s or more on these tables | 195, from 10 s to 42 s |

Step wall time stands in for transaction time here; transaction time was not measured directly.

The #1340 review estimated that with a 20-second limit, about 1 attempt in 5 fails while the pipeline runs. That figure is an estimate, not a measurement.

## What it costs
While the ALTER waits, every new read of `raw_fee_observations` and both catalog views queues for up to the limit. That covers public institution pages, the API, reports and agent reads.

A failed migration does not retry by itself. The link only runs pending migrations on the next push to `main`.

## Safe way to apply (for the next migration that locks a busy table)
1. Pause the `pipeline` control. That is James's call, since it is a production control.
2. Check that `pg_stat_activity` shows no open step transaction on these tables.
3. Merge the migration PR.
4. Confirm the migration's row in `supabase_migrations.schema_migrations` and the schema change it makes.
5. Resume the control.

Only then merge the code that uses the new column or table.

## For next time
- A migration that takes an ACCESS EXCLUSIVE lock on a busy table should be applied with the pipeline paused, and with a `lock_timeout` that fails fast.
- Always confirm on prod that the migration landed. A successful merge does not mean the migration applied.

**Guard:** `scripts/ci-guards.sh migration-lock-kill` (a migration after 20270110000071 that alters, indexes, re-creates a catalog view on or triggers a busy fee, source or run table must set `lock_timeout`; tests `scripts/ci-guards.test.ts:315`)
