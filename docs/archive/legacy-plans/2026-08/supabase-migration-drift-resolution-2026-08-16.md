# Supabase Migration Drift Resolution - 2026-08-16

## Objective

Resolve the linked Supabase migration drift for project `rmhwbbjjctzfaqjyhomu` so future normal deploy checks can run:

```bash
supabase db push --linked --dry-run --yes
```

without requiring `--include-all`, without Docker/local Supabase, and without replaying retired or duplicate historical migrations.

## Current Evidence

Generated artifacts:

- `tmp/api-hardening-audit-2026-08-15/supabase-migration-reconciliation.md`
- `tmp/api-hardening-audit-2026-08-15/supabase-migration-reconciliation.csv`
- `tmp/api-hardening-audit-2026-08-15/supabase-migration-reconciliation.json`
- `tmp/api-hardening-audit-2026-08-15/supabase-db-push-linked-dry-run.txt`

Observed starting state:

- Local migration files: 98
- Remote ledger rows: 23
- Linked dry-run backlog: 75 files
- Candidate ledger repairs after manual SQL review: 24
- Current migrations with missing production effects: 6
- Duplicate/version collision items: 25
- API hardening migration `20270101040000_api_hardening_budget_controls.sql` was already applied and present in the remote ledger.
- The four BFI Hamilton published reports already existed in production.

## Actions Taken

1. Repaired the 24 candidate migration versions in the linked Supabase ledger after confirming their parsed structural/data effects were already represented in production.
2. Created `supabase/migrations/20270101050000_production_current_schema_reconciliation.sql` as a forward-only migration for current missing effects.
3. Archived 51 non-candidate historical files under `docs/archive/supabase-migrations-2026-08-16`.

## Forward Migration Scope

The forward reconciliation migration:

- creates the production `published_fee_records` agentic live lineage dedup index,
- creates `institution_claims` and `institution_claim_events`,
- creates `institution_workspace_memberships`,
- creates `institution_workspace_invitations`,
- creates missing Hamilton chat/scenario indexes,
- enables RLS and revokes public/anon/authenticated grants on current Hamilton internal tables.

The migration is adapted to production schema drift:

- `users.id` is `bigint`,
- Hamilton artifact/user tables currently use `text` user IDs,
- the live published-fee table is `published_fee_records`, not retired `fees_published`.

## Non-Negotiables

- Do not run `supabase db push --linked --include-all` against production.
- Do not use Docker or local Supabase for this cleanup.
- Do not apply or repair anything against a Supabase project other than `rmhwbbjjctzfaqjyhomu`.
- Do not replay migrations that reference retired crawler, Modal, `ops_jobs`, rollback, or legacy compatibility paths.
- If any archived SQL effect is needed, create a new forward-only migration with only that effect.

## Verification

Completion requires all of the following evidence:

```bash
supabase db push --linked --dry-run --yes
```

passes without historical backlog and without `--include-all`.

```bash
supabase migration list --linked
```

shows the intended repaired historical entries and current forward migrations.

Direct database checks verify:

- current missing effects are present,
- RLS is enabled where expected,
- public grants are revoked on internal/admin tables,
- Hamilton seed rows remain present,
- no provider automation is resumed.

## Status — verified complete 2026-08-17

- `supabase db push --dry-run` against `rmhwbbjjctzfaqjyhomu` (via the project's `DATABASE_URL`,
  no `--include-all`): **Remote database is up to date.**
- `supabase migration list`: 48 local files, 48 remote ledger rows, every version matched
  (including `20270101050000_production_current_schema_reconciliation`); no backlog.
- Direct checks: `institution_claims`, `institution_claim_events`,
  `institution_workspace_memberships`, `institution_workspace_invitations`,
  `hamilton_conversations`, `hamilton_messages`, `hamilton_refresh_jobs`, `hamilton_signals`,
  `published_fee_records`, `automation_control` all present with RLS enabled;
  `published_fee_records_agentic_live_lineage_dedup_idx` present; anon/authenticated grants
  revoked on the listed Hamilton internal tables; 11 `hamilton_reports` seed rows intact;
  `automation_control.global.enabled = false` (provider automation not resumed).
- Repository side committed: 51 historical files archived under
  `docs/archive/supabase-migrations-2026-08-16/`; `migration-history-kill` and the
  `chat-memory` test read the archived files.
- Out of scope, noted only: `hamilton_digest_runs` / `hamilton_digest_subscriptions` (unused by
  `src/`) still grant anon/authenticated; lock down with a new forward migration if desired.
