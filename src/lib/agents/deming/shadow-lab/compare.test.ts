// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareRuns, stableJson, type CompareInput } from "./compare";
import { renderReport, REPORT_SECTIONS } from "./report";
import type { CaseTrace, ShadowCase, StageFee } from "./types";

const fee = (cents: number): StageFee => ({ canonicalFeeKey: "nsf", feeName: "NSF", amountCents: cents, frequency: null, excerpt: null, reason: null });

const cases: ShadowCase[] = ["a", "b"].map((key) => ({
  caseKey: `missed_fees:${key}`,
  scenario: "missed_fees",
  provenance: { fixture: "f", fixtureCaseKey: key, textHash: "h", issue: "i" },
  document: { url: null, text: "NSF | $30.00" },
  expected: { publish: [{ canonicalFeeKey: "nsf", feeName: null, amountCents: 3000 }], forbid: [] },
  status: "ok",
}));

function trace(caseKey: string, published: StageFee[], ms = 1): CaseTrace {
  const stage = () => ({ passed: [], dropped: [] });
  return {
    caseKey,
    scenario: "missed_fees",
    stages: { document_gate: stage(), extract: stage(), verify: stage(), publish_gate: stage() },
    published: published.map((item) => ({ ...item, sourceLine: null, attributed: false })),
    documentAccepted: true,
    durationsMs: { document_gate: ms, extract: ms, verify: ms, publish_gate: ms },
  };
}

function input(ms = 1): CompareInput {
  const current = [trace("missed_fees:a", [fee(3000)], ms), trace("missed_fees:b", [], ms)];
  const experimental = [trace("missed_fees:a", [fee(3000)], ms), trace("missed_fees:b", [fee(3000)], ms)];
  return {
    cases,
    versions: { knox: "extract.rules@1" },
    fixtures: [{ path: "f", sha256: "x" }],
    notReplayable: [{ issue: "#1", failure: "f", reason: "no committed source text" }],
    current: { traces: current, repeats: [current], providerCalls: 0 },
    experimental: { traces: experimental, repeats: [experimental], providerCalls: 0, config: { id: "e", description: "d", hourlyAtVerify: true, excerptAtPublish: false } },
  };
}

describe("shadow lab comparison", () => {
  it("should_drop_timing_from_stable_json", () => {
    expect(stableJson(compareRuns(input(1)))).toBe(stableJson(compareRuns(input(99))));
  });

  it("should_list_case_diffs_only_where_variants_differ", () => {
    expect(compareRuns(input()).caseDiffs).toEqual([{ caseKey: "missed_fees:b", current: [], experimental: ["nsf:3000:-"] }]);
  });

  it("should_report_unstable_when_a_repeat_differs", () => {
    const changed = input();
    changed.current.repeats = [[trace("missed_fees:a", []), trace("missed_fees:b", [])]];
    expect(compareRuns(changed).stability.identical).toBe(false);
    expect(compareRuns(input()).stability.identical).toBe(true);
  });

  it("should_render_every_section_heading", () => {
    const report = renderReport(compareRuns(input()));
    const positions = REPORT_SECTIONS.map((heading) => report.indexOf(`## ${heading}`));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("should_show_only_the_fees_that_differ", () => {
    const changed = input();
    changed.current.traces = [trace("missed_fees:a", [fee(3000), fee(2500)]), trace("missed_fees:b", [])];
    changed.experimental.traces = [trace("missed_fees:a", [fee(3000)]), trace("missed_fees:b", [])];
    const report = renderReport(compareRuns(changed));
    expect(report).toContain("| missed_fees:a | nsf:2500:- | none |");
  });

  it("should_say_not_measured_for_null_rates", () => {
    const report = renderReport(compareRuns(input()));
    expect(report).toMatch(/Duplicate prevention \| not measured \| not measured/);
    expect(report).not.toMatch(/Duplicate prevention \| 0\.0%/);
  });
});
