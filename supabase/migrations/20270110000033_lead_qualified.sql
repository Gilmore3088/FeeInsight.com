-- A qualified flag on leads, so the sales metrics can count qualified conversations and the
-- growth step `growth-quote` (src/lib/agents/growth/quote.ts) knows whom to draft a quote for.
--
--   qualified_at  when the lead was marked qualified on /admin/leads; null = not qualified
--   qualified_by  who marked it (the signed-in admin's username)
--
-- Data: schema only. Adds two nullable columns; no existing row changes. Leads are marked
-- qualified by hand in /admin/leads, never by SQL.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS qualified_at timestamptz,
  ADD COLUMN IF NOT EXISTS qualified_by text;
