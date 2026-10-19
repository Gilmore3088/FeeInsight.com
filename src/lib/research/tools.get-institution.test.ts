/**
 * The institution profile a written answer reads carries each catalog fee's row and stored
 * schedule, so the answer's sentences can be bound to them (#981, H06-T06). No database: the
 * readers are stubbed with an invented bank.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writtenAnswerEvidence } from "@/lib/hamilton/written-answer-binding";

const readers = vi.hoisted(() => ({
  charter: "bank",
  financials: [] as Array<Record<string, unknown>>,
  ranking: null as Record<string, unknown> | null,
  getInstitutionRevenueTrend: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/data-store", () => ({
  getFeeCategorySummaries: vi.fn(), getFeeCategoryDetail: vi.fn(), getNationalIndex: vi.fn(), getPeerIndex: vi.fn(), getInstitutionsByFilter: vi.fn(),
  getInstitutionById: async (id: number) => ({ id, institution_name: "Synthetic Bank A", state_code: "ZZ", charter_type: readers.charter }),
  getFeesByInstitution: async () => [
    { id: 41, fee_name: "Overdraft", fee_category: "overdraft", amount: 10, frequency: "per item", conditions: null, review_status: "approved", extraction_confidence: 0.9, source_url: null, source_document_id: 141, institution_id: 9001, institution_name: "Synthetic Bank A", validation_flags: null },
    { id: 42, fee_name: "Wire", fee_category: "wire_domestic_outgoing", amount: 25, frequency: null, conditions: null, review_status: "pending", extraction_confidence: 0.7, source_url: null, source_document_id: null, institution_id: 9001, institution_name: "Synthetic Bank A", validation_flags: null },
  ],
  getFinancialsByInstitution: async () => readers.financials,
}));
vi.mock("@/lib/data-store/call-reports", () => ({ getInstitutionPeerRanking: async () => readers.ranking, getInstitutionRevenueTrend: readers.getInstitutionRevenueTrend }));
vi.mock("@/lib/data-store/institution", () => ({ getInstitutionFeeScheduleEvidence: async () => null }));

describe("getInstitution fee rows", () => {
  beforeEach(() => {
    readers.charter = "bank";
    readers.financials = [];
    readers.ranking = null;
    vi.clearAllMocks();
  });
  it("carry the catalog row and stored schedule, and only an approved row reads as a published record", async () => {
    const { getInstitution } = await import("./tools");
    const output = await getInstitution.execute!({ id: 9001 }, { toolCallId: "t1", messages: [] });
    const fees = (output as { fees: { verified: Array<Record<string, unknown>>; provisional: Array<Record<string, unknown>> } }).fees;
    expect(fees.verified[0]).toMatchObject({ record_id: 41, source_document_id: 141, amount: 10 });
    expect(fees.provisional[0]).toMatchObject({ record_id: 42, source_document_id: null });
    const facts = writtenAnswerEvidence([output])!.evidence.facts;
    expect(facts.map((fact) => [fact.id, fact.status, fact.source.sourceDocumentIds])).toEqual([
      ["fee:published:41", "published", [141]],
      ["fee:published:42", "provisional", []],
    ]);
  });

  it.each([["bank", "fdic"], ["credit_union", "ncua"]])("scopes %s financial records and tools to %s, and withholds a mismatched ranking", async (charter, source) => {
    readers.charter = charter;
    readers.financials = [
      { source: "ffiec", service_charge_income: 9_999_999 },
      { source: source === "fdic" ? "ncua" : "fdic", service_charge_income: 8_888 },
      { source, service_charge_income: 123, report_date: "2026-06-30" },
    ];
    readers.ranking = { peer_count: 152, comparison: { source: source === "fdic" ? "ncua" : "fdic", charter_type: charter } };
    const { getInstitution } = await import("./tools");
    const output = await getInstitution.execute!({ id: 9001 }, { toolCallId: "t1", messages: [] });
    expect(output).toMatchObject({ financials: { latest: { source, service_charge_income: 123 }, records: [{ source, service_charge_income: 123 }], definition: { source, charter_type: charter } }, peer_ranking: null });
    expect(readers.getInstitutionRevenueTrend).toHaveBeenCalledWith(9001, undefined, source);
  });

  it("retains the dated comparable ranking contract and fails closed for unknown charters", async () => {
    readers.ranking = { peer_count: 25, comparison: { source: "fdic", charter_type: "bank", report_date: "2026-06-30", subject_included: true } };
    const { getInstitution } = await import("./tools");
    const execute = () => getInstitution.execute!({ id: 9001 }, { toolCallId: "t1", messages: [] });
    expect(await execute()).toMatchObject({ peer_ranking: readers.ranking });
    readers.charter = "unknown";
    readers.financials = [{ source: "fdic", service_charge_income: 999 }];
    expect(await execute()).toMatchObject({ financials: { latest: null, records: [], definition: null }, peer_ranking: null });
    expect(readers.getInstitutionRevenueTrend).toHaveBeenCalledTimes(1);
  });

});
