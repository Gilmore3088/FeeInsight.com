/**
 * The institution profile a written answer reads carries each catalog fee's row and stored
 * schedule, so the answer's sentences can be bound to them (#981, H06-T06). No database: the
 * readers are stubbed with an invented bank.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writtenAnswerFeeEvidence } from "@/lib/hamilton/written-answer-binding";
import { writtenAnswerCheck } from "@/lib/hamilton/answer-save";
import { financialPeerComparison } from "@/lib/data-store/financial-peer-contract";

const CATALOG_FEES = [
  { id: 41, fee_name: "Overdraft", fee_category: "overdraft", amount: 10, frequency: "per item", conditions: null, review_status: "approved", extraction_confidence: 0.9, source_url: null, source_document_id: 141, institution_id: 9001, institution_name: "Synthetic Bank A", validation_flags: null },
  { id: 42, fee_name: "Wire", fee_category: "wire_domestic_outgoing", amount: 25, frequency: null, conditions: null, review_status: "pending", extraction_confidence: 0.7, source_url: null, source_document_id: null, institution_id: 9001, institution_name: "Synthetic Bank A", validation_flags: null },
];

/** Fees read from the schedule but not published: what the admin evidence preview holds. */
const UNPUBLISHED_PREVIEW = {
  verified_fee_preview: [{ fee_verified_id: 7, fee_name: "Stop payment", canonical_fee_key: "stop_payment", amount: 31.5, frequency: "per item", review_status: "verified", extraction_confidence: 0.8, source_url: "https://first-example.test/fees" }],
  raw_fee_preview: [{ fee_raw_id: 8, fee_name: "Paper statement", amount: 4.75, frequency: "monthly", conditions: null, extraction_confidence: 0.6, source_url: "https://first-example.test/fees" }],
  pipeline_counts: { raw_fee_count: 1, verified_fee_count: 1 },
};

const readers = vi.hoisted(() => ({
  fees: [] as Array<Record<string, unknown>>,
  evidence: null as Record<string, unknown> | null,
  charter: "bank",
  financials: [] as Array<Record<string, unknown>>,
  ranking: null as Record<string, unknown> | null,
  getInstitutionRevenueTrend: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/data-store", () => ({
  getFeeCategorySummaries: vi.fn(), getFeeCategoryDetail: vi.fn(), getNationalIndex: vi.fn(), getPeerIndex: vi.fn(), getInstitutionsByFilter: vi.fn(),
  getInstitutionById: async (id: number) => id === 9002
    // As the registry reads a bank with no published fee but fees under review (core.ts,
    // institution-quality.ts): its status, readiness and summary all say provisional.
    ? {
        id, institution_name: "First Example Bank", state_code: "ZZ", charter_type: readers.charter,
        published_fee_count: 0, provisional_fee_count: 14, fee_publication_status: "provisional",
        insight_readiness: "directional",
        confidence_summary: "Provisional evidence supports directional analysis, but not verified benchmark scoring.",
        source_needed_reason: "not_applicable", latest_source_status: "fetched", latest_extracted_fee_count: 14,
        quality_label: "Fee data pending review", quality_status: "review",
        quality_signals: [{
          code: "extracted_not_published", label: "Extracted, not published", severity: "warning",
          detail: "14 fees were extracted from the latest source, but none are published.",
          recommended_action: "Review the Magellan, Rosetta and Knox reads, then let Darwin verify them.",
        }],
      }
    : { id, institution_name: "Synthetic Bank A", state_code: "ZZ", charter_type: readers.charter },
  getFeesByInstitution: async () => readers.fees,
  getFinancialsByInstitution: async () => readers.financials,
}));
vi.mock("@/lib/data-store/call-reports", () => ({ getInstitutionPeerRanking: async () => readers.ranking, getInstitutionRevenueTrend: readers.getInstitutionRevenueTrend }));
vi.mock("@/lib/data-store/institution", () => ({ getInstitutionFeeScheduleEvidence: async () => readers.evidence }));

describe("getInstitution fee rows", () => {
  beforeEach(() => {
    readers.fees = CATALOG_FEES;
    readers.evidence = null;
    readers.charter = "bank";
    readers.financials = [];
    readers.ranking = null;
    readers.getInstitutionRevenueTrend.mockResolvedValue([]);
    vi.clearAllMocks();
  });
  it("carry the catalog row and stored schedule, and only a published row reaches the model", async () => {
    const { getInstitution } = await import("./tools");
    const output = await getInstitution.execute!({ id: 9001 }, { toolCallId: "t1", messages: [] });
    const fees = (output as { fees: Record<string, Array<Record<string, unknown>>> }).fees;
    expect(fees.verified).toHaveLength(1);
    expect(fees.verified[0]).toMatchObject({ record_id: 41, source_document_id: 141, amount: 10, status: "verified" });
    expect(fees.provisional).toBeUndefined();
    expect(output).not.toHaveProperty("fee_note");
    const facts = writtenAnswerFeeEvidence([output])!.evidence.facts;
    expect(facts.map((fact) => [fact.id, fact.status, fact.source.sourceDocumentIds])).toEqual([
      ["fee:published:41", "published", [141]],
    ]);
  });

  it("never hands the model a raw or verified-but-unpublished fee (wiring audit)", async () => {
    readers.evidence = UNPUBLISHED_PREVIEW;
    const { getInstitution } = await import("./tools");
    const output = await getInstitution.execute!({ id: 9001 }, { toolCallId: "t1", messages: [] });
    const text = JSON.stringify(output);
    for (const leaked of ["Stop payment", "31.5", "Paper statement", "4.75", "Wire", "pipeline_stage", "provisional", "raw_unverified", "verified_unpublished"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("says plainly that First Example Bank has no published fees, quoting none of its unpublished ones", async () => {
    readers.fees = [];
    readers.evidence = UNPUBLISHED_PREVIEW;
    const { getInstitution } = await import("./tools");
    const output = await getInstitution.execute!({ id: 9002 }, { toolCallId: "t1", messages: [] }) as Record<string, unknown>;
    expect(output.fee_note).toBe("No verified fees are published for this institution yet.");
    expect(output.fees).toEqual({ verified: [] });
    expect(JSON.stringify(output)).not.toMatch(/31\.5|4\.75|Stop payment|Paper statement|provisional|directional/i);
    const text = JSON.stringify(output);
    for (const internal of ["Extracted, not published", "pending review", "Magellan", "Darwin", "Knox", "Rosetta", "latest_extracted_fee_count", "latest_source_status", "quality"]) {
      expect(text).not.toContain(internal);
    }
    expect(String(getInstitution.description)).not.toContain("quality signals");
    expect(output.public_fee_status).toEqual({
      status: "none_published",
      label: "No published fees",
      insight_readiness: "no_published_fees",
      confidence_summary: "No verified fees are published for this institution yet.",
      verified_fee_count: 0,
      total_visible_fee_count: 0,
    });
    expect(writtenAnswerFeeEvidence([output])).toBeNull();
    expect(String(getInstitution.description)).toContain("When fee_note is present the institution has no published fees");
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

  it("passes the complete written-answer gate with the actual comparable-quarter tool containers (#2358)", async () => {
    readers.charter = "credit_union";
    readers.financials = [{ source: "ncua", report_date: "2026-06-30", service_charge_income: 297363, fee_income_ratio: 0.0382375 }];
    readers.getInstitutionRevenueTrend.mockResolvedValue([
      { quarter: "2026-Q2", service_charge_income: 153080, fee_income_ratio: 0.0382375, yoy_change_pct: 17.0 },
    ]);
    readers.ranking = {
      sc_income: 153080, sc_rank: 1, peer_count: 25, peer_median_sc: 11125,
      fee_income_ratio: 0.0382375, peer_median_fee_ratio: 0.0430845,
      comparison: financialPeerComparison({ source: "ncua", reportDate: "2026-06-30", tier: "regional", minimumAssetsUsd: 1e10, maximumAssetsUsd: 250e9, subjectIncluded: true, eligibleCount: 25, reportedCount: 25, ratioReportedCount: 25, minimumMedianCount: 5 }),
    };
    const { getInstitution } = await import("./tools");
    const output = await getInstitution.execute!({ id: 4956 }, { toolCallId: "t1", messages: [] });
    expect(output).toMatchObject({
      revenue_trend: [{ source: "ncua", units: expect.stringContaining("thousands") }],
      peer_ranking: { source: "ncua", units: expect.stringContaining("thousands") },
    });
    const toolResults = [{ toolName: "getInstitution", input: { id: 4956 }, output }];
    const check = (answer: string) => writtenAnswerCheck(answer, [output], "How does Navy Federal fee income compare with credit unions in Q2 2026?", { institutionId: 4956, toolResults });
    expect(check("Q2 2026 Navy Federal broad fee income was $153.08 million, versus a peer median of $11.13 million for 25 credit unions with $10 billion to $250 billion in assets. Navy is included.")).toMatchObject({ passed: true, problems: [], figureCheck: { unmatched: [] } });
    expect(check("The peer median was $11.13 million, and Navy Federal fee income was $153.08 million in Q2 2026.")).toMatchObject({ passed: true, problems: [] });
    expect(check("Q2 2026 Navy Federal fee income was $153.08 million. Year-to-date fee income was 3.8% of revenue, against a peer median ratio of 4.3%. The quarter's fee income was 17.0% higher than a year earlier.")).toMatchObject({ passed: true, problems: [] });
    expect(check("Q2 2026 Navy Federal fee income was $153.08 thousand, and the peer median was $11.13 million.").passed).toBe(false);
    expect(check("Q2 2026 Navy Federal fee income was $153.08 million, and its YTD fee-income share of revenue was 0.0382%.").passed).toBe(false);
  });

});
