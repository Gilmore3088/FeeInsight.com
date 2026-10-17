-- Usage per API key: each /api/v1 usage event records which issued key made the call, so a Pro
-- plan's account page can show how the shared monthly allowance splits across the people who
-- hold a key on it.
--
-- Data: this file adds one nullable column and one index. It changes no existing row and writes
-- none; events logged before it keep api_key_id NULL (they are not backfilled). Code writes the
-- column only once it exists and tolerates it being absent on reads (the usage line is hidden).
-- Deleting a key keeps its events and clears the link (ON DELETE SET NULL).
-- Re-running is safe (IF NOT EXISTS throughout).
-- Rollback: DROP INDEX IF EXISTS public.usage_events_api_key_id_created_at_idx;
--           ALTER TABLE public.usage_events DROP COLUMN IF EXISTS api_key_id;

SET lock_timeout = '5s';

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS api_key_id bigint REFERENCES public.api_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS usage_events_api_key_id_created_at_idx
  ON public.usage_events (api_key_id, created_at);

COMMENT ON COLUMN public.usage_events.api_key_id IS
  'The api_keys row that made this /api/v1 call; NULL for signed-in site calls, anonymous calls and events logged before the column existed.';
