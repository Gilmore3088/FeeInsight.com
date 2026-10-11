import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HamiltonRequestContract } from "./request-contract";

const mocks = vi.hoisted(() => ({
  getInstitutionById: vi.fn(),
  getFeesByInstitution: vi.fn(),
  getFinancialsByInstitution: vi.fn(),
  getInstitutionRevenueTrend: vi.fn(),
  getInstitutionPeerRanking: vi.fn(),
  getInstitutionFeeScheduleEvidence: vi.fn(),
}));

vi.mock("@/lib/data-store", () => ({
  getInstitutionById: mocks.getInstitutionById,
  getFeesByInstitution: mocks.getFeesByInstitution,
  getFinancialsByInstitution: mocks.getFinancialsByInstitution,
}));

vi.mock("@/lib/data-store/call-reports", () => ({
  getInstitutionRevenueTrend: mocks.getInstitutionRevenueTrend,
  getInstitutionPeerRanking: mocks.getInstitutionPeerRanking,
}));

vi.mock("@/lib/data-store/institution", () => ({
  getInstitutionFeeScheduleEvidence: mocks.getInstitutionFeeScheduleEvidence,
}));

const contract: Pick<
  HamiltonRequestContract,
  "audience" | "intent" | "evidencePolicy" | "institutionId"
> = {
  audience: "pro",
  intent: "competitive-brief",
  evidencePolicy: "provisional-first",
  institutionId: 2945,
};

describe("Hamilton institution briefing", () => {
  beforeEach(() => {
    mocks.getInstitutionById.mockResolvedValue({
      id: 2945,
      institution_name: "Example Bank",
      city: "Orlando",
      state_code: "FL",
      charter_type: "bank",
      asset_size_tier: "1b_10b",
      asset_size: 2500000, // thousands of dollars
      fed_district: 6,
      fee_publication_status: "provisional",
      published_fee_count: 1,
      provisional_fee_count: 2,
      insight_readiness: "directional",
      confidence_summary: "Provisional evidence is available.",
      quality_label: "Provisional fees",
      quality_signals: [{ code: "extracted_not_published", label: "Fee data pending review" }],
      latest_source_status: "fetched",
      latest_source_collected_at: "2026-08-14T00:00:00.000Z",
    });
    mocks.getFeesByInstitution.mockResolvedValue([
      {
        fee_name: "Overdraft fee",
        fee_category: "overdraft",
        amount: 35,
        frequency: "per item",
        conditions: "May apply to paid overdrafts",
        review_status: "approved",
        extraction_confidence: 0.95,
      },
      {
        fee_name: "Wire transfer",
        fee_category: "wire",
        amount: 25,
        frequency: "per transfer",
        conditions: null,
        review_status: "pending",
        extraction_confidence: 0.72,
      },
    ]);
    mocks.getFinancialsByInstitution.mockResolvedValue([
      {
        report_date: "2026-06-30",
        source: "call_report",
        total_assets: 2500000000,
        total_deposits: 1800000000,
        service_charge_income: 12000000,
        total_revenue: 90000000,
        fee_income_ratio: 0.133,
        roa: 0.011,
        branch_count: 18,
      },
    ]);
    mocks.getInstitutionRevenueTrend.mockResolvedValue([{ report_date: "2026-06-30", service_charge_income: 12000000 }]);
    mocks.getInstitutionPeerRanking.mockResolvedValue({ percentile: 82, peer_count: 40 });
    mocks.getInstitutionFeeScheduleEvidence.mockResolvedValue({
      verified_fee_preview: [],
      raw_fee_preview: [],
    });
  });

  it("builds a source-aware selected institution briefing", async () => {
    const { buildHamiltonInstitutionBriefing } = await import("./institution-briefing");

    const prompt = await buildHamiltonInstitutionBriefing(contract);

    expect(prompt).toContain("SELECTED INSTITUTION CONTEXT");
    expect(prompt).toContain("Institution ID: 2945");
    expect(prompt).toContain("Example Bank");
    expect(prompt).not.toContain("Public fee publication status");
    expect(prompt).not.toContain("Quality signals");
    expect(prompt).not.toContain('"confidence"');
    expect(prompt).toContain("Total assets: $2.5B");
    expect(prompt).toContain("Verified fee count: 1");
    expect(prompt).toContain("Provisional fee count: 2");
    expect(prompt).toContain('"status":"verified"');
    expect(prompt).toContain('"status":"provisional"');
    expect(prompt).toContain("Evidence policy: provisional-first");
  });

  it("loads account evidence by its canonical ID without declaring it the active research subject", async () => {
    const { buildHamiltonInstitutionBriefing } = await import("./institution-briefing");
    const prompt = await buildHamiltonInstitutionBriefing(contract, { contextRole: "account_evidence" });
    expect(prompt).toContain("ACCOUNT INSTITUTION PUBLIC EVIDENCE");
    expect(prompt).toContain("Institution ID: 2945");
    expect(prompt).toContain("Name: Example Bank");
    expect(prompt).toContain("Keep the original research subject");
    expect(prompt).not.toContain("SELECTED INSTITUTION CONTEXT");
    expect(prompt).not.toContain("active institution");
    expect(prompt).not.toContain("Selected institution workflow");
    expect(mocks.getInstitutionById).toHaveBeenCalledWith(2945);
    expect(mocks.getFeesByInstitution).toHaveBeenCalledWith(2945);
  });

  it("uses the fdic record, not the ffiec duplicate, as the latest financial record", async () => {
    mocks.getFinancialsByInstitution.mockResolvedValueOnce([
      { report_date: "2026-06-30", source: "ffiec", total_assets: 84762000, service_charge_income: 0, fee_income_ratio: 0 },
      { report_date: "2026-06-30", source: "fdic", total_assets: 84762, service_charge_income: 81, fee_income_ratio: 0.0706 },
    ]);
    mocks.getInstitutionPeerRanking.mockResolvedValueOnce({ tier: "micro", sc_income: 81, sc_rank: 10, peer_count: 600 });
    const { buildHamiltonInstitutionBriefing } = await import("./institution-briefing");

    const prompt = await buildHamiltonInstitutionBriefing(contract);

    expect(prompt).toContain('"service_charge_income":81');
    expect(prompt).not.toContain("84762000");
    expect(prompt).toContain("in thousands of dollars");
    expect(prompt).toContain("Peer ranking tier: micro (assets under $100M)");
  });

  it("keeps data-quality narration out of Pro answers but not admin ones", async () => {
    const { buildHamiltonInstitutionBriefing } = await import("./institution-briefing");

    const pro = await buildHamiltonInstitutionBriefing(contract);
    const admin = await buildHamiltonInstitutionBriefing({ ...contract, audience: "admin" });

    expect(pro).toContain("Do not describe duplicates, stale sources");
    expect(pro).not.toContain("give concrete diligence steps");
    expect(admin).toContain("give concrete diligence steps");
  });

  it("gives operators the pipeline and quality fields", async () => {
    const { buildHamiltonInstitutionBriefing } = await import("./institution-briefing");

    const prompt = await buildHamiltonInstitutionBriefing({ ...contract, audience: "admin" });

    expect(prompt).toContain("Public fee publication status: Provisional fees (provisional)");
    expect(prompt).toContain("Quality signals: extracted_not_published");
    expect(prompt).toContain('"confidence":0.95');
  });

  it("returns null when the selected institution does not exist", async () => {
    mocks.getInstitutionById.mockResolvedValueOnce(null);
    const { buildHamiltonInstitutionBriefing } = await import("./institution-briefing");

    await expect(buildHamiltonInstitutionBriefing(contract)).resolves.toBeNull();
  });
});
