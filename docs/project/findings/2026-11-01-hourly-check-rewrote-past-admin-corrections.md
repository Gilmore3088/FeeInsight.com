# 2026-11-01: The live hourly frequency check had no admin-correction guard

**What happened.** Darwin's hourly frequency check (`src/lib/agents/darwin/hourly-frequency-check.ts`,
#1456) rewrites the frequency of live fees priced by the hour. Both its switches are on
(`HOURLY_FREQUENCY_LIVE` since 2026-10-16, `HOURLY_LINE_LIVE` since 2026-10-20), and every pass
reads the whole live flat table in batches. Neither its read nor its `UPDATE published_fee_records`
skipped a fee with a current admin correction (`published_fee_corrections`, #978). An admin who
set a fee named "Research: Labor Per Hour" to `per_occurrence` would have seen the next pass set
it back to `hourly`. Darwin's own-unit re-check had the guard in its read but not in its write,
so a correction made between the two could still be overwritten.

**Measured on prod (read-only, 2026-11-01).** 21 current admin corrections, all on live fees
(153754, 155056, 155079-155082, 155086, 155087, 155131-155143). None has a
`darwin.hourly_frequency_check` feedback row, and each live frequency still equals the admin's
corrected frequency, so the check has rewritten **0** corrected fees. Run through `findHourlyFees`
with their stored lines, **0** of the 21 would be set today (155137, which the admin set to
`hourly`, is already hourly, so the check leaves it alone). Nothing needs restoring.

**Cause.** The `keep_admin_corrected_fee_live` trigger (migration 20270110000068) fires only when
`rolled_back_at` goes from null to set. It stops takedowns, not value edits or holds. A check that
edits a value in place has only its own guard, and this one was written before the guard existed.

**Fix.** The hourly check's batch read, full count (`countHourlyFees`), SQL count and samples
(`hourlyCountSql`, `hourlySamplesSql`) and its `UPDATE` now carry `notAdminCorrectedSql`. The
verified-row update runs only for fees the guarded published update changed. Own-unit's `UPDATE`
now carries the guard as well. The switches, the version and the rest of the check's behaviour
are unchanged.

**Still unguarded value edits on `published_fee_records`, listed for their owners, not changed here:**
- `src/lib/agents/darwin/account-owner-check.ts` (fee_name): read guarded, write not; the raw
  product-name write comes first, so a write-only guard would split the two.
- `src/lib/agents/darwin/audience-relabel.ts` (fee_audience): the change is made on the verified
  row and copied up by trigger, so a guard belongs on the verified write.
- `src/lib/agents/hamilton/frequency-fill.ts` (frequency): read guarded, write not.
- `src/lib/agents/hamilton/category-guard.ts`, `taxonomy-fold.ts` (canonical_fee_key, fee_name),
  `account-names.ts` and `page-copy-collapse.ts` (fee_name), `hand-takedowns.ts` (fee_audience),
  `hand-amount-corrections.ts` (amount, fee_name): no guard.
- Holds (`SET quarantined_at`) are not covered by the trigger either.

**Agent lesson:** darwin/issue-978-a-value-edit-carries-the-admin-guard

**Guard:** `src/lib/agents/darwin/hourly-frequency-check.test.ts` ("an admin-corrected fee is never
rewritten (#978)") fails when the read, the write or a count drops `notAdminCorrectedSql`, and
`src/lib/agents/darwin/own-unit-check.test.ts` checks the write's guard.
