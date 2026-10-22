// @vitest-environment node
import { describe, expect, it } from "vitest";
import { matches, scoreRun } from "./metrics";
import type { CaseTrace, FeeRef, ShadowCase, StageFee } from "./types";

const nsf = (cents: number, extra: Partial<StageFee> = {}): StageFee => ({
  canonicalFeeKey: "nsf",
  feeName: "NSF",
  amountCents: cents,
  frequency: null,
  excerpt: null,
  reason: null,
  ...extra,
});

function makeCase(expected: Partial<ShadowCase["expected"]>, extra: Partial<ShadowCase> = {}): ShadowCase {
  return {
    caseKey: "missed_fees:a",
    scenario: "missed_fees",
    provenance: { fixture: "f", fixtureCaseKey: "a", textHash: "h", issue: "i" },
    document: { url: null, text: "NSF | $30.00" },
    expected: { publish: [], forbid: [], ...expected },
    status: "ok",
    ...extra,
  };
}

function makeTrace(c: ShadowCase, stages: Partial<Record<"extract" | "verify" | "publish_gate", { passed?: StageFee[]; dropped?: StageFee[] }>>, published: StageFee[] = []): CaseTrace {
  const stage = (s?: { passed?: StageFee[]; dropped?: StageFee[] }) => ({ passed: s?.passed ?? [], dropped: s?.dropped ?? [] });
  return {
    caseKey: c.caseKey,
    scenario: c.scenario,
    stages: { document_gate: stage(), extract: stage(stages.extract), verify: stage(stages.verify), publish_gate: stage(stages.publish_gate) },
    published: published.map((fee) => ({ ...fee, sourceLine: "NSF | $30.00", attributed: true })),
    documentAccepted: true,
    durationsMs: { document_gate: 0, extract: 0, verify: 0, publish_gate: 0 },
  };
}

const want: FeeRef = { canonicalFeeKey: "nsf", feeName: null, amountCents: 3000 };

describe("shadow lab metrics", () => {
  it("should_charge_a_missed_fee_to_extract_when_never_read", () => {
    const c = makeCase({ publish: [want] });
    const metrics = scoreRun([c], [makeTrace(c, {})], 0);
    expect(metrics.recall).toEqual({ expected: 1, found: 0, rate: 0 });
    expect(metrics.failures).toMatchObject([{ kind: "missed", stage: "extract", reason: "not_read" }]);
  });

  it("should_charge_a_missed_fee_to_verify_when_verify_dropped_it", () => {
    const c = makeCase({ publish: [want] });
    const trace = makeTrace(c, { extract: { passed: [nsf(3000)] }, verify: { dropped: [nsf(3000, { reason: "darwin_checks" })] } });
    expect(scoreRun([c], [trace], 0).failures).toMatchObject([{ kind: "missed", stage: "verify", reason: "darwin_checks" }]);
  });

  it("should_count_a_found_fee_and_its_attribution", () => {
    const c = makeCase({ publish: [want] });
    const metrics = scoreRun([c], [makeTrace(c, { extract: { passed: [nsf(3000)] } }, [nsf(3000)])], 0);
    expect(metrics.recall.rate).toBe(1);
    expect(metrics.sourceAttribution).toEqual({ published: 1, attributed: 1, rate: 1 });
  });

  it("should_count_a_forbidden_fee_as_false_publication", () => {
    const c = makeCase({ forbid: [want] }, { scenario: "limit_as_fee", caseKey: "limit_as_fee:a" });
    const metrics = scoreRun([c], [makeTrace(c, {}, [nsf(3000)])], 0);
    expect(metrics.falsePublication).toEqual({ forbidden: 1, published: 1, rate: 1 });
    expect(metrics.failures).toMatchObject([{ kind: "false_publication", stage: "passed_every_stage" }]);
  });

  it("should_match_null_amount_on_key_only", () => {
    expect(matches({ canonicalFeeKey: "nsf", feeName: null, amountCents: null }, nsf(3000))).toBe(true);
    expect(matches({ canonicalFeeKey: "nsf", feeName: null, amountCents: 0 }, nsf(3000))).toBe(false);
    expect(matches({ ...want, frequency: "!hourly" }, nsf(3000))).toBe(true);
    expect(matches({ ...want, frequency: "!hourly" }, nsf(3000, { frequency: "hourly" }))).toBe(false);
  });

  it("should_charge_collapsed_distinct_lines_to_the_publish_gate", () => {
    const c = makeCase({ publishCount: { canonicalFeeKey: "nsf", amountCents: 3000, count: 2 } }, { scenario: "duplicate_lines", caseKey: "duplicate_lines:a" });
    const read = [nsf(3000), nsf(3000, { feeName: "Returned item" })];
    const metrics = scoreRun([c], [makeTrace(c, { extract: { passed: read }, verify: { passed: read } }, [read[0]])], 0);
    expect(metrics.duplicatePrevention).toEqual({ cases: 1, correct: 0, rate: 0 });
    expect(metrics.failures).toMatchObject([{ kind: "duplicate", stage: "publish_gate" }]);
  });

  it("should_leave_url_only_cases_out_of_every_fee_rate", () => {
    const c = makeCase({ documentIsSchedule: false }, { scenario: "wrong_document", caseKey: "wrong_document:a", document: { url: "https://b.example/p", text: null } });
    const metrics = scoreRun([c], [{ ...makeTrace(c, {}), documentAccepted: true }], 0);
    expect(metrics.documentGate).toEqual({ cases: 1, correct: 0 });
    expect(metrics.failures).toMatchObject([{ kind: "wrong_document", stage: "document_gate" }]);
    expect(metrics.recall.expected).toBe(0);
    expect(metrics.falsePublication.forbidden).toBe(0);
    expect(metrics.sourceAttribution.published).toBe(0);
  });

  it("should_return_null_rates_on_empty_denominators", () => {
    const metrics = scoreRun([], [], 0);
    expect([metrics.recall.rate, metrics.falsePublication.rate, metrics.duplicatePrevention.rate, metrics.sourceAttribution.rate]).toEqual([null, null, null, null]);
    expect(metrics.costMicrousd).toBe(0);
  });

  it("should_leave_corrupt_cases_out_and_count_them", () => {
    const c = makeCase({ publish: [want] }, { status: "corrupt" });
    const metrics = scoreRun([c], [makeTrace(c, {})], 0);
    expect(metrics.cases).toEqual({ ok: 0, corrupt: 1, notReplayable: 0 });
    expect(metrics.recall.expected).toBe(0);
  });

  it("should_count_a_duplicate_case_knox_never_read_as_missed", () => {
    const c = makeCase({ publishCount: { canonicalFeeKey: "nsf", amountCents: 3000, count: 1 } }, { scenario: "duplicate_lines", caseKey: "duplicate_lines:a" });
    const metrics = scoreRun([c], [makeTrace(c, {})], 0);
    expect(metrics.duplicatePrevention.cases).toBe(0);
    expect(metrics.failures).toMatchObject([{ kind: "missed", stage: "extract" }]);
  });

  it("should_charge_an_over_read_duplicate_to_extract", () => {
    const c = makeCase({ publishCount: { canonicalFeeKey: "nsf", amountCents: 3000, count: 1 } }, { scenario: "duplicate_lines", caseKey: "duplicate_lines:a" });
    const read = [nsf(3000), nsf(3000, { feeName: "NSF fee" })];
    const metrics = scoreRun([c], [makeTrace(c, { extract: { passed: read }, verify: { passed: read } }, read)], 0);
    expect(metrics.failures).toMatchObject([{ kind: "duplicate", stage: "extract" }]);
  });

  it("should_say_how_knox_read_a_missed_fee", () => {
    const c = makeCase({ publish: [want, { canonicalFeeKey: "overdraft", feeName: null, amountCents: 2500 }] });
    const trace = makeTrace(c, { extract: { passed: [nsf(3500), nsf(2500, { canonicalFeeKey: "stop_payment" })] } });
    expect(scoreRun([c], [trace], 0).failures.map((f) => f.reason)).toEqual(["read_other_amount", "read_other_category"]);
  });

  it("should_score_answer_key_recall_apart_from_other_expectations", () => {
    const key = makeCase({ publish: [want] });
    const ok = makeCase({ publish: [want] }, { scenario: "wrong_category", caseKey: "wrong_category:a" });
    const metrics = scoreRun([key, ok], [makeTrace(key, {}), makeTrace(ok, {}, [nsf(3000)])], 0);
    expect(metrics.recall).toEqual({ expected: 2, found: 1, rate: 0.5 });
    expect(metrics.answerKeyRecall).toEqual({ expected: 1, found: 0, rate: 0 });
  });
});
