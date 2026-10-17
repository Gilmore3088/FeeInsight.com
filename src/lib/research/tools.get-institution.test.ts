/**
 * The institution profile a written answer reads carries each catalog fee's row and stored
 * schedule, so the answer's sentences can be bound to them (#981, H06-T06). No database: the
 * readers are stubbed with an invented bank.
 */
import { describe, expect, it, vi } from "vitest";
import { writtenAnswerEvidence } from "@/lib/hamilton/written-answer-binding";

vi.mock("@/lib/data-store", () => ({
  getFeeCategorySummaries: vi.fn(), getFeeCategoryDetail: vi.fn(), getNationalIndex: vi.fn(), getPeerIndex: vi.fn(), getInstitutionsByFilter: vi.fn(),
  getInstitutionById: async (id: number) => ({ id, institution_name: "Synthetic Bank A", state_code: "ZZ" }),
  getFeesByInstitution: async () => [
    { id: 41, fee_name: "Overdraft", fee_category: "overdraft", amount: 10, frequency: "per item", conditions: null, review_status: "approved", extraction_confidence: 0.9, source_url: null, source_document_id: 141, institution_id: 9001, institution_name: "Synthetic Bank A", validation_flags: null },
    { id: 42, fee_name: "Wire", fee_category: "wire_domestic_outgoing", amount: 25, frequency: null, conditions: null, review_status: "pending", extraction_confidence: 0.7, source_url: null, source_document_id: null, institution_id: 9001, institution_name: "Synthetic Bank A", validation_flags: null },
  ],
  getFinancialsByInstitution: async () => [],
}));
vi.mock("@/lib/data-store/call-reports", () => ({ getInstitutionPeerRanking: async () => null, getInstitutionRevenueTrend: async () => [] }));
vi.mock("@/lib/data-store/institution", () => ({ getInstitutionFeeScheduleEvidence: async () => null }));

describe("getInstitution fee rows", () => {
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
});
