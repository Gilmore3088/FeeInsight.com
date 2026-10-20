# 2026-10-19: Rosetta artifact subwrites depended on witness capability

**What happened:** Four bounded native PostgreSQL controls on an owned UTF-8/TLS
fixture reproduced partial state when normalized-witness capability was unavailable.
A trigger failed the table-row or profile statement after the earlier text update had
executed. In both known-cost and unknown-cost paid-response cases, the new text stayed
committed despite the failed read. Each control first proved the precise later failure,
one returned provider receipt, the existing run accounting and no normal paid attempt;
it then failed the expected prior-artifact equality. The existing twenty cases were
unselected for this old-runtime run. No production source or provider was requested.

**Cause:** `recordReadResult` used the existing real transaction/savepoint helper only
when witness capability was ready. Its unavailable-schema branch called the same
multi-statement writer directly. That writer upserts the text, then writes the kind,
table/reader fields and main-source profile. A later statement could fail after an
earlier autocommit statement had already changed the artifact.

**Fix:** Related to the bounded process checklist in open #1050. Both capability paths
now use the existing `atomicTextWrite` helper. The readiness probe stays in its existing
position, unavailable capability still uses `retain=false`, and the ready branch,
writer and helper are unchanged. A root client starts a real transaction; an existing
caller transaction uses a real savepoint. A custom client with neither primitive fails
before the writer runs. No direct-write fallback is introduced. Releasing a savepoint
still depends on the caller's eventual outer commit. Companion reads keep the main
profile untouched, and legacy-column mode keeps its previous column behavior.

This prospective persistence change adds no schema, replay, provider call, retry,
policy/version bump or extraction rule. Witness capture stays capability-gated and
unavailable schema still reports no retained history. The ready-only owner/hash checks,
ordinary-reader selected-state concurrency guards and exact historical source fidelity
are not broadened. Those broader concerns remain under #1050/#1056/#2220/#1048 and the
separate repair/recovery work in #2313.

Provider accounting and paid attempts remain outside the artifact transaction. A
successfully committed provider receipt can survive a rolled-back artifact group;
normal paid result/attempt/summary creation can still be absent after storage fails,
and later selection can remain eligible. This is not global exactly-once settlement,
a no-retry guarantee or evidence that a failed/no-return request incurred zero cost.

**Lesson:** Optional diagnostic capability may control evidence capture, but must not
control whether the same primary artifact's subwrites commit together.

**Guard:** `src/lib/agents/rosetta/paid-read.db.test.ts` uses private random schemas on an
owned complete production-schema fixture. Private test tables use `LIKE INCLUDING ALL`,
copying types, defaults, checks and indexes, but not foreign keys. These controls do not
establish full foreign-key acceptance. Its four later-failure cases assert native
rollback after table/profile failures while retaining known/unknown provider receipts.
Ordinary root, savepoint/outer-rollback, explicit subsequent invocation, companion,
legacy-column and failed/null controls preserve the caller and storage contracts.
`src/lib/agents/rosetta/normalized-witness.db.test.ts` preserves active witness capture
and rollback, while the PDF repair SQL suites preserve their outer settlement guards.

**Guard:** `src/lib/agents/rosetta/read.test.ts` rejects a missing transaction primitive
before artifact writes. Existing ordinary/paid and actual installed-SDK fixtures retain
callback-only transaction facades; those facades do not prove SQL rollback. Native SQL
controls supply that proof. Existing paid response/tool/accounting policy is unchanged.
