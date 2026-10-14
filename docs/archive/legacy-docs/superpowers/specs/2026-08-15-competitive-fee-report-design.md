# Competitive Fee Position Report — Design

**Date:** 2026-08-15 · **Status:** approved (user delegated via /goal complete all)
**Goal:** 25 consulting-grade, institution-specific fee reports (all 12 Fed districts,
all asset tiers, banks + CUs), given free; monetization discovered from replies.
First-revenue vehicle for the 90-day goal.

## Strategy (user's answers)
- Delivery: **concierge/Studio** — semi-automated, human-reviewed, ~1 hr/report after setup.
- Channel: the 25 reports ARE the outreach — each institution receives its own report.
- Free vs paid: **full report free to all 25**; paid offer = whatever replies ask for
  (refresh subscription, deep-dives) — no payment infra until a buyer defines it.

## The report (~12–15 pp, "Competitive Fee Position Report — <Institution>")
1. Cover (their name, market, quarter, Bank Fee Index brand)
2. Executive summary — 3 findings, each with a number
3. Competitive position — 15 featured fees vs peer group (charter type + asset tier,
   ≥10 peers per existing fee-benchmarking methodology); percentile position map
4. Outlier callouts — 2–4 fees flagged by existing outlier rules, each with
   revenue-exposure / marketing-opportunity narrative
5. Named peer table with actual fee values (public data — the "whoa" page)
6. District & national context (district-economic-outlook skill)
7. Methodology & data provenance (published fee schedules, verified pipeline, pull date)
8. Back page — contact + soft ask ("refreshed quarterly? deeper dive? reply")

Design: restrained consulting aesthetic, one accent color, real charts, print-first CSS.

## E2E process
select (coverage-driven matrix) → pull (data-pack JSON) → write (Claude narrative via
fee-benchmarking + executive-report skills) → render (HTML→Chrome headless→PDF) →
review (human) → send (user sends; drafts prepared) → log (outreach-log.md; paid
product designed from replies).

## Components — `reports/studio/` (sidecar; no app-route/runtime changes)
- `template.html` — the report shell; placeholders filled per institution
- `pull-data.ts` — institution_id → data-pack JSON; reads `published_fee_catalog`
  ONLY (repo hard rule); peer stats, percentiles, outliers per skill methodology
- `render.sh` — filled HTML → PDF via Chrome headless
- `matrix.md` — 25 slots (district × tier × charter) + per-report status
- `outreach-log.md` — sent/replies/asks
- Data-pack schema: institution {name, id, charter, tier, district, city/state},
  fees[15] {category, their_value, peer_median, peer_p25, peer_p75, national_median,
  percentile, flag}, peers[] {name, values}, meta {pull_date, peer_count}

## Constraints
- `published_fee_catalog` only for fee reads; no `extracted_fees` (repo hard rules)
- No Modal/edge-function/crawler reintroduction; Studio is offline tooling
- Outbound sending is ALWAYS user-performed
- Selection must be coverage-verified before matrix is fixed

## Success criteria
1. Coverage query proves ≥25 viable institutions across the matrix dimensions
2. Pilot report renders end-to-end for 1 institution and looks consulting-grade
3. Marginal report ≈ 1 hour (data pull + narrative + render + review)
4. Outreach draft template ready; log file exists
5. Zero production behavior changes
