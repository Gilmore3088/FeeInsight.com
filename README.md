# Fee Insight

Fee Insight (feeinsight.com) publishes the **Bank Fee Index**, a dataset of bank and credit union
fees read from each institution's own fee schedule, and sells **Hamilton**, the paid workspace for
bank and credit union marketing, product and pricing teams. Brand strings live in
`src/lib/constants.ts`.

## What is in this repository

- **The site and Hamilton**: a Next.js 16 / React 19 / TypeScript app (`src/app`). Vercel runs it,
  and its API routes are the only runtime boundary.
- **The data pipeline**: typed agent modules in `src/lib/agents`, run step by step through a
  visible run ledger (`agent_runs`, `agent_run_steps`, `agent_run_events`) in Supabase Postgres.
- **Project memory**: decisions, findings and lessons in `docs/project/` (start at
  `docs/project/README.md`).

## The pipeline

Atlas -> Magellan -> Rosetta -> Knox -> Darwin -> Hamilton.

| Agent | Role |
|---|---|
| Atlas | Orchestrates runs and is the operator command center; it never extracts, classifies or publishes fees itself |
| Magellan | Finds each institution's fee schedule and captures the document |
| Rosetta | Turns the document into text |
| Knox | Reads fees from the text (`raw_fee_observations`) |
| Darwin | Verifies each fee against the bank's own document and re-checks live fees (`verified_fee_observations`) |
| Hamilton | Publishes verified fees (`published_fee_records`) and answers questions over them |

Deming audits accuracy daily. Product, report and API reads use `published_fee_catalog` for dollar
fees and `published_fee_rate_catalog` for fees stated as a rate. Each agent's role, boundaries and
lessons are in `AGENTS.md`, `src/lib/agents/<agent>/AGENTS.md` and
`src/lib/agents/<agent>/role-lessons.ts`.

## Running it locally

Use Node 22.

```bash
npm install
cp .env.example .env.local   # fill in what you need; DATABASE_URL is the minimum
docker compose up -d         # optional local Postgres on port 5433
npm run dev                  # http://localhost:3000
```

Agent work advances through `/api/admin/agents/tick`. Provider (model) calls go only through
`src/lib/ai-provider.ts`, and `src/lib/automation-control.ts` holds the provider stop and the
pipeline and marketing pauses.

## Checks

Run these before pushing. CI runs the same ones, plus the database tests.

```bash
npm run guard:legacy                                          # repository rules (scripts/ci-guards.sh)
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .  # type check
npx eslint <changed files>
npx vitest run <changed suites>
npm run test:quality-gates                                    # fee category and hard-document gates
```

Database tests (`*.db.test.ts`) skip without a database. CI runs them in the e2e job, listed
under `E2E_TESTS` in `.github/workflows/test.yml`.

## How changes are made

`CLAUDE.md` and `AGENTS.md` hold the working rules. In short:

- One outcome, one branch, one PR. Search for existing work first.
- Fix the pipeline step that caused an error, not the single fee, and add a lesson for that agent.
- A merge needs an independent review of the exact head and green CI.
- Migrations and production-data changes need James's yes. New migration files take the next
  14-digit number in `supabase/migrations/`.

Contact: hello@bankfeeindex.com
