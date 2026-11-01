# 2026-11-01: Second-look flags that no check would ever settle stayed pending forever

**Lesson:** A pending second look has to settle even when its own check never reads the fee
again. A flag on a fee another path already took down resolves at once, and the clear names the
rollback or quarantine that took the fee. A flag on a live fee is never confirmed by its age. It
clears with recorded evidence only after its check has gone a full grace period without failing it
again, and the grace is longer than the slowest check's measured cycle.

**What happened:** `secondLook` (`src/lib/agents/hamilton/second-look.ts`) settles a flag only
when the check that wrote it reads the fee again: it confirms the flag on a second failure at least
12 hours later, or clears it on a pass. #2756 added a scoped clear for checks that read a whole
scope (`readScope`). Only two Darwin checks pass a scope, and a fee that is no longer live is
outside every scope. A read-only count on prod (Nov 1 2026, `pipeline_feedback` kind
`takedown_pending` joined to `published_fee_records`) found:

- 2,204 pending flags on fees already down: rules_recheck 1,013, other_bank_document 424,
  category_guard 172, unconfirmed_document_host 162, business_schedule 77, source_check 58,
  verified_recheck 48, rules_recheck_restore 43, eval_verdict 38, product_page 34, and 10 more
  checks with 1 to 32 each.
- 94 pending flags older than 24 hours on live fees: current_copy 48, category_guard 27 (flagged
  Oct 9), line_conflict 6, unconfirmed_document_host 4, and 9 across six more checks.

Every reader of `takedown_pending` treated these flags as open. Reports and the fee-change feeds
left the live fees out, and Magellan's re-fetch, the lane scheduler and Deming's fresh audit
counted them. A flag on a fee that is down was also a hazard: if a restore brought the fee back,
the check could confirm that old flag on its first new failure, so the fee would come down on one
look.

**Fix:** the 41st publish sweep, `pendingFlags`, runs `resolveStalePendingFlags` hourly in
`publish-sweeps` and covers every check at once.
- A flag on a fee that is rolled back or quarantined becomes `takedown_cleared` at weight 0. Its
  evidence carries `cleared_why: fee_already_down` and `taken_down_by` (the published row's
  rollback time, batch and reason, or its quarantine), and a `flag_cleared` audit row is appended.
- When a check fails a fee again before the flag confirms (a waiting second look, or a check whose
  takedown switch is off), `secondLook` now writes `last_failed_at` and `last_failed_run_id` on the
  flag. A live fee's flag is stamped `overdue_since` once its first look and its last re-fail are
  both older than the 12-hour window. If no run fails it again within `STALE_FLAG_GRACE_MINUTES`
  (14 days), it clears at weight 0 with `cleared_why: not_refailed`. The longest
  first-look-to-confirm gap measured over 30 days was 236.6 hours, for darwin.verified_recheck. A
  re-fail removes the stamp.
- The sweep never confirms a flag, never takes a fee down and never writes a fee table. A dry run
  only counts.

**Dry run (prod, Nov 1 2026, read-only):** the first live pass would resolve 2,204 flags on fees
already down and stamp 182 live flags overdue. The 182 are every live pending flag older than
12 hours, including those still waiting for their normal second look. It would clear none. If
their checks do not fail those fees again, the earliest clears come 14 days after the first pass.
54 of the 182 are already more than 14.5 days old, so they would clear first. No fee goes up or
down because of the sweep.

**Still open:** a live fee whose flag clears goes back into reports and the fee-change feeds that
skip `takedown_pending` fees. That is correct when no check suspects it any more, but it is a
visible change 14 days after deploy.

**Agent lesson:** hamilton/issue-1876-pending-flags-settle-without-their-check

**Guard:** `src/lib/agents/hamilton/second-look.test.ts` (plan, sweep and re-fail stamp),
`src/lib/agents/hamilton/second-look-read-scope.db.test.ts` (the sweep in real PostgreSQL: a fee
already down resolves, a live flag is stamped and then cleared only after the grace, a re-fail
keeps the flag, and no fee row changes), `src/lib/agents/hamilton/publish-sweeps.test.ts`.
