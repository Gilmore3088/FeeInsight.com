# Hamilton fixture catch-up must restore flattened partition structure

**Root cause (#1048):** `tests/e2e/production-schema.sql` captures the legacy `agent_events` and
`agent_auth_log` parents and monthly/default tables as ordinary tables. It omits their partition
relationships and maintenance functions. Catch-up replayed `20260417_agent_events_partitioned.sql`
against that flattened representation, so `PARTITION OF agent_events` failed before browser setup
could seed its synthetic accounts. Treating all old migrations as safely repeatable was incorrect.

**Lineage evidence:** the inspected loopback fixture database had an empty
`public.schema_migrations` table, whose key is `filename`, not `version`. The independent fixture
replay ledger in `supabase_migrations.schema_migrations` held only the earlier successful replay
steps. The schema-only snapshot therefore supplied no production migration-history rows to import.
A date cutoff or an additional silently skipped migration would invent lineage and leave the
maintenance functions absent.

**Fix:** catch-up first restores only the two known empty flattened partition trees, using the
captured columns, types, constraints and indexes. Monthly bounds come from validated table names;
the captured default table is attached last. The repair is transactional and refuses nonempty
parents or children, unknown column shapes, explicit grants, RLS/policies and user triggers.
Dropping the temporary old parent uses `RESTRICT`; an external view or foreign-key dependency
aborts and rolls back the entire repair. Existing partitioned parents remain unchanged. The
original migration SQL then runs normally and creates the missing functions. Product migrations
and the snapshot SQL are unchanged; no production migration history is fabricated.

**Validation:** the real loopback setup reproduced the partition failure before the repair. After
the repair, pending migration replay completed, both trees were partitioned and both maintenance
functions existed; a second catch-up applied nothing. The normal Hamilton fixture seed/readback/
teardown tests also passed. Additional isolated-schema tests verify row preservation on refusal,
rollback with dependent views, unknown-shape rejection and idempotence. No further migration or
fixture-seed failure surfaced in these checks. Browser journey acceptance remains separate.

**Guard:** `tests/e2e/hamilton/schema-catch-up.test.ts` and
`tests/e2e/hamilton/fixtures.db.test.ts`, executed with the existing loopback-only fixture connection.
