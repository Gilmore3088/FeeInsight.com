# 2026-10-19: an early required error left pending siblings unretained

**What happened:** #2338 records a local, source-level lifecycle defect after #2320's
deadline repair. With a real loopback HTTP response, the installed Next `after()` /
`AfterContext`, and a server-observed blocked PostgreSQL read, a different required
read's native error returned HTTP 500 before the pending read registered any lifecycle
promise. Its deadline registered retention about one second later, only because the
local Node process was deliberately kept alive. A deadline-only control registered
retention before its response. This establishes an unretained response-time interval;
it does not prove a Vercel process froze or explain the earlier Oakwood HTTP 500.

**Cause:** The budget retained a read only when that read lost its own deadline race.
A required sibling could reject much sooner and abandon the render's pending reads.
A synchronous factory error had the same seam, including when the pending sibling was
started by a later entry in the same `Promise.all` array.

**Fix:** Budgets with a retention adapter track only original, already-started unresolved
promises. A required rejection retains those siblings in its rejection microtask, before
propagating the same error. An optional error still returns its own fallback and does not
retain siblings; an optional deadline retains only its own abandoned work. Settled work
is removed. The public adapter still deduplicates a shared promise across layout,
metadata and page budgets. Retention starts no factory, query, retry or cancellation.

There is no poisoned or aborted budget state. A caller can catch a required error and
continue within the unchanged deadline. `remaining()`, optional `failed()`, eager/lazy
inputs, numerical budgets, factories, query expressions, fallbacks and cache controls
are unchanged. Callers without a retention adapter acquire no Next dependency.

**Caller boundary:** The public institution layout and metadata/page use the Next adapter.
Metadata explicitly catches a required error and returns degraded metadata. The homepage,
research hub, institution viewer/Pro actions, directory and state city explorer use the
framework-independent helper. They retain their existing continuation/fallback semantics;
this change does not extend retention to those callers or to an unbudgeted sibling such
as the city explorer's city-list read.

**Guard:** Pure tests cover immediate/synchronous required errors, later entries in the
same array, optional controls, catch-and-continue, settled work, shared promises, late
rejection and expired lazy factories. Public adapter tests cover cross-budget deduplication.
The existing native SQL suite now uses actual HTTP and the installed Next lifecycle,
with an observed PostgreSQL advisory-lock dependency. It checks retention at response
completion for a native required error, a synchronous factory throw and own deadlines,
plus an optional-error continuation control. Both late SQL success and failure settle,
release the owned lock and leave the same client reusable. No application rows are written.

**Limit:** Retention is bounded by the platform's request lifetime. It does not cancel SQL,
add capacity, guarantee that a query completes, or address all cold-cache/pool pressure.
The successful later Oakwood capture is separate production evidence, not causal proof
for either the earlier failure or this local defect.
