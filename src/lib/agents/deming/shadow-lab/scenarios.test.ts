// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyManifest, freezeManifest, loadScenarios, NOT_REPLAYABLE } from "./scenarios";
import { SCENARIO_IDS } from "./types";

describe("shadow lab scenarios", () => {
  const cases = loadScenarios();

  it("should_load_all_six_scenarios", () => {
    for (const id of SCENARIO_IDS) {
      expect(cases.filter((c) => c.scenario === id).length, id).toBeGreaterThan(0);
    }
    const documents = cases.filter((c) => c.scenario === "wrong_document");
    expect(documents).toHaveLength(24);
    expect(documents.every((c) => c.document.text === null && c.document.url)).toBe(true);
  });

  it("should_mark_a_case_corrupt_when_its_input_differs_from_the_manifest", () => {
    const manifest = freezeManifest(cases);
    const [first, ...rest] = cases;
    const edited = { ...first, document: { ...first.document, text: `${first.document.text}x` } };
    const checked = applyManifest([edited, ...rest], manifest);
    expect(checked[0].status).toBe("corrupt");
    expect(checked.slice(1).every((c) => c.status === "ok")).toBe(true);
  });

  it("should_mark_a_case_corrupt_when_it_is_missing_from_the_manifest", () => {
    const checked = applyManifest(cases.slice(0, 1), {});
    expect(checked[0].status).toBe("corrupt");
    expect(checked[0].statusReason).toMatch(/SHADOW_LAB_FREEZE/);
  });

  it("should_never_expect_a_zero_for_an_unpriced_answer_key_fee", () => {
    const expected = cases.filter((c) => c.scenario === "missed_fees").flatMap((c) => c.expected.publish);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.every((fee) => fee.amountCents != null)).toBe(true);
  });

  it("should_list_failures_without_committed_source_text", () => {
    expect(NOT_REPLAYABLE.map((item) => item.issue)).toEqual(["#1908", "#1909", "#1911", "#1915"]);
  });

  it("should_be_stable", () => {
    expect(loadScenarios()).toEqual(cases);
    const keys = cases.map((c) => c.caseKey);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });
});
