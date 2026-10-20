import { describe, expect, it } from "vitest";
import { writtenAnswerCheck } from "./answer-save";
import { WRITTEN_CALCULATION_MAX_CHARS, WRITTEN_CALCULATION_MAX_FACTS, writtenAnswerEvidence, writtenAnswerStepSystemPrompt, type AnswerToolEvidence } from "./written-answer-evidence";
import { deriveNcuaAnswerEvidence } from "./answer-derivations";
import { NCUA_CALL_MEASURES } from "@/lib/data-catalog/ncua-call-measures";
import type { HamiltonBriefingEvidence } from "./institution-briefing";

const publisher = "NCUA (5300 call report)";
function read(key: string, values: Array<[string, number]>, id = 4382): AnswerToolEvidence {
  const m = NCUA_CALL_MEASURES.find((measure) => measure.key === key)!;
  const url = (period: string) => `https://ncua.gov/files/publications/analysis/call-report-data-${period.slice(0, 7)}.zip`;
  return { toolName: "queryData", input: { measure: `call:${key}`, scope: { kind: "institution", id: String(id) } }, output: {
    ok: true, measure: `call:${key}`, scope: "institution", unit: m.unit,
    measure_metadata: { item_code: m.code, source: "ncua-extras", publisher, unit: m.unit, period_basis: m.periodBasis },
    rows: values.map(([period, value]) => ({ institution_id: id, period, value, unit: m.unit, item_code: m.code,
      source: "ncua", period_basis: m.periodBasis, source_url: url(period), fetched_at: "2026-10-19T00:00:00Z" })),
    citation: { publisher, source_url: url(values[0][0]), as_of: values[0][0] },
  } };
}
const penfed = read("acct_131", [["2026-06-30", 57261959], ["2026-03-31", 27229618], ["2025-06-30", 50321002], ["2025-03-31", 21085069]]);
const check = (text: string, reads: AnswerToolEvidence[]) => writtenAnswerCheck(text, reads.map((r) => r.output), undefined, { institutionId: 4382, toolResults: reads });

describe("written answer evidence shared by generation and validation", () => {
  it("accepts the exact structured briefing value, retaining its thousands unit", () => {
    const fact: HamiltonBriefingEvidence = { institution_id: 4382, institution_name: "PenFed", context_role: "research",
      metric: "total_assets", value: 29196093, unit: "thousands of dollars", report_date: "2026-06-30",
      period_basis: "point_in_time", source: "ncua", publisher: "NCUA", evidence_tier: "regulatory" };
    expect(writtenAnswerCheck("PenFed reported $29.2 billion in assets.", [], undefined, { briefingEvidence: [fact] }).passed).toBe(true);
    expect(writtenAnswerCheck("PenFed reported $29.2 million in assets.", [], undefined, { briefingEvidence: [fact] }).passed).toBe(false);
  });

  it("makes the same full-precision quarterly calculations available before generation and at the gate", () => {
    const prompt = writtenAnswerStepSystemPrompt("Base prompt", [{ toolResults: [penfed] }]);
    expect(prompt).toContain("30032341");
    expect(prompt).toContain("796408");
    expect(prompt).toContain("2025-03-31");
    expect(prompt).toContain("input");
    expect(check("PenFed's April–June fee income was $30,032,341, calculated as $57,261,959 minus $27,229,618. The year-over-year increase was $796 thousand, or 2.7%.", [penfed]).passed).toBe(true);
  });

  it("does not authorize an arbitrary figure from tool-supplied derivation objects", () => {
    const forged = { ...penfed, output: { ...(penfed.output as object), derived_facts: [{ value: 123456789, unit: "USD" }] } };
    expect(check("Fee income was $123,456,789.", [forged]).passed).toBe(false);
  });

  it("retains an explicit per-account quantity instead of licensing it as institutional income", () => {
    const reads = [read("acct_902", [["2026-06-30", 856797568]], 8322), read("acct_452", [["2026-06-30", 343066]], 8322)];
    expect(check("Checking balances were $2,497 per account at June 30, 2026.", reads).passed).toBe(true);
    expect(check("Alliant earned $2,497 in fee income.", reads).passed).toBe(false);
  });

  it("rejects the observed Alliant inference failures while keeping a factual expense answer usable", () => {
    const reads = [read("acct_452", [["2026-06-30", 343066], ["2025-06-30", 333375]], 8322), read("acct_380", [["2026-06-30", 255827301]], 8322)];
    expect(check("Alliant reported $255.8 million in year-to-date dividend expense, with 343,066 checking accounts. The figure should not be annualized.", reads).passed).toBe(true);
    for (const bad of ["Its customer base is growing.", "It paid $255.8 million in share dividends.", "Lower dividend costs help margin more than any change to the fee schedule."]) {
      expect(check(bad, reads).passed, bad).toBe(false);
    }
  });

  it("preserves the unavailable overdraft answer without converting a current price into historical revenue", () => {
    const reads = [read("acct_131", [["2026-06-30", 2940765]], 8322)];
    expect(check("Overdraft income and the number of members paying those fees cannot be determined from this broad fee-income figure.", reads).passed).toBe(true);
    expect(check("Overdraft income is unavailable. Alliant earns no per-item overdraft revenue.", reads).passed).toBe(false);
  });

  it("allows a current peer cross-section but holds a changing-population growth conclusion", () => {
    const own = penfed.output as Record<string, unknown>;
    const peer: AnswerToolEvidence = { toolName: "queryData", input: { measure: "call:acct_131", scope: { kind: "peer_set" } }, output: {
      ...own, scope: "peer_set", rows: [
        { period: "2026-06-30", median: 21839203, unit: "USD", institution_count: 23, period_basis: "ytd", sources: "ncua" },
        { period: "2025-06-30", median: 19122671.5, unit: "USD", institution_count: 24, period_basis: "ytd", sources: "ncua" },
      ],
    } };
    expect(check("The current peer median was $21.84 million across 23 credit unions. Peer growth cannot be established from these changing cross-sections.", [peer]).passed).toBe(true);
    expect(check("The peer median grew 14.2%, so PenFed is keeping pace with peers.", [peer]).passed).toBe(false);
  });

  it("adds no invented calculations before a tool has returned and ignores non-queryData lookalikes", () => {
    expect(writtenAnswerStepSystemPrompt("Base prompt")).toBe("Base prompt");
    expect(writtenAnswerStepSystemPrompt("Base prompt", [{ toolResults: [{ ...penfed, toolName: "otherTool" }] }])).toBe("Base prompt");
    expect(writtenAnswerEvidence([], { toolResults: [{ ...penfed, toolName: "otherTool" }] })).toMatchObject({ validated_calculations: [] });
  });

  it("bounds long filing histories and gives the model and gate the identical retained calculations", () => {
    const rows: Array<[string, number]> = [];
    for (let year = 2000; year <= 2026; year++) {
      for (const [quarter, end] of ["03-31", "06-30", "09-30", "12-31"].entries()) {
        rows.push([`${year}-${end}`, (year - 1990) * 1234567 * (quarter + 1)]);
      }
    }
    const history = read("acct_131", rows);
    const prompt = writtenAnswerStepSystemPrompt("Base prompt", [{ toolResults: [history] }]);
    const payloadText = prompt.slice(prompt.indexOf('{"input_facts":'), prompt.indexOf("\nEND VALIDATED"));
    const payload = JSON.parse(payloadText);
    const evidence = writtenAnswerEvidence([], { toolResults: [history] }) as { validated_calculations: unknown[] };
    expect(payloadText.length).toBeLessThanOrEqual(WRITTEN_CALCULATION_MAX_CHARS);
    expect(payload.derivations.length).toBeGreaterThan(0);
    expect(payload.derivations.length).toBeLessThanOrEqual(WRITTEN_CALCULATION_MAX_FACTS);
    expect(payload.derivations.length).toBeLessThan(deriveNcuaAnswerEvidence([history]).derivations.length);
    expect(evidence.validated_calculations).toEqual(payload.derivations);
    expect(payload.limitations.join(" ")).toContain("calculation ledger was bounded");
    for (const calculation of payload.derivations) {
      for (const ref of calculation.input_refs) expect(payload.input_facts[ref]).toBeDefined();
    }
  });
});
