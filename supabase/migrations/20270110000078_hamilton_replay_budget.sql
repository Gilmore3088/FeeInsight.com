-- The one-off paid gate replay batch gets its own provider budget (#1077).
--
-- James approved one batch of about 200 paid samples, about $35, on 2026-10-25 (decision card
-- 16:12 UTC; "I approve the update that would run paid models", 17:30 UTC), and approved this
-- separate budget line on a decision card at 21:03 UTC. The batch
-- (src/lib/hamilton/paid-gate-replay.ts) logs and budgets its calls as agent `hamilton_replay`, with
-- no route id, so it checks only `global:provider:default` and this row. It never uses the live
-- Pro readers' route lines ($5 a day each) or `agent:hamilton`, and they never stall it. It still
-- bills to Hamilton's API key.
--
-- Caps: $40 a day and $40 a month, the batch's own cap (which the batch also enforces in the run
-- ledger); $20 a run, above the worst case of the six samples a run writes at once (about $17), so
-- it never throttles a run's workers. A run whose real spend reaches $20 (about 90 samples at the
-- daily eval's average costs) stops reserving: the batch checks this line before each sample, and the
-- next run starts at $0. Enabled and fail-closed, like the other agent policies.
--
-- Data: inserts one row; changes no existing rows. Re-running is safe: an existing
-- agent:hamilton_replay row (a cap James set by hand) is left untouched.

INSERT INTO public.api_budget_policies
  (policy_key, scope, route_id, agent_name, enabled, fail_closed,
   hard_daily_microusd, hard_monthly_microusd, max_estimated_cost_per_run_microusd,
   notes, created_by, updated_by)
VALUES
  ('agent:hamilton_replay', 'agent', NULL, 'hamilton_replay', TRUE, TRUE,
   40000000, 40000000, 20000000,
   'Hamilton''s one-off paid gate replay batch: $40/day, $40/month, $20 a run (James, 2026-10-25, #1077). Bills to Hamilton''s API key.',
   'migration:hamilton_replay_budget', 'migration:hamilton_replay_budget')
ON CONFLICT (policy_key) DO NOTHING;
