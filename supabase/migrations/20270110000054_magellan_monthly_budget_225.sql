-- Magellan's monthly provider cap: $150 -> $225 (James, Data quality thread, 2026-10-17 02:44 UTC:
-- "Add $75" on the card "Raise Magellan's October search budget to find the real fee schedules?").
-- Magellan's paid web search hit the $150 cap on Oct 5 and has found almost nothing since. About
-- 1,100 banks hold a product page or account agreement instead of a fee schedule; at this week's
-- ~$0.054 a bank, $75 covers that backlog. The global $500 monthly cap is unchanged ($293 spent
-- in October as of 02:45 UTC Oct 17). Changes one policy row; no fee data.
UPDATE public.api_budget_policies
   SET hard_monthly_microusd = 225000000,
       notes = 'Monthly cap $225 (James, Oct 17 2026: +$75 to find real fee schedules for ~1,100 wrong-page banks). Was $150.',
       updated_by = 'migration:magellan_monthly_budget_225',
       updated_at = now()
 WHERE policy_key = 'agent:magellan';
