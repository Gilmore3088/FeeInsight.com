# A bare `postgres.Sql` handle fails Vercel's type check at random

**Found:** 2026-10-25, Hamilton V5 merges (#2657).

**What happened:** production deployments of `main` for #2652, #2654, #2656, #2658 and #2659 all
ended in ERROR at "Failed to type check", so production stayed on #2651 (`06ff84a4b`) until #2660's
build passed. Branch previews failed the same way. GitHub's `checks` job (tsc) passed on every one
of those commits. The errors were in two Knox database tests none of those PRs touched
(`paid-returned-events.db.test.ts`, `symbolic-lesser-of-concurrency.db.test.ts`): `Sql<{ numeric;
json; text }>` is not assignable to `Sql<{}>`.

**Cause:** the same order-dependent variance check as
[2026-10-18](2026-10-18-postgres-returntype-in-db-tests.md). A handle declared as a bare
`postgres.Sql` is `Sql<{}>`; assigning it `postgres(url, options)` where `options` registers custom
`types` compiles or not depending on what TypeScript checked first. That rule's guard only caught
`ReturnType<typeof postgres>`, not the bare type.

**Fix:** handles that open with the app client's types are declared
`postgres.Sql<{ numeric: number; json: unknown; text: string }>` in nine database tests. Handles
opened without custom types stay `postgres.Sql`; files that cast with `as unknown as postgres.Sql`
are unchanged.

**Guard:** `src/lib/data-store/db-test-handles.test.ts` ("never assign a custom-typed postgres() to a
bare postgres.Sql handle"): flags a bare `postgres.Sql` handle assigned, without a cast, from a
`postgres(...)` call whose options carry `types`, inline or through an options constant.

**Check after a merge:** a green `checks` job does not mean production deployed. Read the Vercel
production deployment for the merge commit (state READY) before saying a change is live.
