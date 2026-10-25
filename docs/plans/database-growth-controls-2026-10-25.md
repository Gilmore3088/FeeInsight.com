# Database growth controls — October 25, 2026

Status: implementation candidate on `codex/database-growth-controls`; production rollout is not active.
Existing owners: Foundation #1808 (log growth), Hoovie #2225 / #1783 (public data), and the archive foundation from closed #1870.

## Changes

1. FDIC/NCUA financial and detailed call-report upserts compare every field they update, except ingestion run and observation timestamp. A successful unchanged recheck retains its original row and is recorded in the partition receipt. NCUA matched/unmatched counts describe input linkage independently of rows actually written. Existing POR filing-certificate assignment remains authoritative.
2. Migration `20270110000078_public_data_storage_compaction.sql` adds a version-preserving metadata dictionary, a private invoker view and bounded conversion/expansion functions. New observations can share descriptions and schedules; numeric values, units, period basis, original IDs and source lineage remain on the observation. Compatible readers fall back to the original table before migration. Historical conversion preserves the original observation timestamp. No backfill is executed by the migration.
3. HMDA detail uses versioned tuples, retaining all nine statistics for all four metrics. A decoder accepts the legacy and compact formats and refuses malformed evidence. Existing named scalar columns are unchanged. The manifest-pinned 2025 year remains in the original format and is excluded from historical compaction. Historical batches compare exact before-images, at most 5,000 rows per table per storage step; invalid records are retained and counted.
4. Archive policy keeps twelve newest report dates per regulator hot. Exports are ordered, deterministic gzip, with content-addressed keys and read-back verification. Pruning compares the verified file with current logical rows under a short-wait writer lock; removal and the index transition are atomic. POR certificate/update witnesses remain hot to protect historical FDIC identity and reconciliation. The ingestion function blocks reintroduction of archived financial detail. The cold-file index is reread for each query so new archives appear immediately. Export and pruning remain off.
5. Re-entry into the same ledger step suppresses identical free extract/verify/publish receipts. Separate runs and steps, paid attempts, discovery/fetch/read retries and changed outcomes remain separate; playbook folding still runs. The existing 30/60/90-day retention policies are unchanged. No existing logs are removed by this release.
6. National fee summaries use joins for unique text and holding-company identity; peer eligibility materializes one approved institution set per statement. There is no cross-tenant cache and no change to fee eligibility, denominators, shared-schedule rules or peer ranking. No indexes are dropped.

## Read-only production measurements

Project `rmhwbbjjctzfaqjyhomu`; measured October 25. Occupied database: 16,216,698,003 bytes at the first audit, not provisioned disk capacity.

| Evidence | Before | Candidate | Limit |
|---|---:|---:|---|
| HMDA JSONB, 5,000 sampled rows | 864 average bytes | 476 average bytes | About 45% less payload; not a measured whole-table shrink; 2025 excluded |
| Nearest 20 bank peers | 1,641.272 ms | 1,207.253 ms | One warm-cache EXPLAIN ANALYZE each; not an SLO |
| Peer membership difference | — | 0 | Same query parameters, read-only comparison |
| Existing eight-quarter archive estimate | 1,675 MiB | Not the proposed deletion scope | Twelve-quarter policy moves less; current exact plan required |

Do not add dictionary, HMDA and archival savings without accounting for overlap, indexes, free pages and the actual period population. Deletions/updates primarily make pages reusable; they do not automatically reduce provisioned disk charges. Do not run VACUUM FULL, REINDEX, drop indexes or resize compute/disk as part of this rollout.

## Review and rollout

1. Run guards, typecheck, lint, full unit suite, agent suite and isolated PostgreSQL integration tests. Review the exact diff against current main. Keep this migration-dependent PR unmerged until the schema rollout is approved.
2. Deploy compatible readers before applying migration 78. Ensure old workers are drained before allowing metadata compaction or pruning. Verify dictionary-expanded facts equal originals and capture the current table/index sizes. The migration sets a 3-second lock timeout; retry it later if busy, rather than increasing the timeout indiscriminately. It also proposes 2% autovacuum/analyze scale factors on the two update-heavy filing tables; this is a production configuration change.
3. Enable only `STORAGE_COMPACTION_LIVE` first, after approval. Inspect a single completed storage-step receipt and original/expanded equality before permitting more batches. Monitor WAL, latency and dead tuples. Calls remain in the existing run ledger and obey its pipeline pause. Failed savepoints do not advance successful cursors.
4. Run the archive planner with twelve periods hot. Record each source/date, exact row count, estimated bytes, archive hash, reader parity and retained POR count. Enable export separately, verify one file, and rehearse restore before approving pruning. Enabling the boolean alone is not authorization for every future deletion.
5. Before the first prune, confirm every consumer needing old detail uses the cold path or is covered by the twelve-quarter/POR retention policy. Corrections to an archived financial period require restoring it first; a loader must not silently recreate it. A file failing checksum, current-row comparison, coverage, row cap or lock deadline stays hot.
6. Prune one verified period per storage step only after the reviewed manifest is approved. Read it through Hamilton's historical query path after commit. Retain the R2 file and its index. Validate row counts, canonical identity, amounts, source/period and units against the pre-prune result. Keep provider and billing settings unchanged.

## Rollback and stop conditions

Turn compaction/export/pruning switches off on any wrong figure, identity mismatch, archive failure or unacceptable write latency. These switches do not undo previously committed work. Keep compatible readers and the private view installed while compact rows exist. For a code rollback that removes those readers, pause the owning writers and run the bounded `expand_call_report_item_metadata` function through an approved ledger task until no compact rows remain, then verify source/fact equality. The HMDA decoder reconstructs named objects exactly; preserve the 2025 repair manifest hold.

Archived files remain the historical read authority. `restoreCallPeriod` and the server-owned `CALL_PERIOD_RESTORE_TARGET` provide the existing storage step's rollback path; its default target is null and a restore pass never exports or prunes. Before enabling deletion, rehearse a ledger-owned restore from the verified file into a disposable database, preserving original IDs and values and retaining any newer POR witnesses. A restore clears `pruned_at` only after the entire period has been restored and verified in the same transaction. The isolated PostgreSQL restore rehearsal passed, including original IDs, values, microsecond timestamps and idempotent retry. Production pruning stays off until the production-file rehearsal and current consumer acceptance are recorded.

## Validation record

Validated against main base `f9aadb79` on October 25: full suite 1,324 files / 17,754 passing tests (90 files skipped, 12 expected failures); agent suite 68 files / 1,892 passing tests; isolated PostgreSQL 2 files / 9 passing tests; typecheck and guards passed; lint had zero errors and 76 existing warnings. The real-Postgres suite covers dictionary/fact equality, unchanged writes, metadata expansion, archive atomicity, refusal after source changes, no resurrection, retained POR identity and fee-query parity. Pure tests cover the HMDA codec and same-step attempt scope. Production queries used for this work were read-only; no production migration, conversion, upload, deletion, index change or billing change has been performed.
