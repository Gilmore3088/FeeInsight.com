import { describe, expect, it } from "vitest";
import type { FiledFeeIncome } from "@/lib/data-store/fee-revenue";
import { feeIncomeAgainstPeers, MIN_PEERS_FOR_MEDIAN } from "@/lib/research/fee-income-peers";
import { compactToolResult } from "@/lib/research/tool-output";
import { filedPeerIncomeEvidence, filedPeerIncomeEvidenceResult } from "./filed-peer-evidence";
import { writtenAnswerCheck } from "./answer-save";
import { writtenAnswerEvidence } from "./written-answer-evidence";

// Peers 1..10 file $100k..$1,000k a quarter: a median of $550,000.
function peerRead(count = MIN_PEERS_FOR_MEDIAN, source: "fdic" | "ncua" = "ncua") {
  const rows: FiledFeeIncome[] = Array.from({ length: count + 1 }, (_, index) => ({
    institution_id: index + 1, institution_name: `Synthetic ${index + 1}`,
    charter_type: source === "ncua" ? "credit_union" : "bank", financial_source: source,
    report_date: "2026-06-30", state_code: "VA", asset_size_tier: "regional", fed_district: 5,
    total_assets: 20_000_000, service_charge_income: index === 0 ? 30_032 : index * 100,
    fee_income_ratio: index === 0 ? 15.02 : index * 0.05,
  }));
  return {
    toolName: "queryFeeRevenueCorrelation",
    input: { view: "peers", institution_id: 1, charter_type: rows[0].charter_type, states: ["va"] },
    output: feeIncomeAgainstPeers(rows, 1, { charterType: rows[0].charter_type, states: ["VA"] }),
  };
}

type PeerRead = ReturnType<typeof peerRead>;
function replace(read: PeerRead, path: string, value: unknown): void {
  const keys = path.split(".");
  let current = read as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) current = current[key] as Record<string, unknown>;
  current[keys.at(-1)!] = value;
}

const question = "How does the selected credit union's fee income compare with peers for Q2 2026?";
const answer = "Q2 2026 broad fee income was $30.032 million, versus a peer median of $550,000.";
function check(read: PeerRead, text = answer, institutionId = 1) {
  return writtenAnswerCheck(text, [read.output], question, { institutionId, toolResults: [read] });
}

describe("server-observed filed financial peer evidence (#2332)", () => {
  it.each(["ncua", "fdic"] as const)("registers %s subject and median observations from the selected canonical tool read", (source) => {
    const read = peerRead(MIN_PEERS_FOR_MEDIAN, source);
    expect(filedPeerIncomeEvidence([read], 1)).toEqual([{
      institution_id: 1, source, report_date: "2026-06-30", subject_income_usd: 30_032_000,
      peer_median_income_usd: 550_000, peer_count: 10, minimum_median_count: MIN_PEERS_FOR_MEDIAN,
    }]);
  });

  it("passes the complete quarter gate with the real peer result, preserving source and role", () => {
    const read = peerRead();
    expect(check(read)).toMatchObject({ passed: true, problems: [], figureCheck: { unmatched: [] } });
    expect(check(read, "Q2 2026 broad fee income was $550,000, versus a peer median of $30.032 million.").passed).toBe(false);
    expect(check(read, "Q2 2026 broad fee income was $57.262 million.").passed).toBe(false);
    expect(check(read, "Q3 2026 broad fee income was $30.032 million.").passed).toBe(false);
    expect(check(read, answer, 999).passed).toBe(false);
  });

  it("does not promote arbitrary output-shaped objects or self-asserted observations into quarter evidence", () => {
    const read = peerRead();
    expect(writtenAnswerEvidence([read.output])).toMatchObject({ validated_filed_peer_income: [] });
    expect(writtenAnswerCheck(answer, [read.output], question, { institutionId: 1 }).passed).toBe(false);
    expect(writtenAnswerCheck(answer, [{ validated_filed_peer_income: filedPeerIncomeEvidence([read], 1) }], question, { institutionId: 1 }).passed).toBe(false);
  });

  it("supports a named institution without workspace selection only when observed peer-tool identity is unambiguous", () => {
    const read = peerRead();
    expect(filedPeerIncomeEvidence([read], null)).toEqual(filedPeerIncomeEvidence([read], 1));
    expect(writtenAnswerCheck(answer, [read.output], question, { toolResults: [read] }).passed).toBe(true);
    const another = structuredClone(read);
    replace(another, "input.institution_id", 2);
    replace(another, "output.subject.institution_id", 2);
    expect(filedPeerIncomeEvidence([read, another], null)).toEqual([]);
    expect(writtenAnswerCheck(answer, [read.output, another.output], question, { toolResults: [read, another] }).passed).toBe(false);
  });

  it.each([
    ["toolName", "queryData"], ["input.view", "institutions"], ["input.institution_id", 2],
    ["input.financial_source", "fdic"], ["input.charter_type", "bank"], ["input.states", ["TX"]],
    ["output.subject.institution_id", 2], ["output.subject.charter_type", "bank"],
    ["output.source", "fdic"], ["output.subject.source", "fdic"], ["output.subject.financial_source", "fdic"],
    ["output.comparison.source", "fdic"], ["output.comparison.financial_source", "fdic"], ["output.comparison.charter_type", "bank"],
    ["output.comparison.measure", "deposit_service_charge_income"], ["output.comparison.source_period_basis", "standalone_quarter"],
    ["output.comparison.period_basis", "year_to_date"], ["output.subject.period_basis", "year_to_date"],
    ["output.comparison.report_date", "2026-06-29"], ["output.quarter", "2026-03-31"], ["output.subject.report_date", "2026-03-31"],
    ["output.units", "USD"], ["output.subject.units", "USD"], ["output.subject.unit", "USD"],
    ["output.comparison.unit", "USD"], ["output.comparison.income_unit", "USD"],
    ["output.comparison.ratio_unit", "percent"], ["output.subject.field_units.income_per_10k_assets", "percent"],
    ["output.subject.field_units.service_charge_income", "USD"],
    ["output.comparison.population_basis", "fee_price_income_correlation"], ["output.comparison.fee_schedule_coverage_required", true],
    ["output.comparison.subject_included", true], ["output.comparison.sample_size", 11],
    ["output.peer_count", 9], ["output.comparison.minimum_median_count", 1],
    ["output.comparison.minimum_median_count", MIN_PEERS_FOR_MEDIAN - 1],
    ["output.subject.service_charge_income", Infinity],
    ["output.peers.0.institution_id", 1], ["output.peers.0.source", "fdic"], ["output.peers.0.report_date", "2026-03-31"],
    ["output.peers.0.units", "USD"], ["output.peers.0.total_assets", null], ["output.peers.0.income_per_10k_assets", null],
  ])("keeps contradictory or unbound %s held", (path, value) => {
    const read = peerRead();
    replace(read, path as string, value);
    expect(filedPeerIncomeEvidence([read], 1)).toEqual([]);
    expect(check(read).passed).toBe(false);
  });

  it("allows a thin group's subject quarter but never registers or fabricates a median", () => {
    const read = peerRead(MIN_PEERS_FOR_MEDIAN - 1);
    expect(filedPeerIncomeEvidence([read], 1)).toEqual([expect.objectContaining({
      subject_income_usd: 30_032_000, peer_median_income_usd: null, peer_count: 9,
    })]);
    expect(check(read, "Q2 2026 broad fee income was $30.032 million. The Q2 peer median cannot be computed from fewer than ten comparable peers.").passed).toBe(true);
    expect(check(read, "Q2 2026 broad fee income was $30.032 million, versus a peer median of $250,000.").passed).toBe(false);
    replace(read, "output.peer_median_service_charge_income", 250);
    expect(filedPeerIncomeEvidence([read], 1)).toEqual([]);
  });

  it("preserves aggregate evidence through tool-list compaction and suppresses conflicting repeat reads", () => {
    const read = peerRead(30);
    read.output = compactToolResult(read.output, 6000) as typeof read.output;
    expect(filedPeerIncomeEvidence([read], 1)).toEqual([expect.objectContaining({ peer_count: 30, peer_median_income_usd: 1_550_000 })]);
    const first = peerRead();
    const conflicting = structuredClone(first);
    replace(conflicting, "output.subject.service_charge_income", 30_033);
    expect(filedPeerIncomeEvidence([first, conflicting], 1)).toEqual([]);
    replace(conflicting, "input.asset_tiers", ["regional"]);
    replace(conflicting, "output.comparison.filters.assetTiers", ["regional"]);
    expect(filedPeerIncomeEvidence([first, conflicting], 1)).toEqual([]);
    expect(filedPeerIncomeEvidence([peerRead(MIN_PEERS_FOR_MEDIAN, "ncua"), peerRead(MIN_PEERS_FOR_MEDIAN, "fdic")], 1)).toEqual([]);
  });

  it.each([
    ["state order", "states", "states", ["VA", "MD"], ["MD", "VA"]],
    ["state case and duplicates", "states", "states", ["VA", "MD"], ["md", "va", "VA"]],
    ["explicit institution order and duplicates", "peer_institution_ids", "institutionIds", [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 2]],
    ["asset tier order and duplicates", "asset_tiers", "assetTiers", ["regional", "large"], ["large", "regional", "regional"]],
    ["district order and duplicates", "fed_districts", "fedDistricts", [5, 9], [9, 5, 5]],
    ["absent versus empty institution filter", "peer_institution_ids", "institutionIds", undefined, []],
    ["absent versus empty asset tiers", "asset_tiers", "assetTiers", undefined, []],
    ["absent versus empty districts", "fed_districts", "fedDistricts", undefined, []],
    ["absent versus empty states", "states", "states", undefined, []],
  ])("uses one cohort for equivalent %s, holding either conflicting median", (_name, inputKey, outputKey, firstValues, secondValues) => {
    const first = peerRead();
    const second = peerRead();
    replace(first, `input.${inputKey}`, firstValues);
    replace(first, `output.comparison.filters.${outputKey}`, firstValues);
    replace(second, `input.${inputKey}`, secondValues);
    replace(second, `output.comparison.filters.${outputKey}`, secondValues);
    const originalFilters = structuredClone(second.output);
    expect(filedPeerIncomeEvidence([first, second], 1)).toEqual(filedPeerIncomeEvidence([first], 1));
    const context = { institutionId: 1, toolResults: [first, second] };
    expect(writtenAnswerCheck(answer, [first.output, second.output], question, context).passed).toBe(true);
    expect(second.output).toEqual(originalFilters); // Canonicalization does not rewrite tool evidence.

    replace(second, "output.peer_median_service_charge_income", 999);
    expect(filedPeerIncomeEvidence([first, second], 1)).toEqual([]);
    for (const median of ["$550,000", "$999,000"]) {
      const result = writtenAnswerCheck(`Q2 2026 broad fee income was $30.032 million, versus a peer median of ${median}.`, [first.output, second.output], question, context);
      expect(result.figureCheck.unmatched).toEqual([]);
      expect(result.passed).toBe(false);
      expect(result.problems).toContainEqual(expect.stringContaining("Conflicting filed financial peer reads"));
    }
  });

  it("ignores filter property insertion order without merging genuinely different cohorts", () => {
    const first = peerRead();
    const second = peerRead();
    replace(second, "output.comparison.filters", { states: ["VA"], charterType: "credit_union" });
    expect(filedPeerIncomeEvidence([first, second], 1)).toHaveLength(1);
    replace(second, "input.states", ["VA", "MD"]);
    replace(second, "output.comparison.filters.states", ["VA", "MD"]);
    replace(second, "output.peer_median_service_charge_income", 999);
    expect(filedPeerIncomeEvidence([first, second], 1)).toHaveLength(2);
  });

  it.each(["ncua", "fdic"] as const)("uses one effective %s cohort for omitted and explicit canonical charter", (source) => {
    const implicit = peerRead(MIN_PEERS_FOR_MEDIAN, source);
    const explicit = peerRead(MIN_PEERS_FOR_MEDIAN, source);
    replace(implicit, "input.charter_type", undefined);
    replace(implicit, "output.comparison.filters.charterType", undefined);
    expect(filedPeerIncomeEvidence([implicit, explicit], 1)).toEqual(filedPeerIncomeEvidence([explicit], 1));
    const context = { institutionId: 1, toolResults: [implicit, explicit] };
    const label = source === "ncua" ? "broad fee income" : "deposit service charge income";
    expect(writtenAnswerCheck(`Q2 2026 ${label} was $30.032 million, versus a peer median of $550,000.`, [implicit.output, explicit.output], question, context).passed).toBe(true);
    replace(explicit, "output.peer_median_service_charge_income", 999);
    expect(filedPeerIncomeEvidence([implicit, explicit], 1)).toEqual([]);
    for (const median of ["$550,000", "$999,000"]) {
      const result = writtenAnswerCheck(`Q2 2026 ${label} was $30.032 million, versus a peer median of ${median}.`, [implicit.output, explicit.output], question, context);
      expect(result.figureCheck.unmatched).toEqual([]);
      expect(result.passed).toBe(false);
      expect(result.problems).toContainEqual(expect.stringContaining("Conflicting filed financial peer reads"));
    }
    // Within each observed read, an omitted filter still cannot claim an explicit output filter.
    replace(implicit, "output.comparison.filters.charterType", source === "ncua" ? "credit_union" : "bank");
    expect(filedPeerIncomeEvidence([implicit], 1)).toEqual([]);
  });

  it.each(["ncua", "fdic"] as const)("holds either conflicting %s median before source-specific interpretation checks", (source) => {
    const first = peerRead(MIN_PEERS_FOR_MEDIAN, source);
    const second = peerRead(MIN_PEERS_FOR_MEDIAN, source);
    replace(first, "input.states", ["VA", "MD"]);
    replace(first, "output.comparison.filters.states", ["VA", "MD"]);
    replace(second, "input.states", ["md", "va", "VA"]);
    replace(second, "output.comparison.filters.states", ["MD", "VA"]);
    expect(filedPeerIncomeEvidenceResult([first, second], 1)).toEqual({
      observations: filedPeerIncomeEvidence([first], 1), conflicting: false,
    });
    replace(second, "output.peer_median_service_charge_income", 999);
    expect(filedPeerIncomeEvidenceResult([first, second], 1)).toEqual({ observations: [], conflicting: true });
    const context = { institutionId: 1, toolResults: [first, second] };
    expect(writtenAnswerEvidence([first.output, second.output], context)).toMatchObject({
      validated_filed_peer_income: [], filed_peer_income_conflict: true,
    });
    const label = source === "ncua" ? "broad fee income" : "deposit service charge income";
    for (const median of ["$550,000", "$999,000"]) {
      const result = writtenAnswerCheck(`Q2 2026 ${label} was $30.032 million, versus a peer median of ${median}.`, [first.output, second.output], question, context);
      expect(result.figureCheck.unmatched).toEqual([]);
      expect(result.passed).toBe(false);
      expect(result.problems).toContainEqual(expect.stringContaining("Conflicting filed financial peer reads"));
    }
  });

  it.each(["ncua", "fdic"] as const)("holds conflicting selected %s subject income even across distinct cohorts", (source) => {
    const first = peerRead(MIN_PEERS_FOR_MEDIAN, source);
    const second = peerRead(MIN_PEERS_FOR_MEDIAN, source);
    replace(second, "input.asset_tiers", ["regional"]);
    replace(second, "output.comparison.filters.assetTiers", ["regional"]);
    replace(second, "output.subject.service_charge_income", 30_033);
    expect(filedPeerIncomeEvidenceResult([first, second], 1)).toEqual({ observations: [], conflicting: true });
    for (const income of ["$30.032 million", "$30.033 million"]) {
      const result = writtenAnswerCheck(`Q2 2026 fee income was ${income}.`, [first.output, second.output], question, { institutionId: 1, toolResults: [first, second] });
      expect(result.figureCheck.unmatched).toEqual([]);
      expect(result.passed).toBe(false);
      expect(result.problems).toContainEqual(expect.stringContaining("Conflicting filed financial peer reads"));
    }
  });

  it("holds conflicting canonical sources for the selected subject without trusting embedded conflict verdicts", () => {
    const bank = peerRead(MIN_PEERS_FOR_MEDIAN, "fdic");
    const creditUnion = peerRead(MIN_PEERS_FOR_MEDIAN, "ncua");
    expect(filedPeerIncomeEvidenceResult([bank, creditUnion], 1)).toEqual({ observations: [], conflicting: true });
    const fake = { ...bank.output, filed_peer_income_conflict: true };
    expect(writtenAnswerEvidence([fake])).toMatchObject({ validated_filed_peer_income: [], filed_peer_income_conflict: false });
    const validRead = { ...bank, output: fake };
    expect(writtenAnswerCheck("Q2 2026 deposit service charge income was $30.032 million.", [fake], question, {
      institutionId: 1, toolResults: [validRead],
    }).passed).toBe(true);
    const reads = [bank, creditUnion].map((read) => ({ ...read, output: { ...read.output, filed_peer_income_conflict: false } }));
    const result = writtenAnswerCheck("The financial reads need a refresh.", reads.map((read) => read.output), question, { institutionId: 1, toolResults: reads });
    expect(result.passed).toBe(false);
    expect(result.problems).toContainEqual(expect.stringContaining("Conflicting filed financial peer reads"));
  });

  it.each(["ncua", "fdic"] as const)("retains legitimate distinct %s cohorts and their medians without a conflict verdict", (source) => {
    const first = peerRead(MIN_PEERS_FOR_MEDIAN, source);
    const second = peerRead(MIN_PEERS_FOR_MEDIAN, source);
    const charter = source === "ncua" ? "credit_union" : "bank";
    // Ten VA peers at $100k..$1,000k (median $550,000) and ten MD peers at $200k..$2,000k (median $1.1 million).
    const rows: FiledFeeIncome[] = Array.from({ length: 21 }, (_, index) => {
      const income = index === 0 ? 30_032 : index <= 10 ? index * 100 : (index - 10) * 200;
      return {
        institution_id: index + 1, institution_name: `Synthetic ${index + 1}`,
        charter_type: charter, financial_source: source, report_date: "2026-06-30",
        state_code: index <= 10 ? "VA" : "MD", asset_size_tier: "regional", fed_district: 5,
        total_assets: 20_000_000, service_charge_income: income, fee_income_ratio: income / 2000,
      };
    });
    first.output = feeIncomeAgainstPeers(rows, 1, { charterType: charter, states: ["VA"] });
    replace(second, "input.states", ["MD"]);
    second.output = feeIncomeAgainstPeers(rows, 1, { charterType: charter, states: ["MD"] });
    expect(filedPeerIncomeEvidenceResult([first, second], 1)).toMatchObject({ observations: expect.any(Array), conflicting: false });
    expect(filedPeerIncomeEvidence([first, second], 1)).toHaveLength(2);
    const label = source === "ncua" ? "broad fee income" : "deposit service charge income";
    for (const median of ["$550,000", "$1.1 million"]) {
      expect(writtenAnswerCheck(`Q2 2026 ${label} was $30.032 million, versus a peer median of ${median}.`, [first.output, second.output], question, {
        institutionId: 1, toolResults: [first, second],
      }).passed).toBe(true);
    }
  });
});
