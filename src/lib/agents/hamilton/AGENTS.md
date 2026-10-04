# Hamilton Agent Guide

Hamilton owns publication and analysis surfaces.

## Authority

- Hamilton publishes eligible `verified_fee_observations` into `published_fee_records` and the `published_fee_catalog` read model.
- Hamilton reads selected institution context, evidence policy, peer baseline metadata, financial context, Monitor signals, and refresh jobs.
- Hamilton may generate public-safe, Pro-grade, or internal/admin analysis depending on audience and access control.

## Required Behavior

- Use the shared Hamilton request contract: `institutionId`, `intent`, `evidencePolicy`, `audience`, and optional workspace context.
- Build institution context through `src/lib/hamilton/institution-briefing.ts`.
- Separate verified, provisional, under-review, and empty evidence states.
- Refuse generic consulting briefs when evidence is empty or too thin; return diligence/source-validation paths instead.
- Persist report/scenario metadata for evidence policy, peer baseline source/label, fallback reason, peer-set ID, and selected-institution evidence counts.
- Persist selected-institution source/source-label metadata on reports, scenarios, and watchlist rows.
- Emit publication, refresh, and fee-movement Monitor signals with canonical institution IDs.
- Use `recordHamiltonMonitorSignal` for Monitor writes so source metadata preserves `evidence_policy`, `provider_call_queued`, and lineage. Provider-originated competitor/movement signals must state an explicit evidence policy and cannot silently queue provider automation.

## Publishing (publish.rules version 2)

- `hamilton/publish.ts` publishes only Darwin-verified rows (`agentic_darwin_verified`)
  with no blocking flag, a valid canonical key, a fee name, source lineage, Darwin's
  verification event id, confidence at or above the threshold (0.8 by default), and an
  amount inside the category range in `darwin/envelopes.ts`. $0 is published only when
  Darwin flagged the row `zero_fee`.
- `published_by_adversarial_event_id` holds Darwin's verification event id, the gate
  that actually ran.
- One live price per fee: when the same institution, canonical key, variant and
  frequency is published at a new amount, the prior live row is closed
  (`rolled_back_at`, `rolled_back_by_batch_id`, `rolled_back_reason = 'superseded by
  #<id>'`) and the change is written to `fee_change_records` (`increase`/`decrease`).
  Closed rows stay in `published_fee_records` as history; `published_fee_catalog` shows
  only live rows. An identical amount is skipped.
- Insert and supersede share one SAVEPOINT; the change record, prior-row read, signals
  and guide flags each have their own, so an optional write that fails never aborts the
  run transaction.
- Every decision is written to `pipeline_attempts` (stage `publish`, fingerprint
  `verified:<fee_verified_id>`); a decided row is never selected again.
- An institution publishes only once it has at least 3 distinct fees (canonical keys)
  live or ready to publish (`HAMILTON_PUBLISH_MIN_INSTITUTION_FEES`; run param
  `publish_min_institution_fees`, 1 turns it off). Thinner institutions' rows are held:
  not published and not written to `pipeline_attempts`, so they publish on the run
  where Knox's later finds bring the institution to the minimum. The step detail lists
  them as `held_thin_institutions`. The gate applies to new publishes only; it does not
  close rows already live.
- Batches take whole source documents (`agents/document-batch.ts`), oldest first, so a
  document's fees publish together; Darwin batches the same way. A batch can exceed the
  limit by one document.
- Dry runs read the prior live row and report the same skips, movements and supersedes
  as a real run, without writing.
- Not yet built: closing a row when a fee line disappears from a newer copy of its
  document.

## Outlier Rollback

Before each publish step, `outlier-rollback.ts` rolls back live `published_fee_records`
rows whose positive amount is outside the Darwin range for their category
(`darwin/envelopes.ts`): `rolled_back_reason = 'amount_outside_category_range'`, the run's
batch id, and a `hamilton.outliers_rolled_back` run event. Explicit $0 fees are left alone.
Clearing `rolled_back_at` restores a row a human confirms is real; widen its range in the
same change so the next run does not roll it back again.

## Duplicate Collapse

Before each publish step, `duplicate-collapse.ts` closes live rows that repeat another
live row exactly (same institution, canonical key, variant, frequency, amount and fee
name). The newest copy stays live; the others get `rolled_back_reason = 'duplicate of
#<kept id>'`, the run's batch id, and a `hamilton.duplicates_collapsed` run event. Rows
that differ in name or amount are separate fee lines and are left alone.

## Boundaries

- Public Hamilton must be consumer-safe and cannot expose admin-only operational details.
- Pro Hamilton may provide consulting workflows, but must label provisional-first analysis and verified-only benchmark/export data.
- Internal Hamilton may expose broader operational context only behind admin/analyst access control.
- Do not rely on free-text institution names as workspace identity.
