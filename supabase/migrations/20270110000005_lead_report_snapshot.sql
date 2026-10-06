-- A paid institution report keeps the numbers the buyer paid for (value funnel audit, 6 Oct 2026).
-- When the requester starts card checkout, the report's market data (the same data the
-- readiness check just passed) is saved on the request. If the live market later goes thin,
-- the private report shows this saved copy, dated, instead of "being refreshed".
-- Additive and nullable: no existing row changes, and every reader treats a missing
-- column as "no saved copy", so the app works before and after this runs.

BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS report_snapshot JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS report_snapshot_at TIMESTAMPTZ;

COMMIT;
