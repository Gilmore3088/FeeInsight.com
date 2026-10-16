---
name: audit-data
description: Run data quality checks on the current Postgres-backed Fee Insight database and agentic pipeline
user_invocable: true
---

# Data Hygiene Audit

Run a data quality audit against the current Fee Insight Postgres model.

## Runs daily in the pipeline

Deming's `deming-data-quality` step runs these checks every day in Atlas's scoreboard run
(`src/lib/agents/deming/data-quality.ts`, #1065): duplicates, stale fees, fees with no category,
fees with no source link, and each category's share against its normal share, with the thresholds
below, and an ALARM in the step summary for a check at FAIL. The sampled source trace is the
`deming-fresh-audit` step. Read today's results on /admin/scoreboard ("Data checks failing") or in
the step's `step.finished` detail before running anything by hand; use this skill for a deeper,
one-off look the daily step does not cover.

## What This Skill Does

Use current `src/lib/data-store/*` queries or direct read-only SQL to identify data quality issues. Product/report fee reads must use `published_fee_catalog`; pipeline diagnostics may inspect `raw_fee_observations`, `verified_fee_observations`, `published_fee_records`, and the agent run ledger.

## Steps

1. Read current data through `src/lib/data-store/connection.ts` or existing `src/lib/data-store/*` helpers.
2. Check institution coverage, source coverage, fee publication coverage, agent backlog, stale runs, and provider/circuit state.
3. Present findings with row counts, examples, and the owner agent for each fix.
4. Route operational fixes through visible `agent_runs` work instead of one-off scripts.

## Checks

| Check | Source | Healthy Target |
|-------|--------|----------------|
| Invalid state codes | `institution_sources.state_code` | 0 institutions |
| Source URL gaps | `institution_sources.website_url`, `institution_sources.fee_schedule_url` | Trending down |
| Published fee coverage | `published_fee_catalog` | Trending up |
| Raw-to-verified conversion | `raw_fee_observations`, `verified_fee_observations` | Backlog shrinking |
| Agent run health | `agent_runs`, `agent_run_steps`, `agent_run_events` | No silent queued/running runs |
| Provider/circuit health | `automation_control`, `ai_api_usage_events` | Blocked reasons visible |
| Missing financial data | `institution_financial_records` joined to `institution_sources` | Trending down |

## Useful Read-Only SQL

```sql
SELECT state_code, COUNT(*) AS count
FROM institution_sources
WHERE state_code NOT IN ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','VI','GU','AS')
AND state_code IS NOT NULL
GROUP BY state_code;

SELECT
  COUNT(*) AS institutions,
  COUNT(*) FILTER (WHERE website_url IS NOT NULL AND btrim(website_url) <> '') AS with_website,
  COUNT(*) FILTER (WHERE fee_schedule_url IS NOT NULL AND btrim(fee_schedule_url) <> '') AS with_fee_url
FROM institution_sources;

SELECT status, COUNT(*) AS count
FROM agent_runs
GROUP BY status
ORDER BY count DESC;

SELECT COUNT(DISTINCT institution_id) AS institutions_with_published_fees,
       COUNT(*) AS published_observations
FROM published_fee_catalog;
```

## Output Format

```md
| Check | Result | Status | Owner |
|-------|--------|--------|-------|
| Source URL gaps | 1,234 | WARN | Magellan |
| PDF pending OCR | 456 | WARN | Rosetta |
| Low-confidence raw rows | 78 | REVIEW | Knox/Darwin |
```

## Key Files

- `src/lib/data-store/connection.ts` - Postgres connection boundary.
- `src/lib/data-store/*` - Current data access layer.
- `src/lib/agents/run-store.ts` - Current agent run ledger.
- `src/lib/agents/*` - Agent implementations.
- `src/lib/ai-provider.ts` - Provider boundary and circuit checks.
