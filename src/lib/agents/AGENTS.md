# Agent Runtime Guide

This folder contains the active TypeScript agent runtime. Keep all agent work on the semantic Postgres tables and the Vercel/Next.js execution path. Do not add retired crawler workers, Modal jobs, Supabase Edge Function product endpoints, or one-off runtime scripts here.

## Shared Rules

- Every agent run must flow through `run-store.ts` and write durable `agent_runs`, `agent_run_steps`, and `agent_run_events` state.
- Provider calls must go through `src/lib/ai-provider.ts` and respect `src/lib/automation-control.ts`.
- If the provider (`global`) stop is active, deterministic steps continue but provider steps wait and no paid provider call is made. If the `pipeline` control is paused, no step runs and runs stay queued. Any step that can call a provider must be listed in `PROVIDER_STEP_KEYS` (`types.ts`).
- Agent output must preserve lineage: institution ID, source URL or document key, source text/row IDs, confidence, flags, and the agent run/event that produced the row.
- Public and Pro surfaces consume agent results through semantic read models. Do not write UI-only shortcuts that bypass the trust pipeline.
- Pro workspace authority uses numeric `users.id` membership records. Delegated access may grant existing Pro users institution-scoped roles, and pending invitations may queue access by lower-cased email until a matching user activates Pro. Agents must not infer publication authority from membership or invitation records alone.

## Agent Ownership

### Atlas

Atlas owns orchestration and operator visibility.

- Creates and advances scoped runs.
- Shows next safe action, blocked reason, ownership, receipts, and automation posture.
- Does not directly extract, verify, or publish fees.

### Magellan

Magellan owns source discovery and source fetching.

- Reads `institution_sources`, source queues, and accepted submissions.
- Writes source discovery/fetch state and `source_documents`.
- Uses deterministic fetch behavior first and marks failures explicitly.
- Must not call provider extraction.

### Rosetta

Rosetta owns source text normalization.

- Reads `source_documents`.
- Writes `agent_source_texts`.
- Handles deterministic HTML, text, and PDF parsing before escalation.
- Marks OCR/manual states when text cannot be safely extracted.

### Knox

Knox owns conservative raw fee extraction.

- Reads `agent_source_texts`.
- Writes `raw_fee_observations`.
- Extracts only source-grounded rows with canonical hints and lineage.
- Routes ambiguity, policy conflicts, and outliers to review instead of publication.
- Emits aggregate Hamilton Monitor signals when raw observations are inserted or normalized source text needs manual fee review.

### Darwin

Darwin owns verification and classification.

- Reads `raw_fee_observations`.
- Writes `verified_fee_observations`.
- Verifies canonical hints, amount reasonableness, duplicate state, lineage, and rejection flags.
- Emits aggregate Hamilton Monitor signals when rows are actually verified.
- Emits aggregate Hamilton Monitor review signals when rows are skipped by deterministic verification and need canonical, amount, or lineage review.

### Hamilton

Hamilton owns publication and analysis surfaces.

- Publishes eligible verified rows into `published_fee_records` and public read models.
- Emits aggregate Hamilton Monitor refresh signals when verified rows are actually published.
- Emits Hamilton Monitor fee-movement signals when a newly published live row changes from the prior live row for the same institution/category.
- Writes Monitor signals through `recordHamiltonMonitorSignal` so signal metadata carries evidence policy, provider-call posture, canonical institution ID, and refresh-job lineage.
- Enqueues durable Hamilton refresh jobs from lifecycle signals and completes report/scenario refresh jobs when users rerun those workflows.
- Keeps internal chat memory migration-backed and user-scoped; Hamilton messages carry the authenticated user lineage from their parent conversation.
- Keeps workspace invitations separate from active membership authority; pending invitations become delegated memberships only after a matching active Pro user exists.
- Persists report/scenario artifact metadata for evidence policy, peer baseline source/label, fallback reason, peer-set ID, and selected-institution evidence counts.
- Shows that artifact metadata in report previews, published report cards, PDF exports, and scenario data exports.
- Persists selected-institution source/source-label metadata on reports, scenarios, and watchlist rows so artifact history remains auditable when context changes implicitly.
- Preserves evidence-policy labels in Account, Pro dashboard, Pro marketing, summary cards, quick actions, and exports so users can distinguish verified-only benchmarks from provisional-first analysis.
- Keeps public, Pro, and internal analysis institution-aware and evidence-tier-aware.
- Public Hamilton must be consumer-safe and caveated; Pro Hamilton can be consulting-grade; internal Hamilton can expose admin/analyst context behind access control.

## The Crew (operator experience)

- `/admin` is the crew home. Each agent shows a state (Working / Waiting / Blocked / Idle), a "Now" and a "Last" sentence, and today's count (`crew.ts`).
- The activity log is generated from `agent_run_events` by `narrate.ts`. When a step records new numbers in its `detail`, add or update its template there so the log stays plain English.
- The command bar is rule-based (`crew-commands.ts`, no model). Reads answer immediately; writes (run, retry, pause, resume) only return a proposal, and the confirm action re-parses the original text before calling `startAgentRun` or `setPipelineEnabled`. Never add a write path that skips the confirmation.
- Atlas sends a daily brief (`daily-brief.ts`) as a visible one-step run from the `/api/admin/crew/daily-brief` cron. `daily-brief` is in `PAUSE_EXEMPT_STEP_KEYS`, so it still reports while the pipeline is paused.
- Atlas sends readers' fee-change alerts (`fee-alerts.ts`) as a visible one-step run (`fee-alert-dispatch`) from the `/api/admin/crew/fee-alerts` cron. It reads Hamilton's `hamilton_fee_movement_detected` and `hamilton_publication_completed` signals newer than each `institution_fee_alert_subscriptions.last_alerted_at`, keeps only fees the reader follows, sends one email per reader through Resend with a signed one-click unsubscribe, and advances `last_alerted_at` only after a send is accepted. No model calls. It is pause-exempt: a paused pipeline publishes nothing new, so it can only drain alerts already owed.
- The full command center is at `/admin/atlas/details`.
