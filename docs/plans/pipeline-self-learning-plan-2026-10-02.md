# Plan: a self-learning, fully logged fee pipeline that fixes every audit finding

## Context

The 2026-09-30 audit (`docs/audits/2026-09-30-data-pipeline-audit.md`) found these
problems:

- **The pipeline has been stopped since 2026-08-23.** Every cron tick returns 423
  because a disabled budget policy gates it.
- **The index shows wrong numbers.** The median concatenates strings, rows are
  counted instead of institutions, and the index cache is frozen.
- **Duplicates start at the source.** Every fetch creates a new document.
- **Extraction is weak.** It is regex-only, it destroys table structure, and only 77
  documents have ever been read.
- **Operations are fragile.** There are no time budgets, claims, reaper, alerting or
  funnel metric, and CI is red.
- **Coverage is 2.7%.** 239 of 8,750 institutions have sourced published fees.

**The core of this plan is learning, not just repair.** Whatever a run learns about
an institution must persist and change what the next run does. Examples:
- Bank 123's schedule is a scanned PDF, so it goes straight to OCR.
- Bank 857 is static HTML with a two-column table, so it uses the DOM table reader
  and its saved template at $0.
- Path `/disclosures/fees.pdf` works on Banno-hosted sites, so discovery tries it
  first for that platform.
- This alias already confused "service charge" with maintenance once, so it stays
  fixed.

**The guarantee you asked for:** money spent finding an error is never spent finding
it again. Every attempt is logged. A failed (content, method) pair is never repeated.
Every confirmed correction becomes a permanent rule and a regression test.

**Your decisions:**
- Unblock now with temporary policy caps, a production write I make only after you
  approve it, plus a code-level gate split.
- AI budget of **$300/month**, a hard cap.
- Unsourced legacy rows are **hidden from statistics** until re-sourced.
- **One PR per phase.**

**Rules that apply throughout** (from CLAUDE.md and AGENTS.md):
- No one-off scripts. Everything runs as typed agent steps with run-ledger events.
- Migrations go only in `supabase/migrations/`, timestamped after
  `20270101060100`.
- Provider calls go only through `src/lib/ai-provider.ts`.
- `guard:legacy`, `test:agentic`, `tsc` and `lint` must be green on every PR.

---

## The learning system (the spine of every phase)

Five parts. Each is a typed module in `src/lib/agents/learning/` with tests, and is
called by every agent.

### L1. Attempt log: every action, append-only

Add a `pipeline_attempts` table with one row per (institution, stage, strategy)
attempt. Columns:

| Group | Columns |
|---|---|
| Identity | `institution_id`, `source_document_id`, `stage` (discover/fetch/read/extract/verify/publish) |
| Method | `strategy` (e.g. `fetch.conditional`, `fetch.headless`, `read.html_dom`, `read.pdf_layout`, `read.docx`, `read.ocr_vision`, `extract.alias_rules`, `extract.template:<id>`, `extract.llm`), `strategy_version` |
| Input | `input_fingerprint`: content hash, plus layout fingerprint for reads and extracts |
| Result | `outcome` (typed code, see below), `yield` (rows/chars/links), `expected_yield` |
| Cost | `cost_microusd`, `provider_calls`, `duration_ms` |
| Lineage | `agent_run_id`, `agent_run_step_id`, `error_detail jsonb`, `created_at` |

- **Typed outcome codes** live in `learning/outcomes.ts`: `ok`, `ok_partial`,
  `unchanged`, `http_403`, `http_404`, `soft_404`, `timeout`, `too_large`,
  `blocked_bot`, `js_required`, `scanned_pdf`, `wrong_document`,
  `no_candidates`, `low_yield`, `evidence_mismatch`, `budget_blocked`, and others.
  Free-text-only failures are not allowed.
- A helper, `recordAttempt()`, writes the attempt row and the `agent_run_events` row
  in the same transaction, so the ledger and the log can never disagree.

### L2. Institution playbook: per-institution memory

Extend the existing `institution_source_profiles` (migration
`20260815083319_agent_state_lane_memory.sql`). It already holds
`canonical_source_url`, `source_kind`, `read_strategy`, `consecutive_failures` and
`locked_by_correction`. Add:

- `documents jsonb`: every known fee document (URL, format, last hash, last yield),
  because institutions often split fees across 2–3 PDFs.
- `format`: `pdf_text`, `pdf_scanned`, `html_static`, `html_js`, `docx` or `other`.
  Detected from bytes, not from the URL.
- `platform`: the website-platform fingerprint (Banno, Q2, Fiserv, WordPress,
  custom…), detected from homepage markers.
- `layout_fingerprint`: a hash of the document's structure (table shape, header
  terms).
- `best_strategy jsonb`: the chosen strategy per stage.
- `strategy_stats jsonb`: attempts, successes, mean yield and mean cost per
  strategy.
- `expected_fee_count`: the trailing median yield, used to detect drift.
- `do_not_retry jsonb`: (strategy, content hash) pairs that failed.
- `cost_to_date_microusd`, `last_learned_at`.

A deterministic updater, `learning/playbook.ts → applyAttempt(attempt)`, updates these
fields after every attempt. It does not use an LLM.

### L3. Strategy router: memory decides the next action

`learning/router.ts → chooseStrategy(institutionId, stage, contentHash)`:

1. **Never repeat a known failure.** If (strategy, `strategy_version`,
   `content_hash`) is in `do_not_retry` or in the attempt log as failed, skip it.
   Unchanged content plus an unchanged method means no new attempt and **no new
   spend**. It is retried only when the content changes or the strategy version is
   bumped.
2. **Use what worked.** Choose the cheapest strategy whose success rate on this
   institution is at least 80%. Order: alias rules ($0) → saved template ($0) →
   LLM ($).
3. **Use priors when there is no history.**
   - By format: a scanned PDF goes straight to `read.ocr_vision`; a JS page goes
     straight to `fetch.headless`.
   - By platform: the discovery paths ranked by success rate for that platform.
   - Otherwise the global default.
4. **Escalate only in order**, and only within budget. A paid step can run at most
   twice per content hash. After that the item goes to `needs_human` with the
   evidence attached.
5. **Explore a little.** 5% of $0-cost decisions try the next-best free strategy so
   that the statistics stay current.

Each choice is logged with its reason, for example
`"router: pdf_scanned prior → ocr_vision"`, so every decision can be audited.

### L4. Knowledge promotion: paid answers become free rules

Learned knowledge goes into versioned tables. Each row stores its provenance and
confidence.

- **`fee_name_aliases`** (normalized fee name → canonical key).
  - Fed by LLM labels, Darwin-verified rows and human review.
  - A label is promoted to `active` when two independent signals agree (for example
    LLM + Darwin envelope, or LLM + a human verdict); otherwise it waits in a review
    queue.
  - Knox's free alias pass uses active aliases first, so deterministic coverage grows
    every week.
- **`extraction_templates`**, keyed by (institution or platform, layout
  fingerprint).
  - Contains the row and column mapping, the header terms and a key map.
  - Derived automatically from a verified LLM extraction: the evidence spans show
    which cells held the name and the amount.
  - When the same layout reappears (an updated PDF, or another bank on the same
    platform), the template runs at $0.
  - Drift detection: if yield falls below 70% of `expected_fee_count`, the template
    is marked `drifted` and the router escalates once.
- **`discovery_patterns`**, keyed by (platform, path pattern, link text), with
  success and attempt counts. Discovery ranks candidates by this learned hit rate.
- **`category_envelopes`**: p1/p99 per canonical key, recomputed weekly. Darwin uses
  them.
- **`host_policies`**: per-host crawl delay, robots rules, bot-block status and
  soft-404 behavior, so politeness and blocks are remembered.

### L5. Error-to-test loop: no error is paid for twice

Every confirmed error turns into three things:

1. **A rule change.** For example a new alias, a pattern-order fix, a host policy or
   an envelope.
2. **A regression fixture.** The source text snippet and the correct output are
   added automatically to `src/lib/agents/__fixtures__/regressions/`, through a
   generated PR from the weekly retrospective. CI then fails if that error ever
   comes back.
3. **A `pipeline_lessons` row.** Each row has a pattern, an example, the fix applied,
   when it was learned and the cost it avoids. This is the readable memory of
   "what we've learned".

Confirmed errors come from:
- human review verdicts;
- Darwin envelope rejections that a human confirms;
- disagreements between the LLM and the template;
- report-review flags from you.

**Weekly retrospective run.** A scheduled Atlas run kind, `learning_retro`, that:
- recomputes strategy stats, priors, envelopes and the precision of each alias;
- re-scores the gold set and regression sets on the current extractor versions;
- lists regressions, newly promoted knowledge, spend by stage and cost per new
  sourced fee;
- writes all of this to the ledger and to an admin page,
  **`/admin/atlas/learning`**: "What the pipeline learned this week".

### What this looks like for your examples

| Situation | Run 1 | Run 2 and later |
|---|---|---|
| Bank 1 schedule is a scanned PDF | `read.pdf_layout` → `scanned_pdf` (logged, $0) → `read.ocr_vision` (paid) | Router skips straight to OCR, and only when the hash has changed. Same hash means no work and $0. |
| Bank 857 is HTML with a fee table | `read.html_dom` + `extract.alias_rules` gets 60% → `extract.llm` fills the rest → template saved | `extract.template` runs alone at $0. LLM runs again only if drift is detected. |
| 200 newly discovered URLs, mixed formats | Format detected from bytes, platform fingerprinted, each logged | Per-format and per-platform priors route new institutions correctly on their first try. |
| An LLM error found in review ($ spent) | Verdict recorded → alias or template fixed → regression fixture → lesson | The same input yields the corrected output for free, and CI blocks any regression. |

---

## Phase 0: Restart and S0 fixes (PR 0, about 2 days)

**0.1 Production restart. Needs your approval at the time.**
- Set real caps on the `api_budget_policies` row `route:api.admin.agents.tick`.
- Mark zombie run 240 and its step as `failed` ("reaped").
- Verify that the tick returns 200 and lane runs appear.

**0.2 Gate split.** Files: `tick/route.ts`, `run-store.ts` (~L1068),
`automation-control.ts`, `api-hardening/budget.ts`.
- Add `PROVIDER_STEP_KEYS` in `src/lib/agents/types.ts`.
- The budget and the automation stop gate only provider steps.
- Add a separate `automation_control` `pipeline` row as the operator pause, with a
  toggle in `atlas-emergency-control.tsx`.
- Unify the circuit and resume markers (`automation-control.ts:91` against
  `ai-provider-usage.ts:154-181`), and add a "billing resolved" override.

**0.3 Reaper.** `reapStaleAgentSteps()` runs first in every tick:
- re-queue steps that ran longer than twice their budget;
- mark a step `dead` after 3 attempts;
- write an event for each transition.

**0.4 Median and cache.**
- NUMERIC (oid 1700) parser in `src/lib/data-store/connection.ts`.
- Even-n tests in `fees.test.ts`.
- `getNationalIndexCached` reads live data until Phase 1 rebuilds the cache.

**0.5 CI green.**
- Make `legacy-kill` exclude `AGENTS.md` prohibition lines (`scripts/ci-guards.sh`
  ~L134).
- Add `tsc` and `lint` to `.github/workflows/test.yml`.

**0.6 Alerting.** Rewrite `api/admin/job-health/route.ts` and `src/lib/job-health.ts`
on current tables:
- last 200 tick;
- 423 count;
- stale steps;
- overdue lanes;
- hours since the last publish.

You attach an external uptime monitor to it.

**0.7 Hygiene.**
- Change the User-Agent to `FeeInsightBot/1.0 (<Agent>; +https://feeinsight.com/contact)`.
  No public `/bot` page, by owner decision.
- Make `brand-kill` catch the old UA.
- Correct the CLAUDE.md and `darwin/AGENTS.md` claims.

**Verify:** local gates all pass; in production, 24 hours of 200 ticks, lane runs
completing, and job-health 200.

---

## Phase 1: Learning foundation, idempotency and correct numbers (PR 1, about 3–4 weeks)

**This phase must ship before any money is spent.** Phase 3's paid steps cannot run
without L1–L3.

**1A. Migrations**
- A baseline `IF NOT EXISTS` migration for the production-only objects: ledger
  tables, `agent_url_discovery_attempts`, `agent_document_texts`, the dedup indexes.
- The learning tables:
  - `pipeline_attempts`
  - the playbook columns on `institution_source_profiles`
  - `fee_name_aliases`
  - `extraction_templates`
  - `discovery_patterns`
  - `category_envelopes`
  - `host_policies`
  - `pipeline_lessons`
  - `pipeline_funnel_daily`
- Idempotency:
  - unique active `agent_runs.idempotency_key`, with `INSERT … ON CONFLICT` in
    `run-store.ts:1331`;
  - `source_documents (institution_id, content_hash)` unique, plus `etag`,
    `last_modified`, `last_checked_at` and `document_r2_key`;
  - `agent_source_texts` unique on `(document, extractor_version)`, append-only,
    with `structured_rows` and `page_spans`.
- Raw evidence columns: `line_hash`, offsets, `page`, `is_zero`, `is_fee_cap`,
  `amount_max`, `pct`, `basis`, `waiver_conditions` and `extract_status`. Knox rows
  are unique on `(document, line_hash)`.
- Verified rows get a real `review_status` and `reason_code`, plus `variant_type`
  and `taxonomy_version`.
- Published rows get `fee_line_id`, `valid_from`, `valid_to`, `superseded_by` and
  `is_fee_cap`, a unique current key, and a NOT VALID lineage CHECK.
- A `fee_taxonomy` table with a NOT VALID FK.
- `fee_change_records` unified on one column set.
- A rebuilt `published_fee_catalog` with real columns, and a
  `published_fee_current` view (sourced, current rows only).

**1B. Learning modules L1–L3** (`src/lib/agents/learning/`).
- Build `recordAttempt`, `applyAttempt` and `chooseStrategy`.
- Wire them into Magellan, Rosetta, Knox, Darwin and Hamilton. Every agent calls the
  router before it acts and `recordAttempt` after.
- Format detection from bytes: `%PDF`, docx zip signature, HTML; text density per
  page for scanned PDFs; JS-shell detection for HTML.
- Platform fingerprinting from homepage markers.

**1C. Acquisition (Magellan) and stored bytes.**
- Conditional GET. An unchanged response records an `unchanged` attempt instead of a
  new document.
- Upload bytes to R2, reusing the S3 client in `src/lib/report-engine/presign.ts`.
- Use typed outcome codes.
- Stream bodies with a cap and an abort timeout.
- Rosetta reads the R2 bytes instead of fetching the page again.

**1D. Rosetta strategies** (each one is a versioned strategy):
- `read.html_dom`: htmlparser2, already present through `sanitize-html`. Table rows
  become structured rows with the heading path; entities are decoded once.
- `read.pdf_layout`: unpdf `getTextContent` grouped by y then x, keeping page
  numbers.
- `read.docx`: adds a small dependency such as `mammoth`, which needs your OK at
  implementation time.
- Scanned-PDF routing records a `scanned_pdf` outcome, and the playbook remembers it.
  The OCR flip-flop bug goes away because the playbook, not the profile sync, owns
  the format.

**1E. Knox, free tier.**
- Run `extract.alias_rules` (most-specific-first patterns plus the active
  `fee_name_aliases`) and `extract.template`.
- Fix the amount regex and pair each amount with its fee noun.
- Parse ranges, percentages and caps; keep $0 and waived rows.
- Send unclassified rows to review.
- Hash on `(document, line_hash)`, with no `runId`.
- Seed `fee_name_aliases` from `CANONICAL_KEY_MAP` (`src/lib/fee-taxonomy.ts`), with
  the known-wrong synonyms corrected and added as the first `pipeline_lessons`.

**1F. Darwin and Hamilton.**
- **Darwin:**
  - terminal `rejected`/`needs_review` rows with reason codes (no starvation);
  - envelope checks from `category_envelopes`;
  - lineage and duplicate checks.
- **Hamilton:**
  - record the real Darwin event id in place of the fabricated adversarial id;
  - supersede rows on amount change and write `fee_change_records`;
  - close rows with a tombstone when a fee line disappears;
  - movement detection on the full key;
  - SAVEPOINTs in place of swallowed errors;
  - dry run parity with real runs.

**1G. Statistics contract.**
- A `fee_index_stats(scope)` SQL function: per-institution dedupe, $0 included,
  n ≥ 5 to show a median (≥ 20 for "strong"), sourced current rows only.
- Materialize it into `fee_index_cache` after each publish, stamped with `run_id`.
- Rewrite `fees.ts`, `fee-index.ts`, `peers.ts`, `market.ts`, `states.ts`,
  `geographic.ts` and `core.ts` to use it.
- Delete the dead `approvedOnly` and 'flagged' paths.

**1H. Data repair as Atlas workflows.**
- "Rebuild document lineage": collapse duplicate documents by hash.
- Extend `reclassify-write` to map or quarantine the ~35 non-canonical categories.
- "Backfill playbooks from history": derive format, platform and strategy stats
  from the existing 12k documents and 77 texts, so the system starts with memory
  rather than from zero.

**1I. CI.**
- Add `next build` and the full vitest suite.
- Add a Postgres service job that applies the migrations and runs concurrency,
  reaper and idempotency tests.
- Add `sqlite-kill`, and strengthen `provider-kill`.

**Verify:**
- Run the pipeline twice on the same 50 institutions. The second run makes zero new
  documents, texts and raw rows, every row is logged as `unchanged`, and spend is $0.
- Every attempt row carries a typed outcome.
- Medians match a hand SQL check.
- The 25 report PDFs are regenerated with an old/new number diff for your review.

---

## Phase 2: Scale and the improvement loop (PR 2, about 3 weeks)

**2A. Throughput.**
- Every loop takes a time budget (~240s deadline) and returns `partial` with a
  cursor.
- `boundedConcurrency` allows 10 requests overall and 1 per host, honoring
  `host_policies`.
- Item claims (`claimed_until`, `next_attempt_at`, `SKIP LOCKED`) with exponential
  backoff.
- Global stage queues replace lane-bound execution. Lanes become progress and
  priority views.
- `public-discovery` / `public-audit` move to their own daily QA run.
- The profile sync becomes incremental.

**2B. Discovery that learns** (L4 `discovery_patterns`).
- Rank candidates by learned hit rate per platform, with real homepage links above
  guesses.
- Use the redirected origin and allow the same registrable domain.
- Crawl one level into Disclosures, Rates and Documents pages, and read the sitemap.
- Detect soft-404s.
- Dead URLs go back into rediscovery.
- Fix URL-correction shadowing (`institution-commands.ts`, `quality/actions.ts:129`,
  `state-lane-memory.ts:393`).
- `source_validation_queue` and community submissions become queue inputs.
- Respect robots.txt and crawl delay through `host_policies`.

**2C. Universe sync.** A Magellan "census" step pulls FDIC BankFind and NCUA data
quarterly:
- add, merge and deactivate institutions;
- backfill the 634 missing websites;
- verify the 2,019 suspect "Federal" credit union names.

**2D. Gold set plus the L5 error-to-test loop.**
- Label 100 documents, starting with the 25 report institutions, across HTML, PDF,
  scanned and docx.
- The evaluation scores precision and recall per field.
- Regression fixtures are generated automatically from confirmed errors.
- CI fails on any regression.

**2E. Review and promotion.**
- An admin review queue for `needs_review` rows, alias candidates and the weekly
  stratified 2% sample.
- Each verdict feeds L4/L5: alias promotion, envelope updates, fixtures and lessons.
- The Knox review page (`knox-reviews.ts`) is re-pointed to this queue.

**2F. Weekly retrospective and observability.**
- The `learning_retro` run kind.
- The `/admin/atlas/learning` page.
- A `pipeline_funnel_daily` trend on `/admin/atlas`.
- In Atlas status, fix "latest event" and the stale thresholds.
- Remove the dead dashboards (`pipeline-runs.ts`, the `agent_events` rollup, the
  `source_collection_runs` panels).

**Verify:**
- At least 2,000 fetches a day.
- Queue age p95 under 24h.
- Discovery hit rate improves week over week on the retro page.
- The gold-set evaluation is in CI.

---

## Phase 3: Paid intelligence under the $300/month cap (PR 3, about 6 weeks)

- **Budget policy:** $300/month, $10/day and $2/run, `fail_closed`. Add a cap per
  institution, and the router's limit of 2 paid attempts per content hash.
- **`extract.llm`.**
  - Read the claude-api skill first.
  - Schema-constrained output with evidence offsets. A row is rejected unless its
    evidence span contains the literal amount.
  - Runs only where the free tiers yield less than `expected_fee_count`, or disagree.
  - Every verified LLM extraction produces a template (L4), so the same layout never
    costs money again.
- **`read.ocr_vision`.** OCR through `ai-provider.ts` for documents the playbook
  marks `pdf_scanned`, only when the hash has changed. The output becomes an
  `ocr`-tagged text version.
- **`fetch.headless`** for `html_js` institutions: `@sparticuz/chromium` with
  `playwright-core`, concurrency 1. The rendered HTML goes to R2. Risk: Vercel size
  limits; the fallback is to defer this step.
- **Provenance backfill:** a prioritized workflow over the 944 unsourced institutions
  that have a URL on file. Sourced rows supersede the legacy ones.
- **Freshness and history:**
  - a 30-day re-fetch SLA;
  - rows go stale at 180 days and leave the index at 365 days;
  - a Wayback CDX archive agent dates historical fee changes.
- **Cost efficiency KPI on the retro page:** cost per new sourced fee and the share
  of extractions done at $0. The target is a $0 share that rises month over month.

**Verify:**
- Spend stays at or under the cap.
- A second pass over the same changed-layout documents costs $0, because templates
  were used.
- Gold-set recall rises while precision stays at 95% or above.
- 2,500 or more sourced institutions at 90 days.

---

## Docs

- **PR 0:** correct CLAUDE.md and `darwin/AGENTS.md`.
- **PR 1:**
  - Merge the CLAUDE.md agent guidance into AGENTS.md.
  - Add `src/lib/agents/learning/AGENTS.md`, which defines the contract that every
    agent must call `chooseStrategy` and `recordAttempt`.
  - Add a guard, `learning-contract-kill`, that fails CI if an agent stage module
    lacks them.
- **Each PR:** update `docs/outstanding-tasks.md` and the audit's status column.

## Out of scope

Email capture on the public site is already queued as a separate task.

## Traceability

Phases 0–3 cover every audit recommendation:
- **Phase 0:** R-O1, R-O2, R-O3 (part 1), R-D1, R-H1 (part 1), R-H4.
- **Phase 1:** R-O7, R-D2–D6, R-E1, R-E2, R-E6 (part 1), R-E7, R-H1, R-H2, R-H5.
- **Phase 2:** R-O3–O6, R-G1, R-G2, R-G5, R-E5, R-E6.
- **Phase 3:** R-E3, R-E4, R-G3, R-G4, R-D5 (backfill).

The learning system (L1–L5) is new scope, added at your request.
