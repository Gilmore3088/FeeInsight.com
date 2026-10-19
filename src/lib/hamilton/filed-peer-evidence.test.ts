import { describe, expect, it } from "vitest";
import type { FiledFeeIncome } from "@/lib/data-store/fee-revenue";
import { feeIncomeAgainstPeers } from "@/lib/research/fee-income-peers";
import { compactToolResult } from "@/lib/research/tool-output";
import { filedPeerIncomeEvidence } from "./filed-peer-evidence";
import { writtenAnswerCheck } from "./answer-save";
import { writtenAnswerEvidence } from "./written-answer-evidence";

function peerRead(count = 5, source: "fdic" | "ncua" = "ncua") {
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
const answer = "Q2 2026 broad fee income was $30.032 million, versus a peer median of $300,000.";
function check(read: PeerRead, text = answer, institutionId = 1) {
  return writtenAnswerCheck(text, [read.output], question, { institutionId, toolResults: [read] });
}

describe("server-observed filed financial peer evidence (#2332)", () => {
  it.each(["ncua", "fdic"] as const)("registers %s subject and median observations from the selected canonical tool read", (source) => {
    const read = peerRead(5, source);
    expect(filedPeerIncomeEvidence([read], 1)).toEqual([{
      institution_id: 1, source, report_date: "2026-06-30", subject_income_usd: 30_032_000,
      peer_median_income_usd: 300_000, peer_count: 5, minimum_median_count: 5,
    }]);
  });

  it("passes the complete quarter gate with the real peer result, preserving source and role", () => {
    const read = peerRead();
    expect(check(read)).toMatchObject({ passed: true, problems: [], figureCheck: { unmatched: [] } });
    expect(check(read, "Q2 2026 broad fee income was $300,000, versus a peer median of $30.032 million.").passed).toBe(false);
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
    ["output.comparison.subject_included", true], ["output.comparison.sample_size", 6],
    ["output.peer_count", 4], ["output.comparison.minimum_median_count", 1],
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
    const read = peerRead(4);
    expect(filedPeerIncomeEvidence([read], 1)).toEqual([expect.objectContaining({
      subject_income_usd: 30_032_000, peer_median_income_usd: null, peer_count: 4,
    })]);
    expect(check(read, "Q2 2026 broad fee income was $30.032 million. The Q2 peer median cannot be computed from fewer than five comparable peers.").passed).toBe(true);
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
    expect(filedPeerIncomeEvidence([peerRead(5, "ncua"), peerRead(5, "fdic")], 1)).toEqual([]);
  });
});
