# `ReturnType<typeof postgres>` breaks typecheck when unrelated code changes

**Found:** 2026-10-18, building #1924 step 3 (Hamilton dataset stamp).

**What happened:** after step 3 changed only Hamilton and dataset-stamp files, `npx tsc --noEmit` reported
TS2322 in five database tests it never touched (`fee-corrections`, `saved-output-fee-refs`, Knox
`reread`, Deming `knox-misses` and `playbook-contradictions`). Each declared its handle as
`ReturnType<typeof postgres>` and then assigned `postgres(url, { types: { numeric, json, text } })`.

**Cause:** `postgres` is overloaded and generic over its custom types. `ReturnType` of an overloaded
function picks one signature, which here is `Sql<{}>`. Whether TypeScript then accepts the typed
`Sql<{ numeric; json; text }>` depends on cached variance checks, and those depend on what else
the program checks first. Reverting any one of several unrelated step 3 files made the errors
disappear, so the error shows up or vanishes depending on unrelated code.

**Fix:** declare these handles with the types they really have:
`postgres.Sql<{ numeric: number; json: unknown; text: string }>`. These match the custom types
`src/lib/data-store/connection.ts` registers. New database tests should do the same rather than use
`ReturnType<typeof postgres>` with custom `types`.

**Guard:** `src/lib/data-store/db-test-handles.test.ts:20` (no test file declares `ReturnType<typeof postgres>` beside custom `types`)
