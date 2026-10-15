# Migration 048 was cancelled by its own 5-second lock timeout

**Date:** 2026-10-15
**Found by:** builder session, while confirming #1337 on prod

## What happened
- #1337 merged at 01:02:41 UTC. It adds migration `20270110000048`, a nullable `raw_fee_observations.extraction_note` column, and appends that column to both catalog views.
- The Supabase GitHub link ran the file at 01:03:21. Postgres logged `canceling statement due to lock timeout` at 01:03:26.
- The file and its history row run as one transaction, so nothing was applied. Afterwards, `schema_migrations` still ended at 047 and the column did not exist.
- The cause: adding a column takes an ACCESS EXCLUSIVE lock. Read queries on the table that take 6–10 seconds were running at the time: catalog aggregates from other sessions and the publish steps. The 5-second limit expired before they finished.

## Why it matters
- A failed migration does not retry by itself. The link only runs pending migrations on the next push to `main`.
- Until the migration applies, code that reads the new column must not ship. #1336 waits on it.

## Fix
- `lock_timeout` is now 20 seconds. That covers the reads seen at the time. A read that starts while the ALTER is queued can be held for up to 20 seconds.
- The change ships as its own PR, and merging it is the push that retries the deploy.
- After merge, confirm in `supabase_migrations.schema_migrations` and `information_schema.columns` before merging the code that depends on the column.

## For next time
- For any migration that takes an ACCESS EXCLUSIVE lock on a busy table, set `lock_timeout` above the longest normal read on that table. Measure the reads with `pg_stat_activity`.
- Always confirm the migration landed on prod. Don't assume it did because the merge succeeded.
