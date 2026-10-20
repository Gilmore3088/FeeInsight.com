# 2026-10-20: Vercel's build-skip check could skip every build, production included

A check whose exit 0 means "skip" must default to "build"; only an explicit skip decision may exit 0.

**What happened:** The post-merge review of #2494 found that `scripts/vercel-ignore-build.mjs` ran
its decision only when `process.argv[1]` equalled `fileURLToPath(import.meta.url)`. Run through a
symlink (or any path spelled differently from the module's real path) the two differ, nothing ran,
and Node exited 0. Vercel reads exit 0 as "skip the build", so every deployment, production
included, would have been skipped and shown as "Ignored". Reproduced locally: a symlink to the
script with `VERCEL_ENV=production` printed nothing and exited 0.

**Cause:** The entry guard was an import-safety trick for the tests, and Node's default exit code
is 0, so the guard failed open.

**Fix:** The decision moved to `scripts/vercel-ignore-build-lib.mjs`, which has no side effects and
is what the tests import. `scripts/vercel-ignore-build.mjs` has no guard: it sets
`process.exitCode = 1` first, loads the decision, and exits through `exitCodeFor`, which returns 0
only when the decision's `build` is literally `false`. A throw, a missing decision or any other
value exits 1 and builds. `vercel.json`'s `ignoreCommand` is unchanged.

**Guard:** `scripts/vercel-ignore-build.test.ts:158` (no decision or a non-`false` value exits 1;
`:150` a throw exits 1; `:308` a symlinked path still decides; `:320` production via a symlink
builds)
