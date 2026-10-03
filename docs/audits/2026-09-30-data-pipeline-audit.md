# Data Pipeline Audit — 2026-09-30

Scope: the whole fee-data pipeline, Atlas → Magellan → Rosetta → Knox → Darwin →
Hamilton → `published_fee_catalog` → product reads, plus orchestration, schema, CI and
docs. The audit was read-only: static review of the code at `307176c`, local runs of
`guard:legacy`, `test:agentic` and `tsc`, and read-only SQL against production
(`rmhwbbjjctzfaqjyhomu`) on 2026-09-30. Nothing in production was changed.

Severity: **S0** means the pipeline is not running or product numbers are wrong ·
**S1** means correctness or scale is blocked · **S2** means hygiene or debt.

## Remediation status

Tracked in `docs/plans/pipeline-self-learning-plan-2026-10-02.md`.

| Item | Status |
|---|---|
| R-O1 gate split (deterministic steps no longer need the provider budget or provider stop) | Fixed in Phase 0 (code). The production tick-policy caps still need operator approval. |
| R-O2 stuck-step reaper | Fixed in Phase 0 |
| R-O3 (part 1) job-health rebuilt on the ledger and tick audit | Fixed in Phase 0; an external monitor still needs attaching |
| R-D1 median string bug, plus never serving a stale `fee_index_cache` | Fixed in Phase 0 |
| R-H1 (part 1) CI green; tsc, lint and the full test suite added to CI | Fixed in Phase 0 |
| R-H4 crawler User-Agent (`FeeInsightBot/1.0 (<Agent>; +https://feeinsight.com/contact)`) | Fixed in Phase 0; no separate `/bot` page, by owner decision |
| Learning core L1–L3 (attempt log, playbook, router); content idempotency for fetch, read and extract (R-D4, part 1); byte-based format detection and the OCR flip-flop | Fixed in Phase 1a (`src/lib/agents/learning/`). Existing duplicates and the unique index come in a later dedupe workflow. |
| R-D2 statistics contract (per-institution dedupe, $0 included, n≥5 for a median, ≥20 for "strong", sourced rows only per R-D5) | Fixed in Phase 1g in TypeScript (`src/lib/data-store/fee-stats.ts`). Materializing it into `fee_index_cache` after each publish is still open. |
| Everything else | Phases 1–3 |

---

## 1. Executive summary

1. **The pipeline has not run for 38 days (S0).** Every 5-minute cron tick since
   2026-08-23 00:05 UTC has returned HTTP 423 `budget_policy_disabled`. That is about
   11,000 blocked ticks (`api_route_audit_events`), and the latest was 08:20 UTC
   today. The block started when the tick budget policy took effect, right after the
   2026-08-23 emergency stop ("Potential runaway API activity"). The stop was lifted
   at 00:20 the same day, but the policy block was not. The
   policy row `api_budget_policies.policy_key = 'route:api.admin.agents.tick'` is
   `enabled=false` with every cap NULL. The fee pipeline makes **zero** provider
   calls, yet it is gated on provider budget caps. The last agent run in the ledger
   was 2026-08-23 00:21 UTC, and all 54 state lanes are overdue. Nothing alerted
   anyone.
2. **Almost all of the catalog did not come from the agents.** 98.5% of
   `raw_fee_observations` (102,965 of 104,532) come from the one-time
   `migration_v10` backfill. Knox has produced 1,073 raw rows in total. Rosetta has
   normalized **77 documents**, while Magellan has fetched 4,422 successfully. The
   biggest drop in the funnel is between fetch and read, not in discovery.
3. **Sourced coverage is 2.7% of the universe.** 239 of 8,750 institutions have
   published fees with a source URL. The catalog as a whole covers 1,183
   institutions, but 76% of its rows have no source.
4. **The index statistics have correctness bugs (S0).**
   - Peer and district medians concatenate NUMERIC strings: $10 and $20 give a
     median of 10.01.
   - Rows are counted instead of institutions.
   - $0 ("free") fees are excluded everywhere, which biases medians upward.
   - The view hard-codes `review_status='approved'`, so every "approved only" and
     "flagged" code path does nothing.
   - `fee_index_cache` is never rebuilt, so 22 call sites serve a frozen index
     from before the agent pipeline.
5. **Extraction is regex-only and loses the most common fee phrasing.**
   - First-match category ordering files overdraft and returned-item "service
     charges" as monthly maintenance.
   - `$1500` parses as $150.
   - HTML tables are split so the fee name and amount land on different lines.
   - Waived, free, percentage and range rows are dropped silently instead of going
     to review.
   - 20 of the ~65 taxonomy keys can never be produced.
6. **Nothing is idempotent at the source.**
   - Every fetch inserts a new `source_documents` row: 12,135 rows, but only 5,771
     distinct hashes.
   - Rosetta downloads the page a second time instead of reading the stored bytes.
   - Knox re-extracts every new document id.

   This is the upstream cause of the 72% duplicate rate the 08-15 audit found and
   then patched downstream at Hamilton.
7. **The agentic *architecture* is sound; the *operations* are not.** The run
   ledger, lane leases, the automation stop and the semantic table contracts are
   good foundations. What is missing:
   - time budgets;
   - work-item claims;
   - a reaper for stuck runs;
   - alerting;
   - a funnel metric;
   - an evaluation set;
   - a current-value data model.

**The shortest path to a working pipeline:**
- Fix the tick gate (a config change plus a one-file code change).
- Add a stuck-run reaper and time budgets.
- Make fetch idempotent on content hash.
- Fix the median bug.

After that, the roadmap in §8 grows the database from 239 sourced institutions
toward the whole US universe of about 9,000.

---

## 2. Live funnel (production, 2026-09-30)

| Stage | Metric | Value | % of universe |
|---|---|---|---|
| Universe | `institution_sources` | 8,750 | 100% |
| | with `website_url` | 8,116 | 92.8% |
| Discovery | with `fee_schedule_url` | 4,600 | 52.6% |
| Fetch | `source_documents` rows | 12,135 | — |
| | successful fetches | 4,422 | — |
| | distinct `content_hash` | 5,771 | — |
| Read | `agent_source_texts` completed | **77** (+1 needs_ocr, +1 failed) | 0.9% |
| Extract | raw rows from Knox | 1,073 | — |
| | raw rows from the `migration_v10` backfill | 102,965 | — |
| Verify | `verified_fee_observations` | 6,401 | — |
| Publish | `published_fee_records` live | 3,741 | — |
| | institutions with any published fee | 1,183 | 13.5% |
| | institutions with **sourced** published fees | **239** | **2.7%** |
| Taxonomy | distinct `fee_category` in catalog | 100 (taxonomy has ~65) | — |
| | categories with ≥30 institutions | 31 | — |
| | categories with <5 institutions | 47 | — |

Ledger history: 2 runs in March, 223 in April, 15 in August, **0 in September**.
Run 240 ("Reclassify legacy rows (write)") has been `running` since 2026-08-23. It is
a zombie that no process will ever pick up.

Reproduce these numbers with the queries in Appendix A. A snapshot table recording
them daily is recommendation R-O3.

---

## 3. Stage-by-stage findings

Line numbers refer to commit `307176c`.

### 3.1 Atlas: orchestration (`run-store.ts`, `tick/route.ts`, `state-lane-scheduler.ts`)

**S0**
- **The tick is gated on a provider budget policy that is disabled.**
  - The tick calls `assertCronTickBudgetAllowed` (`tick/route.ts:70`), which
    requires `max_provider_calls_per_tick` and `max_estimated_cost_per_tick_microusd`
    (`api-hardening/budget.ts:356-387`).
  - The agents in this pipeline never call a provider: there is no
    `trackAnthropicRequest` in `src/lib/agents`.
  - The provider stop therefore halts deterministic ingestion, which contradicts
    AGENTS.md ("may inspect deterministic data").
  - The same applies to the global automation stop (`tick/route.ts:37`,
    `run-store.ts:1068`).
- **No reaper for stuck runs.**
  - A step killed by the 300s function limit stays `running` forever: the tick only
    selects `queued` (`run-store.ts:1145`).
  - The lane's same-day idempotency key then reuses the zombie run, so the lane is
    dead until the next day.
  - `blocked` runs are terminal, and nothing re-queues them.

**S1**
- **Throughput is too low for the universe.**
  - Default capacity is 2 runs × 1 step per tick, so 576 steps a day.
  - 54 lanes × 10 steps is about 540 steps a day, which already saturates capacity.
  - Each step processes a fixed 25 or 100 rows, not a time budget. Each lane yields
    at most 25 fetches a day however large the state is.
- **Worst-case step time exceeds `maxDuration=300`.**
  - Discovery: 25 × (2 + 3) × 10s ≈ 1,250s.
  - Rosetta: 25 × 35s ≈ 875s.
  - All loops are sequential, and the body-read timeouts are cleared once headers
    arrive (`discovery.ts:300`, `fetch.ts:112`).
- **No claims on work items.**
  - Two runs with overlapping scope (a full cycle and a state lane) select the same
    institutions and documents.
  - The lane lease is cleared as soon as the lane is scheduled
    (`state-lane-scheduler.ts:113-115`), so it protects scheduling, not execution.
- **Idempotency check is not atomic.** `startAgentRun` does a SELECT and then an
  INSERT on `idempotency_key` (`run-store.ts:1331-1347`), with no unique index.
- **Poison rows starve batches.**
  - Rosetta re-selects `failed` documents newest-first with no backoff.
  - Knox re-selects zero-yield texts forever.
  - Darwin re-selects skipped rows oldest-first, so after 500 skips new rows never
    get verified.

**S2**
- `public-discovery` / `public-audit` (QA of Fee Insight's own pages) take 3 of the
  10 lane steps, 30% of acquisition throughput.
- `assemble` and `render` are stubs that return "completed"
  (`run-store.ts:569-576`). Unknown step keys return `skipped` rather than `failed`.
- `resumeAtlasCycle` says it resumes a failed stage. It actually starts a new
  unscoped cycle from `enhance`.
- `syncStateLaneProfiles` rewrites about 8.7k profile rows on every tick, roughly
  2.5M updates a day once ticks run. It also overwrites the lane `failure_count`
  (`state-lane-memory.ts:458`).

### 3.2 Magellan: discovery and fetch

**S1**
- **Fetch is not idempotent.**
  - Every attempt inserts a new `source_documents` row with `document_path=NULL`
    (`fetch.ts:295-303`).
  - An unchanged page still produces a new id, so Rosetta and Knox process it again
    every 12 hours.
  - There is no conditional GET (no ETag or Last-Modified).
- **The fetched bytes are thrown away.**
  - Rosetta downloads `document_url` a second time (`rosetta/read.ts:232`) and
    stamps Magellan's hash on text from a different fetch.
  - The lineage therefore does not attest to the bytes that were parsed.
- **Discovery scoring favors guessed paths over real links.**
  - Guessed paths like `/schedule-of-fees.pdf` score 0.98. A real "Fee Schedule"
    homepage link to `/disclosures/fee-schedule.pdf` scores 0.87.
  - Only the top 3 candidates are validated, so the guesses usually win.
  - `looksLikePdf` accepts any `.pdf` URL that returns 200, including soft-404 HTML
    (`discovery.ts:320`).
- **Redirects and subdomains break discovery.** The off-host filter compares against
  the original `website_url`, not the URL after redirects (`discovery.ts:218,433`).
  A site that moved domains therefore rejects every one of its own links, and PDFs
  on subdomains or CDNs are rejected too.
- **Dead URLs are never re-discovered.** Discovery only selects institutions whose
  `fee_schedule_url` is NULL. A URL that returns 404 is retried weekly forever; the
  08-16 triage counted 109 such rows.
- **Operator and submission URL fixes are shadowed.**
  - `setInstitutionFeeUrl` and submission acceptance write
    `institution_sources.fee_schedule_url`.
  - Fetch prefers `institution_source_profiles.canonical_source_url`, and the
    profile sync keeps the old value (`state-lane-memory.ts:393`).
- **The universe is not maintained.** Nothing in the repo syncs from FDIC or NCUA,
  and there is no merger or closure deactivation. The 634 institutions with no
  `website_url` are excluded from every selector.

**S2**
- **Failure reasons are collapsed.** Every failure is stamped `agentic_fetch_failed`
  (`fetch.ts:384`). Timeout, 403, 404 and too-large cannot be told apart.
- **OCR routing flaps.** Rosetta marks a scanned PDF, then the profile sync and the
  next fetch reset `read_strategy` to `pdf_text`.
- **No crawl politeness.** There is no robots.txt check, no per-host rate limit and
  no `Retry-After` handling.
- **Off-brand User-Agent.** It is
  `AiBI-Magellan/1.0 (+https://theaibankinginstitute.com)` (`fetch.ts:16`,
  `discovery.ts:16`). This breaks the CLAUDE.md brand rule, and `brand-kill` does
  not catch it.
- **`source_validation_queue` is never consumed by an agent.**
- **Schema not rebuildable from the repo.** The DDL for
  `agent_url_discovery_attempts` lives only in `docs/archive/`.

### 3.3 Rosetta: text normalization

**S1**
- **HTML tables lose their row structure.**
  - `</td>` and `</th>` become newlines, so "Outgoing domestic" and "$25.00" end up
    on separate lines and Knox, which works line by line, never pairs them.
  - `<br>`, `dt` and `dd` add no break at all.
  - Entities are re-escaped (`&amp;`).
- **PDF text loses its layout.** `unpdf.extractText(mergePages:true)` has no x/y
  layout, so table columns get glued together and page boundaries are lost.
- **`needs_ocr` is set only when the text is completely empty**
  (`read.ts:338`). A scan with a text-layer header counts as completed.
- **No magic-byte check.** An `octet-stream` PDF is stored as raw `%PDF-1.4` text.
- **Text is overwritten in place.** It is one row per document
  (`ON CONFLICT DO UPDATE`), with no `extractor_version` and no history.

### 3.4 Knox: extraction

**S1**
- **Category assignment is wrong for common fees.**
  - First-match ordering puts `/monthly|maintenance|service charge/` first
    (`knox/extract.ts:75`).
  - Overdraft, returned-item, paper-statement and Reg D excess-withdrawal lines
    therefore become `monthly_maintenance`.
  - `continuous_od` and `od_protection_transfer` can never match.
- **The amount parser has several failure modes.**
  - `$1500` becomes $150 (`extract.ts:124`).
  - It takes the first `$` on the line, so "If balance falls below $1,500, a $12
    fee" yields $1,500.
  - Ranges keep only the low end, "per item, max $140/day" loses the cap, and a
    percentage becomes a flat amount.
- **Rows are dropped silently instead of sent to review.**
  - Anything matching `free|waived|no charge` is skipped (`extract.ts:173`), which
    loses both $0 fees and the waiver conditions.
  - Unclassified lines are dropped.
  - The contract says ambiguity goes to review; the code throws it away.
- **Confidence carries no information.** It is 0.72 plus keyword bonuses, and every
  emitted row scores 0.82–0.94. Hamilton's 0.8 floor therefore never rejects a row.
- **Taxonomy coverage has gaps.**
  - 20 of about 65 canonical keys have no pattern.
  - `CANONICAL_KEY_MAP` contains wrong synonyms, for example
    `excessive_withdrawal_fee→overdraft`,
    `shared_branch_fee→balance_inquiry` and `western_union→wire_domestic_outgoing`.
- **Lineage is incomplete.** There are no character offsets and no page number. The
  excerpt is packed into the free-text `conditions` column, and the product then
  shows it as the fee's "conditions".
- **Re-extraction duplicates rows.** `agent_event_id` includes `runId`, so the same
  document extracted again creates new raw rows (`extract.ts:319`). The only unique
  index covers `source='migration_v10'`.

### 3.5 Darwin: verification

**S1**
- **Darwin checks less than its contract says.**
  - The only checks are a valid canonical hint, a non-empty name and
    0 < amount ≤ $2,500 (`darwin/verify.ts:109-116`).
  - There are no bounds per category, no duplicate check and no lineage check.
  - `darwin/AGENTS.md` claims all of these.
- **Skipped rows are never recorded.** They produce only a signal, not a row, so they
  are re-selected on every run and eventually starve the batch.
- **`variant_type` is always NULL** (`verify.ts:201`), so per-item fees and daily
  caps collapse into one key.
- **The duplicate check depends on an index that doesn't exist.** The "duplicate
  verified row" path relies on a dedup index that is renamed `IF EXISTS` but never
  created in `supabase/migrations`.

### 3.6 Hamilton: publication

**S1**
- **The adversarial gate is bypassed.**
  - Publication inserts directly (`hamilton/publish.ts:230`) rather than through
    `promote_to_tier3`.
  - `published_by_adversarial_event_id` is filled with a hash Hamilton makes up
    (`publish.ts:227`), so "adversarial-gated" Tier 3 is not true in practice.
- **No current-value model.**
  - A changed fee is published as a new row, and the old row stays live.
  - `rolled_back_at` is never set by app code, so there are no tombstones.
  - There is no `valid_from`/`valid_to` and no document effective date.
  - Old and new amounts are both counted in the index.
- **Movement detection is keyed too coarsely.** It compares only the latest live row
  per institution, key, variant and frequency. Two genuine lines in the same
  category therefore look like a price change on every run, which inserts again and
  fires false `hamilton_fee_movement_detected` signals.
- **Fee history is frozen.** Nothing writes `fee_change_records` or snapshots, so
  `getRecentPriceChanges` and `getFeeHistory` serve frozen historical data and hide
  errors with `catch { return [] }`.
- **Swallowed errors abort the transaction.** They are caught inside
  `withTransaction`, so one failed insert silently aborts the rest of the batch.

### 3.7 Read model and index statistics (`published_fee_catalog`, `data-store/*`)

**S0**
- **The median bug.**
  - postgres.js returns NUMERIC columns as strings, and `peers.ts:71-80` and
    `fee-index.ts:178` push those strings into `computePercentile`.
  - `"10.00" + 0.5*(…)` concatenates strings, so an even-sized median is wrong:
    `["10.00","20.00"]` gives 10.01. I reproduced this in node.
- **The frozen index cache.** `fee_index_cache` is never rebuilt: "Re-publish Index"
  routes to `runHamiltonPublish`. `getNationalIndexCached` (22 call sites) serves
  the stale cache whenever it is non-empty.

**S1**
- **No per-institution dedupe in statistics.** One bank with 5 copies or versions of
  a fee counts 5 times. `maturity_tier` 'strong' means ≥10 *rows*, not institutions.
- **`amount > 0` everywhere.** There are 126 published $0 rows, and they are excluded
  from every median.
- **Hard-coded view columns.** The view sets `review_status='approved'`,
  `is_fee_cap=false` and `fee_family=NULL`. `approvedOnly`, the 'flagged' counts and
  the 'provisional' maturity tier all do nothing.
- **`coverage_tier` is ignored.** Strong and provisional evidence are mixed in every
  statistic, contrary to the Hamilton evidence rules in AGENTS.md.
- **No minimum sample size.** A peer or state cell with one institution shows that
  value as the "median". Only district medians require n≥3.
- **Unknown charter types count as credit unions** (`fees.ts:112-116`).

### 3.8 Schema and data model

**S1**
- **An empty database cannot be built from `supabase/migrations`.**
  - The ledger tables (`agent_runs`, `agent_run_steps`, `agent_run_events`,
    `automation_control`, `ai_api_usage_events`), `agent_url_discovery_attempts`,
    `agent_document_texts` and several dedup indexes exist only in
    `docs/archive/supabase-migrations-2026-08-16/`.
  - This is already known (`docs/runbooks/supabase-migration-baseline.md`) but
    unresolved.
  - It blocks any Postgres integration test in CI.
- **Lineage can be NULL on every tier.** `source_url`, `document_r2_key` and
  `source_document_id` are all nullable, and `raw.institution_id` has no FK.
- **`fee_change_records` carries two column sets.** One is
  `previous_amount/detected_at`, the other `old_amount/changed_at`, and each is
  read by different code.
- **100 distinct catalog categories against a taxonomy of about 65.** There is no FK
  or CHECK tying `fee_category` to the taxonomy, and no `taxonomy_version`.

### 3.9 Observability

**S0**
- **No alerting.** 38 days of 423s went unnoticed.
  - `/api/admin/job-health` checks `workers_last_run` for retired jobs, which nothing
    writes, so it is permanently 503.
  - `/admin/agents/health` reads `agent_health_rollup`, which is built from
    `agent_events`, which the current agents deliberately do not write.

**S2**
- `/admin/atlas/status` shows the *oldest* of the last 10 events as "latest"
  (`status/route.ts:28` against the ascending order in `run-store.ts:1206`).
- Queued runs are flagged `stale_queued` after 2 minutes on a 5-minute cron, so the
  warning is permanent and operators learn to ignore it.
- `source_collection_runs` is no longer written, but two dashboards still report
  "runs in last 24h" from it.
- There is no time series for the funnel. It is the open P1 in
  `docs/outstanding-tasks.md`.

### 3.10 CI and verification

**S0**
- **CI is red.** `npm run guard:legacy` exits 1: `legacy-kill` matches the prohibition
  text ("Do not reintroduce … `ops_jobs`") in `src/app/admin/AGENTS.md:20` and
  `src/lib/agents/atlas/AGENTS.md:21`, which were added on 2026-08-15. Every push
  since then has failed the `tests` workflow.

**S1**
- **CI covers little.** It runs only `guard:legacy` and 16 agentic test files, all with
  mocked SQL. It does not run:
  - `tsc` (clean locally);
  - `lint`;
  - `next build`;
  - the other ~114 test files;
  - `sqlite-kill`, which exists but is not part of `guard:legacy`;
  - any Postgres integration test.
- **Extraction has no gold set.** `knox/extract.test.ts` has 4 tests on one 5-line
  fixture, and there is no real PDF fixture. Precision and recall are unmeasured.

### 3.11 Docs

**S2**
- **Docs contradict the code.**
  - CLAUDE.md still describes `extracted_fees` as a live review bridge, but the table
    was renamed to an archive table and nothing in `src/` reads it.
  - AGENTS.md says the automation stop allows deterministic work; the code blocks it.
  - `darwin/AGENTS.md` lists checks Darwin does not perform.
  - The AGENTS.md verification gates list `tsc` and `lint`, which CI does not run.
- **Doc sprawl.** There are 11 `AGENTS.md` files, and CLAUDE.md largely duplicates the
  root AGENTS.md.
- **The Knox review queue is orphaned.** `knox-reviews.ts` reads `agent_messages`
  rows that the current Knox never writes.

---

## 4. Compliance with the agentic contract

| Contract clause (AGENTS.md) | Status |
|---|---|
| Every agent action creates a visible run, step and event | **Partly.** The ledger works; the 25 reports were rendered outside it (`Reports/studio`), and assemble/render are stubs. |
| Provider calls go through `ai-provider.ts` | **Yes.** All 7 call sites comply, but nothing enforces it (`provider-kill` only blocks SDK imports). |
| Automation stop: queue and inspect only, no provider spend | **Over-applied.** It stops deterministic ingestion too. |
| Magellan rotates batches with claim and backoff | **Partly.** Fixed-interval backoff, no item claims, no terminal state for dead URLs. |
| Rosetta marks scanned PDFs `needs_ocr` | **Weak.** Only when the text is completely empty; nothing consumes `needs_ocr`. |
| Knox is source-grounded and sends ambiguity to review | **No.** Ambiguous rows are dropped; lineage has no offsets. |
| Darwin checks amounts, duplicates and lineage | **No.** Only one global amount bound and a canonical-key check. |
| Hamilton separates verified from provisional evidence | **No.** `coverage_tier` is ignored by statistics; `review_status` is hard-coded. |
| Hamilton publication is adversarial-gated | **No.** The event id is made up; `promote_to_tier3` is bypassed. |
| `extracted_fees` is not used for product reads | **Yes.** Guarded by `fee-read-model-kill`. |

---

## 5. Recommendations

The IDs are referenced from the roadmap in §8.

### Operations (O)

- **R-O1: Split the provider gate from the pipeline gate.**
  - Deterministic steps (discover, fetch, read, extract, verify, publish) need
    neither the provider budget policy nor the provider automation stop.
  - Keep a separate `pipeline_enabled` switch for operator pauses.
  - Require `assertCronTickBudgetAllowed` only when a step can call a provider (a
    future OCR or LLM extraction step).
  - As an immediate unblock, configure the `route:api.admin.agents.tick` policy with
    real caps. This is a production write, so it needs the user's approval.
- **R-O2: Add a stuck-run reaper as the first action of every tick.**
  - Re-queue steps that have been `running` longer than twice their budget.
  - Dead-letter after 3 attempts (`status='dead'`, shown in Atlas).
  - Close run 240.
- **R-O3: Record the funnel daily.**
  - Snapshot the §2 table into a `pipeline_funnel_daily` table from the tick.
  - Rewrite `/api/admin/job-health` against `agent_runs`, `agent_state_lanes` and
    the funnel: tick 423 count, zombie count, overdue lanes, and hours since the last
    published row.
  - Point an external uptime monitor at it. This alone would have caught the
    38-day outage on day 1.
- **R-O4: Give every step a time budget.**
  - Pass a deadline of about 240s into every agent loop and return `partial` with a
    cursor.
  - Use bounded concurrency: 8–16 requests overall, 1 per host.
  - Abort body reads on timeout.
- **R-O5: Claim work items, not just lanes.**
  - Add `claimed_until`, `attempt_count` and `next_attempt_at` to source profiles,
    documents and texts.
  - Claim with `FOR UPDATE SKIP LOCKED`.
  - Use exponential backoff from 1h to 30 days, with terminal states
    (`needs_rediscovery`, `no_candidates`, `rejected`) so poison rows leave the
    selectors.
- **R-O6: Decouple acquisition from state lanes.** Run global Magellan, Rosetta and
  Knox queues drained continuously by each tick. Keep lanes for reporting and
  prioritization, and move public-page QA out of the acquisition lane.
- **R-O7: Make idempotency atomic.** Add a unique partial index on
  `agent_runs(idempotency_key) WHERE status IN (active)` and use
  `INSERT … ON CONFLICT`.

### Data correctness (D)

- **R-D1: Fix the median bug.** Convert amounts with `Number()` at the read boundary.
  Better, register a NUMERIC type parser in `connection.ts` so NUMERIC always arrives
  as a number. Add an even-n unit test.
- **R-D2: Build one statistics contract in SQL.**
  - Take each institution's current value first (dedupe), then compute statistics
    across institutions.
  - Include $0 amounts.
  - Require n_institutions ≥ 5 to show a median, and ≥ 20 to label it "strong".
  - Return n_institutions, n_sourced, the IQR and `max(valid_from)`.
  - Materialize the result into `fee_index_cache` at the end of each publish step,
    stamped with `run_id` and `computed_at`.
  - Remove the dead `approvedOnly` and 'flagged' paths.
- **R-D3: Model current values.**
  - Add `valid_from`, `valid_to` and `superseded_by` to `published_fee_records`.
  - Add a `published_fee_current` view with one row per (institution,
    canonical_key, variant, frequency, fee_line_id). Index reads use this view;
    history reads use the full table.
  - When a fee disappears from a fresh document, close it with a tombstone.
  - Write movements to a single `fee_change_records` shape.
- **R-D4: Make every tier idempotent on content.**
  - Magellan: skip on an unchanged hash and use conditional GET.
  - Knox: build the event hash from (source_document_id, text hash, line) with no
    `runId`, and add a unique index.
  - Published tier: add a unique partial index on the current key.
- **R-D5: Require lineage.**
  - Add a NOT VALID CHECK so new Tier-3 rows must carry `source_document_id`.
  - Exclude unsourced legacy rows from `published_fee_current` until they are
    backfilled. The 08-16 triage showed 96% of them belong to institutions whose
    fee URL is already on file.
- **R-D6: Tie categories to the taxonomy.**
  - Add a FK or CHECK from `fee_category` to a `fee_taxonomy` table with a
    `taxonomy_version`.
  - Map or quarantine the ~35 non-canonical categories.
  - Fix the wrong synonyms in `CANONICAL_KEY_MAP`.

### Extraction quality (E)

- **R-E1: Keep document structure through Rosetta.**
  - Store the bytes Magellan fetched (`document_path` in Storage) and have Rosetta
    read those.
  - HTML: use a DOM walk that emits table rows as `name | amount | note` with the
    nearest heading path.
  - PDF: rebuild rows from `getTextContent` item positions and keep page numbers.
  - Make texts append-only, keyed on (document, `extractor_version`).
- **R-E2: Apply the deterministic Knox fixes now.**
  - Order specific patterns before generic ones.
  - Fix the amount regex.
  - Keep waived and free rows (`is_zero`, `waiver_conditions`).
  - Parse ranges, percentages and caps (`is_fee_cap`).
  - Emit unclassified rows with a null hint so they reach review.
  - Store excerpt offsets in real columns.
- **R-E3: Add LLM extraction as a gated fallback.**
  - Call a schema-constrained model through `ai-provider.ts` for each section.
  - Output fields: `{fee_name, canonical_key, amount, amount_max, pct, basis, is_cap,
    is_zero, waiver_conditions, evidence_start, evidence_end, page}`.
  - Reject any row whose evidence span does not contain the amount exactly as
    written.
  - Use it only where the regex yields nothing or the two disagree.
  - This is the one place the provider budget gate belongs.
- **R-E4: Build an OCR path.**
  - Classify by characters per page (below about 200, or fewer than 30% of pages
    with text) and by `%PDF` magic bytes.
  - An OCR step writes a separate text artifact tagged `ocr` with its confidence.
- **R-E5: Build a gold set and evaluation harness.**
  - Hand-label 100 documents, starting with the 25 report institutions and mixing
    HTML, PDF, scanned and JS-rendered pages.
  - Score precision and recall per field in vitest.
  - Fail CI on regression.
  - Record each extractor version's scores in the run ledger.
- **R-E6: Strengthen Darwin.**
  - Envelope each canonical key by p1/p99, recomputed weekly; anything outside goes
    to review.
  - Write skips as `rejected` or `needs_review` rows with reason codes.
  - Run a weekly stratified human sample: 2% (at least 30) of new rows plus every
    movement over 25%.
  - Publish precision per category and use it to calibrate confidence.
- **R-E7: Make the publish gate honest.** Either route publication through
  `promote_to_tier3` or remove the "adversarial-gated" claim and the made-up event
  id.

### Coverage and growth (G)

- **R-G1: Add a universe-sync agent.**
  - Sync quarterly from FDIC BankFind (institutions, websites, mergers, closures) and
    NCUA call-report and profile data, keyed by cert and charter number.
  - Add, merge and deactivate institutions, and backfill `website_url` for the 634
    institutions without one.
- **R-G2: Deepen discovery.**
  - Rank homepage links above guessed paths.
  - Follow the redirected origin and allow links on the same registrable domain.
  - Crawl one level into Disclosures, Rates and Documents pages, and read
    `sitemap.xml`.
  - Require `%PDF` magic bytes for PDFs.
  - Treat JS-rendered pages as `browser_render` / `retry_after`, not `dead`.
  - Target: the 4,150 institutions still without a fee URL.
- **R-G3: Render JS pages in a browser.** The 775 JS-rendered sources from the 08-16
  triage need a headless fetch step (Playwright is already a dev dependency) behind
  its own budget.
- **R-G4: Build history as a moat.**
  - Re-fetch every institution at least every 30 days, with a freshness SLA per row:
    stale after 180 days, excluded after 365.
  - Backfill history from web archives of known fee-schedule URLs to date fee
    changes. This becomes a unique time series that competitors cannot reconstruct.
- **R-G5: Feed intake into the queue.** Make community submissions, institution
  claims and `source_validation_queue` real inputs to the Magellan queue, not
  admin-only tables.

### Engineering hygiene (H)

- **R-H1: Fix CI.**
  - Make `legacy-kill` ignore `AGENTS.md` prohibition lines, or reword those lines.
  - Add `tsc`, `lint` and `next build` to the workflow.
  - Add the full vitest suite.
  - Add a Postgres service container that applies a real baseline migration and runs
    run-store concurrency tests.
- **R-H2: Commit a baseline migration.** Produce a baseline (for example
  `supabase db dump --schema-only`) of the ledger, discovery and text tables and the
  dedup indexes, so an empty database can be built.
- **R-H3: Make the docs single-source.**
  - Merge CLAUDE.md into AGENTS.md, leaving CLAUDE.md as a short pointer plus the
    business status.
  - Correct the `extracted_fees`, automation-stop and Darwin claims.
  - Keep one pipeline doc (this audit's §3 structure) as the per-stage contract, and
    have per-agent AGENTS.md files link to it rather than restate it.
- **R-H4: Fix the Magellan User-Agent.** Use
  `FeeInsightBot/1.0 (+https://feeinsight.com/bot)`, publish a `/bot` page, and
  honor robots.txt.
- **R-H5: Remove dead code.**
  - `pipeline-runs.ts` (it reads an archived table).
  - The `agent_events`-based health rollup.
  - The dead discovery paths.
  - The `mode: "rescue"` option.
  - The knox-reviews queue, or re-point it to a row-level review table.

---

## 6. Target data contract (what "done" looks like per tier)

| Tier | Key | Required | Terminal states | SLA |
|---|---|---|---|---|
| Institution | cert/charter no. | charter, state, website_url, active | inactive (merged/closed) | quarterly universe sync |
| Source profile | institution_id | fee_url or discovery_status | needs_rediscovery, no_public_schedule | rediscover ≤30d after dead |
| Document | (institution_id, content_hash) | stored bytes, fetched_at, http meta | unchanged (304) | fetch ≤30d |
| Text | (document_id, extractor_version) | structured rows, page spans | needs_ocr, unreadable | read ≤1h after fetch |
| Raw observation | (document_id, line_hash) | evidence offsets, amount/basis/is_zero/is_cap | no_candidates | extract ≤1h after read |
| Verified | raw_id | canonical_key ∈ taxonomy vN, envelope check | rejected(reason), needs_review | ≤24h |
| Published current | (institution, key, variant, frequency, fee_line_id) | source_document_id, valid_from | superseded, tombstoned | index rebuilt every publish |

---

## 7. KPIs to track weekly

| KPI | Now | 90-day target | 12-month target |
|---|---|---|---|
| Hours since last successful tick | ~900 | <1 | <1 |
| Institutions with sourced, current fees | 239 (2.7%) | 2,500 (29%) | 7,500 (85%) |
| Fee URL coverage | 52.6% | 80% | 95% |
| Fetched docs with text | 77 of 4,422 | 95% | 98% |
| Canonical categories with ≥30 institutions | 31 | 45 | 60 |
| Extraction precision / recall (gold set) | unmeasured | ≥95% / ≥80% | ≥97% / ≥90% |
| Share of published rows with lineage | 24% | 100% of current view | 100% |
| Median data age (current rows) | unknown | <60d | <30d |
| Duplicate content rows in current view | 73 | 0 (enforced) | 0 |

Capacity check at the 12-month target:
- 9,000 institutions re-fetched every 30 days is about 300 fetches a day.
- With conditional GET, about 10% of those change, so about 30 documents a day need
  re-extraction.
- At R-O4 throughput (about 1,000 fetches per tick at concurrency 10), this uses less
  than 1% of cron capacity.
- The constraint is extraction quality, not compute.

---

## 8. Roadmap

**Phase 0: Restart and stop the bleeding (this week, about 1 day)**
- R-H1 part 1: make CI green (the `legacy-kill` fix).
- R-O1: split the gate. Short term, configure the tick policy caps (needs approval).
- R-O2: add the reaper and close run 240.
- R-D1: fix the median bug.
- R-O3: rebuild job-health on the ledger and attach an uptime monitor.

**Phase 1: Correctness (weeks 1–3)**
- R-D4: content idempotency at every tier.
- R-D2: the statistics contract and the index cache rebuild.
- R-D3: the current-value model.
- R-E2: the deterministic Knox fixes.
- R-E1: structured Rosetta output and stored bytes.
- R-H2: the baseline migration, then a Postgres CI job.

**Phase 2: Automation at scale (weeks 3–6)**
- R-O4: time budgets.
- R-O5: work-item claims.
- R-O6: global queues.
- R-G1: the universe sync.
- R-G2: deeper discovery.
- R-E5: the gold set, gating CI.
- R-E6: the Darwin envelopes and sampling.

**Phase 3: Growth (weeks 6–12)**
- R-E3: LLM extraction fallback behind budget caps.
- R-E4: OCR.
- R-G3: headless rendering.
- R-D5: lineage enforcement and legacy backfill.
- R-D6: taxonomy v2.
- R-G4: freshness SLAs and archive-based history.
- R-G5: intake feeding the queues.

**Phase 4: Moat (quarter 2 onward)**
- Historical time series and movement feeds.
- Publish the methodology (sample sizes, precision per category), which is a trust
  asset for the $300 report buyer.
- Coverage beyond deposit fees (loan, mortgage and card fee schedules).
- Non-US markets only once US coverage is above 85%.

---

## Appendix A: Reproduction queries (read-only)

```sql
-- Why nothing runs
select status_code, reason_code, count(*), max(created_at)
  from api_route_audit_events where route_id = 'api.admin.agents.tick'
 group by 1,2 order by 4 desc;
select * from api_budget_policies where policy_key = 'route:api.admin.agents.tick';

-- Ledger activity
select run_kind, status, count(*), max(started_at) from agent_runs group by 1,2;

-- Funnel
select count(*), count(*) filter (where coalesce(fee_schedule_url,'')<>'') from institution_sources;
select count(*), count(*) filter (where status='success'), count(distinct content_hash) from source_documents;
select status, count(*) from agent_source_texts group by 1;
select source, count(*) from raw_fee_observations group by 1;
select count(*), count(distinct institution_id),
       count(distinct institution_id) filter (where source_url is not null)
  from published_fee_catalog;
```

## Appendix B: Items from earlier audits still open

From `2026-08-15-catalog-data-quality.md`:
- the `is_fee_cap` view fix;
- the unique content constraint;
- the provenance gate in Hamilton;
- the 2,019 CU names with a suspect "Federal".

From `2026-08-16-source-triage.md`:
- the 4,157 institutions with no URL;
- the 775 JS-rendered sources;
- `extraction_completeness_label`, which nothing writes.

All of these map to R-D5, R-D4, R-G1, R-G2 and R-G3 above.
