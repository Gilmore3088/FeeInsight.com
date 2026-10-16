-- #1573 (follow-up to #1042): dated notes a state expert learns about its state.
--
-- The `state-expert` lane step (Atlas, deterministic, no provider calls) adds a note when it learns
-- something new about the state:
--   document_type   which kinds of stored fee documents are most common there (Rosetta's
--                   agent_source_texts.document_kind)
--   state_fee_rule  a signed state fee bill (reg_tracker_items, Open States)
-- The admin state expert page (/admin/states/<ST>/expert) lists them, newest first.
--
-- Data: this file only adds one new, empty table. It changes no existing row and writes none.
-- Code tolerates the table being absent: the step records a skipped event instead of writing,
-- and the page shows no notes. Re-running is safe (IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS public.state_expert_notes (
  id            BIGSERIAL PRIMARY KEY,
  state_code    TEXT NOT NULL,
  note_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  kind          TEXT NOT NULL,
  note          TEXT NOT NULL,
  source_ref    TEXT,
  evidence      JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id  INTEGER REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT state_expert_notes_state_code_check
    CHECK (state_code = upper(state_code) AND length(state_code) BETWEEN 2 AND 3),
  CONSTRAINT state_expert_notes_kind_check
    CHECK (kind IN ('document_type', 'state_fee_rule'))
);

CREATE INDEX IF NOT EXISTS idx_state_expert_notes_state_date
  ON public.state_expert_notes (state_code, note_date DESC, id DESC);

COMMENT ON TABLE public.state_expert_notes IS
  'Dated notes a state expert learned about its state (#1573), written by the state-expert lane step. One row per note; never updated.';

ALTER TABLE public.state_expert_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.state_expert_notes FROM anon, authenticated;
