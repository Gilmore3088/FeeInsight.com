# Supabase Migration Baseline Runbook

## Current State

The migration history replays on an empty database (2026-10-06, PR 196). Production's
first tables were created before the history began, so the oldest file,
`20260406_report_jobs.sql`, now opens with a baseline: the public schema dumped from
production on 2026-10-04 (DDL only, no data), run only when `institution_sources` does
not exist. The eight files that rewrote the pre-2026-08-13 legacy tables
(`20260408_*` to `20260813063108_*`) skip themselves when `crawl_targets` is absent and
`institution_sources` exists, which is true only on a database built from that baseline.

Production applied all of these versions before the edits and never re-runs an applied
version, so nothing changes there. Supabase preview branches and `supabase db reset`
now build the current schema. Earlier, a clean replay failed at
`20260408_enable_rls_all_tables.sql` with `relation "agent_run_results" does not exist`.

## What This Release Fixes

`supabase/config.toml` is now committed so local Supabase commands use the
Fee Insight project id and a dedicated `573xx` port range. This prevents the
CLI from silently targeting another running local Supabase project on the
default `54321-54324` ports.

Expected local validation behavior after this config:

1. `supabase start` should create/use `feeschedule-hub` containers.
2. It should not attach to unrelated local stacks.
3. It currently still fails at the historical baseline gap above.

## Safe Production Posture

Do not run destructive reset commands against production:

```bash
supabase db reset --linked
```

Do not rewrite or reorder already-applied historical migration files in a
production release branch. That can make Supabase migration history harder to
reason about and can cause fresh, staging, and production databases to diverge.

PRs may ship against the current production database only when:

1. The live database already contains the required relations and columns.
2. New migrations are idempotent and safe on the live schema.
3. App build, tests, and production health checks pass.
4. The baseline gap is explicitly listed as a remaining disaster-recovery task.

## Baseline Recovery Path

Use a separate migration-recovery branch for this work.

Recommended path:

1. Create or choose a throwaway Supabase project or local Postgres database.
2. Capture the current production schema with schema-only tooling, not data:

   ```bash
   supabase db dump --db-url "$DATABASE_URL" --schema public --file /tmp/feeinsight-public-schema.sql
   ```

3. Review the dump before committing anything:
   - no production data,
   - no secrets,
   - no grants that should not be versioned,
   - no Supabase-managed schemas unless intentionally included.
4. Decide between one of these explicit strategies:
   - create a new canonical baseline snapshot for fresh environments and mark
     historical migrations as production history only, or
   - reconstruct the missing pre-`20260406` baseline so the existing migration
     chain replays from zero.
5. Verify on an isolated clean stack:

   ```bash
   supabase start
   supabase db reset
   supabase db lint --local --fail-on error
   supabase db advisors --local --fail-on error
   ```

6. Only after the isolated replay passes, update release guidance and remove the
   baseline caveat from PR descriptions.

## Current Release Checklist

Before merging a release that depends on Supabase:

```bash
git diff --check
npx tsc --noEmit
npx eslint
npx vitest run
npm run build
npm run guard:legacy
curl -fsS http://localhost:3000/api/health
```

Also verify Vercel production env metadata without printing secrets:

1. `DATABASE_URL` points at `rmhwbbjjctzfaqjyhomu`.
2. `NEXT_PUBLIC_SUPABASE_URL` points at `rmhwbbjjctzfaqjyhomu`.
3. Supabase key values do not contain literal `\n`.
4. The anon key is accepted by Supabase; direct public table access can still be
   denied by RLS/grants.
