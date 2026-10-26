-- A second one-off paid gate replay batch gets $25 more on its own provider budget line (#1077).
--
-- The first batch ("2026-10-25", migration 20270110000078) ended at $39.47 of its $40. The second
-- batch ("2026-10-26", src/lib/hamilton/paid-gate-replay.ts) writes 50 written answers, capped at
-- $25 in the run ledger, to measure the written answer's hold rate after the gate fixes #2696,
-- #2699, #2700 and #2701. James's approval of 2026-10-26 covers the batch, this line and its
-- 10-minute schedule together. Its calls are still budgeted and recorded as agent
-- `hamilton_replay` with no route id, so they check only `global:provider:default` and this row,
-- never the live Pro readers' route lines or `agent:hamilton`. It still bills to Hamilton's API key.
--
-- Caps: the monthly cap goes from $40 to $65, so October's $39.47 from the first batch plus the
-- second batch's $25 fit. The daily cap stays $40 (if the first batch's spend on 2026-10-26 leaves
-- less than $25 of that day, the batch continues the next day) and the per-run cap stays $20,
-- above the worst case of the six samples a run writes at once, so it never throttles a run's
-- workers. Enabled and fail-closed are unchanged.
--
-- Data: changes one policy row (agent:hamilton_replay); no fee data. api_budget_policies is not a
-- busy fee, source or run table, so no lock_timeout is needed (migration-lock-kill). Re-running is
-- safe: it sets the same values again.

UPDATE public.api_budget_policies
   SET hard_monthly_microusd = 65000000,
       hard_daily_microusd = 40000000,
       max_estimated_cost_per_run_microusd = 20000000,
       notes = 'Hamilton''s one-off paid gate replay batches: $40/day, $65/month, $20 a run (James, 2026-10-25, #1077); $25 more for batch 2026-10-26 (James, 2026-10-26, #1077). Bills to Hamilton''s API key.',
       updated_by = 'migration:hamilton_replay_budget_1026',
       updated_at = now()
 WHERE policy_key = 'agent:hamilton_replay';
