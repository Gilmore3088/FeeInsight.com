-- Regulatory Wire watched states (stage 3): the states a Pro reader chose to watch on the
-- Wire's States view ("Watch this state"). The Wire opens on them as "My states", the weekly
-- Wire digest page (/pro/news/digest) covers them, and last_viewed_at holds when the reader
-- last opened My states, for a "new since your last visit" count. Nothing is emailed from
-- this table: the Monday Pro digest only adds a Wire section to an email it already sends,
-- and that email still needs PRO_EMAILS_ENABLED.
--
-- Additive only: one new empty table. No existing row changes value.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reg_wire_watched_states (
  user_id bigint NOT NULL,
  state_code text NOT NULL CHECK (state_code ~ '^[A-Z]{2}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz,
  PRIMARY KEY (user_id, state_code)
);
COMMENT ON TABLE public.reg_wire_watched_states IS
  'States a Pro reader watches on the Regulatory Wire (one row per reader and state). last_viewed_at is when they last opened My states. Written only by the reader''s own Watch this state toggle.';

ALTER TABLE public.reg_wire_watched_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reg_wire_watched_states FROM PUBLIC, anon, authenticated;

COMMIT;
