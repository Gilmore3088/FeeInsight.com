# Running the consumer_guides migration

The migration has been **validated against a real Postgres 16 instance** but not applied
to any of your environments — this session has no database credentials and no network
egress to Supabase. Everything below is the remaining step.

## What was verified, and how

A throwaway Postgres 16 cluster was created locally, the migration applied, and the real
application code run against it. This is not a dry read of the SQL.

| Check | Result |
| --- | --- |
| `20260815120000_consumer_guides.sql` applies cleanly | ✅ 3 tables, 11 indexes, 8 comments, no errors |
| RLS enabled on all three tables | ✅ |
| `anon` / `authenticated` / `PUBLIC` privileges | ✅ none — a draft is unreachable by an anonymous request |
| Consumer guide cannot leave the public tier | ✅ rejected by `consumer_guides_consumer_is_public_check` |
| Regulatory guide cannot publish unapproved | ✅ rejected by `consumer_guides_regulatory_gate_check` |
| Same guide publishes once approved | ✅ |
| Half an approval (approver without timestamp) | ✅ rejected by `consumer_guides_regulatory_approval_check` |
| Primary category repeated in related | ✅ rejected by `consumer_guides_primary_not_in_related_check` |
| Published guide without a review date | ✅ rejected by `consumer_guides_published_metadata_check` |
| Malformed slug | ✅ rejected by `consumer_guides_slug_format_check` |
| Duplicate section anchor within a guide | ✅ rejected by `consumer_guide_sections_anchor_unique` |
| Non-array `blocks` | ✅ rejected by `consumer_guide_sections_blocks_array_check` |
| Deleting a guide cascades its sections | ✅ |
| All 13 guides seed through the real `upsertGuide` | ✅ sections and blocks round-trip intact |
| `getPublishedGuides()` before any human publishes | ✅ returns 0 — agent drafts never reach readers |
| Approve → publish → revision snapshot | ✅ approver and timestamp recorded on the revision |
| Editing a published guide clears its approval | ✅ an agent never inherits a human's sign-off |
| `next build` with a live database | ✅ `● /guides/[slug]` prerendered |

**One real bug was found and fixed by doing this.** `${JSON.stringify(x)}::jsonb` does not
store a JSON array or object — the Postgres client serialises the JS string, producing a
jsonb *string*. `consumer_guide_sections.blocks` hit its `jsonb_typeof(blocks) = 'array'`
check on the very first insert. Both jsonb writes in `src/lib/data-store/guides.ts` now use
`sql.json(...)`, and `snapshot->>'slug'` resolves SQL-side as it should. The CHECK
constraint is what caught it, which is the argument for having written it.

## Apply it

Nothing here is destructive: three new tables, no changes to existing ones.

```bash
# Option A — Supabase CLI, from the repo root
supabase db push

# Option B — psql directly
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260815120000_consumer_guides.sql
```

`anon` and `authenticated` already exist on Supabase, so the `REVOKE` statements resolve
without preparation. (A plain Postgres needs those roles stubbed first — that is only
relevant to local testing.)

## Then seed

The public pages read Postgres and fall back to the typed catalog when the table is absent
or empty, so **the site is correct before, during and after** this step. Seeding is what
moves the source of truth.

Seed through the run ledger rather than a script, per `CLAUDE.md`. Each of the 13 guides
lands in `in_review`; nothing becomes visible until you publish it, and the consumer guides
carry regulatory content so each needs a recorded approval.

1. Apply the migration.
2. Open `/admin/hamilton/guides`. The "migration not run" banner should be gone and the
   list empty.
3. Trigger a `guide-draft` run per category, or seed the existing catalog through
   `upsertGuide`.
4. For each guide: review, **Approve regulatory content**, then **Publish**. The publish
   control stays disabled with a stated reason until approval is recorded.

Until step 4, `/guides` continues serving the typed catalog — same content, so readers see
no change.

## Verify after applying

```sql
-- Tables and RLS
SELECT relname, relrowsecurity FROM pg_class
WHERE relname LIKE 'consumer_guide%' AND relkind = 'r';

-- No anon/authenticated grants
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_name LIKE 'consumer_guide%'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC');   -- expect zero rows

-- The regulatory gate is live
INSERT INTO consumer_guides
  (slug, title, seo_title, description, primary_category, family,
   carries_regulatory_content, status, published_at, reviewed_at)
VALUES ('gate-test','T','T','d','overdraft','F', true, 'published', NOW(), NOW());
-- expect: violates check constraint "consumer_guides_regulatory_gate_check"
```

## Rollback

```sql
DROP TABLE IF EXISTS public.consumer_guide_revisions;
DROP TABLE IF EXISTS public.consumer_guide_sections;
DROP TABLE IF EXISTS public.consumer_guides;
```

The pages fall back to the typed catalog automatically, so dropping the tables returns the
site to its pre-migration behaviour with no deploy.

---

## Separate finding — a pre-existing bug outside this work

Worth a decision, and **not changed here** because it touches agent behaviour and needs a
data call on existing rows.

`${JSON.stringify(x)}::jsonb` appears at **18 call sites** across `run-store.ts`,
`publish.ts` and others, writing `agent_runs.params_json` and `agent_run_events.detail`.
Those columns therefore hold jsonb *strings*, not objects.

Reads through `safeJsonb()` (`src/lib/pg-helpers.ts`) survive it — the helper `JSON.parse`s
a string value, so the run console is unaffected. But two places query those columns
**SQL-side**, where a jsonb string silently yields NULL:

- `src/lib/agents/run-store.ts:986` — `params_json->>'state_code'`
- `src/lib/data-store/states.ts:258` — `arr.detail->>'reason'`

Demonstrated on the test instance:

```
jsonb_typeof | params_json->>'state_code'
-------------+---------------------------
object       | WA
string       | <NULL>        <-- what the current write path produces
```

So state-lane routing that depends on `params_json->>'state_code'` is reading NULL, and the
`detail->>'reason'` lookup in the states query returns nothing.

A fix has two halves and should be one deliberate change: switch the writes to
`sql.json(...)`, and either backfill existing rows
(`UPDATE ... SET params_json = params_json #>> '{}' ::jsonb` for string-typed rows) or guard
the two readers with `jsonb_typeof`. Happy to do it as its own piece of work.
