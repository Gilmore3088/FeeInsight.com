# 2026-10-25: a suite's leftover live fees broke another suite's count on the shared test database

**Lesson:** Every DB suite on the shared e2e database removes its own rows when it ends, and a
suite that counts rows across the whole database isolates its fixture inside its own rolled-back
transaction. vitest orders files by its own cache, not the CLI list, so a suite that passes only
because of where it runs is a coin flip.

**What happened:** On PR #2565 the e2e job failed twice in `darwin/verified-recheck.db.test.ts`:
the older-live shadow read 5 and 6 rows where the test expects 1, and the explicit older-live run
flagged 3 where it expects 1. The older-live read takes every live verified fee in the database
(`selectOlderLiveRows`, wrapping round from a random start). `fee-corrections.db.test.ts` cleans
its bank only before it starts, so its live fees, and the peer banks `pipeline.e2e.test.ts`
leaves, were counted whenever those files ran first. Reproduced locally on a fresh database with
the CI file list; `origin/main` fails the same pair (`fee-corrections.db.test.ts` then the Darwin
suite) too.

**Cause:** suites that leave live fees behind, and a whole-database count that assumed an empty
database.

**Fix:** PR #2565: `fee-corrections.db.test.ts` removes its own rows after the suite as well as
before, and the Darwin older-live tests hold every other bank's live fees inside their rolled-back
fixture (`onlyFixtureLive`).

**Guard:** `src/lib/agents/darwin/verified-recheck.db.test.ts` (`onlyFixtureLive`) and the
after-suite clean-up in `src/lib/fee-corrections.db.test.ts`, both in the e2e job.
