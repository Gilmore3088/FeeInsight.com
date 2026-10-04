# Hamilton Agent Guide

Hamilton owns publication and analysis surfaces.

## Authority

- Hamilton publishes eligible `verified_fee_observations` into `published_fee_records` and the `published_fee_catalog` read model.
- Hamilton reads selected institution context, evidence policy, peer baseline metadata, financial context, Monitor signals, and refresh jobs.
- Hamilton may generate public-safe, Pro-grade, or internal/admin analysis depending on audience and access control.

## Category guard (issue #51)

- `hamilton/publish.ts` runs the category guard (`src/lib/fee-category-guard.ts`) before
  publishing; a verified row that fails it is skipped and marked `review_status =
  'rejected'` with a `category_guard:<code>` flag so it is never re-selected.
- The `category-guard` step (`hamilton/category-guard.ts`) rolls back live
  `published_fee_records` that fail the guard: soft delete only (`rolled_back_at`,
  `rolled_back_by_batch_id = category-guard-run-<id>`, `rolled_back_reason =
  category_guard:<code>: ...`), rejects their verified rows, and refreshes the fee index. Start it from
  Atlas details -> Catalog repair; a `dry_run` run reports counts and samples and writes
  nothing.

## Required Behavior

- Use the shared Hamilton request contract: `institutionId`, `intent`, `evidencePolicy`, `audience`, and optional workspace context.
- Build institution context through `src/lib/hamilton/institution-briefing.ts`.
- Separate verified, provisional, under-review, and empty evidence states.
- Refuse generic consulting briefs when evidence is empty or too thin; return diligence/source-validation paths instead.
- Persist report/scenario metadata for evidence policy, peer baseline source/label, fallback reason, peer-set ID, and selected-institution evidence counts.
- Persist selected-institution source/source-label metadata on reports, scenarios, and watchlist rows.
- Emit publication, refresh, and fee-movement Monitor signals with canonical institution IDs.
- Use `recordHamiltonMonitorSignal` for Monitor writes so source metadata preserves `evidence_policy`, `provider_call_queued`, and lineage. Provider-originated competitor/movement signals must state an explicit evidence policy and cannot silently queue provider automation.

## Boundaries

- Public Hamilton must be consumer-safe and cannot expose admin-only operational details.
- Pro Hamilton may provide consulting workflows, but must label provisional-first analysis and verified-only benchmark/export data.
- Internal Hamilton may expose broader operational context only behind admin/analyst access control.
- Do not rely on free-text institution names as workspace identity.
