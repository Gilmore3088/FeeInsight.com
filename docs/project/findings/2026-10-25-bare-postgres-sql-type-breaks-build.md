# 2026-10-25: a bare `postgres.Sql` in database tests broke the production type check

**Lesson:** Type a test's database connection with the custom types it is opened with
(`postgres.Sql<{ numeric: number; json: unknown; text: string }>`), never a bare `postgres.Sql`.
A bare one is `Sql<{}>`, and whether TypeScript accepts a typed connection there depends on the
order it checks files in, so an unrelated new file can turn the whole build red.

**What happened:** after #2652 (Hamilton command center) merged, Vercel's production builds of main
failed `Failed to type check` (deploys of 0ea8063b4f and 1612730bb5), with 24 TS2322/TS2345 errors
in 9 `*.db.test.ts` files that #2652 never touched: `Sql<{ numeric; json; text }>` not assignable
to `Sql<{}>`. Main typechecked clean one commit earlier (06ff84a4b0) with the same package versions
(typescript 5.9.3, postgres 3.4.8) and an unchanged `connection.ts`. The production site kept
serving the last good deploy, but nothing new could ship.

**Fix:** each of the 9 files declares `type PgTypes = { numeric: number; json: unknown; text: string }`
and types its connections and connection parameters `postgres.Sql<PgTypes>`; a connection opened
without the custom types stays a bare `postgres.Sql`. Shipped in #2653.
**Guard:** the `npx tsc --noEmit` step in `.github/workflows/test.yml` and Vercel's `next build` type check, both over the `*.db.test.ts` files.
