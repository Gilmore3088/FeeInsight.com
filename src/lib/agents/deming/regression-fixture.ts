import fixture from "./__fixtures__/regression-cases.json";
import { CATEGORY_GUARD_CHECK } from "@/lib/agents/hamilton/category-guard";
import { LIMIT_GUARD_CHECK } from "@/lib/agents/hamilton/limit-guard";
import type { CaseInput } from "./checkers";

/**
 * The CI regression fixture (`__fixtures__/regression-cases.json`, replayed by
 * `regression-gate.test.ts`) and how it is kept current from confirmed cases (#2064).
 *
 * The fixture holds the confirmed takedowns CI can replay from their frozen input alone: the limit
 * guard's and the category guard's (`isFixtureCase`). Source-check cases freeze whole stored texts
 * (11 MB for 477 cases on 2026-10-27) and the audience, wrong-document and duplicate replays read
 * live rows, so they stay out.
 *
 * The app cannot commit to the repository and `scripts/` holds only read-only audits (CLAUDE.md),
 * so the confirming run does not write the file. Instead:
 * 1. The daily `deming-regression` step compares today's active fixture cases with the committed
 *    keys (`fixtureDrift`) and reports both counts in its step detail and summary, so a stale
 *    fixture shows on the run ledger the day it falls behind.
 * 2. `REGRESSION_FIXTURE_SQL` is the one read-only SELECT of those cases. Its single `rows` value,
 *    saved to a file, rebuilds the fixture with
 *    `REGRESSION_FIXTURE_ROWS=<file> npx vitest run src/lib/agents/deming/regression-fixture.test.ts`
 *    (`buildRegressionFixture`), the same lock-in pattern as the shadow lab's `SHADOW_LAB_REBASE`.
 *    The gate then replays every case and fails on any the deployed rules no longer catch.
 * 3. The fixture holds every limit-guard case and the first `FIXTURE_CATEGORY_LIMIT` category-guard
 *    cases by case key in byte (C collation) order (`fixtureSelection`). Both the rebuild and the
 *    daily drift apply that cap, so the rebuild reproduces the committed file and drift reports
 *    only real staleness, not the cases the cap leaves out.
 */

export interface FixtureCase {
  case_key: string;
  check_name?: string;
  severity: string;
  error_class: string;
  expected_verdict: string;
  input: CaseInput;
}

export interface RegressionFixture {
  about: string;
  read_at: string;
  cases: FixtureCase[];
}

export const FIXTURE_ABOUT =
  "Deming regression cases replayed in CI (src/lib/agents/deming/regression-gate.test.ts). Each is a fee a second look confirmed was wrong on prod (pipeline_feedback kind=takedown_confirmed), frozen as the check read it. Rebuilt from REGRESSION_FIXTURE_SQL (regression-fixture.ts); the daily deming-regression step reports when it falls behind.";

/** Checks whose fee-fields snapshot CI replays with no live rows. */
export const FIXTURE_CHECKS: readonly string[] = [LIMIT_GUARD_CHECK, CATEGORY_GUARD_CHECK];

/**
 * How many category-guard cases the fixture holds (2026-10-27: 100 of 990 eligible). Every
 * limit-guard case goes in; the category guard's are capped so the file stays small (about 48 KB).
 */
export const FIXTURE_CATEGORY_LIMIT = 100;

/** Byte order, as Postgres `COLLATE "C"`: never the locale's, which skips punctuation. */
export function byCaseKey(a: { case_key: string }, b: { case_key: string }): number {
  return a.case_key < b.case_key ? -1 : a.case_key > b.case_key ? 1 : 0;
}

/**
 * Pure: the cases the fixture holds from today's eligible rows: every limit-guard case plus the
 * first `limit` others by case key in byte order, returned in that order.
 */
export function fixtureSelection<T extends { case_key: string; check_name: string | null; input: Pick<CaseInput, "kind">; dataset?: string; label_provenance?: string }>(
  rows: readonly T[],
  limit: number = FIXTURE_CATEGORY_LIMIT,
): T[] {
  const eligible = rows.filter((row) => isFixtureCase(row)).sort(byCaseKey);
  const limits = eligible.filter((row) => row.input.kind === "limit_guard");
  const others = eligible.filter((row) => row.input.kind !== "limit_guard").slice(0, Math.max(0, limit));
  return [...limits, ...others].sort(byCaseKey);
}

const committed = fixture as RegressionFixture;

/** The case keys in the committed fixture. */
export const FIXTURE_CASE_KEYS: readonly string[] = committed.cases.map((item) => item.case_key);

/** Pure: whether a confirmed case belongs in the fixture (replayable from its frozen input alone). */
export function isFixtureCase(row: { check_name: string | null; input: Pick<CaseInput, "kind">; dataset?: string; label_provenance?: string }): boolean {
  if (row.input.kind === "limit_guard") return true;
  if (row.dataset !== "regression" || row.label_provenance !== "takedown_confirmed") return false;
  if (row.input.kind === "category_guard") return true;
  return row.input.kind === "unreplayable" && row.check_name != null && FIXTURE_CHECKS.includes(row.check_name);
}

export interface FixtureDrift {
  /** Fixture-eligible cases active today. */
  active: number;
  /** Cases in the committed fixture. */
  committed: number;
  /** Active today and not in the fixture. */
  missing: number;
  /** In the fixture and not active today. */
  stale: number;
}

/** Pure: the committed fixture against today's active fixture-eligible case keys. */
export function fixtureDrift(committedKeys: readonly string[], activeKeys: readonly string[]): FixtureDrift {
  const have = new Set(committedKeys);
  const active = new Set(activeKeys);
  return {
    active: active.size,
    committed: have.size,
    missing: [...active].filter((key) => !have.has(key)).length,
    stale: [...have].filter((key) => !active.has(key)).length,
  };
}

/**
 * Read-only: every active, still-caught fixture case, as one JSON value `rows` (run through the
 * read-only SQL tool; never from app code). `buildRegressionFixture` applies the category cap.
 */
export const REGRESSION_FIXTURE_SQL = `
SELECT COALESCE(jsonb_agg(jsonb_build_object(
         'case_key', case_key, 'check_name', check_name, 'severity', severity, 'error_class', error_class,
         'expected_verdict', last_verdict, 'input', input, 'dataset', dataset, 'label_provenance', label_provenance
       ) ORDER BY case_key COLLATE "C"), '[]'::jsonb) AS rows
  FROM eval_cases
 WHERE status = 'active'
   AND last_caught IS TRUE
   AND (input->>'kind' = 'limit_guard'
        OR (dataset = 'regression' AND label_provenance = 'takedown_confirmed'
            AND (input->>'kind' = 'category_guard'
                 OR (input->>'kind' = 'unreplayable' AND check_name IN ('${FIXTURE_CHECKS.join("', '")}')))))`;

export interface FixtureExportRow {
  case_key: string;
  check_name: string | null;
  severity: string;
  error_class: string;
  expected_verdict: string | null;
  input: CaseInput;
  dataset?: string;
  label_provenance?: string;
}

/**
 * Pure: the fixture file from the export's rows: the `fixtureSelection` of the cases with a
 * verdict, in byte order of case key.
 */
export function buildRegressionFixture(rows: readonly FixtureExportRow[], readAt: string, limit: number = FIXTURE_CATEGORY_LIMIT): RegressionFixture {
  const cases = fixtureSelection(rows.filter((row) => row.expected_verdict), limit)
    .map((row): FixtureCase => ({
      case_key: row.case_key,
      ...(row.check_name && row.check_name !== LIMIT_GUARD_CHECK ? { check_name: row.check_name } : {}),
      severity: row.severity,
      error_class: row.error_class,
      expected_verdict: row.expected_verdict as string,
      input: row.input,
    }));
  return { about: FIXTURE_ABOUT, read_at: readAt, cases };
}
