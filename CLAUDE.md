# feeinsight.com — Bank Fee Index

## Brand
Fee Insight is the company and site (feeinsight.com). Bank Fee Index is its product
(the dataset/index); Hamilton is the Pro workspace. Never name the site as the product.
Brand strings live in `src/lib/constants.ts`; `scripts/ci-guards.sh brand-kill` enforces it.
Contact stays hello@bankfeeindex.com until feeinsight.com mail exists.

## Money thesis
A bank/CU marketing or product manager pays ~$300 for a competitive fee report for
their market. Why us: live verified fee data (`published_fee_catalog`) + banking domain
expertise. Kept fully separate from the CSI day job.

## Repository coordination
Read `docs/project/BACKLOG.md` and GitHub issue #984 before coding. One canonical issue,
one implementer, one implementation PR. Search existing open/closed PRs, branches and main;
reuse or explicitly supersede work before starting another version. Respect the three-hour
active-work protection, parked outreach and the per-area work-in-progress limit.
No branch deletion, force-push or direct main push under a general cleanup instruction.
The repository-maintenance workflows operate on GitHub records only; they are not app agents.

## Standing rules
- Never fake logs, records or numbers. If a count or result isn't known, say so.
- Accuracy means the share of live published fees whose amount and category match the
  bank's own current fee schedule. The one shared check is `checkFeeAgainstSource` in
  `src/lib/custom-report/source-check.ts`; use it rather than writing another.
- CI is evidence, not merge permission. Every production merge needs James's explicit approval
  for that change. This supersedes older merge-on-green and recovery auto-merge guidance.


## Project memory
`docs/project/` is the project's durable memory; `docs/project/README.md` explains it.
- Before starting work, read the latest file in `docs/project/checkpoints/`.
- When you hit a structural or infrastructure problem, add it as its own file,
  `docs/project/findings/YYYY-MM-DD-short-slug.md`, in the same PR as the fix (or its own PR if
  there is no fix yet). `docs/project/FINDINGS.md` holds entries through 2026-10-09 and takes no
  new ones; `scripts/ci-guards.sh findings-file-kill` enforces it.
- When James makes a decision that changes how work is done, add it to `docs/project/DECISIONS.md`.
- A daily routine writes the checkpoint and `docs/project/CHANGELOG.md` from merged PRs.
- This file holds rules that stay true. Status and next steps go in a checkpoint, never here.

## Design
Headings never wrap a single word onto its own line. `src/app/globals.css` and
`Reports/studio/template.html` balance h1-h4 (`text-wrap: balance`) and give body text
`text-wrap: pretty`; don't override that per page. `scripts/ci-guards.sh heading-wrap-kill` enforces it.

## Migrations
`supabase/migrations/` must match prod's migration history (`supabase_migrations.schema_migrations`)
file for file, so Supabase's GitHub deploy never re-runs applied SQL. Name a new file with a
14-digit number one higher than the highest file already there (e.g. `20270109000000_name.sql`),
never a lower or duplicate number. `scripts/ci-guards.sh migration-version-kill` enforces the names.

Once the Supabase GitHub link is on, merging a PR that adds a migration runs it on prod, so the
PR must say whether its SQL changes data or must wait for a check. Until then, and for any SQL
James runs by hand in the SQL editor, the steps go in a numbered GitHub issue labeled
`sql-to-run`; a hand-run migration file also needs its history row recorded there.

## Runtime
- Next.js 16 / React 19 / TypeScript is the application and agent control plane. Vercel/Next
  API routes are the runtime boundary.
- Supabase Postgres is the source of truth for institutions, fee data, `agent_runs`,
  `agent_run_steps`, `agent_run_events`, provider usage, and review queues.
- The worker contract is `EXECUTION_BACKEND=agentic_v1` (`src/lib/execution-backend.ts`).
- Provider SDK/model construction lives only in `src/lib/ai-provider.ts`; `provider-kill`
  blocks direct Anthropic SDK imports elsewhere.
- Postgres data access is `src/lib/data-store`.
- Source/document/text access uses `institution_sources`, `source_documents`,
  `source_collection_runs`, and `agent_source_texts`.
- Fee tiers are `raw_fee_observations` (Knox) -> `verified_fee_observations` (Darwin) ->
  `published_fee_records` (Hamilton). Product, report, research and API fee reads use
  `published_fee_catalog` (dollar fees); a fee stated as a rate ("1.1% of the transaction")
  is read from `published_fee_rate_catalog` and never pooled with dollar amounts
  (`src/lib/percent-fees.ts`).
- Pipeline order: Atlas -> Magellan -> Rosetta -> Knox -> Darwin -> Hamilton. Each agent's
  role and boundaries are in `AGENTS.md` and `src/lib/agents/*/AGENTS.md`.

## Hard rules
Most are enforced by `scripts/ci-guards.sh` (`npm run guard:legacy` runs them all in CI).
- No Modal endpoints, Modal env vars, or `.modal.run` URLs.
- No `fee_crawler`, `python -m fee_crawler`, Python crawler tests, or pytest setup.
- No Supabase Edge Functions as a parallel runtime; use typed Next routes and agent modules.
- No `ops_jobs`, `ops_job_id`, `modal_call_id`, `modalCallId`, or `spawnJob`.
- No hidden provider calls while billing/provider health is broken.
- Do not use the Firecrawl connector (it bills James's own account; `.claude/settings.json` denies it). For live pages use plain fetches, WebFetch, Vercel previews, or the pre-installed Playwright Chromium for JavaScript-built pages.
- Every agent action creates or updates a visible agent run/step/event.
- No public prelaunch proxy gate that serves a parallel static site instead of the App Router pages.
- Never read `extracted_fees` (archived; `fee-read-model-kill`). Read `published_fee_catalog`.
- Three controls gate agent work (`src/lib/automation-control.ts`): the `global` provider stop
  blocks only provider steps (`PROVIDER_STEP_KEYS` in `src/lib/agents/types.ts`, paid model
  calls); the `pipeline` control pauses deterministic data steps; the `marketing` control pauses
  growth (marketing) steps (`MARKETING_STEP_KEYS`), and neither pause holds the other's work. The tick checks the provider budget
  only when a provider step is queued. Don't gate deterministic work on provider budget.
- Don't query historical `crawl_*` source tables from app code (`source-read-model-kill`).
- Document agents use `institution_id`, `source_document_id`, and `agent_source_texts`
  (`agent-source-contract-kill`).
- Fee-tier agents use the semantic tier tables, never `fees_raw`, `fees_verified`,
  `fees_published`, or `crawl_event_id` (`fee-tier-contract-kill`).
- Don't add one-off data mutation, dedupe, migration, crawler, or provider scripts; that work
  belongs in typed agent modules with run-ledger visibility. `scripts/` holds only the CI
  guards, the production-route build check, and read-only audits.

## Source of truth
- `AGENTS.md` and per-agent `src/lib/agents/*/AGENTS.md`
- `src/lib/agents/run-store.ts`, `src/lib/ai-provider.ts`, `src/lib/data-store/connection.ts`,
  `src/lib/execution-backend.ts`, `scripts/ci-guards.sh`
- `docs/plans/agentic-codebase-cleanup-2026-08-13.md`

Docs under `docs/archive/` (Modal, `fee_crawler`, SQLite, `ops_jobs`) are history, not guidance.
