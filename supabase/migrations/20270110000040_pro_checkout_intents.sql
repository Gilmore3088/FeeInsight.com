-- R04 / #983: additive private checkout reservations. Review before deployment.
-- Generated with Supabase CLI, then numbered after the repository's existing
-- 20270110000039 baseline. Does not alter subscriptions, payments or fee data.
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
CREATE UNIQUE INDEX pro_checkout_one_current_per_user
  ON public.pro_checkout_intents(user_id) WHERE retired_at IS NULL;
ALTER TABLE public.pro_checkout_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pro_checkout_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pro_checkout_intents TO service_role;
COMMENT ON TABLE public.pro_checkout_intents IS
  'Server-only checkout intents. Persist before Stripe; reuse immutable parameters and keys after ambiguous failures. Never expose through client roles.';
