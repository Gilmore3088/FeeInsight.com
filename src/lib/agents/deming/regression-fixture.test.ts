import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRegressionFixture,
  FIXTURE_CATEGORY_LIMIT,
  fixtureSelection,
  FIXTURE_CASE_KEYS,
  fixtureDrift,
  isFixtureCase,
  REGRESSION_FIXTURE_SQL,
  type FixtureExportRow,
  type RegressionFixture,
} from "./regression-fixture";

/**
 * The CI fixture is rebuilt from confirmed cases (#2064). With `REGRESSION_FIXTURE_ROWS=<file>`
 * (the `rows` value of `REGRESSION_FIXTURE_SQL`, read through the read-only SQL tool) this test
 * writes `__fixtures__/regression-cases.json`; commit it, and `regression-gate.test.ts` replays it.
 */
const FIXTURE_PATH = join(__dirname, "__fixtures__", "regression-cases.json");

const limitRow: FixtureExportRow = {
  case_key: "takedown:1427:hamilton.limit_guard", check_name: "hamilton.limit_guard", severity: "critical", error_class: "limit_as_fee",
  expected_verdict: "name_states_limit", input: { kind: "limit_guard", canonical_fee_key: "od_daily_cap", fee_name: "No Bounce Courtesy Pay Limit", amount: 600, conditions: null },
  dataset: "regression", label_provenance: "takedown_confirmed",
};
const categoryRow: FixtureExportRow = {
  case_key: "takedown:9:hamilton.category_guard", check_name: "hamilton.category_guard", severity: "major", error_class: "category_guard",
  expected_verdict: "name_contradicts", input: { kind: "unreplayable", canonical_fee_key: "stop_payment", fee_name: "Stop payment of Home Equity Line checks", amount: 25, conditions: null },
  dataset: "regression", label_provenance: "takedown_confirmed",
};

describe("regression fixture", () => {
  it("holds only cases CI can replay from their frozen input", () => {
    expect(isFixtureCase(limitRow)).toBe(true);
    expect(isFixtureCase(categoryRow)).toBe(true);
    expect(isFixtureCase({ ...categoryRow, check_name: "hamilton.product_page" })).toBe(false);
    expect(isFixtureCase({ ...categoryRow, check_name: "hamilton.business_schedule" })).toBe(false);
    expect(isFixtureCase({ ...categoryRow, label_provenance: "deming_audit" })).toBe(false);
    expect(isFixtureCase({ check_name: "hamilton.source_check", input: { kind: "source_check" } as never, dataset: "regression", label_provenance: "takedown_confirmed" })).toBe(false);
  });

  it("holds every limit-guard case and the first category-guard cases in byte order (review of #2064)", () => {
    const keys = ["takedown:a:hamilton.category_guard", "takedown:B:hamilton.category_guard", "takedown:2:hamilton.category_guard"];
    const rows = [...keys.map((case_key) => ({ ...categoryRow, case_key })), { ...limitRow, case_key: "takedown:9:hamilton.limit_guard" }];
    // Byte order, as Postgres COLLATE "C": digits, then capitals, then lower case (a locale puts "a" before "B").
    expect(fixtureSelection(rows, 2).map((item) => item.case_key)).toEqual([
      "takedown:2:hamilton.category_guard", "takedown:9:hamilton.limit_guard", "takedown:B:hamilton.category_guard",
    ]);
    expect(buildRegressionFixture(rows, "2026-10-27T00:00:00Z", 1).cases.map((item) => item.case_key)).toEqual([
      "takedown:2:hamilton.category_guard", "takedown:9:hamilton.limit_guard",
    ]);
    // The committed file is exactly the capped selection of itself, so a rebuild reproduces it.
    const committedFile = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as RegressionFixture;
    const asRows = committedFile.cases.map((item) => ({ ...item, check_name: item.check_name ?? "hamilton.limit_guard", dataset: "regression", label_provenance: "takedown_confirmed" }));
    expect(fixtureSelection(asRows).map((item) => item.case_key)).toEqual(committedFile.cases.map((item) => item.case_key));
    expect(committedFile.cases.filter((item) => item.input.kind !== "limit_guard")).toHaveLength(FIXTURE_CATEGORY_LIMIT);
  });

  it("builds the fixture sorted, keeps the check name off limit-guard cases, and drops cases with no verdict", () => {
    const built = buildRegressionFixture([categoryRow, limitRow, { ...categoryRow, case_key: "takedown:10:hamilton.category_guard", expected_verdict: null }], "2026-10-27T00:00:00Z");
    expect(built.cases.map((item) => item.case_key)).toEqual(["takedown:1427:hamilton.limit_guard", "takedown:9:hamilton.category_guard"]);
    expect(built.cases[0]).not.toHaveProperty("check_name");
    expect(built.cases[1].check_name).toBe("hamilton.category_guard");
  });

  it("counts drift both ways", () => {
    expect(fixtureDrift(["a", "b"], ["b", "c", "d"])).toEqual({ active: 3, committed: 2, missing: 2, stale: 1 });
    expect(fixtureDrift(FIXTURE_CASE_KEYS, FIXTURE_CASE_KEYS)).toMatchObject({ missing: 0, stale: 0 });
  });

  it("exports with one read-only SELECT", () => {
    expect(REGRESSION_FIXTURE_SQL.trim()).toMatch(/^SELECT/);
    expect(REGRESSION_FIXTURE_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(REGRESSION_FIXTURE_SQL).toContain("'hamilton.limit_guard', 'hamilton.category_guard'");
  });

  it("the committed fixture is in the built shape", () => {
    const committed = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as RegressionFixture;
    const rows = process.env.REGRESSION_FIXTURE_ROWS;
    if (rows) {
      const exported = JSON.parse(readFileSync(rows, "utf8")) as FixtureExportRow[] | { rows: FixtureExportRow[] };
      const list = Array.isArray(exported) ? exported : exported.rows;
      writeFileSync(FIXTURE_PATH, `${JSON.stringify(buildRegressionFixture(list, new Date().toISOString()), null, 1)}\n`);
      return;
    }
    expect(committed.cases.length).toBeGreaterThan(0);
    expect(new Set(committed.cases.map((item) => item.case_key)).size).toBe(committed.cases.length);
    for (const item of committed.cases) expect(isFixtureCase({ check_name: item.check_name ?? "hamilton.limit_guard", input: item.input, dataset: "regression", label_provenance: "takedown_confirmed" })).toBe(true);
  });
});
