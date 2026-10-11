import { beforeEach, describe, expect, it, vi } from "vitest";
import { getInstitutionFeeRows } from "@/lib/data-store/fee-index";
import { buildFeeResearchEvidence } from "./evidence-contract";
import type { FeeResearch } from "./workspace/types";

const db = vi.hoisted(() => ({ unsafe: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: { unsafe: db.unsafe } }));

function research(ownRows: Awaited<ReturnType<typeof getInstitutionFeeRows>>): FeeResearch {
  return {
    institutionId: 1001, institutionName: "Synthetic CU",
    feeCategory: "overdraft", displayName: "Overdraft", current: null,
    ownRows, peers: [], band: null,
    provenance: { generatedAt: "2026-10-10T00:00:00Z" },
  } as unknown as FeeResearch;
}

describe("H06-T02/T03 canonical evidence lineage", () => {
  beforeEach(() => db.unsafe.mockReset());

  it("keeps actual zero, charge basis, fee audience, source hash and retrieval dates", async () => {
    db.unsafe.mockResolvedValue([{
      id: "91", fee_name: "Overdraft item", amount: "0",
      source_document_id: "300", document_url: "https://example.test/fees.pdf",
      source_url: null, created_at: new Date("2026-10-09T12:00:00Z"),
      verified_by_agent_event_id: "event-12", frequency: "per item",
      conditions: "When item overdraws consumer account",
      fee_audience: "consumer", audience_evidence: "Consumer disclosure",
      source_content_hash: "synthetic-document-hash",
      source_crawled_at: new Date("2026-10-07T00:00:00Z"),
      source_last_checked_at: new Date("2026-10-10T00:00:00Z"),
    }]);
    const rows = await getInstitutionFeeRows(1001, "overdraft");
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("FROM published_fee_catalog ef");
    expect(query).toContain("doc.id = ef.source_document_id AND doc.institution_id = ef.institution_id");
    expect(query).toContain("ef.review_status = 'approved'");
    expect(params).toEqual([1001, "overdraft"]);
    expect(rows[0]).toMatchObject({
      amount: 0, feeAudience: "consumer", frequency: "per item",
      sourceContentHash: "synthetic-document-hash",
      sourceCrawledAt: "2026-10-07T00:00:00.000Z",
      sourceLastCheckedAt: "2026-10-10T00:00:00.000Z",
    });
    const [fact] = buildFeeResearchEvidence(research(rows)).facts;
    expect(fact).toMatchObject({
      id: "fee:published:91", value: 0, frequency: "per item",
      conditions: "When item overdraws consumer account",
      audienceEvidence: "Consumer disclosure",
      scope: { institutionId: 1001, accountApplicability: "consumer",
        reportingDate: null, effectiveDate: null },
      source: { recordId: 91, sourceDocumentIds: [300], location: null,
        documentContentHash: "synthetic-document-hash",
        retrievedAt: "2026-10-07T00:00:00.000Z",
        lastCheckedAt: "2026-10-10T00:00:00.000Z",
        asOf: "2026-10-09T12:00:00.000Z" },
    });
  });

  it("keeps missing dates, source version and unknown audience null, never assumes consumer", async () => {
    db.unsafe.mockResolvedValue([{
      id: 92, fee_name: "Overdraft item", amount: 25,
      source_document_id: null, document_url: null, source_url: null,
      created_at: null, verified_by_agent_event_id: null,
      frequency: null, conditions: null, fee_audience: "unexpected",
      audience_evidence: null, source_content_hash: null,
      source_crawled_at: null, source_last_checked_at: null,
    }]);
    const rows = await getInstitutionFeeRows(1001, "overdraft");
    expect(rows[0].feeAudience).toBe("unknown");
    const [fact] = buildFeeResearchEvidence(research(rows)).facts;
    expect(fact).toMatchObject({
      value: 25, frequency: null, conditions: null,
      scope: { accountApplicability: "unknown", reportingDate: null, effectiveDate: null },
      source: { sourceDocumentIds: [], urls: [], asOf: null, location: null,
        documentContentHash: null, retrievedAt: null, lastCheckedAt: null },
    });
  });

  it("rejects negative and nonfinite values but keeps a true zero", () => {
    const row = { id: 1, feeName: "Synthetic", sourceDocumentId: null,
      documentUrl: null, sourceUrl: null, publishedAt: null, verifiedByEventId: null,
      frequency: null, conditions: null, feeAudience: "unknown" as const,
      audienceEvidence: null, sourceContentHash: null, sourceCrawledAt: null,
      sourceLastCheckedAt: null };
    const bundle = buildFeeResearchEvidence(research([
      { ...row, amount: Number.NaN }, { ...row, id: 2, amount: Infinity },
      { ...row, id: 3, amount: -3 }, { ...row, id: 4, amount: 0 },
    ]));
    expect(bundle.facts.map(f => [f.id, f.value])).toEqual([["fee:published:4", 0]]);
  });
});
