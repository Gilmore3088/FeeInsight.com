import { describe, expect, it } from "vitest";
import { buildCallCohortHistory } from "@/lib/data-catalog/call-cohort-history";
import { compactToolResult } from "@/lib/research/tool-output";
import { financialMeasureDefinition, financialPeerComparison } from "@/lib/data-store/financial-peer-contract";
import { feeIncomeAgainstPeers } from "@/lib/research/fee-income-peers";
import { callPeerHistoryEvidence } from "./call-peer-history-evidence";
import { writtenAnswerCheck } from "./answer-save";
import { writtenAnswerEvidence, type AnswerToolEvidence } from "./written-answer-evidence";

function read(source: "ncua" | "ffiec" = "ncua", lists = [[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]]): AnswerToolEvidence {
  const measure = source === "ncua" ? "call:acct_131" : "call:service_charges_deposits_ytd";
  const rows = ["2026-06-30", "2025-06-30"].map((period, index) => ({
    period, median: index ? 200_000 : 300_000, p25: 100_000, p75: 400_000,
    unit: "USD", period_basis: "ytd", sources: source, institution_count: lists[index].length,
    reported_count: lists[index].length, subject_included: true,
  }));
  const history = buildCallCohortHistory({ requestedIds: [...new Set(lists.flat())], subjectId: 1,
    periods: rows.map((row, index) => ({ ...row, sources: [source], reporting_institution_ids: lists[index], reporter_ids_complete: true })) });
  return { toolName: "queryData", input: { measure, scope: { kind: "peer_set", id: "1", peer: { charter_type: source === "ncua" ? "credit_union" : "bank" } } },
    output: { ok: true, measure, scope: "peer_set", unit: "USD", rows,
      ...(source === "ncua" ? { measure_metadata: { source: "ncua-extras", item_code: "ACCT_131", unit: "USD", period_basis: "ytd", publisher: "NCUA" } } : {}),
      peer_comparison: { cohort_history: history }, citation: { publisher: source === "ncua" ? "NCUA" : "FFIEC", as_of: "2026-06-30" } } };
}
interface MutableHistory {
  periods: Array<{ reporting_institution_ids: number[]; reporter_ids_complete: boolean; reported_count: number }>;
  periods_complete: boolean; growth_status: string; merger_adjusted: boolean;
}
interface MutableOutput extends Record<string, unknown> {
  rows: Array<Record<string, unknown>>; measure: string;
  measure_metadata: { item_code: string };
  peer_comparison: { cohort_history?: MutableHistory };
  identity: { id: number }; peer_ranking: { field_units?: Record<string, string> };
}
const output = (value: AnswerToolEvidence) => value.output as MutableOutput;
const check = (text: string, reads: AnswerToolEvidence[]) => writtenAnswerCheck(text, reads.map((value) => value.output), "Compare the institution and peers over time", { institutionId: 1, toolResults: reads });

describe("observed historical call-report peer evidence (#2333)", () => {
  it.each(["ncua", "ffiec"] as const)("preserves useful %s dated cross-sections and exact reporter equality without authorizing growth", (source) => {
    const observed = read(source);
    expect(callPeerHistoryEvidence([observed])).toMatchObject({ observed: true, invalid: false, matching_reporter_ids: true });
    const label = source === "ncua" ? "NCUA broad fee income" : "FDIC deposit-account service charges";
    expect(check(`The June 2026 peer median ${label} was $300,000 year-to-date. The June 2025 peer median was $200,000 year-to-date.`, [observed]).passed).toBe(true);
    expect(check("The reporting population is unchanged. Identical charter IDs do not establish merger-adjusted growth.", [observed]).passed).toBe(true);
    expect(check("The same charter IDs reported in both periods.", [observed]).passed).toBe(false);
    expect(check("Identical charter IDs do not establish an unchanged economic perimeter.", [observed]).passed).toBe(true);
    for (const text of [
      "The peers grew faster than the institution.", "The same-charter cohort grew faster than the institution.",
      "The benchmark increased over the year.", "The fee-income median rose over the year.",
      "Matching charter IDs proves merger-adjusted growth.", "The cohort has an unchanged economic perimeter.",
      "The market drove the peer income increase.", "Pricing caused the income increase.",
      "Peer growth is unknown, but the benchmark grew.",
      "The market cause is unknown and pricing caused the income increase.",
    ]) expect(check(text, [observed]).passed, text).toBe(false);
    expect(check("These are separate dated cross-sections. Peer growth cannot be established without membership and merger treatment.", [observed]).passed).toBe(true);
    for (const caveat of ["This is not constant-cohort or merger-adjusted growth.", "A merger-adjusted comparison is unavailable.",
      "A constant-cohort, merger-adjusted growth comparison cannot be established from these cross-sections."]) {
      expect(check(caveat, [observed]).passed, caveat).toBe(true);
      expect(check(`${caveat} But the benchmark grew.`, [observed]).passed, caveat).toBe(false);
    }
  });

  it.each(["ncua", "ffiec"] as const)("does not infer %s population stability from counts or incomplete IDs", (source) => {
    const observed = read(source, [[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 7]]);
    expect(callPeerHistoryEvidence([observed]).matching_reporter_ids).toBe(false);
    expect(check("The reporting population is unchanged.", [observed]).passed).toBe(false);
    expect(check("Population stability cannot be established from equal counts.", [observed]).passed).toBe(true);
    for (const mutate of [
      (history: MutableHistory) => { history.periods[0].reporting_institution_ids = [1, 2]; },
      (history: MutableHistory) => { history.periods[0].reporter_ids_complete = false; },
      (history: MutableHistory) => { history.periods[0].reported_count = 999; },
      (history: MutableHistory) => { history.periods_complete = false; },
      (history: MutableHistory) => { history.growth_status = "established"; history.merger_adjusted = true; },
    ]) {
      const exact = read(source); mutate(output(exact).peer_comparison.cohort_history!);
      expect(callPeerHistoryEvidence([exact]).matching_reporter_ids).toBe(false);
      expect(check("The reporting population is unchanged.", [exact]).passed).toBe(false);
    }
  });

  it("binds YTD peer figures to source, metric and date even when the question is broad", () => {
    const observed = read();
    for (const text of [
      "The peer median standalone Q2 2026 broad fee income was $300,000.",
      "The peer median year-to-date bank deposit-account service charges for June 2026 was $300,000.",
      "FDIC reports the June 2026 peer median as $300,000.",
      "The June 2025 peer median year-to-date fee income was $300,000.",
      "The June 2026 peer median year-to-date fee income was $100,000.",
    ]) {
      const result = check(text, [observed]);
      expect(result.figureCheck.unmatched).toEqual([]);
      expect(result.passed, text).toBe(false);
      expect(result.problems.join(" ")).toContain("observed measure, regulator");
    }
    const dividends = read();
    (dividends.input as { measure: string }).measure = "call:acct_380"; output(dividends).measure = "call:acct_380";
    output(dividends).measure_metadata.item_code = "ACCT_380";
    expect(check("The June 2026 peer median fee income was $300,000 year-to-date.", [dividends]).passed).toBe(false);
    const bank = read("ffiec");
    (bank.input as { measure: string }).measure = "call:net_interest_income_ytd"; output(bank).measure = "call:net_interest_income_ytd";
    expect(check("The June 2026 peer median bank deposit-account service charges was $300,000 year-to-date.", [bank]).passed).toBe(false);
  });

  it.each(["ncua", "ffiec"] as const)("keeps independently validated %s quarterly medians alongside raw YTD reads", (source) => {
    const raw = read(source); const canonicalSource = source === "ncua" ? "ncua" : "fdic";
    const charter = source === "ncua" ? "credit_union" : "bank";
    const comparison = financialPeerComparison({ source: canonicalSource, reportDate: "2026-06-30", tier: "regional", minimumAssetsUsd: 10e9,
      maximumAssetsUsd: 250e9, subjectIncluded: true, eligibleCount: 6, reportedCount: 6, ratioReportedCount: 6, minimumMedianCount: 5 });
    const profile: AnswerToolEvidence = { toolName: "getInstitution", input: { id: 1 }, output: {
      identity: { id: 1, charter_type: charter }, peer_ranking: { comparison, peer_median_sc: 125 },
    } };
    const label = source === "ncua" ? "NCUA broad fee income" : "FDIC deposit-account service charges";
    const answer = `The standalone Q2 2026 peer median ${label} was $125,000.`;
    expect(check(answer, [raw, profile]).passed).toBe(true);
    const wrongSubject = structuredClone(profile); (wrongSubject.input as { id: number }).id = 2; output(wrongSubject).identity.id = 2;
    expect(check(answer, [raw, wrongSubject]).passed).toBe(false);
    output(profile).peer_ranking.field_units = { peer_median_sc: "USD" };
    expect(check(answer, [raw, profile]).passed).toBe(false);

    // The subject and ten filed peers at $200k..$1,100k: a peer median of $650,000.
    const rows = Array.from({ length: 11 }, (_, index) => ({ institution_id: index + 1, institution_name: `Synthetic ${index}`,
      charter_type: charter, financial_source: canonicalSource, state_code: "VA", asset_size_tier: "regional", fed_district: 5,
      report_date: "2026-06-30", total_assets: 20_000_000, service_charge_income: (index + 1) * 100, fee_income_ratio: (index + 1) * .05 }));
    const filed: AnswerToolEvidence = { toolName: "queryFeeRevenueCorrelation", input: { view: "peers", institution_id: 1, charter_type: charter },
      output: feeIncomeAgainstPeers(rows, 1, { charterType: charter }) };
    const filedAnswer = `The standalone Q2 2026 peer median ${label} was $650,000.`;
    expect(check(filedAnswer, [raw]).passed).toBe(false);
    expect(check(filedAnswer, [raw, filed]).passed).toBe(true);
  });

  it("keeps point-in-time quarter-end assets distinct from income flows", () => {
    const assets = read("ffiec");
    (assets.input as { measure: string }).measure = "call:total_assets"; output(assets).measure = "call:total_assets";
    for (const row of output(assets).rows) row.period_basis = "point_in_time";
    expect(check("The Q2 2026 peer median total assets was $300,000.", [assets]).passed).toBe(true);
    expect(check("The Q2 2026 peer median total assets was $300,000 year-to-date.", [assets]).passed).toBe(false);
  });

  it.each(["fdic", "ncua"] as const)("recognizes observed %s national financial history without licensing growth", (source) => {
    const history = buildCallCohortHistory({ requestedIds: null, periods: ["2026-06-30", "2025-06-30"].map((period) => ({
      period, unit: "thousands of dollars", period_basis: "standalone_quarter", sources: [source], institution_count: 6,
      reporting_institution_ids: [1, 2, 3, 4, 5, 6], reporter_ids_complete: true,
    })) });
    const group = { source, financial_source: source, charter_type: source === "fdic" ? "bank" : "credit_union",
      fee_income_definition: financialMeasureDefinition(source), units: "dollar amounts in thousands; historical groups are dated cross-sections",
      trend: { quarters: [{ quarter: "2026-Q2", total_service_charges: 300,
        total_institutions: 6, yoy_change_pct: null }], cohort_history: history } };
    const observed: AnswerToolEvidence = { toolName: "queryNationalData", input: { source: "call_reports", view: "trend", financial_source: source },
      output: { financial_groups: [group] } };
    expect(callPeerHistoryEvidence([observed])).toMatchObject({ observed: true, catalog_observed: false, invalid: false });
    expect(check("The bank benchmark grew over the year.", [observed]).passed).toBe(false);
    expect(check("The current filing cross-section total was $300,000. Comparable-cohort growth cannot be established.", [observed])).toMatchObject({ passed: true, problems: [], figureCheck: { unmatched: [] } });
    const raw = read(source === "ncua" ? "ncua" : "ffiec");
    const label = source === "ncua" ? "broad fee income" : "deposit-account service charges";
    expect(check(`The Q2 2026 cohort total ${label} was $300,000.`, [observed]).passed).toBe(true);
    expect(check(`The Q2 2026 peer median ${label} was $300,000.`, [observed]).passed).toBe(false);
    const wrongSource = source === "ncua" ? "FDIC bank deposit-account service charges" : "NCUA broad fee income";
    expect(check(`The Q2 2026 cohort total ${wrongSource} was $300,000.`, [observed]).passed).toBe(false);
    expect(check(`The Q3 2026 cohort total ${label} was $300,000.`, [observed]).passed).toBe(false);
    expect(check(`The Q2 2026 cohort total ${label} was $300,000 year-to-date.`, [observed]).passed).toBe(false);
    expect(check(`The Q2 2026 cohort total ${label} was $300,000.`, [raw, observed]).passed).toBe(true);
    expect(check(`The Q2 2026 peer median ${label} was $300,000.`, [raw, observed]).passed).toBe(false);
    expect(check("The posted fee-price median increased.", [observed]).passed).toBe(true);
    expect(callPeerHistoryEvidence([{ ...observed, toolName: "otherTool" }]).observed).toBe(false);
    for (const level of ["group", "trend", "quarter"]) {
      const conflict = structuredClone(observed);
      const conflictGroup = (conflict.output as { financial_groups: Array<Record<string, unknown>> }).financial_groups[0];
      const conflictTrend = conflictGroup.trend as { quarters: Array<Record<string, unknown>> } & Record<string, unknown>;
      const container = level === "group" ? conflictGroup : level === "trend" ? conflictTrend : conflictTrend.quarters[0];
      container.field_units = { total_service_charges: "percent" };
      expect(callPeerHistoryEvidence([conflict]).invalid).toBe(true);
      expect(check(`The Q2 2026 cohort total ${label} was $300,000.`, [raw, conflict]).passed).toBe(false);
    }
  });

  it.each([
    ["unit", "count"], ["period_basis", "point_in_time"], ["sources", "ffiec"],
  ])("refuses contradictory observed %s metadata", (key, value) => {
    const observed = read(); output(observed).rows[0][key] = value;
    expect(callPeerHistoryEvidence([observed]).invalid).toBe(true);
    expect(check("The peer median is $300,000.", [observed]).passed).toBe(false);
  });

  it("does not let field-unit overrides become untyped money evidence", () => {
    for (const path of ["row", "output"]) {
      const observed = read();
      const container = path === "row" ? output(observed).rows[0] : output(observed);
      container.field_units = { median: "percent" };
      expect(callPeerHistoryEvidence([observed]).invalid).toBe(true);
      expect(check("The peer median was $300,000 year-to-date.", [observed]).passed).toBe(false);
    }
  });

  it("does not promote embedded/model lookalikes or repeated single dates into historical proof", () => {
    const observed = read(); delete output(observed).peer_comparison.cohort_history;
    output(observed).validated_call_peer_history = { observed: true, matching_reporter_ids: true, observations: [] };
    expect(writtenAnswerEvidence([], { toolResults: [observed] })).toMatchObject({ validated_call_peer_history: { matching_reporter_ids: false } });
    expect(check("The reporting population is unchanged.", [observed]).passed).toBe(false);
    expect(callPeerHistoryEvidence([{ ...observed, toolName: "otherTool" }]).observed).toBe(false);
    const single = read(); output(single).rows = [output(single).rows[0]];
    expect(callPeerHistoryEvidence([single, single]).matching_reporter_ids).toBe(false);
  });

  it("keeps a retained dated cross-section through compaction but never treats truncated lists as stability proof", () => {
    const ids = Array.from({ length: 300 }, (_, index) => index + 1);
    const observed = read("ncua", [ids, ids]);
    observed.output = compactToolResult(observed.output, 3500);
    expect(output(observed)._shortened).toBeTruthy();
    expect(callPeerHistoryEvidence([observed]).matching_reporter_ids).toBe(false);
    expect(check("The June 2026 peer median broad fee income was $300,000 year-to-date.", [observed]).passed).toBe(true);
    expect(check("The reporting population is unchanged.", [observed]).passed).toBe(false);
  });
});
