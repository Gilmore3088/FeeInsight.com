# Fee Report Studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** The Studio sidecar in `reports/studio/` that turns an institution_id into a
consulting-grade PDF, plus a coverage-verified 25-institution matrix and a pilot report.

**Architecture:** Offline tooling only. Postgres read via DATABASE_URL from .env.local,
`published_fee_catalog` reads exclusively. HTML template filled with a data-pack JSON,
rendered by headless Chrome. No app/runtime changes.

**Tech:** tsx/node + pg, HTML/CSS print styles, Chrome headless.

## Global Constraints
- Fee reads from `published_fee_catalog` ONLY (repo hard rule).
- No new deps in package.json if avoidable (pg already present via app).
- Nothing outbound is sent by tooling; user sends.
- Studio files live in `reports/studio/`; commits use conventional format.

### Task 1: Coverage query + matrix
- [ ] Write `reports/studio/coverage.sql`: institutions with ≥12 of the 15 featured
      categories published, grouped by charter_type, asset tier, fed district.
- [ ] Run against DB (DATABASE_URL from .env.local). Verify ≥25 viable across matrix.
- [ ] Write `matrix.md`: 25 chosen slots (district × tier × charter) with institution
      ids/names + status column (selected → pulled → written → rendered → reviewed → sent).
- [ ] Commit: `feat(studio): coverage query and 25-institution matrix`

### Task 2: pull-data script
- [ ] `reports/studio/pull-data.ts`: arg institution_id → `packs/<id>.json` per spec
      schema (fees, peer stats via charter+tier cohort ≥10 peers, percentiles,
      outlier flags per fee-benchmarking rules, named peer values, meta).
- [ ] Verify: run for pilot institution; JSON validates; spot-check 2 numbers by SQL.
- [ ] Commit: `feat(studio): institution data-pack extraction`

### Task 3: template + renderer
- [ ] `reports/studio/template.html`: 8 sections per spec, print CSS (Letter,
      margins, page breaks), one accent color, chart placeholders driven by data
      (CSS bar percentiles; no JS libs).
- [ ] `reports/studio/fill.ts`: data-pack + narrative JSON → filled HTML.
- [ ] `reports/studio/render.sh`: filled HTML → PDF via
      `chrome --headless --print-to-pdf`.
- [ ] Verify: render with pilot pack + placeholder narrative; open PDF; page count
      12±3; no overflow.
- [ ] Commit: `feat(studio): report template and PDF renderer`

### Task 4: pilot report + outreach kit
- [ ] Generate pilot narrative (Claude, fee-benchmarking + executive-report skills)
      from pilot pack; render final PDF to `reports/studio/out/`.
- [ ] `outreach-template.md` (email draft w/ placeholders) + `outreach-log.md`.
- [ ] Update matrix status; commit: `feat(studio): pilot report and outreach kit`.

### Task 5: handoff
- [ ] Final summary: pilot PDF path, matrix, per-report runbook (the ~1-hour loop),
      what only the user can do (review + send).
