import { describe, expect, it } from "vitest";
import retained from "./test-fixtures/navy-comparable-peers-4003.json";
import operandRetained from "./test-fixtures/navy-comparable-peers-017b.json";
import { writtenAnswerCheck } from "./answer-save";
import { HAMILTON_INTERPRETATION_INSTRUCTION } from "./answer-interpretations";
import { profileQuarterCalculations } from "./profile-quarter-evidence";
import { writtenAnswerEvidence, writtenAnswerStepSystemPrompt, type WrittenAnswerEvidenceContext } from "./written-answer-evidence";

// Unmodified candidate and actual public-data context from the isolated 4003a1d run.
const context = retained.context as WrittenAnswerEvidenceContext;
const outputs = retained.context.toolResults.map((read) => read.output);
const cause = "The dollar lead mostly reflects size, not pricing.";
const check = (text: string) => writtenAnswerCheck(text, outputs, retained.question, context);
const profileRead = () => structuredClone(retained.context.toolResults[0]);

describe("retained Navy profile answer (#2365, #2366, #2367)", () => {
  it("holds the unmodified answer specifically for its unsupported cause after validating its periods, arithmetic and exclusive bounds", () => {
    const result = check(retained.answer);
    expect(result.figureCheck.unmatched).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.problems).toEqual([expect.stringContaining("size, rather than pricing")]);
  });

  it("passes a test-only copy with just the causal sentence removed", () => {
    expect(retained.answer).toContain(cause);
    expect(check(retained.answer.replace(cause, ""))).toMatchObject({ passed: true, problems: [], figureCheck: { unmatched: [] } });
    expect(retained.answer).toContain(cause); // The captured response remains unchanged.
    expect(writtenAnswerCheck(retained.answer.replace(cause, ""), outputs, retained.question, { ...context, institutionId: 9999 }).passed).toBe(false);
  });

  it("recomputes profile arithmetic with distinct rounded aggregate provenance for generation and validation", () => {
    const calculations = profileQuarterCalculations(context.toolResults!);
    expect(calculations).toContainEqual(expect.objectContaining({
      id: "ncua-profile:4956:service_charge_income:2026-06-30:ytd_to_quarter",
      institution_id: 4956, source: "ncua", source_kind: "canonical regulatory institution profile",
      measure: "broad_credit_union_fee_income", report_date: "2026-06-30", value: 153080000,
      expression: "(297363000 - 144283000)", caveat: expect.stringContaining("rounded to thousands"),
    }));
    expect(JSON.stringify(calculations)).not.toContain("source_url");
    expect(JSON.stringify(calculations)).not.toContain("call:acct_131");
    expect(writtenAnswerEvidence(outputs, context)).toMatchObject({ validated_calculations: calculations });
    expect(writtenAnswerStepSystemPrompt("Base prompt", [{ toolResults: context.toolResults! }])).toContain("(297363000 - 144283000)");
  });

  it("accepts result-last or result-first profile equations and keeps relabeled operands held", () => {
    expect(check("Q2 2026 fee income: Navy's year-to-date total of $297.36 million minus its Q1 total of $144.28 million equals $153.08 million (Source: NCUA, 2026-06-30).").passed).toBe(true);
    expect(check("Q2 2026 fee income was $153.08 million = $297.36 million YTD minus $144.28 million YTD (Source: NCUA, 2026-06-30).").passed).toBe(true);
    expect(check("Q2 2026 fee income: Navy's year-to-date total of $297.36 million minus its Q2 peer median of $144.28 million equals $153.08 million.").passed).toBe(false);
    expect(check("Q2 2026 fee income: Navy's year-to-date total of $297.36 million minus its Q1 total of $144.28 million equals $153.08 million, the Q2 peer median.").passed).toBe(false);
  });

  it.each([
    ["tool name", (r: ReturnType<typeof profileRead>) => { r.toolName = "otherTool"; }],
    ["input identity", (r: ReturnType<typeof profileRead>) => { r.input.id = 9999; }],
    ["canonical charter", (r: ReturnType<typeof profileRead>) => { r.output.identity.charter_type = "bank"; }],
    ["source definition", (r: ReturnType<typeof profileRead>) => { r.output.financials.definition.source = "fdic"; }],
    ["measure definition", (r: ReturnType<typeof profileRead>) => { r.output.financials.definition.measure = "deposit_service_charge_income"; }],
    ["period definition", (r: ReturnType<typeof profileRead>) => { r.output.financials.definition.period_basis = "standalone_quarter"; }],
    ["units", (r: ReturnType<typeof profileRead>) => { r.output.financials.definition.unit = "USD"; }],
    ["prior institution", (r: ReturnType<typeof profileRead>) => { r.output.financials.records[1].institution_id = 9999; }],
    ["prior source", (r: ReturnType<typeof profileRead>) => { r.output.financials.records[1].source = "fdic"; }],
    ["same-year adjacency", (r: ReturnType<typeof profileRead>) => { r.output.financials.records[1].report_date = "2025-12-31"; }],
    ["nonnegative input", (r: ReturnType<typeof profileRead>) => { r.output.financials.records[1].service_charge_income = -1; }],
    ["finite input", (r: ReturnType<typeof profileRead>) => { r.output.financials.records[1].service_charge_income = Infinity; }],
    ["quarter agreement", (r: ReturnType<typeof profileRead>) => { r.output.revenue_trend[0].service_charge_income = 153079; }],
    ["duplicate conflict", (r: ReturnType<typeof profileRead>) => { r.output.financials.records[0].service_charge_income += 1; }],
  ])("suppresses the current-quarter derivation for invalid %s", (_name, mutate) => {
    const read = profileRead();
    mutate(read);
    expect(profileQuarterCalculations([read]).filter((calculation) => calculation.report_date === "2026-06-30")).toEqual([]);
  });

  it("suppresses conflicts across repeated profile reads, and never substitutes arbitrary nested derivations or medians", () => {
    const first = profileRead();
    const second = profileRead();
    second.output.financials.latest.service_charge_income += 1;
    second.output.financials.records[0].service_charge_income += 1;
    second.output.revenue_trend[0].service_charge_income += 1;
    expect(profileQuarterCalculations([first, second]).filter((calculation) => calculation.report_date === "2026-06-30")).toEqual([]);
    first.output.financials.records = [];
    Object.assign(first.output, { derived_facts: [{ value: 153080000, source: "ncua", operation: "ytd_to_quarter" }] });
    expect(profileQuarterCalculations([first])).toEqual([]);
  });

  it.each([
    ["financial container", (r: ReturnType<typeof profileRead>) => { r.output.financials.units = "USD"; }],
    ["row unit", (r: ReturnType<typeof profileRead>) => { Object.assign(r.output.financials.records[1], { unit: "USD" }); }],
    ["row units", (r: ReturnType<typeof profileRead>) => { Object.assign(r.output.financials.records[1], { units: "USD" }); }],
    ["row field override", (r: ReturnType<typeof profileRead>) => { Object.assign(r.output.financials.records[1].field_units, { service_charge_income: "USD" }); }],
    ["latest duplicate unit conflict", (r: ReturnType<typeof profileRead>) => { Object.assign(r.output.financials.latest, { unit: "USD" }); }],
    ["trend unit override", (r: ReturnType<typeof profileRead>) => { Object.assign(r.output.revenue_trend[0], { unit: "USD" }); }],
    ["trend field override", (r: ReturnType<typeof profileRead>) => { Object.assign(r.output.revenue_trend[0].field_units, { service_charge_income: "USD" }); }],
    ["unsafe converted input", (r: ReturnType<typeof profileRead>) => { r.output.financials.records[1].service_charge_income = Number.MAX_SAFE_INTEGER; }],
  ])("suppresses helper and full-gate arithmetic for conflicting %s (#2370)", (_name, mutate) => {
    const read = profileRead();
    mutate(read);
    expect(profileQuarterCalculations([read]).filter((calculation) => calculation.report_date === "2026-06-30")).toEqual([]);
    expect(writtenAnswerCheck(retained.answer.replace(cause, ""), [read.output], retained.question, { ...context, toolResults: [read] }).passed).toBe(false);
  });

  it("instructs upstream generation to use neutral period and dollar-lead wording", () => {
    expect(HAMILTON_INTERPRETATION_INSTRUCTION).toContain("This is a six-month total; no full-year estimate is established.");
    expect(HAMILTON_INTERPRETATION_INSTRUCTION).toContain("gap, lead or ranking");
    expect(HAMILTON_INTERPRETATION_INSTRUCTION).toContain("these figures do not establish whether size, pricing or member volume explains the lead");
  });
});

describe("retained Navy operand-only explanation and scope claims (#2379, #2380, #2381)", () => {
  const context = operandRetained.context as WrittenAnswerEvidenceContext;
  const outputs = operandRetained.context.toolResults.map((read) => read.output);
  const explanation = "The quarter is $297.36 million year to date minus $144.28 million for Q1 (NCUA 5300 call report).";
  const result = "Navy Federal reported $153.08 million in standalone Q2 2026 fee income.";
  const check = (text: string, question: string | undefined = operandRetained.question) => writtenAnswerCheck(text, outputs, question, context);

  it("keeps the exact captured candidate held for quality and overdraft-exclusion claims after validating its arithmetic", () => {
    const checked = check(operandRetained.answer);
    expect(checked.figureCheck.unmatched).toEqual([]);
    expect(checked.passed).toBe(false);
    expect(checked.problems).toHaveLength(2);
    expect(checked.problems.join(" ")).toContain("coverage, not benchmark strength");
    expect(checked.problems.join(" ")).toContain("includes overdraft fees");
    expect(checked.problems.join(" ")).not.toContain("standalone-quarter");
  });

  it("passes a test-only copy correcting just the two unsupported semantic claims", () => {
    const bounded = operandRetained.answer.replace(", so the benchmark is strong", "")
      .replace("This is not overdraft income or bank deposit service charges.", "This is not overdraft income alone or bank deposit service charges.");
    expect(check(bounded)).toMatchObject({ passed: true, problems: [], figureCheck: { unmatched: [] } });
    expect(operandRetained.answer).toContain(", so the benchmark is strong");
    expect(operandRetained.answer).toContain("This is not overdraft income or bank deposit service charges.");
  });

  it("accepts source-bound operand explanations only when the requested quarter result is validated elsewhere", () => {
    expect(check(`${result} ${explanation}`).passed).toBe(true);
    expect(check(`${explanation} ${result}`).passed).toBe(true);
    expect(check(explanation).passed).toBe(false);
    expect(check(`${explanation} The Q2 comparison is unavailable.`).passed).toBe(false);
  });

  it.each(["cohort", "group", "benchmark"])("retains the requested-quarter role and date for an unqualified %s median", (label) => {
    const wrong = check(`${result} The ${label} median was $297.36 million.`);
    expect(wrong.figureCheck.unmatched).toEqual([]);
    expect(wrong.passed).toBe(false);
    expect(wrong.problems.join(" ")).toContain("standalone-quarter");
    expect(check(`${result} The ${label} median was $11.125 million.`)).toMatchObject({ passed: true, problems: [] });
  });

  it("does not apply the income-period rule to an explicitly sourced published fee-price median", () => {
    const priceRead = { toolName: "queryData", input: { measure: "fee:atm_non_network" }, output: {
      measure: "fee:atm_non_network", period_basis: "fee_schedule", source: "published_fee_catalog", unit: "USD", median: 1, institution_count: 25, review_status: "approved", evidence_policy: "verified_only",
    } };
    expect(writtenAnswerCheck(`${result} The cohort median published ATM fee price was $1.`, [...outputs, priceRead.output], operandRetained.question, { ...context, toolResults: [...context.toolResults!, priceRead] })).toMatchObject({ passed: true, problems: [] });
    const priceContext = { ...context, toolResults: [...context.toolResults!, priceRead] };
    expect(writtenAnswerCheck("All 25 institutions reported published fee prices, giving the fee-price sample strong benchmark maturity.", [...outputs, priceRead.output], "", priceContext)).toMatchObject({ passed: true, problems: [] });
    expect(writtenAnswerCheck("All 25 institutions reported published fee prices, giving the fee-price sample a strong financial benchmark.", [...outputs, priceRead.output], "", priceContext).passed).toBe(false);
    expect(writtenAnswerCheck("All 25 institutions reported published fee prices, giving the fee-price sample strong benchmark maturity, and the financial benchmark is strong.", [...outputs, priceRead.output], "", priceContext).passed).toBe(false);
  });

  it.each([
    "The quarter is $297.36 million year to date minus $144.28 million for Q2 (NCUA 5300 call report).",
    "The quarter is $297.36 million year to date minus $144.28 million for Q1 2025 (NCUA 5300 call report).",
    "The Q3 2026 quarter is $297.36 million year to date minus $144.28 million for Q1 (NCUA 5300 call report).",
    "The quarter is $297.36 million year to date minus $144.28 million for Q1, the Q2 peer median.",
    "The quarter is $297.36 million year to date minus $144.28 million for Q1 and the Q2 peer median was $144.28 million.",
    "The quarter is $297.36 million year to date minus $153.08 million for Q1 (NCUA 5300 call report).",
  ])("holds incorrect or relabeled operands: %s", (explanation) => {
    expect(check(`${result} ${explanation}`).passed).toBe(false);
  });

  it.each([
    "All 25 reported a usable figure for this date; coverage for this cohort is complete.",
    "All 25 reported, but coverage alone cannot establish a strong benchmark.",
    "All 25 reported, but this is not a strong benchmark.",
    "All 25 reported, but that does not make this a reliable benchmark.",
    "All 25 reported. Benchmark strength has not been established from coverage.",
    "Broad NCUA fee income includes overdraft fees but does not isolate their amount.",
    "This is not overdraft-only income or bank deposit service charges.",
    "This is not overdraft income alone.",
    "Separate overdraft income is not reported in the available evidence.",
    "Overdraft income cannot be determined from this broad total.",
    "Broad NCUA fee income does not exclude overdraft fees.",
    "Broad NCUA fee income doesn't exclude overdraft fees.",
    "A published fee price is not overdraft income.",
  ])("preserves precise coverage and overdraft limitations: %s", (answer) => {
    expect(check(answer, "")).toMatchObject({ passed: true, problems: [] });
  });

  it.each([
    "All 25 reported a usable figure, so the benchmark is strong.",
    "All 25 reported, making this a reliable benchmark.",
    "All 25 reported, but coverage alone cannot establish a strong benchmark; nevertheless the financial benchmark is reliable.",
    "All 25 financial filers reported, so the financial benchmark is strong; published prices are separate.",
    "This is not overdraft income or bank deposit service charges.",
    "Broad fee income excludes overdraft fees.",
    "Overdraft income is excluded from broad NCUA fee income.",
    "Broad income does not exclude overdraft fees, but the broad total excludes overdraft income.",
    "Broad income does not exclude overdraft fees and this is not overdraft income.",
    "Broad fee income excludes overdraft fees, while published fee prices are separate.",
  ])("holds unsupported quality or exclusion claims: %s", (answer) => {
    const checked = check(answer, "");
    expect(checked.passed).toBe(false);
    expect(checked.problems.join(" ")).not.toContain("standalone-quarter");
  });

  it("instructs generation to separate coverage from quality and preserve overdraft inclusion", () => {
    expect(HAMILTON_INTERPRETATION_INSTRUCTION).toContain("not a strong, reliable, robust or representative benchmark");
    expect(HAMILTON_INTERPRETATION_INSTRUCTION).toContain("Broad NCUA fee income includes overdraft fees");
  });
});
