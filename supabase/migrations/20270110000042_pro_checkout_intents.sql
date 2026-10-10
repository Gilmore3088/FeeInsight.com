-- R04 / #983: additive private checkout reservations. Review before deployment.
-- Canonical release order after permitted history review:
--   Pinnacle audience migrations 40/41, checkout intents 42, payment outbox 43.
-- Production currently ends at 39. The R04 preview already created this table
-- under the superseded preview-only version 40, so this migration validates that
-- existing shape instead of attempting to rewrite preview migration history.
DO $$
BEGIN
  IF to_regclass('public.pro_checkout_intents') IS NULL THEN
    CREATE TABLE public.pro_checkout_intents (
      id uuid PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      customer_id text NOT NULL,
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
      parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters) = 'object'),
      session_id text UNIQUE,
      state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'open', 'review')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      retired_at timestamptz
    );
  ELSE
    IF EXISTS (
      SELECT 1
      FROM (VALUES
        ('id'),('user_id'),('customer_id'),('fingerprint'),('parameters'),
        ('session_id'),('state'),('created_at'),('updated_at'),('retired_at')
      ) AS required(column_name)
      LEFT JOIN information_schema.columns c
        ON c.table_schema = 'public'
       AND c.table_name = 'pro_checkout_intents'
       AND c.column_name = required.column_name
      WHERE c.column_name IS NULL
    ) THEN
      RAISE EXCEPTION 'Existing public.pro_checkout_intents does not match the expected checkout-intent shape';
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS pro_checkout_one_current_per_user
  ON public.pro_checkout_intents(user_id) WHERE retired_at IS NULL;
ALTER TABLE public.pro_checkout_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pro_checkout_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pro_checkout_intents TO service_role;
COMMENT ON TABLE public.pro_checkout_intents IS
  'Server-only checkout intents. Persist before Stripe; reuse immutable parameters and keys after ambiguous failures. Never expose through client roles.';
