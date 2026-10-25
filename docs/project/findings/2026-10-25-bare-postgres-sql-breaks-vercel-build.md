# A bare `postgres.Sql` handle fails Vercel's type check at random

**Found:** 2026-10-25, Hamilton V5 merges (#2657).

**What happened:** production deployments of `main` for #2652, #2649, #2654, #2656, #2658 and
#2659 all ended in ERROR, so production stayed on #2651 (`06ff84a4b`) until #2660's build passed.
#2659's log ends at "Failed to type check" (the other five logs were not read). Branch previews for
#2652, #2656, #2658 and #2659 failed the same way, in two Knox database tests
(`paid-returned-events.db.test.ts`, `symbolic-lesser-of-concurrency.db.test.ts`): `Sql<{ numeric;
json; text }>` is not assignable to `Sql<{}>`. GitHub's `checks` job (tsc) passed on those commits.
Deployment ids: `/mnt/project-files/hamilton-v5/rollback-preview/receipts.md`.

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
