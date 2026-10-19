import { describe, expect, it } from "vitest";
import { NCUA_CALL_MEASURES } from "@/lib/data-catalog/ncua-call-measures";
import { deriveNcuaAnswerEvidence, deriveNcuaQueryResult, MAX_NCUA_ANSWER_DERIVATIONS, type NcuaDerivationRead } from "./answer-derivations";

function read(key: string, values: Array<[string, number]>, institutionId = 12): NcuaDerivationRead {
  const metric = NCUA_CALL_MEASURES.find((measure) => measure.key === key)!;
  return {
    input: { measure: `call:${key}`, scope: { kind: "institution", id: String(institutionId) } },
    output: {
      ok: true, measure: `call:${key}`, scope: "institution", unit: metric.unit,
      measure_metadata: { item_code: metric.code, name: metric.name, source: "ncua-extras", publisher: "NCUA (5300 call report)", unit: metric.unit, period_basis: metric.periodBasis },
      citation: { publisher: "NCUA (5300 call report)", source_url: "https://ncua.gov/newest.zip", as_of: values[0]?.[0] ?? null },
      rows: values.map(([period, value]) => ({ institution_id: institutionId, period, value, unit: metric.unit, period_basis: metric.periodBasis,
        item_code: metric.code, source: "ncua", source_url: `https://ncua.gov/filing-${period}.zip`, fetched_at: "2026-10-19T00:00:00Z" })),
    },
  };
}

const penfed = () => read("acct_131", [["2026-06-30", 57_261_959], ["2026-03-31", 27_229_618], ["2025-06-30", 50_321_002], ["2025-03-31", 21_085_069]]);
const rows = (value: NcuaDerivationRead) => (value.output as { rows: Record<string, unknown>[] }).rows;

describe("bounded NCUA financial derivations", () => {
  it("turns adjacent same-year cumulative filings into standalone quarters with every input's own provenance", () => {
    const query = penfed();
    const evidence = deriveNcuaQueryResult(query.input, query.output);
    const q2 = evidence.derivations.find((fact) => fact.report_date === "2026-06-30" && fact.operation === "ytd_to_quarter");
    expect(q2).toMatchObject({ institution_id: 12, measure: "call:acct_131", value: 30_032_341, unit: "USD", period_basis: "standalone_quarter",
      period_start: "2026-04-01", report_date: "2026-06-30", operation: "ytd_to_quarter", expression: "(57261959 - 27229618)" });
    expect(q2?.inputs).toEqual([
      expect.objectContaining({ institution_id: 12, value: 57_261_959, report_date: "2026-06-30", item_code: "ACCT_131", source: "ncua", source_url: "https://ncua.gov/filing-2026-06-30.zip", period_basis: "ytd", unit: "USD" }),
      expect.objectContaining({ institution_id: 12, value: 27_229_618, report_date: "2026-03-31", source_url: "https://ncua.gov/filing-2026-03-31.zip" }),
    ]);
    expect(evidence.limitations.join(" ")).toMatch(/not establish causes/);
  });

  it("derives PenFed's actual standalone YOY and sequential changes without arbitrary pair arithmetic", () => {
    const facts = deriveNcuaAnswerEvidence([penfed()]).derivations;
    expect(facts).toContainEqual(expect.objectContaining({ report_date: "2026-06-30", baseline_report_date: "2025-06-30", period_basis: "standalone_quarter", comparison: "year_over_year", operation: "difference", value: 796_408, unit: "USD" }));
    const yoy = facts.find((fact) => fact.report_date === "2026-06-30" && fact.period_basis === "standalone_quarter" && fact.comparison === "year_over_year" && fact.unit === "percent");
    expect(yoy?.value).toBeCloseTo(2.724072462, 6);
    expect(yoy?.inputs).toHaveLength(4);
    expect(yoy?.expression).toBe("(((57261959 - 27229618) - (50321002 - 21085069)) / (50321002 - 21085069) * 100)");
    expect(facts).toContainEqual(expect.objectContaining({ report_date: "2026-06-30", baseline_report_date: "2026-03-31", period_basis: "standalone_quarter", comparison: "quarter_over_quarter", operation: "difference", value: 2_802_723 }));
    const sequential = facts.find((fact) => fact.report_date === "2026-06-30" && fact.period_basis === "standalone_quarter" && fact.comparison === "quarter_over_quarter" && fact.unit === "percent");
    expect(sequential?.value).toBeCloseTo(10.292920745, 6);
    expect(facts.some((fact) => fact.period_basis === "ytd" && fact.comparison === "quarter_over_quarter")).toBe(false);
  });

  it("keeps a first quarter's cumulative value as its standalone quarter without subtracting last year's Q4", () => {
    const facts = deriveNcuaAnswerEvidence([read("acct_380", [["2026-03-31", 20], ["2025-12-31", 90], ["2025-09-30", 60]])]).derivations;
    expect(facts).toContainEqual(expect.objectContaining({ report_date: "2026-03-31", value: 20, operation: "q1_ytd_as_quarter", period_start: "2026-01-01", inputs: [expect.objectContaining({ value: 20 })] }));
    expect(facts).toContainEqual(expect.objectContaining({ report_date: "2026-03-31", value: -10, operation: "difference", comparison: "quarter_over_quarter", period_basis: "standalone_quarter" }));
  });

  it("does not bridge a missing cumulative quarter or treat a decreasing cumulative line as a negative quarter", () => {
    const missing = deriveNcuaAnswerEvidence([read("acct_131", [["2026-09-30", 90], ["2026-03-31", 20]])]).derivations;
    expect(missing.some((fact) => fact.report_date === "2026-09-30")).toBe(false);
    const decreasing = deriveNcuaAnswerEvidence([read("acct_131", [["2026-06-30", 10], ["2026-03-31", 20]])]).derivations;
    expect(decreasing.some((fact) => fact.report_date === "2026-06-30")).toBe(false);
  });

  it("produces only the two allowed same-date ratios with explicit quantity dimensions", () => {
    const facts = deriveNcuaAnswerEvidence([
      read("acct_902", [["2026-06-30", 856_797_568]]), read("acct_452", [["2026-06-30", 343_066]]), read("acct_564a", [["2026-06-30", 913]]),
      read("acct_657", [["2026-06-30", 1_000_000]]), read("acct_131", [["2026-06-30", 200]]),
    ]).derivations;
    const ratios = facts.filter((fact) => fact.operation === "ratio");
    expect(ratios).toHaveLength(2);
    expect(ratios).toContainEqual(expect.objectContaining({ value: 856_797_568 / 343_066, unit: "USD", denominator_unit: "account", period_basis: "point_in_time", report_date: "2026-06-30", expression: "(856797568 / 343066)" }));
    expect(ratios).toContainEqual(expect.objectContaining({ value: 343_066 / 913, unit: "count", denominator_unit: "employee", expression: "(343066 / 913)" }));
    expect(ratios.every((fact) => fact.inputs.length === 2 && fact.inputs.every((input) => input.report_date === fact.report_date && input.institution_id === fact.institution_id))).toBe(true);
  });

  it.each(["institution", "date"])("does not divide different %s values", (mismatch) => {
    const numerator = read("acct_902", [["2026-06-30", 200]]);
    const denominator = read("acct_452", [[mismatch === "date" ? "2026-03-31" : "2026-06-30", 10]], mismatch === "institution" ? 99 : 12);
    expect(deriveNcuaAnswerEvidence([numerator, denominator]).derivations.filter((fact) => fact.operation === "ratio")).toEqual([]);
  });

  it("retains real zero values but never divides by zero or reports a percentage from a zero baseline", () => {
    const facts = deriveNcuaAnswerEvidence([read("acct_131", [["2026-03-31", 0], ["2025-03-31", 0]]), read("acct_452", [["2026-06-30", 0]]), read("acct_902", [["2026-06-30", 100]])]).derivations;
    expect(facts).toContainEqual(expect.objectContaining({ value: 0, operation: "q1_ytd_as_quarter", report_date: "2026-03-31" }));
    expect(facts.some((fact) => fact.operation === "percent_change" || fact.operation === "ratio")).toBe(false);
    expect(facts.every((fact) => Number.isFinite(fact.value))).toBe(true);
  });

  it("keeps decreases signed and compares the same reporting basis", () => {
    const facts = deriveNcuaAnswerEvidence([read("acct_452", [["2026-06-30", 80], ["2026-03-31", 100], ["2025-06-30", 160]])]).derivations;
    expect(facts).toContainEqual(expect.objectContaining({ value: -20, unit: "count", operation: "difference", comparison: "quarter_over_quarter", period_basis: "point_in_time" }));
    expect(facts).toContainEqual(expect.objectContaining({ value: -50, unit: "percent", operation: "percent_change", comparison: "year_over_year" }));
  });

  it.each([
    ["source", "ffiec"], ["item_code", "ACCT_380"], ["unit", "thousands"], ["period_basis", "quarterly"], ["institution_id", 99],
    ["period", "2026-06-29"], ["source_url", null], ["source_url", "https://evil.example/ncua.gov/filing.zip"],
    ["source_url", "http://ncua.gov/filing.zip"], ["value", null], ["value", "20"], ["value", Number.NaN], ["value", Number.POSITIVE_INFINITY], ["value", -1],
  ])("refuses invalid input %s=%s instead of deriving from it", (key, value) => {
    const query = read("acct_131", [["2026-06-30", 20], ["2026-03-31", 10]]);
    rows(query)[0][key] = value;
    expect(deriveNcuaAnswerEvidence([query]).derivations.some((fact) => fact.report_date === "2026-06-30")).toBe(false);
  });

  it("does not accept nonintegral account or employee counts", () => {
    const facts = deriveNcuaAnswerEvidence([read("acct_902", [["2026-06-30", 100]]), read("acct_452", [["2026-06-30", 1.5]])]).derivations;
    expect(facts).toEqual([]);
  });

  it.each(["peer_set", "national", "state"])("refuses every %s aggregate, including medians with the right numeric values", (scope) => {
    const query = penfed();
    (query.input as { scope: { kind: string } }).scope.kind = scope;
    (query.output as { scope: string }).scope = scope;
    for (const row of rows(query)) row.median = row.value;
    expect(deriveNcuaAnswerEvidence([query]).derivations).toEqual([]);
  });

  it("requires matching validated tool input, curated metadata and publisher", () => {
    const wrongMeasure = penfed();
    (wrongMeasure.input as { measure: string }).measure = "call:acct_380";
    const wrongMetadata = penfed();
    ((wrongMetadata.output as { measure_metadata: Record<string, unknown> }).measure_metadata).period_basis = "quarterly";
    const wrongPublisher = penfed();
    ((wrongPublisher.output as { citation: Record<string, unknown> }).citation).publisher = "Other";
    const failed = penfed();
    (failed.output as { ok: boolean }).ok = false;
    for (const query of [wrongMeasure, wrongMetadata, wrongPublisher, failed, { output: penfed().output }]) expect(deriveNcuaAnswerEvidence([query]).derivations).toEqual([]);
  });

  it("suppresses conflicting duplicate filing values instead of selecting whichever was read last", () => {
    const query = penfed();
    const conflicting = read("acct_131", [["2026-06-30", 100]]);
    for (const reads of [[query, conflicting], [conflicting, query]]) {
      const facts = deriveNcuaAnswerEvidence(reads).derivations;
      expect(facts.some((fact) => fact.inputs.some((input) => input.report_date === "2026-06-30"))).toBe(false);
      expect(facts.some((fact) => fact.report_date === "2026-03-31")).toBe(true);
    }
    const noConflict = deriveNcuaAnswerEvidence([query, query]).derivations;
    expect(noConflict.map((fact) => fact.id)).toEqual([...new Set(noConflict.map((fact) => fact.id))]);
  });

  it("never consumes a tool result's invented derived_facts or prose as inputs", () => {
    const query = read("acct_131", [["2026-06-30", 20]]);
    (query.output as Record<string, unknown>).derived_facts = [{ value: 500, unit: "USD", operation: "ytd_to_quarter" }];
    (query.output as Record<string, unknown>).note = "$900 million and 25% are available";
    expect(deriveNcuaAnswerEvidence([query]).derivations).toEqual([]);
  });

  it("bounds the output and leaves shared input data unchanged", () => {
    const readings = Array.from({ length: 6 }, (_, offset) => read("acct_131", Array.from({ length: 80 }, (_, index) => {
      const year = 2026 - Math.floor(index / 4);
      const q = 3 - index % 4;
      return [`${year}-${["03-31", "06-30", "09-30", "12-31"][q]}`, (q + 1) * 100] as [string, number];
    }), offset + 1));
    const before = JSON.stringify(readings);
    const facts = deriveNcuaAnswerEvidence(readings).derivations;
    expect(facts).toHaveLength(MAX_NCUA_ANSWER_DERIVATIONS);
    expect(facts[0].report_date).toBe("2026-12-31");
    expect(JSON.stringify(readings)).toBe(before);
  });
});
