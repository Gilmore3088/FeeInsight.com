# 2026-10-25: main's Vercel build failed on database tests' connection types
**What happened:** from 0ea8063 (#2652) on, every Vercel build of main and of PR branches failed at
"Running TypeScript" with TS2322 in nine `*.db.test.ts` files: `Sql<{ numeric: number; json: unknown;
text: string }>` is not assignable to `Sql<{}>`. GitHub CI's `checks` job stayed green on the same
commits, and the same `tsc --noEmit` passed or failed locally from one run to the next.
**Cause:** those tests open their connections with the app's typed parsers (`NUMERIC_AS_NUMBER`,
`JSON_TEXT_PASSTHROUGH`, `TEXT_WITHOUT_NUL`) but declared the variables as bare `postgres.Sql`
(`Sql<{}>`). Whether TypeScript accepts that depends on the variance it measures for `Sql<T>`, which
depends on which file it checks first, so a change elsewhere (new files in #2652) flipped the result.
**Fix:** the nine files declare the typed connection as
`postgres.Sql<{ numeric: number; json: unknown; text: string }>`, matching the options they pass, so
no comparison with `Sql<{}>` is left to chance. A connection opened without those parsers keeps the
bare type.
**Guard:** the explicit types in the nine files; Vercel's production build type check (Next.js
`next build`) is the check that caught it.
