# 2026-10-17: the e2e schema snapshot lacks the saved peer group columns
**What happened:** the new `src/lib/hamilton/peer-group-membership.db.test.ts` failed on a fresh
database loaded from `tests/e2e/production-schema.sql` with `column "states" does not exist` on
`saved_peer_sets`.
**Cause:** the snapshot predates `supabase/migrations/20270110000021_saved_peer_sets_custom_peers.sql`,
so any db test that saves a state, advanced or hand-picked peer group fails against it.
**Fix:** for now the test applies that migration file itself (it is idempotent, loopback database
only). Refreshing the snapshot from prod's schema is not done yet.
**Lesson:** when a db test needs a recently added column, check the snapshot first; refresh the
snapshot rather than having each test patch it.
