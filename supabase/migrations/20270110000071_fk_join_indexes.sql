-- Indexes for four foreign keys the app joins on but that have no index.
--
-- From a read-only prod review (2026-10-19; sizes are that day's, not re-measured here):
--   * pipeline_attempts.source_document_id -> source_documents (about 2.39M rows, 1,480 MB).
--     Joined by state-lane-scheduler and Hamilton's rules-recheck, newer-copy-retire and
--     current-copy; its FK (ON DELETE SET NULL) also makes every source_documents delete
--     seq-scan this table.
--   * agent_run_events.step_id -> agent_run_steps (about 175k rows, 177 MB). Queries join
--     events to steps by step_key and read the newest first (ORDER BY e.created_at DESC,
--     e.id DESC: hoovie/storage-tiers, daily-brief, crew, goal-scorecard), so the index
--     carries that order.
--   * source_documents.superseded_by_id and duplicate_of_id: self FKs (ON DELETE SET NULL),
--     NULL on most rows, so partial indexes keep them small.
--
-- Data: none. Index-only; no row is inserted, updated or deleted.
-- Locks: a plain CREATE INDEX (Supabase's GitHub deploy runs each file in a transaction, so
-- CONCURRENTLY is not available) blocks writes to each table while its index builds; reads
-- continue. lock_timeout stops the file waiting behind a long writer instead of queueing
-- every other writer behind it. IF NOT EXISTS lets a hand-run CONCURRENTLY build go first.

SET lock_timeout = '10s';
SET statement_timeout = '600s';

CREATE INDEX IF NOT EXISTS pipeline_attempts_source_document_idx
  ON public.pipeline_attempts (source_document_id)
  WHERE source_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_run_events_step_time_idx
  ON public.agent_run_events (step_id, created_at DESC, id DESC)
  WHERE step_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS source_documents_superseded_by_idx
  ON public.source_documents (superseded_by_id)
  WHERE superseded_by_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS source_documents_duplicate_of_idx
  ON public.source_documents (duplicate_of_id)
  WHERE duplicate_of_id IS NOT NULL;
