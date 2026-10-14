-- Our own record of every email sendResendEmail (src/lib/email/resend.ts) attempts, so the
-- Publishing room can list sent mail without a Resend key that can read Resend's history.
-- The production key is sending-only (least privilege), so GET /emails answered 401.
--
--   label          which sender wrote it, e.g. "password reset email"
--   recipient      the To address
--   subject        the subject line
--   status         our send outcome: sent (Resend accepted it), failed, not_configured
--   provider_id    Resend's email id when it accepted the send
--   error          the failure or not-configured reason
--   last_event     the latest Resend webhook event for provider_id (email.delivered, email.bounced, ...)
--   last_event_at  when that event happened
--
-- Data: schema only. Adds one new table and two indexes; no existing table or row changes.
-- Rows are written by the app on each send and by /api/webhooks/resend, never by SQL.

CREATE TABLE IF NOT EXISTS public.email_send_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  label text,
  recipient text,
  subject text,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'not_configured')),
  provider_id text,
  error text,
  last_event text,
  last_event_at timestamptz
);

CREATE INDEX IF NOT EXISTS email_send_log_created_at_idx
  ON public.email_send_log (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS email_send_log_provider_id_key
  ON public.email_send_log (provider_id)
  WHERE provider_id IS NOT NULL;

-- Server-only table: the app connects as the database owner; no client role reads it.
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
