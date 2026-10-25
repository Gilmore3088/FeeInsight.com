import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NCUA_CALL_MEASURES } from "@/lib/data-catalog/ncua-call-measures";
import type { FiledFeeIncome } from "@/lib/data-store/fee-revenue";
import { financialMeasureDefinition } from "@/lib/data-store/financial-peer-contract";
import { feeIncomeAgainstPeers } from "@/lib/research/fee-income-peers";
import { claimEvidenceFacts, filingFactId, SHORTENED_PEER_LIST_LIMITATION } from "./claim-evidence";
import { medianOf } from "./evidence-contract";
import { writtenAnswerEvidence, writtenAnswerEvidenceBuild, type AnswerToolEvidence } from "./written-answer-evidence";

// Synthetic institutions only: Bank A 9001 and Bank B 9002 (evidence-regression-set.ts), peers 9003-9011 (ten filed peers with Bank B, the Hamilton minimum).
const BANK_A = 9001;
const BANK_B = 9002;
const UNITS = "dollar amounts in thousands; fee_income_ratio is a fraction (0.068 = 6.8%)";

/** A credit union's getInstitution read: YTD filings in thousands and the profile's standalone quarters. */
function profileRead(id: number, ytd: Array<[string, number]>, quarters: Array<[string, number]>, rowId = id): AnswerToolEvidence {
  const records = ytd.map(([report_date, income]) => ({
    institution_id: rowId, report_date, source: "ncua", service_charge_income: income, total_assets: 400_000, total_deposits: 350_000,
    total_revenue: income * 10, fee_income_ratio: 0.1, field_units: { fee_income_ratio: "fraction" },
  }));
  return {
    toolName: "getInstitution",
    input: { id },
    output: {
      identity: { id, name: `Synthetic Credit Union ${id}`, charter_type: "credit_union" },
      fees: { verified: [], provisional: [] },
      financials: { units: UNITS, definition: { ...financialMeasureDefinition("ncua"), period_basis: "year_to_date" }, latest: records[0] ?? null, records },
      revenue_trend: quarters.map(([quarter, income]) => ({ quarter, service_charge_income: income, source: "ncua", units: "thousands of dollars",
        field_units: { fee_income_ratio: "fraction", yoy_change_pct: "percent" } })),
      revenue_trend_definition: { ...financialMeasureDefinition("ncua"), ratio_period_basis: "year_to_date" },
    },
  };
}

/** A queryData institution read of one curated NCUA call line. */
function callRead(id: number, key: string, values: Array<[string, number]>): AnswerToolEvidence {
  const metric = NCUA_CALL_MEASURES.find((measure) => measure.key === key)!;
  return {
    toolName: "queryData",
    input: { measure: `call:${key}`, scope: { kind: "institution", id: String(id) } },
    output: {
      ok: true, measure: `call:${key}`, scope: "institution", unit: metric.unit,
      measure_metadata: { item_code: metric.code, name: metric.name, source: "ncua-extras", publisher: "NCUA (5300 call report)", unit: metric.unit, period_basis: metric.periodBasis },
      citation: { publisher: "NCUA (5300 call report)", source_url: "https://ncua.gov/newest.zip", as_of: values[0]?.[0] ?? null },
      rows: values.map(([period, value]) => ({ institution_id: id, period, value, unit: metric.unit, period_basis: metric.periodBasis,
        item_code: metric.code, source: "ncua", source_url: `https://ncua.gov/filing-${period}.zip`, fetched_at: "2026-10-19T00:00:00Z" })),
    },
  };
}

/** queryFeeRevenueCorrelation peers for Bank A, its peers 9002-9011, built by the real tool code. */
function peerRead(): AnswerToolEvidence & { output: Record<string, unknown> } {
  const rows: FiledFeeIncome[] = Array.from({ length: 11 }, (_, index) => ({
    institution_id: BANK_A + index, institution_name: `Synthetic ${BANK_A + index}`, charter_type: "credit_union", financial_source: "ncua",
    report_date: "2026-06-30", state_code: "VA", asset_size_tier: "regional", fed_district: 5,
    total_assets: 400_000, service_charge_income: index === 0 ? 1_400 : index * 100, fee_income_ratio: index === 0 ? 35 : index * 2.5,
  }));
  return {
    toolName: "queryFeeRevenueCorrelation",
    input: { view: "peers", institution_id: BANK_A, charter_type: "credit_union", states: ["va"] },
    output: feeIncomeAgainstPeers(rows, BANK_A, { charterType: "credit_union", states: ["VA"] }) as Record<string, unknown>,
  };
}

const profileA = () => profileRead(BANK_A, [["2026-06-30", 2_600], ["2026-03-31", 1_200]], [["2026-Q2", 1_400]]);
const profileB = () => profileRead(BANK_B, [["2026-06-30", 900], ["2026-03-31", 500]], [["2026-Q2", 400]]);
const callA = () => callRead(BANK_A, "acct_131", [["2026-06-30", 2_600_123], ["2026-03-31", 1_200_456]]);
const fixtures = (): AnswerToolEvidence[] => [profileA(), profileB(), callA(), peerRead()];
const byId = (reads: readonly AnswerToolEvidence[], institutionId: number | null = BANK_A) =>
  new Map(claimEvidenceFacts(reads, institutionId).facts.map((fact) => [fact.id, fact]));
const ytdIncome = (id: number, date: string) => filingFactId("ncua", id, date, "service_charge_income", "ytd");
const quarterIncome = (id: number, date: string) => filingFactId("ncua", id, date, "service_charge_income", "standalone_quarter");

describe("claim fact IDs for filings and filed peers (#1077 step 1)", () => {
  it("gives the same IDs for the same reads, read twice or copied", () => {
    const first = claimEvidenceFacts(fixtures(), BANK_A);
    expect(claimEvidenceFacts(fixtures(), BANK_A)).toEqual(first);
    expect(claimEvidenceFacts(structuredClone(fixtures()), BANK_A)).toEqual(first);
    const ids = [...first.facts, ...first.derivations].map((fact) => fact.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      ytdIncome(BANK_A, "2026-06-30"), ytdIncome(BANK_A, "2026-03-31"),
      filingFactId("ncua", BANK_A, "2026-06-30", "total_assets", "point_in_time"),
      filingFactId("ncua", BANK_A, "2026-06-30", "call:acct_131", "ytd"),
      quarterIncome(BANK_A, "2026-06-30"),
      `ncua-profile:${BANK_A}:service_charge_income:2026-06-30:ytd_to_quarter`,
    ]));
  });

  it("keeps each filing on its own institution, period basis and source", () => {
    const facts = byId(fixtures());
    expect(facts.get(ytdIncome(BANK_A, "2026-06-30"))).toMatchObject({ value: 2_600_000, unit: "usd",
      scope: { institutionId: BANK_A, reportingDate: "2026-06-30", metric: "service_charge_income", periodBasis: "ytd" },
      source: { table: "institution_financial_records", evidenceClass: "filing", recordKey: ytdIncome(BANK_A, "2026-06-30"), asOf: "2026-06-30" } });
    // The peer view's standalone quarter never shares an ID with the profile's year-to-date row.
    expect(facts.get(quarterIncome(BANK_A, "2026-06-30"))?.value).toBe(1_400_000);
    expect(facts.get(filingFactId("ncua", BANK_A, "2026-06-30", "fee_income_ratio", "ytd"))).toMatchObject({ value: 0.1, unit: "ratio" });
    expect(facts.get(filingFactId("ncua", BANK_A, "2026-06-30", "call:acct_131", "ytd"))).toMatchObject({ value: 2_600_123,
      source: { table: "institution_call_report_items", urls: ["https://ncua.gov/filing-2026-06-30.zip"], retrievedAt: "2026-10-19T00:00:00Z" } });
    const quarter = claimEvidenceFacts(fixtures(), BANK_A).derivations.find((derived) => derived.derivation.kind === "ytd_to_quarter");
    expect(quarter).toMatchObject({ value: 1_400_000, scope: { institutionId: BANK_A, periodBasis: "standalone_quarter" },
      derivation: { inputFactIds: [ytdIncome(BANK_A, "2026-06-30"), ytdIncome(BANK_A, "2026-03-31")] } });
  });

  it("never gives Bank B's row Bank A's ID", () => {
    const facts = byId(fixtures());
    for (const fact of facts.values()) expect(fact.id.split(":")[2]).toBe(String(fact.scope.institutionId));
    expect(facts.get(ytdIncome(BANK_B, "2026-06-30"))).toMatchObject({ value: 900_000, scope: { institutionId: BANK_B } });
    expect(facts.get(ytdIncome(BANK_A, "2026-06-30"))?.value).toBe(2_600_000);
    // Bank B as one of Bank A's filed peers keeps its own ID and its own quarter.
    expect(facts.get(quarterIncome(BANK_B, "2026-06-30"))).toMatchObject({ value: 100_000, scope: { institutionId: BANK_B } });
    // A profile read for Bank A that returns Bank B's rows gives no fact to either bank.
    const swapped = byId([profileRead(BANK_A, [["2026-06-30", 900], ["2026-03-31", 500]], [["2026-Q2", 400]], BANK_B)]);
    expect(swapped.size).toBe(0);
  });

  it("gives no fact for a filing two reads disagree on, and drops what was derived from it", () => {
    const conflictingCall = byId([callA(), callRead(BANK_A, "acct_131", [["2026-06-30", 2_700_000]])]);
    expect(conflictingCall.has(filingFactId("ncua", BANK_A, "2026-06-30", "call:acct_131", "ytd"))).toBe(false);
    expect(conflictingCall.has(filingFactId("ncua", BANK_A, "2026-03-31", "call:acct_131", "ytd"))).toBe(true);

    const restated = profileRead(BANK_A, [["2026-06-30", 2_650], ["2026-03-31", 1_200]], [["2026-Q2", 1_450]]);
    const evidence = claimEvidenceFacts([profileA(), restated], BANK_A);
    const ids = new Set(evidence.facts.map((fact) => fact.id));
    expect(ids.has(ytdIncome(BANK_A, "2026-06-30"))).toBe(false);
    expect(ids.has(ytdIncome(BANK_A, "2026-03-31"))).toBe(true);
    expect(evidence.derivations.some((derived) => derived.derivation.kind === "ytd_to_quarter")).toBe(false);
  });

  it("names every peer row behind a complete peer median, recomputing to the tool's median", () => {
    const evidence = claimEvidenceFacts([peerRead()], BANK_A);
    const median = evidence.derivations.find((derived) => derived.derivation.kind === "peer_median")!;
    expect(median).toMatchObject({ value: 550_000, scope: { institutionId: null, cohortKey: expect.stringMatching(/^filed_peers:ncua:2026-06-30:[0-9a-f]{8}$/) } });
    expect(median.id).toBe(`stat:${median.scope.cohortKey}:median`);
    expect(median.derivation.inputFactIds).toEqual([9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9010, 9011].map((id) => quarterIncome(id, "2026-06-30")));
    const values = median.derivation.inputFactIds.map((id) => evidence.facts.find((fact) => fact.id === id)!.value as number);
    expect(medianOf(values)).toBe(median.value);
    expect(evidence.limitations).toEqual([]);
  });

  it("gives a shortened peer list's median no inputs and a limitation", () => {
    const read = peerRead();
    read.output.peers = (read.output.peers as unknown[]).slice(0, 3);
    read.output._shortened = "peers: kept 3 of 10";
    const evidence = claimEvidenceFacts([read], BANK_A);
    const median = evidence.derivations.find((derived) => derived.derivation.kind === "peer_median");
    expect(median).toMatchObject({ value: 550_000, derivation: { inputFactIds: [] } });
    expect(evidence.limitations).toEqual([SHORTENED_PEER_LIST_LIMITATION]);
    expect(evidence.facts.filter((fact) => fact.scope.periodBasis === "standalone_quarter")).toHaveLength(4);
  });

  // Digests of writtenAnswerEvidence's JSON for these fixtures, recorded on origin/main before #2569; peers and all
  // re-recorded when the peer fixture grew to ten peers for the Hamilton peer minimum (#2568).
  const BEFORE: Record<string, string> = {
    profile: "55521bceeb4ccaf01739360f8bb943bb464dcea9049d5e41b073f2296bf4e576",
    call: "74aa5fc8e9f96570f140219f52b178024f73dd16f85b489b2215e7fde1e113f4",
    peers: "c6ecd951d8e084b10319c658c6a49b48d04e0ed54b3a4b55a7d0f26012c08b00",
    all: "994f645f7e85fbb58055dd7b4ce553dc9e51a03ff21cf5348c8ab3b0c759896c",
  };
  it("leaves the figure check's DATA byte-identical", () => {
    const cases: Record<string, AnswerToolEvidence[]> = { profile: [profileA(), profileB()], call: [callA()], peers: [peerRead()], all: fixtures() };
    for (const [name, reads] of Object.entries(cases)) {
      const context = { toolResults: reads, institutionId: BANK_A };
      const outputs = reads.map((read) => read.output);
      const data = JSON.stringify(writtenAnswerEvidence(outputs, context));
      expect(JSON.stringify(writtenAnswerEvidenceBuild(outputs, context).data), name).toBe(data);
      expect(createHash("sha256").update(data).digest("hex"), name).toBe(BEFORE[name]);
    }
  });
});

describe("profile filings read as profileQuarterCalculations reads them (#1077 step 2)", () => {
  type Output = { financials: { units: unknown; definition: Record<string, unknown>; records: Array<Record<string, unknown>>; latest: unknown } };
  const changedProfile = (change: (output: Output) => void) => {
    const read = profileA();
    change(read.output as Output);
    return read;
  };
  const profileFacts = (read: AnswerToolEvidence) => [...byId([read]).keys()].filter((id) => id.startsWith(`filing:ncua:${BANK_A}:`));

  it("gives no fact when the definition's unit, publisher or period basis is not the source's own", () => {
    expect(profileFacts(profileA())).not.toHaveLength(0);
    expect(profileFacts(changedProfile((o) => { o.financials.definition.unit = "dollars"; }))).toEqual([]);
    expect(profileFacts(changedProfile((o) => { o.financials.definition.publisher = "A spreadsheet"; }))).toEqual([]);
    expect(profileFacts(changedProfile((o) => { o.financials.definition.period_basis = "standalone_quarter"; }))).toEqual([]);
  });

  it("makes a date conflicting when a row's unit cannot be read, and never lets an explicit null fall through", () => {
    // The 2026-06-30 row says unit: null; the response's thousands are not used, and the whole date gives no fact.
    const nullUnit = changedProfile((o) => {
      o.financials.records[0].unit = null;
      o.financials.latest = o.financials.records[0];
    });
    expect(profileFacts(nullUnit).filter((id) => id.includes(":2026-06-30:"))).toEqual([]);
    expect(profileFacts(nullUnit)).toContain(ytdIncome(BANK_A, "2026-03-31"));
    const unreadableField = changedProfile((o) => {
      o.financials.records[1].field_units = { fee_income_ratio: "fraction", service_charge_income: "widgets" };
    });
    expect(profileFacts(unreadableField).filter((id) => id.includes(":2026-03-31:"))).toEqual([]);
    expect(profileFacts(unreadableField)).toContain(ytdIncome(BANK_A, "2026-06-30"));
    // The profile's quarter needs the dropped date, so it is not derived either.
    const evidence = claimEvidenceFacts([changedProfile((o) => { o.financials.records[1].unit = null; })], BANK_A);
    expect(evidence.derivations.some((derived) => derived.derivation.kind === "ytd_to_quarter")).toBe(false);
  });
});
