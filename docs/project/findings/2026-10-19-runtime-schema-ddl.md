# 2026-10-19: request code still created schema
**What happened:** the 2026-10-19 data estate audit (#2234) found `ensureResearchTables()` in
`src/lib/research/history.ts` running four CREATE TABLE IF NOT EXISTS and six CREATE INDEX
statements on every public article render and seven admin research pages, and
`ensureNewsTable()` in `src/lib/data-store/news.ts` creating `reg_articles` on each
`storeArticles` call. The tables already come from
`supabase/migrations/20260406_report_jobs.sql` (and `20261004163709_research_usage_baseline.sql`),
sometimes with different column types, so the runtime copy could only drift from the migrated
schema and put DDL on a public read.
**Cause:** SQLite-era "create on first use" helpers survived the move to migrated Postgres, and
no guard blocked DDL in `src/`.
**Fix:** #2234 removes both helpers and every caller; a missing table now fails with Postgres's
own "relation does not exist" error instead of being created silently.
**Lesson:** schema changes go in `supabase/migrations` with James's approval, never in request
code. A table with no migration is reported, not created at runtime.
**Guard:** `scripts/ci-guards.sh runtime-ddl-kill` (in `npm run guard:legacy`) fails on
CREATE/ALTER/DROP TABLE/INDEX/SCHEMA/VIEW/... in non-test `src/` code; tested in
`scripts/ci-guards.test.ts`.
