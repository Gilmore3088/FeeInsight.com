# 2026-10-27: Hamilton's health probes measured the morning brief, not Hamilton

**Lesson:** a health probe that shares a small connection pool with other work times the queue
for a connection, not the path it checks. Run it on its own, with the pool free, inside a known
time budget.

**How it was found:** reading the daily-brief steps' `hamilton_health` detail in the run ledger
after #2602 merged (the check added for #1921).

| Brief | database probe | Ask probe | export probe | Whole brief |
|---|---|---|---|---|
| Oct 24 (before the check) | n/a | n/a | n/a | 22 s |
| Oct 25 | passed, 15,953 ms | **failed: took longer than 20 seconds** | passed, 487 ms | 24 s |
| Oct 26 | passed, 17,870 ms | **failed: took longer than 20 seconds** | passed, 603 ms | 22 s |

So "Hamilton Ask check failed" went to James on both mornings. The probes' SQL is not slow:
`EXPLAIN ANALYZE` on prod (Oct 27) ran the Ask probe's institution pick in 0.48 ms and the
database probe's `SELECT 1 FROM published_fee_catalog LIMIT 1` in 0.45 ms. The export probe, which
uses no database, passed in under a second.

**Cause:** `runDailyBrief` started the probes inside the same `Promise.all` as about 15 other
brief reads (pipeline health, funnel, goal scorecard, quality ledger, source health and so on).
The app's pool holds five connections (`DATABASE_POOL_MAX`, default 5), and those reads take
about 20 seconds together (the whole Oct 24 brief, without the probes, took 22 s). The database
probe's seven reads and the Ask engine's reads queued behind them. The cause is inferred from
these timings. Nothing logged pool waits directly.

**Fix (#1921 follow-up):** the brief runs the probes after its other reads finish
(`briefHamiltonHealth` in `src/lib/agents/daily-brief.ts`). Each probe gets up to 20 seconds, cut
so the probes end by 45 seconds into the brief (`hamiltonCheckTimeoutMs`), which leaves the rest
of the route's 60 seconds for the step record and the email. With under 5 seconds left the probes
are not started, and the brief says the check could not run, which still reaches James.

**To confirm:** the first brief after the fix merges should carry `hamilton_health` with the Ask
probe passing and the database probe in well under a second. If the Ask probe still times out
with the pool free, the slowness is in the Ask engine's own reads (`getFeeResearch`), and that is
a real finding for the Hamilton lane.
