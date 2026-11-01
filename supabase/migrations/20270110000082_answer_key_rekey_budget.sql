-- The one-off answer-key re-key gets its own provider budget line: $15 for the whole batch.
--
-- James chose on 2026-11-01 that the rebuilt answer keys are confirmed by two independent Claude
-- reads that must agree ("Claude only, two independent reads"). He then picked "Dry run only for
-- now": this $15 line, both reads of the 62 confirmed answer-key banks, and no key writes
-- (decision card, 17:35 UTC). The batch (src/lib/agents/deming/answer-key-rekey.ts) books its calls
-- as agent `answer_key_rekey` with no route id, so they check `global:provider:default` and this
-- row, never Knox's or Magellan's agent lines. It bills to Knox's API key.
--
-- Caps: $15 a day and $15 a month, the batch's own cap (the batch also enforces $15 in the run
-- ledger, charging each unfinished bank at its worst case). $3 a run: a run reads at most two banks,
-- about $0.30 on average and under $3 at the worst case of the largest document.
-- Enabled and fail-closed, like the other agent policies.
--
-- Data: inserts one policy row; changes no existing rows and no fee or answer-key data.
-- api_budget_policies is not a busy fee, source or run table, so no lock_timeout is needed
-- (migration-lock-kill). Re-running is safe: an existing agent:answer_key_rekey row is left as is.

INSERT INTO public.api_budget_policies
  (policy_key, scope, route_id, agent_name, enabled, fail_closed,
   hard_daily_microusd, hard_monthly_microusd, max_estimated_cost_per_run_microusd,
   notes, created_by, updated_by)
VALUES
  ('agent:answer_key_rekey', 'agent', NULL, 'answer_key_rekey', TRUE, TRUE,
   15000000, 15000000, 3000000,
   'One-off answer-key re-key, two independent reads of the 62 confirmed banks, no key writes: $15/day, $15/month, $3 a run (James, 2026-11-01). Bills to Knox''s API key.',
   'migration:answer_key_rekey_budget', 'migration:answer_key_rekey_budget')
ON CONFLICT (policy_key) DO NOTHING;
