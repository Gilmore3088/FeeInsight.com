# 2026-10-20: migration numbers collided across open PRs

A migration number is claimed when any open PR uses it, not when it reaches `main`, so check open PRs before taking one.

**What happened:** Prod already had `20270110000068_keep_admin_corrected_fees_live.sql` (#2433)
while the draft #2377 also used 068. Later the same morning, 070 to 074 were handed out in
parallel to #2450, #2451, #2453, #2459 and #2253, and the PRs had to be sequenced and renumbered
by hand before they merged. On `main` they are now 069 (#2377), 070 `branch_deposits_year_index`,
071 `fk_join_indexes`, 072 `drop_expired_legacy_event_partition`, 073
`call_report_quarterly_income` and 074 `fdic_identity_conflict_holds`.

**Cause:** `scripts/ci-guards.sh migration-version-kill` sees only the files on the branch it
runs on. Each branch was valid on its own; the clash existed only between open PRs. It is the
same gap as `2026-10-09-parallel-migration-numbers.md`, now with more migration PRs open at once.

**Fix:** Renumbered by hand before each merge. No guard yet.

**Lesson:** Before naming a migration, list the numbers claimed by open PRs (each open PR's
`supabase/migrations` files) and take one above both `main` and every open PR. After any
migration PR merges, re-check the others.

**Guard:** Foundation tracker #1048 checklist line "guard for migration numbers claimed by open
PRs"; until it exists, the CLAUDE.md rule that a migration PR merges `main` and re-runs
`migration-version-kill` before merging.
