# Pipeline Shadow Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command replays frozen, committed source texts through today's pipeline stages and
one configurable experimental variant, and reports per stage where fees are lost, misread,
duplicated or wrongly published.

**Architecture:** A pure vitest suite under Deming (`src/lib/agents/deming/shadow-lab/`). Six
scenarios are built from fixtures already in the repo. Each case runs through four stages:
document gate, extract, verify and publish gate. The stages are wired from the existing pure
functions; the experimental variant is the same wiring with named overrides. Scoring attributes
every failed expectation to the first stage that got it wrong, which is the root-cause view the
current fix-15-fees loop lacks. No database is needed: duplicate prevention is replayed with the
pure `decidePriorFee`, so the "disposable Postgres where needed" clause is unused in v1, and the
plan says so in the report.

**Tech Stack:** TypeScript, vitest 4 (`@vitest-environment node`), node `zlib`/`crypto`/`fs`.

**Spec:** `docs/superpowers/specs/2026-10-21-pipeline-shadow-lab.md`

## Global Constraints

- No production change: no edits to any stage function, version constant, `*_LIVE` switch, cron,
  route or migration. Existing owner (Deming) holds the lab; no new agent, tracker or owner.
- No DB: the suite fails if `DATABASE_URL` or `E2E_DATABASE_URL` is set, before importing any
  module that imports `data-store/connection.ts` (it opens a client at import time).
- No paid provider: `@/lib/ai-provider` is `vi.mock`ed with stubs that throw and count calls; the
  run fails if the count is above 0.
- Inputs are committed fixtures only. A scenario with no committed source text is reported as
  `not_replayable` with the reason; it is never filled with invented text or counts.
- Every input text is checked against its stored `text_hash` with Rosetta's `hashText`; a
  mismatch marks the case `corrupt` and keeps it out of every rate.
- Determinism: the comparison JSON, minus the `timing` block, is byte-identical across two runs
  and a reversed case order.
- Command: `npm run test:shadow-lab`. Outputs go to `test-results/shadow-lab/` (gitignored):
  `comparison.json` and `report.md`. Files are written only when `SHADOW_LAB_OUT` is set (the npm
  script sets it), so CI shards that pick the test up run it without writing.
- Branch `feat/deming-shadow-lab` from `main` in a worktree (the current checkout has unrelated
  uncommitted files). One PR, conventional commits, refs #1026 and #2064.
- Copy and docs follow `growth-os/context/editorial-policy.md`: every number in the report comes
  from the run.

## Scenarios (the six)

All from committed fixtures. `issue` is the tracker line each one speaks to.

| Id | Failure | Source | Expectation |
|---|---|---|---|
| `limit_as_fee` | A limit or "& up" price published as a fee | `deming/__fixtures__/adversarial-documents.json` cases with `family = "source_states_limit"` or `takedown = "limit_as_fee"` | the case's fee (key, cents) is not published |
| `not_a_fee` | Waiver, rebate or price-in-name sentence read as a fee | same file, every other `cases[]` entry | the case's fee is not published |
| `wrong_category` | Fee filed under a category its name or schedule contradicts (#1912) | `hard-documents.json` `category[]` with `expected != "ok"` (forbidden) and `== "ok"` (expected) | forbidden key not published; ok cases published under their key |
| `duplicate_lines` | Same-dollar lines collapsed or kept wrongly (#1910, #1909 class) | `hard-documents.json` `same_price[]` | `true_duplicate`: one publication at that key and cents; `distinct_same_dollar`: two |
| `hourly_as_flat` | Hourly charge published as flat (#1456) | `darwin/hourly-frequency-check.fixtures.ts` `W43_HOURLY_LINE_ROWS` (`source_line` is the text) | not published with a frequency other than per hour |
| `missed_fees` | Fees in the schedule missing from live pages (Now item 3, MISSING) | `knox/__fixtures__/texas-answer-keys.json.gz` and `state-answer-keys.json.gz`, keys with `set = "holdout"` and `is_fee_schedule` | every key fee is published (key, cents; key only when amount is null) |

Document-gate replay: `hard-documents.json` `documents[]` (URL only, no text) runs through the
document gate alone as scenario `wrong_document`, scored as gate
accuracy, never in fee rates. Wrong-document issues #1908, #1911, #1915 and the M&T Spanish copies
(#1909) have no committed source text; the report lists them as `not_replayable` with that
reason, which is #2064's gap made visible.

## Review Focus

1. `DATABASE_URL` exported in the shell: the run must stop with a clear message before any import
   opens a client, not run against prod. Test in Task 1.
2. A fixture edited so its text no longer matches `text_hash`: the case is `corrupt`, excluded,
   and counted in the report header. Test in Task 2.
3. Answer-key fees with `amount: null`: matched on key only, never as $0. Test in Task 4.
4. Money rounding: `"30.00"`, `30` and `29.999999` compare as 3000 cents. Test in Task 4.
5. URL-only cases (no text) entering recall, attribution or false-publication denominators: they
   must not. Test in Task 4.

---

### Task 1: Types, guards and the stage wiring for the current pipeline

**Files:**
- Create: `src/lib/agents/deming/shadow-lab/types.ts`
- Create: `src/lib/agents/deming/shadow-lab/env-guard.ts`
- Create: `src/lib/agents/deming/shadow-lab/rows.ts`
- Create: `src/lib/agents/deming/shadow-lab/variants.ts`
- Modify: `src/lib/agents/deming/hard-documents.test.ts:87-107` (import `verifiedRow` from `rows.ts` instead of the local copy)
- Test: `src/lib/agents/deming/shadow-lab/variants.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type ScenarioId = "limit_as_fee" | "not_a_fee" | "wrong_category" | "duplicate_lines" | "hourly_as_flat" | "missed_fees" | "wrong_document"`
  - `type StageId = "document_gate" | "extract" | "verify" | "publish_gate"`
  - `interface FeeRef { canonicalFeeKey: string | null; feeName: string | null; amountCents: number | null; frequency?: string | null }`
  - `interface ShadowCase { caseKey: string; scenario: ScenarioId; provenance: { fixture: string; fixtureCaseKey: string; textHash: string | null; issue: string }; document: { url: string | null; text: string | null }; expected: { publish: FeeRef[]; forbid: FeeRef[]; publishCount?: { canonicalFeeKey: string; amountCents: number; count: number }; documentIsSchedule?: boolean }; status: "ok" | "corrupt" | "not_replayable"; statusReason?: string }`
  - `interface StageFee extends FeeRef { excerpt: string | null; reason: string | null }`
  - `interface CaseTrace { caseKey: string; scenario: ScenarioId; stages: Record<StageId, { passed: StageFee[]; dropped: StageFee[] }>; published: (StageFee & { sourceLine: string | null; attributed: boolean })[]; documentAccepted: boolean | null; durationsMs: Record<StageId, number> }`
  - `interface PipelineVariant { id: string; description: string; documentGate(c: ShadowCase): { accepted: boolean; reason: string | null }; extract(text: string): { passed: StageFee[]; dropped: StageFee[] }; verify(fee: StageFee, text: string): { ok: true; fee: StageFee } | { ok: false; reason: string }; publishGate(fee: StageFee, text: string, live: StageFee[]): { publish: boolean; reason: string | null } }`
- Produces (`env-guard.ts`): `assertOfflineEnv(env: NodeJS.ProcessEnv = process.env): void`, throws `Error("shadow lab runs offline: unset DATABASE_URL and E2E_DATABASE_URL")`.
- Produces (`rows.ts`): `verifiedRow(input, extra?)` moved verbatim from `hard-documents.test.ts:87-107`; `toCents(amount: number | string | null): number | null`.
- Produces (`variants.ts`): `currentVariant: PipelineVariant`; `interface ExperimentConfig { id: string; description: string; heldNameRules: boolean; productPageGate: boolean; requireSourceCheck: boolean }`; `EXPERIMENTS: Readonly<Record<string, ExperimentConfig>>`; `experimentalVariant(config: ExperimentConfig): PipelineVariant`; `selectExperiment(env = process.env): ExperimentConfig` (reads `SHADOW_LAB_EXPERIMENT`, default `"source-check-gate"`, throws on an unknown name listing the known ones).

Current wiring (mirror the existing pure pipe, `hamilton/rules-recheck.ts:84-110` and `adversarial-documents.test.ts:54-73`):
- `documentGate`: `isProductPage(url)` (hamilton/product-page) rejects; no URL accepts.
- `extract`: `runFreeSpecialists(text)`; `candidates` pass, `held` are dropped with `reason = "held:<shape>"`; key = `refileCategory(hint, name, foldContext(text, name, amount)) ?? hint`.
- `verify`: `passesDarwinChecks(key, name, amount)`, then `limitGuardVerdict({canonical_fee_key, fee_name, amount, conditions: excerpt})`, then `ruleFor(key, name, amount, excerpt)`; first refusal is the reason.
- `publishGate`: `publishSkipReason(verifiedRow(...), HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE)`, then `decidePriorFee(row, live, (a, b) => linesApartOnPage(text, a.fee_name, b.fee_name, amount))`; `identical` or `older_document` is a skip.

Experiment `"source-check-gate"` (the default): `heldNameRules: true` (wrap extract in `withHeldNameRules(true, ...)`), `productPageGate: true` (pass `productPageOn = true` to `publishSkipReason`), `requireSourceCheck: true` (verify also requires `checkFeeAgainstSource(text, name, amount, ".", key).ok`). Every override is a parameter the existing function already takes; none edits production code.

- [ ] **Step 1: Write failing tests** in `variants.test.ts` (header `// @vitest-environment node`):
  - `should_throw_when_DATABASE_URL_is_set`: `expect(() => assertOfflineEnv({ DATABASE_URL: "postgres://x" })).toThrow(/offline/)`; same for `E2E_DATABASE_URL`; `assertOfflineEnv({})` does not throw.
  - `should_read_a_limit_line_through_the_current_variant`: `currentVariant.extract("APPRAISAL | $450.00 & up")` then `verify` on each passed fee; no fee with `amountCents === 45000` comes out of verify with `ok: true`.
  - `should_select_the_default_experiment`: `selectExperiment({}).id === "source-check-gate"`; `selectExperiment({ SHADOW_LAB_EXPERIMENT: "nope" })` throws naming `source-check-gate`.
  - `should_round_money_to_cents`: `toCents("30.00") === 3000`, `toCents(29.999999) === 3000`, `toCents(null) === null`.
- [ ] **Step 2: Run** `npx vitest run src/lib/agents/deming/shadow-lab/variants.test.ts`. Expected: FAIL, modules missing.
- [ ] **Step 3: Implement** the four files; move `verifiedRow` and update the `hard-documents.test.ts` import.
- [ ] **Step 4: Run** the new test and `npx vitest run src/lib/agents/deming/hard-documents.test.ts`. Expected: both PASS.
- [ ] **Step 5: Commit** `feat(deming): shadow lab stage wiring for current and experimental variants`.

### Task 2: Scenario loader from committed fixtures

**Files:**
- Create: `src/lib/agents/deming/shadow-lab/scenarios.ts`
- Test: `src/lib/agents/deming/shadow-lab/scenarios.test.ts`

**Interfaces:**
- Consumes: `ShadowCase`, `ScenarioId`, `toCents` (Task 1); `hashText` (rosetta/read.ts:321).
- Produces: `loadScenarios(root = process.cwd()): ShadowCase[]` (sorted by `caseKey`); `NOT_REPLAYABLE: readonly { issue: string; failure: string; reason: string }[]` listing #1908, #1909, #1911, #1915 with reason `"no committed source text"`; `checkTextHash(c: ShadowCase): ShadowCase`.

Mapping per the Scenarios table. `caseKey` = `<scenario>:<fixtureCaseKey>`. `hourly_as_flat` cases use `source_line` as text, forbid `{ key, amountCents, frequency: "!per_hour" }` (the `!` prefix means "any frequency except"), and have `textHash: null` (the fixture stores none). Answer keys are read with `gunzipSync`; only `set === "holdout" && is_fee_schedule`.

- [ ] **Step 1: Write failing tests:**
  - `should_load_all_six_scenarios`: every `ScenarioId` except `wrong_document` has at least one `ok` case; `wrong_document` has `documents[].length` (24) cases with `text: null`.
  - `should_mark_a_case_corrupt_when_its_text_hash_differs`: `checkTextHash({ ...someCase, document: { ...d, text: d.text + "x" } }).status === "corrupt"`.
  - `should_keep_null_amount_answer_key_fees_as_null`: some `missed_fees` expected fee has `amountCents === null` and none is `0` unless the key says 0.
  - `should_be_stable`: two `loadScenarios()` calls are deep-equal and sorted.
- [ ] **Step 2: Run** `npx vitest run src/lib/agents/deming/shadow-lab/scenarios.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `loadScenarios`.**
- [ ] **Step 4: Run.** Expected: PASS. Note the per-scenario case counts in the commit body; they are the report's denominators.
- [ ] **Step 5: Commit** `feat(deming): shadow lab scenarios from committed fixtures`.

### Task 3: Run a case through a variant

**Files:**
- Create: `src/lib/agents/deming/shadow-lab/run-case.ts`
- Test: `src/lib/agents/deming/shadow-lab/run-case.test.ts`

**Interfaces:**
- Consumes: `PipelineVariant`, `ShadowCase`, `CaseTrace` (Task 1).
- Produces: `runCase(variant: PipelineVariant, c: ShadowCase, clock: () => number = performance.now): CaseTrace`; `runAll(variant, cases, clock?): CaseTrace[]` (output sorted by `caseKey` whatever the input order).

Each extracted fee goes through verify, then publish gate against the case's running `live` list. A published fee gets `sourceLine` and `attributed` from `checkFeeAgainstSource(text, name, amount, ".", key)`. Cases with `status !== "ok"` produce a trace with empty stages. A URL-only case runs `documentGate` only. If `documentGate` rejects, later stages are empty.

- [ ] **Step 1: Write failing tests:**
  - `should_publish_one_fee_for_a_true_duplicate`: a `true_duplicate` `same_price` case yields one published fee at that key and cents under `currentVariant`.
  - `should_record_the_drop_reason_at_the_stage_that_dropped_it`: for a `limit_as_fee` case, the forbidden fee appears in `stages.extract.dropped` or `stages.verify.dropped` with a non-null `reason`, or in `published` (the test asserts it is in exactly one of these places).
  - `should_give_the_same_traces_in_any_order`: `runAll(v, cases)` equals `runAll(v, [...cases].reverse())`, with `durationsMs` stripped.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(deming): shadow lab case runner with stage traces`.

### Task 4: Metrics and failure attribution

**Files:**
- Create: `src/lib/agents/deming/shadow-lab/metrics.ts`
- Test: `src/lib/agents/deming/shadow-lab/metrics.test.ts`

**Interfaces:**
- Consumes: `CaseTrace`, `ShadowCase`, `FeeRef`, `StageId`.
- Produces:
  - `matches(ref: FeeRef, fee: StageFee): boolean` (key equal; cents equal unless `ref.amountCents` is null; `frequency "!x"` matches any frequency except `x`).
  - `interface Failure { caseKey: string; scenario: ScenarioId; kind: "missed" | "false_publication" | "duplicate" | "wrong_document"; stage: StageId | "passed_every_stage"; fee: FeeRef; reason: string | null }`
  - `interface VariantMetrics { cases: { ok: number; corrupt: number; notReplayable: number }; recall: { expected: number; found: number; rate: number | null }; falsePublication: { forbidden: number; published: number; rate: number | null }; duplicatePrevention: { cases: number; correct: number; rate: number | null }; sourceAttribution: { published: number; attributed: number; rate: number | null }; documentGate: { cases: number; correct: number }; unexpectedPublications: number; failuresByStage: Record<StageId | "passed_every_stage", number>; failures: Failure[]; providerCalls: number; costMicrousd: number }`
  - `scoreRun(cases: ShadowCase[], traces: CaseTrace[], providerCalls: number): VariantMetrics`

Attribution: a missed expected fee is charged to `extract` when no extracted or held fee matches it, `verify` when verify dropped it, and `publish_gate` when the gate skipped it. A forbidden fee that got published is charged to `passed_every_stage`, and the trace records which stages it passed. A wrong count in `publishCount` is a `duplicate` charged to `publish_gate`. `unexpectedPublications` counts published fees on answer-key documents that match no key fee. The report labels these "not in the answer key", not as errors, because the keys may be incomplete. Rates are `null` when the denominator is 0. `costMicrousd` is `0` when `providerCalls` is 0; the runner fails the run otherwise.

- [ ] **Step 1: Write failing tests** with hand-built `ShadowCase`/`CaseTrace` pairs (no fixtures):
  - `should_charge_a_missed_fee_to_extract_when_never_read`
  - `should_charge_a_missed_fee_to_verify_when_verify_dropped_it` (expects `reason` carried through)
  - `should_count_a_forbidden_fee_as_false_publication`
  - `should_match_null_amount_on_key_only` (`matches({ canonicalFeeKey: "nsf", feeName: null, amountCents: null }, { ...nsf, amountCents: 3000 })` is true; with `amountCents: 0` ref and 3000 fee is false)
  - `should_leave_url_only_cases_out_of_every_fee_rate` (a `wrong_document` case changes `documentGate` only)
  - `should_return_null_rates_on_empty_denominators`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(deming): shadow lab metrics with first-failing-stage attribution`.

### Task 5: Comparison, report and the one command

**Files:**
- Create: `src/lib/agents/deming/shadow-lab/compare.ts`
- Create: `src/lib/agents/deming/shadow-lab/report.ts`
- Create: `src/lib/agents/deming/shadow-lab/shadow-lab.test.ts`
- Modify: `package.json` (add script)
- Test: `src/lib/agents/deming/shadow-lab/compare.test.ts`

**Interfaces:**
- Consumes: everything above; `knoxFreeSignature()` (hamilton/rules-recheck.ts:62); `CATEGORY_GUARD_VERSION`, `HAMILTON_PUBLISH_STRATEGY`, `DARWIN_VERIFY_STRATEGY` for the version stamp.
- Produces:
  - `SHADOW_LAB_VERSION = 1`
  - `interface Comparison { labVersion: number; versions: Record<string, string>; fixtures: { path: string; sha256: string }[]; scenarios: { id: ScenarioId; cases: number }[]; notReplayable: typeof NOT_REPLAYABLE; variants: { current: VariantMetrics; experimental: VariantMetrics & { config: ExperimentConfig } }; caseDiffs: { caseKey: string; current: string[]; experimental: string[] }[]; stability: { runs: number; identical: boolean; sha256: string }; timing: Record<"current" | "experimental", Record<StageId, { totalMs: number; p50Ms: number }>> }`
  - `compareRuns(input: {...}): Comparison`; `stableJson(c: Comparison): string` (sorted keys, `timing` removed); `renderReport(c: Comparison): string`

`renderReport` sections, in order, every number read from `c`:
1. Header: lab version, stage versions, experiment id and description, case counts (ok, corrupt, not replayable), provider calls and cost (expected 0 and $0), stability verdict.
2. Headline table: current vs experimental for recall, false publication, duplicate prevention,
   source attribution and document gate.
3. "Where fees go wrong": `failuresByStage` for both variants, then a per-scenario breakdown.
4. "What would address it": one line per stage with failures, chosen from a fixed table keyed by
   (stage, kind). Example: (extract, missed) → "Knox does not read these lines. The top held
   shapes are …, so start with the specialist that owns them." The `…` is filled from the
   failures' `reason` counts. The table is code, so the report states only what the data shows.
5. Cases where the variants differ (`caseDiffs`, top 25 by scenario).
6. Not replayable: the `NOT_REPLAYABLE` list, plus a line that says #2064 tracks giving each
   error kind a replay.
7. Limits: the read stage is not replayed (the fixtures store text after Rosetta's read), no DB
   stage was needed, and the answer keys may be incomplete.

`shadow-lab.test.ts`: `// @vitest-environment node`. `assertOfflineEnv()` runs at the top, before
any dynamic `await import(...)` of stage modules. `vi.mock("@/lib/ai-provider")` with a
throwing, counting proxy. The test runs both variants twice plus once in reversed order and
asserts that `stability.identical` holds and `providerCalls === 0`. When `SHADOW_LAB_OUT` is
set, it writes `comparison.json` (`stableJson` plus timing) and `report.md`. It asserts no
thresholds on rates: the lab measures and does not gate.

Script: `"test:shadow-lab": "env -u DATABASE_URL -u E2E_DATABASE_URL SHADOW_LAB_OUT=test-results/shadow-lab vitest run src/lib/agents/deming/shadow-lab"`.

- [ ] **Step 1: Write failing tests** in `compare.test.ts`:
  - `should_drop_timing_from_stable_json` (two comparisons differing only in `timing` give equal `stableJson`)
  - `should_list_case_diffs_only_where_variants_differ`
  - `should_render_every_section_heading` (the seven headings above appear, in order)
  - `should_say_not_measured_for_null_rates` (a null rate renders "not measured", never "0%")
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `compare.ts`, `report.ts`, `shadow-lab.test.ts` and the script.
- [ ] **Step 4: Run** `npm run test:shadow-lab` twice. Expected: PASS both times, and the two
  `comparison.json` files are identical apart from `timing`. Check with
  `jq 'del(.timing)' a.json | shasum` on each copy.
- [ ] **Step 5: Commit** `feat(deming): shadow lab comparison, report and test:shadow-lab`.

### Task 6: Record the first run and wire it into project memory

**Files:**
- Create: `docs/project/findings/2026-10-21-pipeline-shadow-lab-first-run.md`
- Modify: `docs/project/LESSONS.md` (one line)
- Modify: `src/lib/agents/deming/AGENTS.md` (a "Shadow lab" section and a `SHADOW_LAB_VERSION` v1 row in "Current versions")

- [ ] **Step 1:** Run `npm run test:shadow-lab`. Copy the headline table and "Where fees go wrong" from `test-results/shadow-lab/report.md` into the finding unchanged. Add a short "Reading" paragraph that names the stage with the most failures, and add nothing the report does not show.
- [ ] **Step 2:** Add the LESSONS line (`- 2026-10-21 — Replay frozen sources by stage before fixing fees one at a time. — [finding](findings/2026-10-21-pipeline-shadow-lab-first-run.md)`) and the Deming AGENTS.md section. The section says what the lab is, the command, that it never gates CI, that no production path changes until independent evidence supports it, and how to add a scenario.
- [ ] **Step 3:** Run `npm run guard:legacy`, `npx tsc --noEmit`, `npm run test:quality-gates`, `npm run test:shadow-lab`. Expected: all pass.
- [ ] **Step 4: Commit** `docs(deming): shadow lab first-run finding and guide`.
- [ ] **Step 5:** Open the PR. The body covers the outcome, the command, the headline numbers from the run, "no migrations, no data changes, no provider calls", and refs #1026 and #2064. Add a checklist line to #1026 under Data quality: "Shadow lab: replay by stage (PR #N)".

## Self-review notes

- Spec coverage: the harness is Tasks 3–5. Deming fixtures and the six scenarios are Task 2.
  Current and experimental variants are Task 1. Every recorded metric is in Task 4, except
  stability and cost, which are in Task 5. The one command, the JSON and the report are Task 5.
  Prod, jobs, providers, migrations and owner are covered by Global Constraints and the guards
  tested in Tasks 1 and 5. The disposable DB is not needed in v1, and the report says so.
- Not in this plan: switching on any experimental override in production. That is a separate PR
  per override, with Darwin's live re-check and dry-run count as the Standing rules require.
