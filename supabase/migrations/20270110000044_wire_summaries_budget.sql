-- Regulatory Wire research notes get their own provider budget (#1149, option b).
--
-- James, 2026-10-12: give Wire summaries their own small policy so they don't compete with
-- Magellan's fetching, at $25 a month. Magellan's $150 monthly cap ran out on Oct 12 and the
-- summaries wrote nothing. The step now logs and budgets its calls as agent `wire`
-- (src/lib/agents/magellan/registry/wire-research.ts) and still bills to Magellan's API key.
--
-- Caps: $25 a month, at most 30 calls and $1 a run (the step sends at most 30 items a run).
-- Enabled and fail-closed, like the other agent policies.
--
-- Data: inserts one row; changes no existing rows. Re-running is safe: an existing
-- agent:wire row (a cap James set by hand) is left untouched.

INSERT INTO public.api_budget_policies
  (policy_key, scope, route_id, agent_name, enabled, fail_closed,
   hard_monthly_microusd, max_provider_calls_per_run, max_estimated_cost_per_run_microusd,
   notes, created_by, updated_by)
VALUES
  ('agent:wire', 'agent', NULL, 'wire', TRUE, TRUE,
   25000000, 30, 1000000,
   'Regulatory Wire research notes: $25/month, 30 calls and $1 a run (James, 2026-10-12, #1149). Bills to Magellan''s API key.',
   'migration:wire_summaries_budget', 'migration:wire_summaries_budget')
ON CONFLICT (policy_key) DO NOTHING;
