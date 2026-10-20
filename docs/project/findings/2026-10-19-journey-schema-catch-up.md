# 2026-10-19: The Hamilton journeys ran on a schema missing everything added since 2026-10-04

**What happened.** The answer journey (`tests/e2e/hamilton/answer-workflow.pw.ts`, #2045) could
not test the decision step. Its fixture database is `tests/e2e/production-schema.sql`, a copy of
prod from 2026-10-04, and the decision tables came later
(`20270108000001_hamilton_decision_workspace.sql`). The step was cut back to a visibility check
and filed as #2170. On 2026-10-19 a fresh snapshot load had 146 public tables and the catch-up
below brought it to 227, so 81 tables were missing, seven of them Hamilton tables (the decision
workspace among them). The fee alert functions were missing too, so Watch failed on the fixture
database. Prod has them from `20260813062152_physical_institution_data_contracts.sql`, which
skips a database built without the legacy tables, so replaying it cannot add them.

**Cause.** The snapshot is refreshed by hand (the 2026-10-06 entry in `FINDINGS.md`), so each new
table, column and function stays missing until someone adds it. The journeys are not in CI, so the
gap went unseen, and three journey checks had drifted from the app as well.

**Fix (#2170).** Before seeding, the journey setup (`tests/e2e/hamilton/schema-catch-up.ts`)
applies, in file order, every migration the fixture database has not recorded, and records each
one in `supabase_migrations.schema_migrations`, as Supabase does on prod. On a fresh snapshot this replays
140 of 145. The other five are recorded without running, because the snapshot already carries
later versions of their catalog views and columns; replaying them fails. The one piece lost is an
index from `20270110000032` that no journey needs. A second run applies none. The snapshot now carries the two fee alert functions.

Today's schema made two more fixture steps fail, and both are fixed:
- Teardown issued a `DELETE` on every table with a user or institution column. The normalized
  witness table refuses any `DELETE` statement, so teardown now deletes only from tables that
  hold fixture rows.
- The login limit (10 attempts per account in 15 minutes) now applies. The suite signs in more
  often than that, so its sign-in helper clears the local database's earlier attempts first.

With these fixes, 28 of the 29 journeys pass locally. The one still failing is the billing-access
action inventory: ten report and simulate actions became callable from the browser but are still
listed as server only. That gap predates this fix and is tracked on #975.

**Guard:** `tests/e2e/hamilton/schema-catch-up.test.ts` fails when a migration the fixture
database has not recorded no longer applies, or when the decision tables or the fee alert function
are missing after catch-up. The answer journey fails if the decision step stops writing its event.

**Still open.** The CI database tests (`E2E_TESTS` in `.github/workflows/test.yml`) still load
only the snapshot. A full refresh from prod, the open item in the 2026-10-06 entry, would close
that gap too.
