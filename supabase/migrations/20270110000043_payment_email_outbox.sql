-- R03 / #983. Additive, private transactional delivery obligations. Review first.
-- Canonical release order: Pinnacle 40/41, checkout intents 42, payment outbox 43.
-- No send, replay of historical events, or modification of payment/fee records.
CREATE TABLE public.payment_email_outbox (
  id uuid PRIMARY KEY,
  event_id text NOT NULL REFERENCES public.stripe_events(stripe_event_id),
  dedupe_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('welcome','report_customer','report_admin','duplicate_admin','refund_admin')),
  lead_id bigint REFERENCES public.leads(id),
  message jsonb NOT NULL CHECK (jsonb_typeof(message) = 'object'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','accepted','review','cancelled','resolved')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 6),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  first_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  provider_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_by bigint REFERENCES public.users(id),
  resolution_note text,
  CHECK ((state = 'sending') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX payment_email_due ON public.payment_email_outbox(next_attempt_at) WHERE state IN ('pending','sending');
CREATE INDEX payment_email_event ON public.payment_email_outbox(event_id);
ALTER TABLE public.payment_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_email_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_email_outbox TO service_role;
COMMENT ON TABLE public.payment_email_outbox IS
  'Immutable payment email envelopes; provider acceptance is not inbox delivery. Ambiguous attempts older than 23h require operator reconciliation, not blind resend.';
