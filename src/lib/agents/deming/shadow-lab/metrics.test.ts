// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isKeyLine, matches, scoreRun } from "./metrics";
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

  it("should_score_names_only_on_published_fees_with_an_expected_name", () => {
    const named: FeeRef = { ...want, expectedName: "Insufficient funds item fee" };
    const c = makeCase({ publish: [named, { ...want, amountCents: 3500, expectedName: "NSF fee" }] }, { scenario: "live_audit", caseKey: "live_audit:a" });
    const good = scoreRun([c], [makeTrace(c, {}, [nsf(3000, { feeName: "Insufficient Funds Item" })])], 0);
    expect(good.names).toEqual({ expected: 1, matched: 1, rate: 1 });
    const cut = scoreRun([c], [makeTrace(c, {}, [nsf(3000, { feeName: "if insufficient funds" })])], 0);
    expect(cut.names).toEqual({ expected: 1, matched: 0, rate: 0 });
    expect(cut.failures.filter((f) => f.kind === "wrong_name")).toMatchObject([{ stage: "passed_every_stage" }]);
  });

  it("should_score_recall_and_false_publication_per_scenario", () => {
    const c = makeCase({ publish: [want], forbid: [{ ...want, amountCents: 2500 }] }, { scenario: "live_audit", caseKey: "live_audit:a" });
    const metrics = scoreRun([c], [makeTrace(c, {}, [nsf(2500)])], 0);
    expect(metrics.byScenario.live_audit).toEqual({ cases: 1, failures: 2, expected: 1, found: 0, forbidden: 1, published: 1 });
  });

  it("should_not_call_a_coincidental_same_price_read_a_misfile", () => {
    const ref: FeeRef = { canonicalFeeKey: "wire_domestic_outgoing", feeName: null, amountCents: 2500, sourceLine: "Outgoing domestic wire transfer ... $25.00" };
    const c = makeCase({ publish: [ref] });
    const coincidence = makeTrace(c, { extract: { passed: [nsf(2500, { canonicalFeeKey: "stop_payment", feeName: "Stop Payment", excerpt: "Stop Payment | $25.00" })] } });
    const misfiled = makeTrace(c, { extract: { passed: [nsf(2500, { canonicalFeeKey: "wire_intl_outgoing", feeName: "Outgoing Wire", excerpt: "Outgoing domestic wire transfer ... $25.00" })] } });
    expect(scoreRun([c], [coincidence], 0).failures[0].reason).toBe("other_line_same_price");
    expect(scoreRun([c], [misfiled], 0).failures[0].reason).toBe("read_other_category");
  });
});

describe("shadow lab miss charging", () => {
  const keyLine = "Cashier Checks 3 Free $5 3 Free $5";
  const ref: FeeRef = { canonicalFeeKey: "cashiers_check", feeName: null, amountCents: 500, sourceLine: keyLine };
  const c = makeCase({ publish: [ref] });
  const reason = (stages: Parameters<typeof makeTrace>[1], published: StageFee[] = []) =>
    scoreRun([c], [makeTrace(c, stages, published)], 0).failures[0];
  const unclassified = (extra: Partial<StageFee>) => nsf(500, { canonicalFeeKey: null, reason: "held:unclassified", ...extra });

  it("should_charge_an_unclassified_hold_on_the_key_line_as_held_unclassified", () => {
    const held = unclassified({ feeName: "Cashier Checks", excerpt: keyLine });
    expect(reason({ extract: { dropped: [held] } })).toMatchObject({ stage: "extract", reason: "held_unclassified" });
  });

  it("should_read_a_reflowed_key_line_as_the_same_line", () => {
    const held = unclassified({ feeName: "Cashier Checks", excerpt: "Cashier Checks | $5" });
    expect(reason({ extract: { dropped: [held] } })?.reason).toBe("held_unclassified");
  });

  it("should_prefer_held_unclassified_over_the_category_read_at_another_price", () => {
    const held = unclassified({ feeName: "Cashier Checks", excerpt: keyLine });
    const elsewhere = nsf(1000, { canonicalFeeKey: "cashiers_check", excerpt: "Official Check | $10" });
    expect(reason({ extract: { passed: [elsewhere], dropped: [held] } })?.reason).toBe("held_unclassified");
  });

  it("should_not_charge_an_unclassified_hold_on_another_line_or_price_as_held_unclassified", () => {
    const otherLine = unclassified({ feeName: "Telephone Transfer", excerpt: "Telephone Transfer | $5" });
    const otherPrice = unclassified({ feeName: "Cashier Checks", excerpt: keyLine, amountCents: 300 });
    expect(reason({ extract: { dropped: [otherLine] } })?.reason).toBe("not_read");
    expect(reason({ extract: { dropped: [otherPrice] } })?.reason).toBe("not_read");
  });

  it("should_keep_a_held_read_with_the_key_category_at_its_own_hold_reason", () => {
    const held = nsf(500, { canonicalFeeKey: "cashiers_check", reason: "held:untraced", excerpt: keyLine });
    expect(reason({ extract: { dropped: [held] } })?.reason).toBe("held:untraced");
  });

  it("should_not_call_a_same_price_read_on_another_line_other_category", () => {
    // 7450's "Cashier Checks 3 Free ..." against "Bill Payer | Free": one shared price word, two lines.
    const billPayer = nsf(500, { canonicalFeeKey: "bill_pay", feeName: "Bill Payer", excerpt: "Bill Payer | $5" });
    // Sharing a distinctive word is not enough either.
    const sharedWord = nsf(500, { canonicalFeeKey: "stop_payment", feeName: "Cashier Check Stop Payment", excerpt: "Cashier Check Stop Payment | $5" });
    expect(reason({ extract: { passed: [billPayer] } })?.reason).toBe("other_line_same_price");
    expect(reason({ extract: { passed: [sharedWord] } })?.reason).toBe("other_line_same_price");
  });

  it("should_call_the_key_line_filed_elsewhere_other_category_by_excerpt_or_traced_line", () => {
    const byExcerpt = nsf(500, { canonicalFeeKey: "money_order", feeName: "Cashier Checks", excerpt: "Cashier Checks | $5" });
    const traced = nsf(500, { canonicalFeeKey: "money_order", feeName: "Checks", excerpt: null });
    const published = { ...traced, sourceLine: keyLine };
    expect(reason({ extract: { passed: [byExcerpt] } })?.reason).toBe("read_other_category");
    const trace = makeTrace(c, { extract: { passed: [traced] } });
    trace.published = [{ ...published, attributed: true }];
    expect(scoreRun([c], [trace], 0).failures[0].reason).toBe("read_other_category");
  });

  it("should_charge_a_read_with_no_link_to_the_key_as_not_read", () => {
    expect(reason({ extract: { passed: [nsf(700, { canonicalFeeKey: "stop_payment", excerpt: "Stop Payment | $7" })] } })?.reason).toBe("not_read");
  });

  it("should_tell_the_key_line_from_lines_that_only_share_a_price_or_word", () => {
    expect(isKeyLine("Direct Checking FREE FREE FREE $10 FREE", "Direct Checking | $10")).toBe(true);
    expect(isKeyLine("Each Additional Page | $ | 1.50", "Each Additional Page | $1.50")).toBe(true);
    expect(isKeyLine("\u200d$25.00 - NSF Check/ACH/ATM item", "$25.00 - NSF Check/ACH/ATM item")).toBe(true);
    expect(isKeyLine("$20.00", "Wire Fee Incoming / $20.00")).toBe(false);
    expect(isKeyLine("$20.00", "$20.00")).toBe(true);
    expect(isKeyLine("Outgoing domestic wire | $25", "Outgoing international wire | $25")).toBe(false);
    expect(isKeyLine(null, "Anything | $1")).toBe(false);
  });

  it("should_list_excluded_keys_and_leave_them_out_of_recall", () => {
    const excluded = makeCase({
      publish: [want],
      excluded: [{ canonicalFeeKey: "estatement_fee", amountCents: 0, sourceLine: "eStatements | FREE", reason: "retired_category_no_home" }],
    });
    const metrics = scoreRun([excluded], [makeTrace(excluded, {}, [nsf(3000)])], 0);
    expect(metrics.answerKeyRecall).toEqual({ expected: 1, found: 1, rate: 1 });
    expect(metrics.excludedKeys).toEqual([
      { caseKey: "missed_fees:a", canonicalFeeKey: "estatement_fee", amountCents: 0, sourceLine: "eStatements | FREE", reason: "retired_category_no_home" },
    ]);
  });
});
