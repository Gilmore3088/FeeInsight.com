-- Fee-change alert dispatch (Atlas step `fee-alert-dispatch`).
--
-- The dispatcher joins active subscriptions to hamilton_signals by institution and
-- reads only signals newer than each subscription's high-water mark. This index keeps
-- that join on the small active set; the comment records what last_alerted_at means
-- now that something writes it. RLS and the REVOKEs on this table are unchanged.

BEGIN;

CREATE INDEX IF NOT EXISTS institution_fee_alert_subscriptions_active_institution_idx
  ON public.institution_fee_alert_subscriptions (institution_id)
  WHERE is_active;

COMMENT ON COLUMN public.institution_fee_alert_subscriptions.last_alerted_at IS
  'High-water mark: created_at of the newest hamilton_signals row included in the last fee-change alert sent to this reader. NULL means none sent; the dispatcher then reads signals after created_at.';

COMMIT;
