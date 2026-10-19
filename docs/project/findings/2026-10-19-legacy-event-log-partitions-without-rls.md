# 2026-10-19: monthly partitions of the legacy event log were created without RLS
**What happened:** a read-only audit on Oct 19 found RLS off on `agent_events`, `agent_auth_log`
and their `_2026_10` and `_2026_11` partitions. The older partitions had RLS on. No table has
policies, and only `postgres` and `service_role` hold grants, both of which bypass RLS. Nothing
was exposed through the Data API, but every new month added two more tables without RLS. The
same audit found four leftover pg_cron jobs. `seed-discovery-queue` failed 7 of 7 days because
`crawl_targets` was gone. `cleanup-old-jobs` deleted 0 rows each week because the 42,069 `jobs`
rows are failed or pending, not completed. `agent-review-knox` and `agent-review-darwin` had
written 55,966 `review_tick` rows into the retired `agent_events` table, and nothing reads them.
**Cause:** `maintain_agent_events_partitions()` and `maintain_agent_auth_log_partitions()` run
`CREATE TABLE ... PARTITION OF` with no `ENABLE ROW LEVEL SECURITY`. A partition does not inherit
its parent's RLS setting. The four cron jobs were created by hand, outside the migrations, so no
cleanup of the old crawler and review loop removed them.
**Fix:** migration `20270110000068_legacy_event_log_rls_and_cron_pause.sql`, held for James's yes.
It turns on RLS on both parents and every partition, makes both maintainers turn on RLS for each
partition they create and pins their `search_path`, removes `service_role`'s EXECUTE on them,
and pauses the four jobs with `cron.alter_job(active := false)`.
**Lesson:** a function that creates tables has to set the same security as the tables it copies.
pg_cron jobs belong in migrations so a cleanup can find them.
**Guard:** `src/lib/agents/legacy-event-log-rls.test.ts` fails if the newest migration
definition of either maintainer stops turning on RLS or pinning `search_path`.
