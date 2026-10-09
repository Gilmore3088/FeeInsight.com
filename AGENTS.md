# Fee Insight Agent Operating Guide

This repository uses one agentic experience for data trust, validation, publishing, and analysis. Keep agent work tied to the TypeScript/Vercel runtime and the semantic Postgres tables. Do not reintroduce retired crawler workers, Modal paths, Supabase Edge Function product endpoints, or ad hoc scripts as runtime surfaces.

## Current Runtime

- Agent runs start in `agent_runs`, advance through `agent_run_steps`, and write `agent_run_events`.
- The execution envelope is `src/lib/agents/run-store.ts`.
- Scheduled advancement happens through `/api/admin/agents/tick`.
- Manual advancement happens through `/api/admin/agents/runs/[id]/execute`.
- Provider access must flow through `src/lib/ai-provider.ts` and usage/circuit accounting.
- `src/lib/automation-control.ts` holds three controls. The `global` provider stop blocks provider steps (`PROVIDER_STEP_KEYS`, paid model calls) and provider calls; deterministic steps keep running. The `pipeline` control is the operator pause for deterministic steps; a paused run stays queued. The `marketing` control is the operator pause for Growth's steps (`MARKETING_STEP_KEYS`), which obey it instead of the pipeline pause; each pause leaves the other side's runs going. The Atlas emergency stop engages the provider stop and the pipeline pause.
- The tick (`/api/admin/agents/tick`) first reaps steps stuck `running` (re-queue, then dead after 3 attempts), then schedules lanes and drains runs. It consults the cron provider budget policy only when a provider step is queued. With the pipeline paused it schedules no data runs but still drains Growth's runs; it does nothing only when both the pipeline and marketing are paused. While marketing runs, it also queues Growth's daily `growth-withdraw` run when unreviewed outreach drafts no longer qualify (`src/lib/agents/growth/withdraw.ts`).
- Every agent, marketing included, works through the run ledger: a run that writes, drafts or sends anything is an `agent_runs` row with visible steps and events. No marketing work runs outside it.
- `/api/admin/job-health` is the external alerting endpoint: it returns 503 with plain-language problems when ticks stop succeeding, ticks are blocked, steps are stuck, lanes are overdue, or nothing has been published for a week.

## Marketing Team

Marketing runs on the same run ledger as the data agents, as agent `growth` (Growth, below). It
never writes fee data. The GrowthOS team definitions (DRAPER, SHERLOCK and the others), rules and
work queue are in `growth-os/README.md`; their skills are in `.agents/skills/`. App-side
marketing work (the LinkedIn drafts, the monthly email) runs as Growth's steps, under the
marketing pause and the `agent:growth` budget.

## Agent Roster

### Atlas

Atlas is the operator command center and run orchestrator.

- Creates scoped runs and workflow lanes.
- Shows run receipts, current step, latest event, owner, blocked reason, and next safe action.
- Does not extract, classify, or publish fee data directly.
- Must make automation posture visible before an action can spend provider money.

### Magellan

Magellan owns institution source discovery and source fetching.

- Reads `institution_sources` and source/submission queues.
- Writes discovery attempts and source-document collection results.
- Should rotate batches with claim/backoff behavior and avoid repeatedly selecting the same failed institutions.
- Must not call provider extraction directly. If automation is stopped, mark accepted sources as queued/manual-validation-ready.

### Rosetta

Rosetta owns source text normalization.

- Reads `source_documents`.
- Writes normalized text to `agent_source_texts`.
- Handles deterministic HTML/text/PDF parsing first.
- Routes scanned or unreadable PDFs to an explicit OCR-needed/manual state instead of pretending text is available.

### Knox

Knox owns conservative raw fee extraction and anomaly surfacing.

- Reads `agent_source_texts`.
- Writes `raw_fee_observations`.
- Extracts only source-grounded rows with lineage back to the source document/text.
- Sends ambiguous rows, policy conflicts, and outliers to review rather than publishing them.
- Emits aggregate Hamilton Monitor signals when raw observations are inserted or normalized source text needs manual fee review.

### Darwin

Darwin owns verification and classification.

- Reads `raw_fee_observations`.
- Writes `verified_fee_observations` and review decisions.
- Checks canonical fee hints, amount reasonableness, duplicates, source lineage, and rejection policy.
- Should challenge suspicious rows instead of flooding human review with every row.
- Emits aggregate Hamilton Monitor signals when source-grounded rows are actually verified.
- Emits aggregate Hamilton Monitor review signals when deterministic verification skips rows that need canonical, amount, or lineage review.

### Hamilton

Hamilton owns publication and analysis surfaces.

- Publishes eligible verified rows into `published_fee_records` and the `published_fee_catalog` read model.
- Public Hamilton behavior must be institution-aware, evidence-tier-aware, and consumer-safe.
- Pro Hamilton behavior must act like a consulting workspace: Analyze, Benchmark, Scenario, Report, and Watch.
- Internal Hamilton can use broader operational context, but must remain admin/analyst-gated.
- Public, Pro, and internal Hamilton routes must use the shared request contract in `src/lib/hamilton/request-contract.ts`: `institutionId`, `intent`, `evidencePolicy`, `audience`, and optional `workspaceContext`.
- Selected-institution analysis context must come from `src/lib/hamilton/institution-briefing.ts` so public/Pro research and internal chat receive the same identity, evidence tier, financial, peer, and source-quality briefing.
- Hamilton must separate verified from provisional evidence and exclude provisional rows from verified benchmark scoring unless explicitly labeled otherwise.
- Hamilton publication must emit aggregate Monitor refresh signals when verified rows are actually published, so Pro users can rerun reports, scenarios, and watchlist analysis from data lifecycle events.
- Hamilton publication must compare new live published rows against prior live published rows for the same institution/category and emit Monitor fee-movement signals when amounts change and `confirmFeeChange` confirms the change on the bank's own page.
- Hamilton Monitor refresh signals must enqueue durable `hamilton_refresh_jobs` records for report, scenario, and watchlist reruns; user-triggered Reports and Simulate workflows complete their matching queued jobs.
- Hamilton Monitor signals must use `recordHamiltonMonitorSignal`, carry explicit `evidence_policy` and `provider_call_queued` metadata in `source_json`, and must never queue provider work from a signal while automation is stopped. Provider-originated competitor/movement signals require an explicit evidence policy before they can be recorded.
- Internal Hamilton chat memory must be migration-backed and scoped to authenticated numeric `users.id`; message rows should carry user lineage copied from the owning conversation.
- Saved report and scenario artifacts must carry queryable evidence policy, peer baseline source/label, fallback reason, peer-set ID, and selected-institution evidence counts wherever the artifact can later be refreshed, exported, or audited.
- Report previews, report cards, PDF exports, and scenario data exports must surface the saved evidence policy and peer baseline metadata whenever those artifacts are presented outside the generation form.
- Saved reports, saved scenarios, and watchlist rows must preserve the selected-institution source and source label so artifacts still explain whether context came from a URL, manual Settings selection, Profile, or Watchlist.
- Account, Pro dashboard, Pro marketing, and summary/index modules must label whether a figure is a verified-only benchmark, a verified-only export, or provisional-first Hamilton analysis. Do not show benchmark medians without making clear that provisional evidence is excluded from scoring.

### Growth

Growth owns marketing: the weekly LinkedIn drafts and the monthly marketing email
(`src/lib/agents/growth/AGENTS.md`).

- Runs on the run ledger as agent `growth`; its steps obey the marketing pause, not the pipeline pause.
- Never sends or posts on its own: drafts wait in `content_drafts` or MailerLite for James's approval.
- Bills `ANTHROPIC_API_KEY_GROWTH` and the `agent:growth` budget ($5 a day, $60 a month, off until James enables it).
- Writes results and lessons to `pipeline_feedback` and drafts to `content_drafts` only; never writes fee data.

## Data Boundaries

Use these current semantic tables and read models:

- Institutions and sources: `institution_sources`, `source_documents`, `source_collection_runs`, `agent_source_texts`.
- Fee tiers: `raw_fee_observations`, `verified_fee_observations`, `published_fee_records`, `published_fee_catalog`.
- Public intake: `community_fee_submissions`.
- Institution authority: `institution_claims`, `institution_claim_events`, `institution_workspace_memberships`, `institution_workspace_invitations`.
- Agent ledger: `agent_runs`, `agent_run_steps`, `agent_run_events`.
- Provider safety: `automation_control`, `ai_api_usage_events`.
- Marketing (Growth): `content_drafts`, `pipeline_feedback`.
- Hamilton Pro persistence: `hamilton_saved_analyses`, `hamilton_scenarios`, `hamilton_reports`, `hamilton_watchlists`, `hamilton_workspace_contexts`, `hamilton_signals`, `hamilton_priority_alerts`, `hamilton_refresh_jobs`, `hamilton_conversations`, `hamilton_messages`.

Do not use retired runtime contracts such as `fee_crawler`, `ops_jobs`, Modal worker IDs, old crawler table aliases, or request-time DDL.

## Product Rules

- Public pages are evidence/report-card surfaces. They may show provisional evidence only when labeled with confidence/source context.
- Empty profiles must create source-submission and validation paths, not fake confidence or generic AI answers.
- Public claim/validation CTAs should route through login into Hamilton Settings with `instId`; Pro users submit authenticated claims into `institution_claims`, and source evidence still routes through structured source intake.
- Accepted institution claims must create active `institution_workspace_memberships` records before Account or Pro pages show workspace authority; claim acceptance never publishes fee rows by itself.
- Institution owners/admins may delegate workspace roles to existing active Pro users through `institution_workspace_memberships`, and may queue pending invitations for users who still need to register or activate Pro through `institution_workspace_invitations`. Delegated access must preserve numeric `users.id` scoping, pending-invite lifecycle state, and revocation audit history.
- Pro pages must preserve selected institution context across Hamilton workflows whenever an `instId` exists.
- Pro institution selection must resolve to canonical numeric `institution_sources.id` values through search, URL params, watchlist, or validated Settings updates. Do not rely on free-text institution names as workspace identity.
- `/pro/research` is a compatibility redirect. New visible Pro entry points should use `/pro/analyze`, `/pro/reports`, `/pro/simulate`, or `/pro/monitor`.
- Reports for thin evidence should produce a diligence/readiness path, not a generic consulting brief.
- Account and Pro navigation should reinforce Hamilton as the canonical workspace, not separate old AI research pages.

## Verification Gates

Before calling agentic work done, run the narrow tests for the touched code and the broad checks when the blast radius crosses routes or shared data:

- `npm run guard:legacy`
- `npm run test:agentic`
- `npx tsc --noEmit`
- `npm run lint`
- `npx vitest run` (full suite; CI runs all of these)
- Focused route/browser checks for public institution, submit-source, admin quality, and Hamilton Pro flows.

For database-affecting work, verify against the actual current schema and add a migration only through the project migration workflow. Do not edit production-applied migrations in place.
