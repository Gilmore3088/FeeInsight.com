-- Hamilton decision workspace: decisions, their event log, what the bank tells Hamilton
-- (memory) and the files it uploads. Hamilton is decision support: a decision records
-- what the bank researched, modeled and chose; nothing here stores a recommendation.
--
-- Creates four new, empty tables. Changes no existing table or row.

BEGIN;

CREATE TABLE IF NOT EXISTS hamilton_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id BIGINT NOT NULL REFERENCES institution_sources(id) ON DELETE CASCADE,
  fee_category TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'researching'
    CHECK (status IN ('researching', 'modeling', 'decided', 'implementing', 'monitoring', 'closed')),
  chosen_amount NUMERIC,
  chosen_by TEXT,
  watch_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hamilton_decisions_user_institution
  ON hamilton_decisions(user_id, institution_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS hamilton_decision_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES hamilton_decisions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('opened', 'question_asked', 'answer_given', 'upload_added', 'scenario_tested',
                    'option_chosen', 'plan_created', 'deliverable_made', 'watch_tripped', 'status_changed')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hamilton_decision_events_decision
  ON hamilton_decision_events(decision_id, at);

-- One row per answer or edit; an edit supersedes the earlier row instead of overwriting it,
-- so every figure Hamilton used can be traced to who gave it and when.
CREATE TABLE IF NOT EXISTS hamilton_institution_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id BIGINT NOT NULL REFERENCES institution_sources(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value JSONB NOT NULL,
  given_by TEXT,
  source TEXT NOT NULL CHECK (source IN ('answer', 'upload', 'edit')),
  upload_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hamilton_memory_current
  ON hamilton_institution_memory(user_id, institution_id, field_key)
  WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS hamilton_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id BIGINT NOT NULL REFERENCES institution_sources(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT,
  byte_size INTEGER,
  storage_key TEXT,
  column_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'mapped', 'applied', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hamilton_uploads_user_institution
  ON hamilton_uploads(user_id, institution_id, created_at DESC);

-- The bank's own figures are private: server routes only, never the public API roles.
ALTER TABLE hamilton_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hamilton_decision_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hamilton_institution_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE hamilton_uploads ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE hamilton_decisions, hamilton_decision_events,
  hamilton_institution_memory, hamilton_uploads FROM anon, authenticated;

COMMIT;
