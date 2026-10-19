import { describe, expect, it } from "vitest";
import { checkAnswerInterpretations } from "./answer-interpretations";
import { writtenAnswerCheck } from "./answer-save";

function query(metric: string, values: number[] = [100, 120], scope = "institution", id = "8322") {
  const unit = metric === "acct_452" ? "count" : "USD";
  return {
    toolName: "queryData", input: { measure: `call:${metric}`, scope: { kind: scope, id } },
    output: {
      ok: true, measure: `call:${metric}`, scope,
      measure_metadata: { source: "ncua-extras", unit, period_basis: metric === "acct_452" ? "point_in_time" : "ytd" },
      rows: values.map((value, i) => ({ period: ["2025-06-30", "2026-06-30"][i], value: scope === "institution" ? value : undefined,
        median: scope === "institution" ? undefined : value, unit, period_basis: metric === "acct_452" ? "point_in_time" : "ytd",
        // This counts institutions, never the members of a credit union.
        ...(scope === "peer_set" ? { member_count: i ? 24 : 23 } : {}),
      })),
    },
  };
}
function fact(metric: string, value: number, report_date: string, overrides = {}) {
  return { metric, value, report_date, institution_id: 8322, institution_name: "Alliant Federal Credit Union", unit: "count", source: "ncua",
    context_role: "research", ...overrides };
}
const data = { toolResults: [query("acct_452"), query("acct_380"), query("acct_131"), query("acct_131", [19, 22], "peer_set")] };
const check = (text: string, evidence: unknown = data) => checkAnswerInterpretations(text, evidence);

describe("bounded NCUA interpretation gate (#2331)", () => {
  it.each([
    "Its customer base is growing.",
    "Alliant's membership grew.",
    "Member growth was strong.",
    "Not only is customer growth strong, its fee income rose.",
    "More accounts means more customers.",
  ])("rejects account counts substituted for member/customer growth: %s", (text) => {
    expect(check(text).join(" ")).toContain("do not establish member or customer growth");
  });

  it.each([
    "Checking accounts grew from 100 to 120; these are accounts, not members.",
    "Member growth cannot be determined from the account figures.",
    "Checking-account growth does not establish customer growth.",
    "We cannot infer member growth from account counts.",
    "There is not enough evidence to infer member growth.",
    "How did its member count change over the same period?",
  ])("allows account reporting and explicit limits: %s", (text) => expect(check(text)).toEqual([]));

  it("accepts independent same-institution, same-period, count-unit member evidence", () => {
    const facts = [fact("member_count", 500, "2025-06-30"), fact("member_count", 550, "2026-06-30")];
    expect(check("Alliant's membership grew from June 2025 to June 2026.", { ...data, facts })).toEqual([]);
  });

  it.each([
    { institution_id: 4382, institution_name: "Pentagon Federal Credit Union" },
    { report_date: "2024-06-30" },
    { unit: "USD" },
    { source: "unverified" },
  ])("unrelated member evidence cannot authorize account-to-member inference: %j", (override) => {
    const facts = [fact("member_count", 500, "2025-06-30", override), fact("member_count", 550, "2026-06-30", override)];
    expect(check("Its customer base is growing.", { ...data, facts }).join(" ")).toContain("member-count series");
  });

  it("checks the direction and dates rather than presence of member data", () => {
    const facts = [fact("member_count", 550, "2025-06-30"), fact("member_count", 500, "2026-06-30")];
    expect(check("Membership grew.", { ...data, facts })).not.toEqual([]);
    expect(check("Membership fell.", { ...data, facts })).toEqual([]);
    expect(check("Membership fell in 2024.", { ...data, facts })).not.toEqual([]);
  });

  it.each([
    "Membership grew from March 2025 to June 2026.",
    "Membership grew from June 1, 2025 to June 30, 2026.",
    "Membership grew from 2025-06-01 to 2026-06-30.",
    "Membership grew from Q1 2025 to Q2 2026.",
  ])("same-year member figures cannot support a different claimed reporting window: %s", (text) => {
    const facts = [fact("member_count", 500, "2025-06-30"), fact("member_count", 550, "2026-06-30")];
    expect(check(text, { ...data, facts }).join(" ")).toContain("same-period member-count series");
  });

  it.each([
    "It had paid $255.8 million in share dividends year to date.",
    "Share dividends paid, year to date: $255.8 million.",
    "NCUA says dividends were not paid.",
  ])("does not turn dividend expense into cash payments: %s", (text) => expect(check(text).join(" ")).toContain("not cash paid"));

  it.each([
    "NCUA reports $255.8 million in dividend expense, not cash paid.",
    "The reported dividend expense does not establish cash paid to members.",
    "We cannot infer how much was paid in share dividends.",
    "The filings do not tell us how much was paid in share dividends.",
    "Dividends on shares were a YTD expense of $255.8 million.",
    "NCUA reports $255.8 million in dividends-on-shares expense, not cash paid.",
    "Dividends on shares were an expense of $255.8 million, not cash paid.",
  ])("allows expense labels and cash-payment caveats: %s", (text) => expect(check(text)).toEqual([]));

  it.each([
    "NCUA reports $255.8 million in dividends-on-shares expense, not cash paid.",
    "Dividends on shares were an expense of $255.8 million, not cash paid.",
  ])("the written-answer gate permits scoped dividends-on-shares expense caveats: %s", (text) => {
    const dividends = query("acct_380", [128800000, 255800000]);
    expect(writtenAnswerCheck(text, [dividends.output], undefined, { institutionId: 8322, toolResults: [dividends] }).passed).toBe(true);
  });

  it.each([
    "Alliant earns no per-item overdraft revenue.",
    "Overdraft revenue was zero.",
    "Overdraft revenue was $0.",
    "$0 overdraft income was earned.",
    "It earns no overdraft income on its published schedule.",
    "Its fee income comes from other charges.",
    "No members paid overdraft fees.",
    "300 members paid overdraft fees.",
    "Overdraft payer count was zero.",
    "Overdraft fees generated no revenue.",
    "Alliant received no revenue from overdrafts.",
    "No revenue was received from overdrafts.",
    "Nobody paid overdraft fees.",
    "No one paid overdraft fees.",
    "None of its members paid overdraft fees.",
    "Not a single member paid overdraft fees.",
  ])("preserves missing overdraft income and payers: %s", (text) => expect(check(text)).not.toEqual([]));

  it.each([
    "We cannot infer zero overdraft revenue from a current price.",
    "No overdraft revenue is reported in the supplied data.",
    "Overdraft income is not known; payer counts are unavailable.",
    "Its current schedule lists a $0 overdraft price.",
    "The data cannot determine how many members paid overdraft fees.",
    "We cannot infer that overdraft fees generated no revenue.",
    "It is unknown whether Alliant received no revenue from overdrafts.",
    "Nobody paid overdraft fees is not established by this filing.",
    "We cannot establish that no one paid overdraft fees.",
    "No revenue from overdrafts is available in the supplied data.",
  ])("allows honest refusals and current prices: %s", (text) => expect(check(text)).toEqual([]));

  it.each([
    "Overdraft fees generated no revenue.",
    "Alliant received no revenue from overdrafts.",
    "Nobody paid overdraft fees.",
  ])("the written-answer hold catches reordered zero inferences from broad fee income: %s", (text) => {
    const broadFeeIncome = query("acct_131");
    const result = writtenAnswerCheck(text, [broadFeeIncome.output], undefined,
      { institutionId: 8322, toolResults: [broadFeeIncome] });
    expect(result.passed).toBe(false);
    expect(result.problems.join(" ")).toMatch(/realized overdraft revenue|overdraft payer counts/);
  });

  it("the written-answer gate still permits scoped missing-data statements and current fee prices", () => {
    const broadFeeIncome = query("acct_131");
    const result = writtenAnswerCheck("Its current schedule lists a $0 overdraft price. We cannot infer that overdraft fees generated no revenue or that nobody paid overdraft fees.",
      [{ fee: 0 }, broadFeeIncome.output], undefined, { institutionId: 8322, toolResults: [broadFeeIncome,
        { toolName: "searchFees", input: { category: "overdraft" }, output: { fee: 0 } }] });
    expect(result.passed).toBe(true);
  });

  it("does not let an initial refusal excuse a later assertion", () => {
    expect(check("We cannot infer zero overdraft revenue, but Alliant earns no per-item overdraft revenue.").join(" ")).toContain("realized overdraft revenue");
    expect(check("Dividends are an expense, not cash paid. It paid $255.8 million in share dividends.").join(" ")).toContain("not cash paid");
    expect(check("We cannot establish customer growth. Its customer base is growing.").join(" ")).toContain("member-count series");
    expect(check("Member growth cannot be determined and its customer base is growing.").join(" ")).toContain("member-count series");
    expect(check("The data cannot establish causality, but the market caused fee income growth.").join(" ")).toContain("pricing or market cause");
    expect(check("Dividends on shares were an expense of $255.8 million, not cash paid, and Alliant paid $255.8 million in share dividends.").join(" ")).toContain("not cash paid");
  });

  it("permits a dedicated zero-income line only for its explicit institution, period and dollar unit", () => {
    const facts = [fact("overdraft_revenue", 0, "2026-06-30", { unit: "USD" })];
    expect(check("Alliant reported zero overdraft revenue for June 2026.", { ...data, facts })).toEqual([]);
    expect(check("Alliant reported zero overdraft revenue for June 2025.", { ...data, facts })).not.toEqual([]);
    expect(check("Alliant reported zero overdraft revenue for June 1, 2026.", { ...data, facts })).not.toEqual([]);
    expect(check("Alliant reported zero overdraft revenue for 2026-06-01.", { ...data, facts })).not.toEqual([]);
    expect(check("Alliant reported zero overdraft revenue for June 2026.", { ...data, facts, selected_institution_id: 4382 })).not.toEqual([]);
    expect(check("Alliant reported zero overdraft revenue for June 2026.", { ...data, facts: [fact("overdraft_revenue", 0, "2026-06-30")] })).not.toEqual([]);
    const wrongSubject = { ...facts[0], institution_id: 4382, context_role: "peer" };
    expect(check("Alliant reported zero overdraft revenue for June 2026.", { ...data, facts: [wrongSubject] })).not.toEqual([]);
  });

  it("does not confuse a genuine payer count with a different number or period", () => {
    const facts = [fact("overdraft_payer_count", 300, "2026-06-30")];
    expect(check("300 members paid overdraft fees through June 2026.", { ...data, facts })).toEqual([]);
    expect(check("301 members paid overdraft fees through June 2026.", { ...data, facts })).not.toEqual([]);
    expect(check("300 members paid overdraft fees through June 2025.", { ...data, facts })).not.toEqual([]);
    expect(check("Nobody paid overdraft fees through June 2026.", { ...data, facts: [fact("overdraft_payer_count", 0, "2026-06-30")] })).toEqual([]);
  });

  it.each([
    "The peer median grew 14.2%.",
    "Its growth matched the pace of the group.",
    "PenFed grows at the pace of its peers.",
    "PenFed is not pulling further ahead of peers.",
    "Growth matching peers suggests the market, not PenFed's own pricing, is driving the gain.",
    "Lower dividend costs help margin more than any change to the fee schedule.",
    "Alliant earns its revenue through rates, not fees.",
    "Zero overdraft fees remove the largest fee line most peers earn.",
    "The zero-fee stance is what keeps fee income near the bottom of peers.",
  ])("blocks unsupported cohort trends, causes and counterfactuals: %s", (text) => expect(check(text)).not.toEqual([]));

  it.each(["peer_set", "state", "national"])("the written-answer gate holds peer growth from a single %s cross-section", (scope) => {
    const current = query("acct_131", [21839203], scope);
    current.output.rows[0].period = "2026-06-30";
    const result = writtenAnswerCheck("The peer median grew, so PenFed is keeping pace with peers.", [current.output], undefined,
      { institutionId: 8322, toolResults: [current] });
    expect(result.passed).toBe(false);
    expect(result.problems.join(" ")).toContain("cross-sections, not comparable-cohort growth");
    expect(writtenAnswerCheck("The current peer median describes this quarter's filers; peer growth is unavailable.", [current.output], undefined,
      { institutionId: 8322, toolResults: [current] }).passed).toBe(true);
  });

  it.each(["state", "national"])("two dated %s roll-ups still provide no verified common cohort", (scope) => {
    const observations = query("acct_131", [19, 22], scope);
    expect(check(`The ${scope} median grew.`, { toolResults: [observations] }).join(" ")).toContain("comparable-cohort growth");
  });

  it.each([
    "The June 2026 peer median was $21.84 million across 23 filers.",
    "The peer median was $19.12 million in June 2025 and $21.84 million in June 2026; these are separate cross-sections.",
    "Peer growth cannot be determined without a common comparable cohort.",
    "The data does not establish that market pricing drove the gain.",
    "How do peer medians change with a consistent cohort?",
    "What explains the change in dividend costs?",
  ])("allows dated comparisons, limitations and genuine research questions: %s", (text) => expect(check(text)).toEqual([]));

  it("does not take catalog captions or peer population counts as observed member growth", () => {
    const facts = [fact("member_count", 23, "2025-06-30", { institution_id: undefined }), fact("member_count", 24, "2026-06-30", { institution_id: undefined })];
    expect(check("Customer growth was strong.", { ...data, facts })).not.toEqual([]);
    expect(check("Its customer base is growing.", { call_measures: [{ measure: "call:acct_452", publisher: "NCUA" }] })).not.toEqual([]);
    expect(check("It paid $10 million in share dividends.", { call_measures: [{ measure: "call:acct_380", publisher: "NCUA" }] })).not.toEqual([]);
    expect(check("Member growth is unavailable.", { call_measures: [{ measure: "call:acct_452", publisher: "NCUA" }] })).toEqual([]);
  });

  it("reads structured shortened tool outputs, bounds traversal and ignores prose-as-evidence", () => {
    const wrapped = { toolResults: data.toolResults.map((t) => ({ ...t, output: { _shortened: true, text: JSON.stringify(t.output) } })) };
    expect(check("Its customer base is growing.", wrapped)).not.toEqual([]);
    const cyclic: { own?: unknown; data: unknown } = { data }; cyclic.own = cyclic;
    expect(check("Its customer base is growing.", cyclic)).not.toEqual([]);
    expect(check("Its customer base is growing.", { text: "NCUA says acct_452 means membership" })).toEqual([]);
    expect(check("The reported figure is dated June 2026.", { publisher: "NCUA", tooMuch: Array.from({ length: 5001 }, () => 0) }).join(" ")).toContain("could not inspect");
  });

  it("leaves unrelated sourced fee answers to the existing checks", () => {
    expect(check("Its customer base is growing. The peer median grew 14.2%.", { publisher: "FDIC", values: [1, 2] })).toEqual([]);
  });
});
