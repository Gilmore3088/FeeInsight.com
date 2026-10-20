# Darwin recheck could report effects that did not commit (#2072)

At source `faa7f11884e7c1957b402aa616675b248e57a1db`, a status-qualified restore
without RETURNING still appended the verified ID when a native trigger suppressed its
UPDATE. Separately, confirmation feedback survived a later native archive exception,
while a terminal recheck attempt could suppress the ordinary retry. The corrected
old-source four-case fixture proves those two independent defects and an ordinary restore
positive. Its reject case did not establish a no-op-reject defect: the synthetic line passed
the current checker and failed only its terminal-attempt expectation. Preserve that limit.
The first fixture run had JSON serialization/temp-function setup failures and is not
counted as causal evidence. Both runs and all six original runtime hashes are retained.

The old causal proof used TEMP TABLE AS SELECT clones: actual native SQL and production
column types, without production constraints. The permanent settlement suite uses real
production-schema constraints, run/step/source foreign keys, savepoint rollback and shared
rows for two-connection drift/contention. Its final verification is recorded separately;
no old temp-clone proof is represented as full-schema validation.

Full-row stamps witness selected-state drift; they do not certify a declared source hash,
original historical provenance, latest-bank freshness or global source authority. Current
stored source identity is bound to the actual artifact used by this check.

The fix attests the existing selected batch, requires current selected identities and
strict actual feedback/UPDATE/attempt persistence, and writes a bounded producer event in
the same recheck transaction. Row failures remain unresolved without terminal suppression;
a failed batch witness rolls back recheck effects while ordinary verification remains.
A later saved step receipt references the actual producer event. It does not certify a new
measurement, whole-backlog completion, old review, source freshness or policy activation.
Pending, waiting and other-code counts remain visible as assessments without a final fee
decision. The event carries only bounded fixed-shape witnesses and safe samples. The current
shape's conservative byte bound is below its defensive payload cap; no native cap-branch
coverage is claimed from an artificially inflated fixture.

**Guard:** `src/lib/agents/darwin/verified-recheck.db.test.ts`,
`src/lib/agents/darwin/verified-recheck.test.ts`,
`src/lib/agents/darwin/verified-recheck-receipt.test.ts` and
`src/lib/agents/run-store.test.ts` cover actual effects/rollback/retry/current identity,
legacy policy controls, safe v1/v2 projection and the connected saved receipt boundary.
The native suite is excluded from unit shards and registered once in the SQL CI job.

No rule version, paid/default-off policy, reason allowlist, 12-hour gate or historical
suppression floor changes. Canonical #2072 and Darwin #1110/#1111 remain open. No production
execution, switch change, source/provider call or eight-case historical adjudication is
included. The change creates no additional James queue.
