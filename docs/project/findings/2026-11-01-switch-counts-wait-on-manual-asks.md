# 2026-11-01: Switch counts waited on one manual production ask each

**What happened:** By Nov 1, several accuracy fixes had merged behind off-by-default switches, and
each was waiting on a production dry-run count:
- `DAILY_CAP_LINES_LIVE` (#2768, Knox v146);
- `DASH_LIST_ROWS_LIVE` (#2834, Knox v148);
- the shadow lab's `excerpt-at-publish` experiment;
- a live accuracy figure.

No builder session has production database access. Each count was a separate request to James,
written up differently in each #1092 comment. So a switch waited until someone asked for its count,
James ran one read for it, and the answer was copied back, and the improvement loop stalled there.

**Cause:** Each switch's dry run was described in prose ("count the rows whose check goes from
not-ok to ok") and had no code. Earlier dry runs (`own-unit-check.ts`, `same-line-read-check.ts`)
each exported their own SQL constant for a read-only transaction, so every new switch needed its
own query, and nothing gathered them into one command.

**Fix:** `npm run audit:switch-dry-runs` (`scripts/switch-dry-runs.mjs`), with its logic in
`src/lib/agents/deming/switch-dry-runs/` and its reads in `src/lib/data-store/switch-dry-runs.ts`.
- **One read-only run.** It is one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction
  that checks `transaction_read_only` before it reads anything. It sends SELECT only, makes no
  provider calls, and prints totals plus capped samples, or JSON with `--json`.
- **The real functions.** Each section passes rows through the code production runs, with the
  switch off and then on: `checkFeeAgainstSource`, Knox's `runFreeSpecialists` through the shadow
  lab variants, Hamilton's `decidePriorFee` and `limitGuardVerdict`, and Deming's `runFreshAudit`.
- **Checked offline.** Every counter has a fixture test whose counts were worked out by hand.
  Locally the whole run was also tried against a throwaway Postgres loaded with
  `tests/e2e/production-schema.sql` and a few seeded rows (State key 10272's text, one cap, one
  Zelle limit), never against production.

What the audit found without production data:
- `excerpt-at-publish` maps to no live switch. The publish step selects no raw `conditions`, so
  the publish-time limit guard never reads Knox's excerpt. Turning it on is a code change.
- No existing measure checks live fees against the bank's current schedule. The live accuracy
  section restates the fresh audit, which reads stored copies: amount and category supported by
  the fee's stored source text. The launch measure is still James's weekly live batch
  (`docs/plans/weekly-live-fee-accuracy-plan.md`).

**Not measured:** every production count. This PR's session had no database access, so the
numbers come from James's first run.

**Guard:** `src/lib/agents/deming/switch-dry-runs/*.test.ts`, `src/lib/data-store/switch-dry-runs.test.ts`
(SELECT-only statements, read-only transaction refused otherwise).

**Agent lesson:** deming/issue-1092-a-switch-ships-its-dry-run-count
