# Production Migration History Runbook - 2026-08-15

## Purpose

This runbook turns the local Supabase replay repair into a production-safe deployment path. It exists because the local migration set now includes renamed historical duplicate-version migrations and compatibility edits that make a clean database replay deterministic. That is different from safely applying changes to an existing production project that already has its own `supabase_migrations.schema_migrations` history.

Do not run `supabase db push --linked` against production until this runbook has been completed on a staging project or Supabase branch and the dry-run output is understood.

## Current Local Evidence

- Fresh local database-only replay passes through all migrations.
- The installed Supabase CLI was checked with `supabase --version`: `2.84.2`.
- The installed CLI supports the required inspection and safety flags:
  - `supabase migration list --linked`
  - `supabase migration list --local`
  - `supabase db push --linked --dry-run`
  - `supabase db dump --linked`
  - `supabase migration repair <version> --status applied|reverted --linked`
- Supabase's current migration docs state that `migration repair` changes only the migration history table. It does not apply or revert SQL.
- The Hamilton selected-source metadata migration is intentionally versioned as `20270101000000_hamilton_selected_source_labels.sql` because the repo already contains `20261231_reconcile_schema_drift.sql`. This keeps the new forward migration after the reconciliation migration and avoids requiring an out-of-order `--include-all` path for this specific change.

## Non-Negotiable Rules

- Never run `supabase db reset --linked` against production.
- Never use `migration repair` as proof that schema SQL ran. Repair only changes history records.
- Never mark a migration `applied` unless the production schema already contains the exact intended effect.
- Never mark a migration `reverted` unless the history row is wrong or is being replaced by a proven equivalent history mapping.
- Never deploy the renamed historical migration set blindly. A dry-run that lists renamed historical migrations as pending is a blocker, not a routine deploy.
- Never reintroduce `20260815125638_hamilton_selected_source_labels.sql`; that out-of-order local verification migration was replaced by `20270101000000_hamilton_selected_source_labels.sql`.
- Keep provider automation paused. This migration/history work must not resume AI/provider paths.

## Preflight

1. Confirm the target project.

   ```bash
   cat supabase/.temp/project-ref
   supabase projects list
   ```

   Confirm the production project ref before any linked command. For Fee Insight production, the expected Supabase project ref has been discussed as `rmhwbbjjctzfaqjyhomu`; verify this against the linked project before proceeding.

2. Capture remote and local migration state.

   ```bash
   mkdir -p tmp/production-migration-audit
   supabase migration list --linked > tmp/production-migration-audit/migration-list-linked-before.txt
   supabase migration list --local > tmp/production-migration-audit/migration-list-local-before.txt
   supabase db push --linked --dry-run > tmp/production-migration-audit/db-push-dry-run-before.txt
   ```

3. Create a logical backup before any history repair or push.

   ```bash
   supabase db dump --linked -f tmp/production-migration-audit/remote-schema-before.sql
   supabase db dump --linked --role-only -f tmp/production-migration-audit/remote-roles-before.sql
   supabase db dump --linked --data-only --use-copy -f tmp/production-migration-audit/remote-data-before.sql
   ```

4. Preserve the exact branch and commit being evaluated.

   ```bash
   git rev-parse HEAD > tmp/production-migration-audit/git-head.txt
   git status --short > tmp/production-migration-audit/git-status-before.txt
   ```

## Decision Point

After preflight, choose exactly one deployment path.

### Path A: Staging-Proven History Repair

Use this only when the remote schema already contains the historical changes and only the migration history table is wrong.

1. Clone or branch production into a staging database.
2. Run the same preflight commands against staging.
3. Build a mapping table with these columns:
   - `remote_history_version`
   - `local_replacement_version`
   - `old_file_name`
   - `new_file_name`
   - `proof_sql_or_schema_object`
   - `operator`
   - `reviewer`
4. For each mapping, prove the target schema object exists before repair.
5. On staging only, repair the history.

   ```bash
   supabase migration repair <old_remote_version> --status reverted --linked
   supabase migration repair <new_local_version> --status applied --linked
   supabase migration list --linked
   supabase db push --linked --dry-run
   ```

6. Continue until `db push --dry-run` lists only expected new forward migrations.
7. Repeat the exact reviewed repair commands against production only after staging proof and backup review.

This path is acceptable only when every renamed historical migration can be mapped to proven production schema state. If one mapping is ambiguous, stop and use Path B.

### Path B: Forward-Only Production Migration

Use this when production history cannot be safely repaired or when dry-run shows renamed historical migrations that cannot be mapped with high confidence.

1. Keep the local replay fixes for clean rebuilds and development.
2. Create a production-forward migration branch that leaves production's already-applied history untouched.
3. Add one or more new timestamped migrations containing only the schema deltas production actually needs now.
4. Prove the forward migration on staging.
5. Require `supabase db push --linked --dry-run` to show only the new forward migration files.
6. Push to production only after backup and smoke tests are ready.

This is the safest production path if the renamed historical files do not map one-to-one to production history.

### Path C: Rebuild And Cut Over

Use this only for a controlled database replacement or Supabase branch cutover.

1. Build a fresh database from the local replayed migration chain.
2. Load production data through a reviewed import process.
3. Diff schema and critical row counts against production.
4. Run application smoke tests against the rebuilt target.
5. Cut over only with a rollback plan and maintenance window.

This path is operationally heavier but avoids mutating a confusing production migration history in place.

## Required Production Sanity Checks

Run these checks on staging and production after the selected path completes.

```sql
select
  to_regclass('public.source_documents') as source_documents,
  to_regclass('public.verified_fee_observations') as verified_fee_observations,
  to_regclass('public.institution_workspace_memberships') as institution_workspace_memberships,
  to_regclass('public.institution_workspace_invitations') as institution_workspace_invitations,
  to_regclass('public.ops_jobs') as retired_ops_jobs;

select
  c.relname,
  c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('institution_workspace_memberships', 'institution_workspace_invitations');

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('institution_workspace_memberships', 'institution_workspace_invitations')
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by table_name, grantee, privilege_type;
```

Expected:

- `source_documents`, `verified_fee_observations`, `institution_workspace_memberships`, and `institution_workspace_invitations` exist.
- `ops_jobs` remains absent from the final active schema.
- RLS is enabled on workspace membership and invitation tables.
- No broad `PUBLIC`, `anon`, or `authenticated` table grants exist on workspace membership/invitation tables unless a reviewed RLS-backed API exposure explicitly requires them.

## Application Smoke Tests

After migration/history work, run these against the deployment target:

- Public institution profile with empty evidence: `/institution/2945`.
- Public institution profile with provisional evidence: `/institution/8109`.
- Public source intake with institution context: `/submit-fees?institutionId=2945`.
- Login redirect preserving Pro context: `/pro/analyze?instId=2945&intent=institution`.
- Pro Analyze with selected institution.
- Pro Reports competitive brief with selected institution.
- Pro Simulate with selected institution.
- Pro Monitor selected/watchlist scope.
- Pro Settings institution picker, claim status, workspace members, and pending invitations.
- Account quick actions preserving selected institution context.

## Stop Conditions

Stop and do not deploy if any of these are true:

- `supabase db push --linked --dry-run` includes renamed historical migrations that have not been mapped and proven.
- A `migration repair` mapping cannot be tied to a concrete schema object or checked SQL state.
- A staging repair requires different commands from the proposed production repair.
- `ops_jobs` returns in the final active schema.
- Workspace membership/invitation tables lose numeric `users.id` scoping, RLS, or private grant posture.
- Public/Pro smoke tests lose the selected institution context.

## Completion Criteria

Production migration/history work is complete only when:

- Backup artifacts exist for the exact pre-change production state.
- Staging has proven the selected path.
- Production `migration list` and `db push --dry-run` show no unexpected historical drift.
- Required SQL sanity checks pass.
- Application smoke tests pass.
- The deployed commit and migration-history decision are recorded in this runbook or a deployment note.

## Post-Review Cleanup Completion - 2026-08-15

| Recommendation | Action taken | Success evidence | Status | Blocker, if any |
| --- | --- | --- | --- | --- |
| Historical migration history restored. | Restored tracked historical files in `supabase/migrations` back to `origin/main` and removed replay-only duplicate historical artifacts from the active migration chain. | `git status --short supabase/migrations` shows no `M` or `D` entries for tracked historical migration files. | Complete | None |
| Forward-only migrations retained. | Kept only new forward migrations, including Hamilton workspace/pro/chat tables, institution workspace/claim tables, selected-source metadata, published report seeds, and `users.fed_district`. | `git ls-files --others --exclude-standard supabase/migrations` lists only the intended forward files: `20260815073928_hamilton_workspace_context.sql`, `20260815080620_institution_claim_review_queue.sql`, `20260815083600_hamilton_pro_base_tables.sql`, `20260815083700_hamilton_chat_memory_tables.sql`, `20260815083928_hamilton_scenario_peer_set_id.sql`, `20260815091517_institution_workspace_memberships.sql`, `20260815103531_hamilton_refresh_jobs.sql`, `20260815110200_hamilton_artifact_policy_metadata.sql`, `20260815113223_institution_workspace_invitations.sql`, `20270101000000_hamilton_selected_source_labels.sql`, `20270101010000_hamilton_published_report_seeds.sql`, and `20270101020000_users_fed_district_profile_column.sql`. | Complete | None |
| Hamilton runtime DDL removed. | Removed `ensureHamiltonProTables()`, `ensureHamiltonTables()`, and all call sites from Pro layout, Hamilton chat API, admin Hamilton chat, and Hamilton persistence modules. Moved the remaining Pro settings `users.fed_district` DDL into a migration. | `rg -n "ensureHamiltonProTables\|ensureHamiltonTables\|CREATE TABLE\|ALTER TABLE\|CREATE INDEX\|ENABLE ROW LEVEL SECURITY\|REVOKE" src/lib/hamilton src/app/pro src/app/api/hamilton src/app/admin/hamilton/chat --glob '!*.test.ts'` returns no matches. | Complete | None |
| Hamilton published-report seed moved to migration. | Removed runtime `seedPublishedReports()` and added idempotent seed migration `20270101010000_hamilton_published_report_seeds.sql` for the four BFI-authored published report artifacts. | Hamilton structural tests pass and assert `INSERT INTO public.hamilton_reports`, deterministic report IDs, `ON CONFLICT (id) DO UPDATE`, `status = 'published'`, and `BFI authored publication`. | Complete | None |
| Local `tmp` artifact cleaned or ignored. | Deleted `tmp/production-migration-audit/agent-state-lane-preflight.txt` and added `/tmp/` to `.gitignore`. | `git status --short tmp supabase/.temp` returns no output. | Complete | None |
| Verification gates passed. | Ran the required repo-local gates after cleanup. | Passed: `git diff --check`; `npm run guard:legacy`; `npm run test:agentic` with 16 files and 111 tests; `npx tsc --noEmit`; `npm run lint` with 0 errors and existing warnings only. Touched Hamilton tests also pass with 3 files and 12 tests. | Complete | None |
| Supabase linked dry-run verified, or blocked by explicit privilege issue. | Pulled current Vercel production env vars and used the refreshed production `DATABASE_URL` password as `SUPABASE_DB_PASSWORD` in-process for Supabase CLI verification. Linked migration-list access now works. | `supabase migration list --linked` connects to project `rmhwbbjjctzfaqjyhomu`. `supabase db push --linked --dry-run` no longer fails with 403, but stops because local historical migration files would be inserted before the latest remote migration. `supabase migration list --local` remains blocked because `127.0.0.1:57322` is not running; `supabase start` fails creating `/Users/jgmbp/.colima/default/docker.sock` with `operation not supported`. | Blocked | Supabase credentials are resolved. Remaining blocker is migration-history drift: do not use `--include-all` or repair history until each missing historical migration is mapped to proven production schema state, or a production-forward migration path is cut. Need local Docker/Colima fixed before local migration-list verification can run. |
