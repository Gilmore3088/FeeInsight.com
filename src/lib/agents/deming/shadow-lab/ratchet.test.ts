// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareToBaseline, heldExpectations } from "./ratchet";
import type { CaseTrace, ShadowCase, StageFee } from "./types";

const nsf = (cents: number): StageFee => ({ canonicalFeeKey: "nsf", feeName: "NSF", amountCents: cents, frequency: null, excerpt: null, reason: null });

function makeCase(expected: Partial<ShadowCase["expected"]>, extra: Partial<ShadowCase> = {}): ShadowCase {
  return {
    caseKey: "missed_fees:a",
    scenario: "missed_fees",
    provenance: { fixture: "f", fixtureCaseKey: "a", textHash: "h", issue: "i" },
    document: { url: null, text: "t" },
    expected: { publish: [], forbid: [], ...expected },
    status: "ok",
    ...extra,
  };
}

function trace(c: ShadowCase, published: StageFee[], documentAccepted: boolean | null = true): CaseTrace {
  const stage = () => ({ passed: [], dropped: [] });
  return {
    caseKey: c.caseKey,
    scenario: c.scenario,
    stages: { document_gate: stage(), extract: stage(), verify: stage(), publish_gate: stage() },
    published: published.map((fee) => ({ ...fee, sourceLine: null, attributed: true })),
    documentAccepted,
    durationsMs: { document_gate: 0, extract: 0, verify: 0, publish_gate: 0 },
  };
}

describe("shadow lab ratchet", () => {
  it("should_list_each_expectation_the_run_meets", () => {
    const c = makeCase({
      publish: [{ canonicalFeeKey: "nsf", feeName: null, amountCents: 3000 }, { canonicalFeeKey: "nsf", feeName: null, amountCents: 2500 }],
      forbid: [{ canonicalFeeKey: "overdraft", feeName: null, amountCents: 3000 }],
    });
    expect(heldExpectations([c], [trace(c, [nsf(3000)])])).toEqual(["missed_fees:a|forbid|overdraft:3000", "missed_fees:a|publish|nsf:3000"]);
  });

  it("should_hold_counts_and_documents", () => {
    const dup = makeCase({ publishCount: { canonicalFeeKey: "nsf", amountCents: 3000, count: 1 } }, { caseKey: "duplicate_lines:a", scenario: "duplicate_lines" });
    const doc = makeCase({ documentIsSchedule: false }, { caseKey: "wrong_document:a", scenario: "wrong_document", document: { url: "u", text: null } });
    expect(heldExpectations([dup, doc], [trace(dup, [nsf(3000)]), trace(doc, [], false)])).toEqual(["duplicate_lines:a|count|nsf:3000", "wrong_document:a|document"]);
  });

  it("should_hold_nothing_for_a_case_that_is_not_ok", () => {
    const c = makeCase({ publish: [{ canonicalFeeKey: "nsf", feeName: null, amountCents: 3000 }] }, { status: "corrupt" });
    expect(heldExpectations([c], [trace(c, [nsf(3000)])])).toEqual([]);
  });

  it("should_report_lost_and_new_expectations_against_the_baseline", () => {
    expect(compareToBaseline({ held: ["a", "b"] }, ["b", "c"])).toEqual({ regressions: ["a"], gains: ["c"] });
  });
});
