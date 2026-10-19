# Durable FDIC identity holds (#2266)

Prepared in draft PR #2253 under tracker #2225. All four release gates remain false. No
production data, schema, run ledger, queue, deployment or automation setting was changed.
The ten-bank manifest and its 10/10/85/39 bounds are unchanged.

The previous receipt-only hold could disappear when partition detail was replaced. Preserving
a stored LEI also let another matcher trust it after FDIC reported shared or conflicting
ownership. `institution_identity_holds` is independent of partition receipts and canonical
GLEIF link rows. Every row is an unresolved veto and immutable first-observation evidence.
Update, delete and truncate are rejected by a migration-backed trigger. RLS is enabled with
no public policies; anonymous/authenticated access is revoked. There is no runtime release,
expiry or automatic clearing operation in this change.

## Evidence and source completeness

The source producer checks raw records before NAME/profile filtering and write chunks. It
detects LEIs reported by multiple certificates or claimed by another preserved canonical
certificate (including inactive owners), stored/source LEI disagreements, and multiple
or mixed valid/missing LEI values for a certificate. The hold includes the certificate,
institution ID when known, reason, preserved stored key, all implicated/reported LEIs, source
owners/raw values, source URL, SHA-256, observation time and owning run ID. Evidence separates
publisher-reported records from preserved canonical ownership facts. The SHA-256 is of
sorted canonical JSON raw rows across all fetched pages, explicitly a logical snapshot rather
than HTTP response bytes. Repeated conflict identity keeps its first evidence; expansion
appends another veto. Lineage IDs do not cascade away if source or run rows are later retained
differently. A held certificate also blocks a subsequently created canonical institution.

Active-universe fetching refuses missing/malformed pagination metadata or records, changing
totals, short pages before the announced total, out-of-bounds totals, invalid certificate or
active flags, and exhausted pagination. Incomplete or failed source reads do not clear holds.
Missing LEIs alone do not invent evidence or replace known identifiers.

With future separately authorized hold collection, the producer fetches before its transaction,
locks `institution_sources` before the hold table, reloads current stored identifiers, and
persists conflicts before any own-LEI propagation. Both operations and the partition receipt
share the transaction. The actual uncancelled running FDIC registry run and step must own the
write, including a source pass with zero conflicts. Enabling own-LEI writes without durable
hold collection is refused. `FDIC_IDENTITY_HOLD_WRITES_ENABLED` is false in this release.

## Matching behavior

Matching reads every hold, including inactive and untracked FDIC owners. A held institution,
FDIC certificate or globally implicated LEI vetoes all routes. Candidate own and canonical
LEIs are checked as well as the incoming LEI, so RSSD, name/state or cached entity links cannot
bypass a conflict. Held owners stay in uniqueness indexes. HMDA decision snapshots include
the applicable immutable evidence; repair preview/apply refuse any held cohort member.

HMDA and GLEIF write phases stabilize canonical institutions and crosswalks before locking the
hold table and re-reading holds. GLEIF link writes serialize crosswalk changes; HMDA and
entity writers hold shared crosswalk locks through persistence. All lock waits and statements
are bounded, and network work finishes before locks. GLEIF checks final chunk writes, and family seeds, member labels
and trusted-coverage readers suppress held associations. When ordinary HMDA identity writes
are off, a held state partition fails before any database write; it cannot copy an old annual
ID into newly fetched child metrics even when the fresh resolver no longer finds that annual
institution. No existing production identifiers are cleared here.

Missing schema, corrupt hold evidence or more than 5,000 unresolved rows makes matching
unavailable; none is treated as an empty hold set. The bound is an explicit review limit.

## Release prerequisites

The new migration is `20261019163933_fdic_identity_conflict_holds.sql`, generated using the
project Supabase migration workflow. It creates empty schema only. Read-only inspection
confirmed production currently has no hold table and verified the relevant institution/run
columns. The migration has only been exercised on disposable loopback PostgreSQL fixtures.

Deployment is held until the schema migration is separately authorized and applied. Durable
evidence collection then needs its own reviewed bounded execution/authorization; the empty
table alone does not establish that historical conflicts have been collected. Broader own-LEI
and ordinary HMDA release must wait for that evidence review. Keep the existing bounded
pilot separately scoped, with fresh source/row/hold checks and explicit authorization before
any queue request or apply. Queueing even a preview writes ledger history.

Hold resolution requires a later reviewed design and separately authorized data action. A
rollback must preserve accumulated hold evidence; do not remove the table or bypass the veto
to make matching resume. No production release is implied by passing local or CI checks.

## Verification

Guards include default-off release assertions, producer/resolver and cached-family regressions,
and isolated PostgreSQL tests for the actual migration, first-evidence persistence, replay,
append-only protection, RLS/access, missing schema, running/cancelled ledger ownership,
transaction rollback, write-time hold locks, cross-state propagation and bounded repair.
Review findings #2300, #2301, #2302 and #2305 are fixed within this work. Final validation counts are recorded
in the PR review receipt.
