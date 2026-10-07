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
- Pro readers' Monitor watchlists (`hamilton_watchlists`) feed the same fee-alert email, merged per reader, with their own mark `hamilton_watchlists.last_alerted_at`. Atlas also sends the Pro Monday digest (`pro-digest.ts`, step `pro-digest`, `/api/admin/crew/pro-digest` cron Mondays 13:11 UTC; a `?dry_run=1` cron runs daily at 13:31 UTC and stores and sends nothing): what moved in the reader's state and Fed district, their institution's position against state peers, and their watched institutions' headline fees, against last Monday's `pro_digest_snapshots` row; skipped when nothing moved. Both Pro emails send only while `PRO_EMAILS_ENABLED` is on; while it is off, runs count and render them (step detail `previews`) and the digest still stores its snapshot. Free fee alerts are not behind that switch. Fee alerts and the digest report a fee movement only when `fee-movement-check.ts` confirms it as a price change on the same page with `confirmFeeChange`, the rule Hamilton and the Monthly Pulse share (rereads, renamed lines and other pages' copies are dropped). Dollar fees only; no model calls.
- Hamilton's competitor change alerts (`src/lib/hamilton/competitor-alerts.ts`, step `competitor-alerts`, `/api/admin/crew/competitor-alerts` daily 14:51 UTC; `?dry_run=1&institution_id=N` previews one bank) put a Monitor alert in front of every active member of an institution workspace when a local competitor (FDIC branch-deposit market) changes a headline fee. A change counts only from `fee_change_records` after `FEE_MOVES_TRACKED_SINCE`, on a Darwin-verified live row, at least 12 hours old with no pending takedown, and confirmed by `confirmFeeChange`. In-app only, never email; each bank sees each change once.
- Hamilton's quarterly briefing refresh (`src/lib/hamilton/briefing-snapshots.ts`, step `briefing-refresh`, `/api/admin/crew/briefing-refresh` daily 15:07 UTC) stores one `getWorkspaceBriefing` copy per active institution workspace per quarter in `hamilton_briefing_snapshots` (the first run of a quarter, or the first after a workspace appears). `diffBriefings` (`src/lib/hamilton/workspace/briefing-diff.ts`) compares the two newest copies: own prices, peer medians, which side of the peer band the bank sits on, fees added or removed, a new income filing, and observations new or dropped. Deterministic; no provider calls.
- Atlas runs an hourly lead watch (`src/lib/leads/lead-alerts.ts`) as a visible one-step run (`lead-watch`) from the `/api/admin/crew/lead-watch` cron. It emails CONTACT_EMAIL once about report/contact requests still `new` or `in_progress` 24 hours after they arrived and about leads whose emails failed, then moves them to `overdue` / `needs_reply` (only when that alert was sent) so they are not alerted twice. No model calls; pause-exempt.
- Atlas measures the pipeline once a day from the `/api/admin/crew/scoreboard` cron, as one visible run with two deterministic steps (no model calls, both pause-exempt):
  - `score-answer-key` (`answer-key-score.ts`) compares every confirmed answer-key institution (`answer_key_institutions` / `answer_key_fees`, edited on `/admin/answer-key`) with the pipeline stage by stage: Magellan's document (normalized URL or content hash), Rosetta's completed text of it, Knox raw rows (canonical hint + amount within 1 cent), Darwin's verified category and amount, and Hamilton's live `published_fee_catalog` amount. It stores precision and recall overall (= Hamilton, end to end), per stage, per fee category, per document type and per institution in `answer_key_score_runs`.
  - `scoreboard-snapshot` (`scoreboard.ts`) stores the six daily numbers (coverage, right-document rate, Knox yield, depth, accuracy, freshness) in `pipeline_scoreboard_snapshots`; `/admin/scoreboard` shows them with a 30-day trend.
- The full command center is at `/admin/atlas/details`.
