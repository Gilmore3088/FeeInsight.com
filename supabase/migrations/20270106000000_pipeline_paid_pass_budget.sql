-- Pipeline pass 3 (paid last pass) budget: $300 a month in total, a hard stop.
--
-- Provider calls need every matching policy enabled with caps: the global policy,
-- the cron-tick route policy (so the tick may run paid steps) and the agent's own
-- policy. Route policies for Hamilton chat, research, reports and Scout stay disabled,
-- so this enables only the pipeline's paid steps (Magellan, Rosetta, Knox).
-- Spend is summed from ai_api_usage_events; when a cap is reached the paid steps are
-- skipped and the free steps keep running. Change the numbers here to change the cap.

UPDATE public.api_budget_policies
   SET enabled = true,
       hard_monthly_microusd = 300000000,
       hard_daily_microusd = 20000000,
       notes = 'All provider spend: $300/month, $20/day hard stop. Route and agent policies still gate each caller.',
       updated_by = 'migration:pipeline_paid_pass_budget',
       updated_at = now()
 WHERE policy_key = 'global:provider:default';

UPDATE public.api_budget_policies
   SET enabled = true,
       max_provider_calls_per_tick = 30,
       max_estimated_cost_per_tick_microusd = 3000000,
       max_provider_calls_per_run = 30,
       max_estimated_cost_per_run_microusd = 3000000,
       notes = 'Cron tick may run pipeline paid steps: at most 30 calls and $3 per tick and per run.',
       updated_by = 'migration:pipeline_paid_pass_budget',
       updated_at = now()
 WHERE policy_key = 'route:api.admin.agents.tick';

UPDATE public.api_budget_policies
   SET enabled = true,
       hard_monthly_microusd = CASE agent_name
         WHEN 'magellan' THEN 60000000
         WHEN 'rosetta' THEN 90000000
         WHEN 'knox' THEN 150000000
       END,
       max_provider_calls_per_run = 30,
       max_estimated_cost_per_run_microusd = 3000000,
       notes = 'Pipeline paid last pass. Monthly share of the $300 cap: Magellan $60, Rosetta $90, Knox $150.',
       updated_by = 'migration:pipeline_paid_pass_budget',
       updated_at = now()
 WHERE policy_key IN ('agent:magellan', 'agent:rosetta', 'agent:knox');
