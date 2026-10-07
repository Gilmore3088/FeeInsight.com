-- Pro emails: watchlist fee-change alerts and the Monday digest (Atlas steps
-- `fee-alert-dispatch` and `pro-digest`). Sending stays behind PRO_EMAILS_ENABLED.
--
-- Additive only: three nullable columns and one empty table. No existing row
-- changes value.
--   hamilton_watchlists.last_alerted_at  high-water mark for watchlist alerts, like
--                                        institution_fee_alert_subscriptions.last_alerted_at
--   users.watchlist_alerts_off_at        set by the fee-alert unsubscribe link
--   users.pro_digest_off_at              set by the digest unsubscribe link
--   pro_digest_snapshots                 last week's positions, so the digest can say
--                                        what changed since

BEGIN;

ALTER TABLE public.hamilton_watchlists ADD COLUMN IF NOT EXISTS last_alerted_at timestamptz;
COMMENT ON COLUMN public.hamilton_watchlists.last_alerted_at IS
  'High-water mark: created_at of the newest hamilton_signals row included in the last watchlist fee alert sent to this reader. NULL means none sent; the dispatcher then reads at most the last 7 days.';

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS watchlist_alerts_off_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pro_digest_off_at timestamptz;

CREATE TABLE IF NOT EXISTS public.pro_digest_snapshots (
  user_id bigint NOT NULL,
  week_start date NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);
COMMENT ON TABLE public.pro_digest_snapshots IS
  'One row per Pro reader per Monday: their institution''s position among state peers and their watched institutions'' headline fees, written by the pro-digest step so next week''s digest can report what changed.';

ALTER TABLE public.pro_digest_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pro_digest_snapshots FROM PUBLIC, anon, authenticated;

COMMIT;
