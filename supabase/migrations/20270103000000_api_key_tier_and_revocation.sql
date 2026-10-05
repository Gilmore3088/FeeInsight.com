-- API keys: add the allowance tier and revocation timestamp that src/lib/api-auth.ts reads.
-- The production api_keys table predates both columns, so every keyed request failed.
-- Idempotent and additive: safe to run more than once.

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'pro';

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

ALTER TABLE public.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_tier_check;

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_tier_check CHECK (tier IN ('free', 'pro', 'enterprise'));
