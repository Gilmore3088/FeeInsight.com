# 2026-10-19: retain exact normalized text before replacement

**What happened:** the weekly audit found that a raw observation can still name an
artifact ID and text hash after a same-document reread has replaced that artifact's
normalized text. The current table intentionally contains one mutable row per source
document. A later text with the same fee amount cannot establish the original bytes.
Existing exact-witness callers correctly report the overwritten witness unavailable.

**Cause:** `recordReadResult` upserts the mutable current artifact without retaining
the previous exact text. A simple select followed by an upsert would also lose an
intermediate text during competing first inserts. An autocommit archive/update pair
would allow one side of the operation to survive a failure.

**Fix:** proposed [#2220](https://github.com/Gilmore3088/FeeInsight.com/issues/2220),
not applied to production. Migration 67 creates one empty private append-only table.
The shared ordinary/paid reader boundary inserts the current row if absent, locks it,
captures its hash-valid incumbent, replaces it, and captures the incoming text in one
transaction. An existing transaction uses a real savepoint. PDF repair retains its
outer transaction, including its persisted-artifact success marker. Once the table is
available, an archive failure aborts replacement; it cannot silently claim durability.
Missing schema is explicitly reported as `unavailable_schema` and retains the existing
current-only writer. A mismatched incumbent gives `unavailable_hash_mismatch` and is
never stored under the claimed hash.

The diagnostic resolver requires the exact artifact, text hash, source-document and
institution identities and rechecks the actual UTF-8 SHA-256. It returns current,
retained history, or an explicit unavailable reason. `captured_at` is retention time;
`originalReadAt` is always null. Source URL/hash, status, reader, run and artifact dates
are first-capture observations, not a complete history of read executions. Repeated
identical bytes do not replace that metadata. No existing fee, takedown, source-sweep,
release, public reader, selection query or benchmark gains historical authority.

**Lesson:** exact normalized bytes, captured metadata and current bank applicability
are separate claims. Preserve exact bytes at the write boundary before offering any
future historical consumer authority.

**Guard:** `normalized-witness.db.test.ts` exercises actual PostgreSQL first-insert and
reread races, root and transactional rollback, ordinary/paid shared writes, exact
history/unavailable resolution, owner and hash mismatch, deduplication, failed/empty
reads, status-only writes, role permissions and immutable normal DML. The actual
Oakwood PDF fixture additionally proves both witness inserts and the outer bound
success marker commit together or all roll back. The existing PDF owner and concurrent
settlement suites run with the witness schema installed. CI includes the new suite.
The complete shared-schema SQL inventory runs with `--maxWorkers=1`: these tests
temporarily rename schema objects and install transactional failure triggers, so
parallel files could observe another test's deliberate temporary fixture. This
preserves every suite, assertion and deadline. The initial 32-suite serial gate
passed 567 tests in 56.74 seconds; it is a test-isolation choice, not a runtime change.

## Privacy and normal-write immutability

The relation has RLS enabled, no PUBLIC/anon/authenticated privileges, and only
SELECT/INSERT for `service_role`. The table owner retains PostgreSQL owner powers.
A statement trigger rejects normal UPDATE, DELETE and TRUNCATE even for the owner;
the role regressions test the owner and backend role models. This is normal-DML
immutability: a DDL administrator can disable/drop the guard or table. There is no
SECURITY DEFINER function, public view, HTTP endpoint or change to current-table RLS.
Plain retained identities have no cascading foreign keys. Removing current artifacts,
source documents or runs does not erase the retained evidence.

The deployed application's actual database session role is **not yet proven**. The
read-only Supabase connector used `postgres`; that is not evidence of the Vercel
application's role. Confirm the deployed role and its exact append/select contract
through an existing supported deployment diagnostic/session before writer rollout.
Do not add a production endpoint or broaden privileges to bypass this preflight.

## Storage and retention posture

There is no automatic purge, retention duration, import, backfill or source replay.
On the next real replacement, an uncaptured valid incumbent is retained at that actual
time. Earlier overwritten text remains unavailable. Hash deduplication limits repeated
identical writes but does not bound changed-version growth.

A metadata-only production SELECT at 2026-10-19 18:14:24 UTC measured the database at
12,424,031,379 bytes (11,848.5 MiB), the current normalized-text table at 225,148,928
bytes (214.7 MiB including indexes/TOAST), and an estimated 27,795 current rows. The
witness table did not exist. This used relation sizes/catalog estimates, not a full-text
scan. The existing 13,000 MiB database warning therefore had approximately 1,151.5 MiB
of warning-threshold headroom; that is not a measurement of free provisioned disk.
Existing database growth warnings remain 300 MiB since the previous Atlas measurement.

Atlas additionally measures this private table through its existing inexpensive
relation-size path and warns above a **256 MiB review budget**. This warning does not
purge evidence, pause writers, change provider controls or hold a registry source.
Operators must review actual headroom and observed changed-version growth before
raising this budget or defining any future storage/retention policy. No forecast of
daily growth is claimed from the current-table estimate.

## Migration generation and approval boundary

The Supabase CLI 2.84.2 generated the new file using
`supabase migration new normalized_source_text_witnesses`, initially named
`20261019181207_normalized_source_text_witnesses.sql`. Before any application, it was
renamed to the repository's next sequence,
`20270110000067_normalized_source_text_witnesses.sql`, after applied migration 66.
No applied migration was edited. The SQL is schema-only with a five-second lock timeout;
it neither reads/copies existing normalized text nor changes the hot current table.

This repository's integration applies migrations on merge. Keep the migration PR
unmerged until James separately approves the exact reviewed migration and rollout.
Normal code-merge standing approval does not approve this production schema/permission
change. No production migration/application action is part of patch preparation.

## Reviewable rollout

1. Freeze the exact commit and migration SHA-256; compose the released PDF/performance
   parent and preserve the complete CI SQL-suite union. Obtain independent exact-head
   review and required checks. Confirm no competing migration claimed sequence 67.
2. Complete the deployed-session-role preflight above. Confirm its SELECT/INSERT path
   without expanding permissions. Recheck cheap database/table sizes and alert headroom.
3. Present the exact SQL, role contract, storage posture and rollback to James for the
   separate production approval. Until then, do not merge or apply the migration.
4. After approval, use the normal Supabase integration. Verify schema history, empty
   new table, hash constraints, RLS/ACL/trigger/function settings against approved SQL.
   Deploy the reviewed writer through the normal Vercel release. No manual seed or replay.
5. Observe a normal free read's sanitized `witness_retention` receipt and exact retained
   hash/owner match. Verify current row uniqueness/ID and the ordinary attempt outcome.
   Observe any naturally occurring paid read through the same boundary; do not activate
   a provider merely for a smoke test. The local accepted-paid fixture proves that path.
6. Check Atlas's next ordinary measurement for the table-size budget. A failed archive
   must leave the previous current row intact and the operation failed, not advertised
   as a durable successful replacement. Do not release a fee or enable a historical
   consumer as a consequence of witness availability.

## Evidence-preserving rollback

Redeploy the previously released application writer through the normal release path.
It resumes current-only behavior and makes no future retention promise. **Keep migration
67, the witness table, its bytes, RLS/ACL and immutability guard.** Do not run DROP,
TRUNCATE, DELETE, a migration-down script or a restore that discards captured evidence.
Existing diagnostic history can be inspected separately; the older application need
not consume it. If the new writer itself throws, its transaction/savepoint rolls back
the archive and replacement together. A destructive database rollback, evidence import
or later historical authority change requires its own review and approval.
