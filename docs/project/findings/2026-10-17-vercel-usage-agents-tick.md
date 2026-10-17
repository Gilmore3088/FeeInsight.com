# Vercel usage: the agents tick is the compute bill

Vercel warned on 2026-10-17 that the team had used $15 of its $20 monthly Pro credit
(credit resets 2026-11-05).

Measured (prod `agent_run_steps`, last 24 h to 13:45 UTC): steps started by
`api.admin.agents.tick` ran 17.3 hours; the registry tick 0.5 h; the Hamilton answer
eval 0.5 h; every other cron under 0.1 h. The tick is built to fill each 5-minute slot
(`STEP_FINISH_BUDGET_MS = 270_000`), so the function is busy most of the day.

Measured (`main` history): 87 merges to `main` on 2026-10-17 (UTC+8 day), 134 and 126 the
two days before, about 1,850 since 2026-10-05. The `ignoreCommand` lets every one of them
build for production; only 3 of today's 87 touched docs or tests alone.

Inferred: build minutes are not the main cost. 1,850 production builds at metered build
rates would far exceed $15, so builds appear to run on included build time. Fluid compute
(active CPU and provisioned memory) from the tick fits the $15. Vercel's Usage tab confirms
which line it is; this cloud has no Vercel access.

Fix: the agents tick runs every 10 minutes instead of every 5, which halves its function
time and the pipeline's throughput.
