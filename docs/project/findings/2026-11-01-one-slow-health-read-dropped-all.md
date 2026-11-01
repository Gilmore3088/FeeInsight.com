# 2026-11-01: one slow agent-health read dropped every agent's numbers
**What happened:** The admin home page showed "Darwin backlog: Not read, not in the newest scorecard". `pipeline_scoreboard_snapshots.detail` had no `agent_health` on Oct 26, 28, 30, 31 and Nov 1; Oct 27's held Darwin's numbers (6,569 undecided). Prod logs at 12:53:28 UTC on Nov 1: `readAgentHealth failed: canceling statement due to statement timeout`.
**Cause:** `readAgentHealth` read the nine agents one after another in one savepoint, so the first statement to pass the server's 120 s limit threw away all nine sections. `pg_stat_statements` shows Gutenberg's read at mean 54 s, max 110 s, and Darwin's at mean 25 s, max 67 s; a read that runs past 120 s is cancelled and never recorded there.
**Fix:** PR #2841 reads each agent in its own savepoint with a 90 s limit and restores the step's limit afterwards. A read that fails leaves an empty section with a broken "numbers are read" rule; the other agents, Darwin's backlog included, are stored.
**Lesson:** A report that gathers several independent reads must isolate each one, so a slow or broken read costs only its own line and says so.
**Guard:** `src/lib/agents/agent-health.test.ts` ("keeps every agent's section when one agent's read times out").
**Agent lesson:** atlas/scoreboard-health-read-per-agent
