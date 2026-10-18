-- #1511 / #1443: an index on pipeline_feedback(kind, id), so Knox's re-read pass
-- (`knox/reread-feedback.ts`, KNOX_REREAD_FEEDBACK_LIVE) can claim and count its
-- `knox_reread_requested` rows and read their `knox_reread_resolved` rows in every lane
-- without scanning the whole table (457,718 rows on 2026-10-17; until now the only index
-- that names `kind` was the partial one on `kind = 'takedown_pending'`). `id` second serves
-- the claim's `WHERE kind = ... ORDER BY id LIMIT 25 FOR UPDATE SKIP LOCKED`; `kind` alone
-- serves the counts.
--
-- Data change: none. This file only adds an index. It writes, updates and deletes no row.
-- Re-running is safe (IF NOT EXISTS). Plain CREATE INDEX, as in the repo's other index
-- migrations (the migration runs in a transaction, so CONCURRENTLY is not available).
-- Rollback: DROP INDEX IF EXISTS public.pipeline_feedback_kind_idx;

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS pipeline_feedback_kind_idx
  ON public.pipeline_feedback (kind, id);
