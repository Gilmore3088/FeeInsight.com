-- Hoovie, the internal agent that owns public data (the registry loaders), on the run ledger
-- (James, 2026-10-17: "It's an internal name, so call him Hoovie"; DECISIONS.md).
--
-- A `hoovie` row in agent_registry, because agent_runs.agent_name and agent_run_steps.agent_name
-- reference agent_registry(agent_name). Same shape as the gutenberg row
-- (20270110000051_gutenberg_agent.sql). No provider budget policy: Hoovie's steps are
-- deterministic, apart from registry-wire-research, which keeps its own switch and budget.
--
-- Data: inserts one registry row; changes no existing row. Nothing writes the name yet: the code
-- PR that switches registry runs from `magellan` to `hoovie` follows. Re-running is safe: the
-- insert does nothing on conflict.
DO $$
BEGIN
  IF to_regclass('public.agent_registry') IS NOT NULL THEN
    INSERT INTO public.agent_registry (agent_name, display_name, description, role, parent_agent)
    VALUES ('hoovie', 'Hoovie',
            'Owns public data: loads regulator, government and survey datasets, links them to institutions and places, and keeps them fresh. Internal name only.',
            'data', 'atlas')
    ON CONFLICT (agent_name) DO NOTHING;
  END IF;
END $$;
