import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionInput } from "@/lib/hamilton/types";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  landingResearch: vi.fn(),
  getInstitutionById: vi.fn(),
  getFeesByInstitution: vi.fn(),
  getFinancialsByInstitution: vi.fn(),
  getInstitutionRevenueTrend: vi.fn(),
  getInstitutionPeerRanking: vi.fn(),
  getInstitutionFeeScheduleEvidence: vi.fn(),
  generateSection: vi.fn(),
  resolveHamiltonPeerIndex: vi.fn(),
  saveHamiltonReport: vi.fn(),
  getRecentHamiltonReports: vi.fn(),
  getActiveScenarios: vi.fn(),
  getHamiltonReportById: vi.fn(),
  getHamiltonScenarioById: vi.fn(),
  completeHamiltonRefreshJobsForInstitution: vi.fn(),
  checkProAiQuota: vi.fn(),
  recordProRequest: vi.fn(),
  getLocalFeeMoves: vi.fn(),
  getLocalMarketCompetitors: vi.fn(),
  getInstitutionComplaintYears: vi.fn(),
  sql: Object.assign(vi.fn(), { json: vi.fn((value: unknown) => ({ json: value })) }),
}));

vi.mock("@/lib/hamilton/landing-geographic-research", () => ({ loadLandingGeographicResearch: mocks.landingResearch }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/data-store", () => ({
  getInstitutionById: mocks.getInstitutionById,
  getFeesByInstitution: mocks.getFeesByInstitution,
  getFinancialsByInstitution: mocks.getFinancialsByInstitution,
}));

vi.mock("@/lib/data-store/connection", () => ({
  sql: mocks.sql,
}));

vi.mock("@/lib/data-store/local-market", () => ({
  getLocalMarketCompetitors: mocks.getLocalMarketCompetitors,
  getLocalFeeMoves: mocks.getLocalFeeMoves,
  FEE_MOVES_TRACKED_SINCE: "2026-10-05T06:43:00Z",
}));

vi.mock("@/lib/data-store/complaints", () => ({
  getInstitutionComplaintYears: mocks.getInstitutionComplaintYears,
}));

vi.mock("@/lib/data-store/call-reports", () => ({
  getInstitutionRevenueTrend: mocks.getInstitutionRevenueTrend,
  getInstitutionPeerRanking: mocks.getInstitutionPeerRanking,
}));

vi.mock("@/lib/data-store/institution", () => ({
  getInstitutionFeeScheduleEvidence: mocks.getInstitutionFeeScheduleEvidence,
}));

vi.mock("@/lib/hamilton/quota", () => ({
  checkProAiQuota: mocks.checkProAiQuota,
  quotaExceededMessage: (quota: { limit: number }) => `You've used all ${quota.limit} Hamilton AI requests for today.`,
}));

vi.mock("@/lib/agents/run-store", () => ({
  recordProRequest: mocks.recordProRequest,
}));

vi.mock("@/lib/research/history", () => ({
  logUsage: async () => undefined,
}));

vi.mock("@/lib/hamilton/generate", async () => {
  // Real figure check over the mocked section text, as generateVerifiedSection does.
  const { checkNarrativeFigures } = await vi.importActual<typeof import("./figure-check")>("./figure-check");
  return {
    generateVerifiedSection: async (input: SectionInput) => {
      const section = await mocks.generateSection(input);
      const check = checkNarrativeFigures(section.narrative, input.data);
      return check.unmatched.length > 0
        ? { status: "needs_review", section, unmatched: check.unmatched, citation: {} }
        : { status: "ok", section, figuresChecked: check.checked, citation: {} };
    },
  };
});

vi.mock("@/lib/hamilton/peer-index", () => ({
  resolveHamiltonPeerIndex: mocks.resolveHamiltonPeerIndex,
}));

vi.mock("@/lib/hamilton/refresh-jobs", () => ({
  completeHamiltonRefreshJobsForInstitution: mocks.completeHamiltonRefreshJobsForInstitution,
}));

vi.mock("@/lib/hamilton/pro-tables", () => ({
  saveHamiltonReport: mocks.saveHamiltonReport,
  getRecentHamiltonReports: mocks.getRecentHamiltonReports,
  getActiveScenarios: mocks.getActiveScenarios,
  getHamiltonReportById: mocks.getHamiltonReportById,
  getHamiltonScenarioById: mocks.getHamiltonScenarioById,
}));

function selectedInstitution(overrides: Record<string, unknown> = {}) {
  return {
    id: 2945,
    institution_name: "Hamilton Federal Credit Union",
    fee_publication_status: "provisional",
    insight_readiness: "directional_analysis",
    confidence_summary: "Official source accepted; rows are pending approval.",
    published_fee_count: 0,
    provisional_fee_count: 1,
    asset_size: 1_500_000_000,
    latest_source_status: "accepted",
    ...overrides,
  };
}

function peerIndex() {
  return {
    entries: [
      {
        fee_category: "wire_transfer",
        median_amount: 20,
        p25_amount: 15,
        p75_amount: 25,
        institution_count: 40,
        maturity_tier: "strong",
      },
      {
        fee_category: "overdraft",
        median_amount: 30,
        p25_amount: 25,
        p75_amount: 35,
        institution_count: 80,
        maturity_tier: "strong",
      },
    ],
    source: "saved-peer-set",
    label: "Custom CU peers",
    filters: { state_code: "TN" },
    peerSetId: "peer-set-1",
    fallbackReason: null,
  };
}

function reportParams() {
  return {
    templateType: "competitive_positioning" as const,
    dateFrom: "2026-01-01",
    dateTo: "2026-06-30",
    institutionId: 2945,
    peerSetId: "peer-set-1",
    evidencePolicy: "provisional-first" as const,
    selectedSource: "url" as const,
    selectedSourceLabel: "URL selected",
  };
}

describe("Hamilton Reports generateReport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.checkProAiQuota.mockResolvedValue({ allowed: true, used: 0, limit: 50, resetsAt: "" });
    mocks.recordProRequest.mockResolvedValue(1);
    mocks.getLocalMarketCompetitors.mockResolvedValue(null);
    mocks.getLocalFeeMoves.mockResolvedValue([]);
    mocks.getInstitutionComplaintYears.mockResolvedValue([]);

    mocks.getCurrentUser.mockResolvedValue({
      id: 7,
      role: "premium",
      subscription_status: "active",
      institution_name: "Fallback Bank",
    });
    mocks.getInstitutionById.mockResolvedValue(selectedInstitution());
    mocks.getFeesByInstitution.mockResolvedValue([]);
    mocks.getFinancialsByInstitution.mockResolvedValue([
      {
        report_date: "2026-06-30",
        total_assets: 1_500_000_000,
        total_deposits: 1_200_000_000,
        service_charge_income: 1_500_000,
        total_revenue: 25_000_000,
        fee_income_ratio: 0.06,
        roa: 0.8,
      },
    ]);
    mocks.getInstitutionRevenueTrend.mockResolvedValue([{ quarter: "2026Q2" }]);
    mocks.getInstitutionPeerRanking.mockResolvedValue({ rank: 4, count: 19 });
    mocks.getInstitutionFeeScheduleEvidence.mockResolvedValue(null);
    mocks.resolveHamiltonPeerIndex.mockResolvedValue(peerIndex());
    mocks.saveHamiltonReport.mockResolvedValue("report-1");
    mocks.completeHamiltonRefreshJobsForInstitution.mockResolvedValue(undefined);
    mocks.generateSection.mockImplementation(async (input: SectionInput) => ({
      narrative:
        input.type === "recommendation"
          ? "Treat the $35 domestic wire row as provisional. Do not use it as a verified benchmark score."
          : `${input.title} uses the $35 domestic wire row and the $20 Custom CU peers median with provisional labeling.`,
      wordCount: 18,
      model: "mock",
      usage: { inputTokens: 10, outputTokens: 8 },
    }));
  });

  it("refuses free accounts before any provider call", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 8, role: "viewer", subscription_status: null });
    const { generateReport } = await import("@/app/pro/(hamilton)/reports/actions");

    const result = await generateReport(reportParams());

    expect(result).toEqual({ success: false, error: "Pro subscription required" });
    expect(mocks.generateSection).not.toHaveBeenCalled();
  });

  it("returns a readiness report and skips provider generation when selected-institution evidence is empty", async () => {
    const { generateReport } = await import("@/app/pro/(hamilton)/reports/actions");

    const result = await generateReport(reportParams());

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(mocks.generateSection).not.toHaveBeenCalled();
    expect(result.report.title).toBe("Data Readiness Brief - Hamilton Federal Credit Union");
    expect(result.report.implementationNotes).toContain(
      "Written from the data on file, without a model-written analysis.",
    );
    expect(result.artifactMetadata).toMatchObject({
      evidencePolicy: "source-diligence",
      selectedSource: "url",
      selectedSourceLabel: "URL selected",
      peerBaselineSource: "saved-peer-set",
      peerBaselineLabel: "Custom CU peers",
      selectedVerifiedFeeCount: 0,
      selectedProvisionalFeeCount: 0,
      selectedFeeDeltaCount: 0,
    });
    expect(mocks.saveHamiltonReport).toHaveBeenCalledWith(
      expect.objectContaining({
        evidencePolicy: "source-diligence",
        selectedFeeDeltaCount: 0,
      }),
    );
  });

  it("normalizes transient saved-artifact source before persisting a new report", async () => {
    const { generateReport } = await import("@/app/pro/(hamilton)/reports/actions");

    const result = await generateReport({
      ...reportParams(),
      selectedSource: "artifact",
      selectedSourceLabel: "Saved artifact",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(mocks.saveHamiltonReport).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedSource: "manual",
        selectedSourceLabel: "Manual",
      }),
    );
  });

  it("passes provisional-only selected-institution evidence into every provider section with benchmark caveats", async () => {
    const { generateReport } = await import("@/app/pro/(hamilton)/reports/actions");
    mocks.getFeesByInstitution.mockResolvedValue([
      {
        fee_name: "Domestic wire",
        fee_category: "wire_transfer",
        amount: 35,
        frequency: "per wire",
        review_status: "pending",
        extraction_confidence: 0.76,
        source_url: "https://example.com/fees",
      },
    ]);
    mocks.getInstitutionFeeScheduleEvidence.mockResolvedValue({
      pipeline_counts: { raw_fee_count: 0, verified_fee_count: 1 },
      verified_fee_preview: [
        {
          fee_name: "Cashier check",
          canonical_fee_key: "cashiers_check",
          amount: 10,
          frequency: "per check",
          review_status: "pending_review",
          extraction_confidence: 0.67,
          source_url: "https://example.com/fees",
        },
      ],
      raw_fee_preview: [],
    });

    const result = await generateReport(reportParams());

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // The default mock answer is unformatted prose, so the partner review sends it
    // back once; the identical rewrite fixes nothing and the first draft is kept.
    expect(mocks.generateSection).toHaveBeenCalledTimes(4);
    expect(mocks.recordProRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "report",
        status: "completed",
        userId: expect.any(Number),
        detail: expect.objectContaining({ partner_review: expect.objectContaining({ rewritten: false, remaining: 1 }) }),
      }),
    );
    const calls = mocks.generateSection.mock.calls.map(([input]) => input as SectionInput);
    for (const input of calls) {
      expect(input.context).toContain("Provisional rows are directional only");
      expect(input.context).toContain("do not treat it as a verified benchmark score");
      expect(input.data.selected_institution).toMatchObject({
        id: 2945,
        benchmark_scope: "Custom CU peers",
        can_generate_verified_benchmark_conclusions: false,
      });
    }

    const selectedPayload = calls[0].data.selected_institution as {
      fee_rows: Array<Record<string, unknown>>;
      fees_under_review: Array<Record<string, unknown>>;
      fee_peer_deltas: Array<Record<string, unknown>>;
      financials: Record<string, unknown>;
    };
    expect(selectedPayload.fee_rows[0]).toMatchObject({
      fee_name: "Domestic wire",
      evidence_tier: "provisional",
      excluded_from_verified_benchmark: true,
    });
    expect(selectedPayload.fees_under_review[0]).toEqual({
      fee_name: "Cashier check",
      fee_category: "cashiers_check",
      amount: 10,
      frequency: "per check",
      evidence_tier: "provisional",
    });
    expect(selectedPayload.fee_peer_deltas[0]).toMatchObject({
      fee_category: "wire_transfer",
      institution_amount: 35,
      peer_median: 20,
      evidence_tier: "provisional",
      excluded_from_verified_benchmark: true,
    });
    expect(selectedPayload.financials.service_charge_income_dollars).toBe(1_500_000_000);

    const recommendationInput = calls.find((input) => input.type === "recommendation");
    expect(recommendationInput?.data.peer_anchored_fees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fee_category: "wire_transfer",
          evidence_tier: "provisional",
          excluded_from_verified_benchmark: true,
        }),
      ]),
    );
    expect(result.report.snapshot).toContainEqual({
      label: "Wire Transfer",
      current: "$35.00 (provisional)",
      proposed: "$20.00 peer median",
    });
    expect(result.report.implementationNotes).toEqual(
      expect.arrayContaining([
        "Peer group: Custom CU peers",
        "1 of Hamilton Federal Credit Union's fees compared with the peer median",
        "Verified benchmark conclusions exclude provisional fees; provisional figures are labeled.",
      ]),
    );
    expect(result.artifactMetadata).toMatchObject({
      evidencePolicy: "provisional-first",
      peerSetId: "peer-set-1",
      selectedProvisionalFeeCount: 1,
      selectedFeeDeltaCount: 1,
    });
  });

  it("rejects generated provider output that fails the report artifact quality gate", async () => {
    const { generateReport } = await import("@/app/pro/(hamilton)/reports/actions");
    mocks.getFeesByInstitution.mockResolvedValue([
      {
        fee_name: "Domestic wire",
        fee_category: "wire_transfer",
        amount: 35,
        frequency: "per wire",
        review_status: "pending",
        extraction_confidence: 0.76,
        source_url: "https://example.com/fees",
      },
    ]);
    mocks.generateSection.mockImplementation(async (input: SectionInput) => ({
      narrative:
        input.type === "recommendation"
          ? "This $35 wire fee creates sustainable competitive advantage."
          : `${input.title} cites the $35 domestic wire row and the $20 peer median as provisional evidence.`,
      wordCount: 18,
      model: "mock",
      usage: { inputTokens: 10, outputTokens: 8 },
    }));

    const result = await generateReport(reportParams());

    expect(result).toEqual({
      success: false,
      error:
        'Report artifact failed quality gate: generic phrase "sustainable competitive advantage" is not allowed.',
    });
    expect(mocks.saveHamiltonReport).not.toHaveBeenCalled();
    expect(mocks.completeHamiltonRefreshJobsForInstitution).not.toHaveBeenCalled();
  });

  it("stops before any model call when the daily quota is used up", async () => {
    const { generateReport } = await import("@/app/pro/(hamilton)/reports/actions");
    mocks.getFeesByInstitution.mockResolvedValue([
      { fee_name: "Domestic wire", fee_category: "wire_transfer", amount: 35, frequency: "per wire", review_status: "pending", extraction_confidence: 0.76, source_url: "https://example.com/fees" },
    ]);
    mocks.checkProAiQuota.mockResolvedValue({ allowed: false, used: 50, limit: 50, resetsAt: "" });

    const result = await generateReport(reportParams());

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("50 Hamilton AI requests") });
    expect(mocks.generateSection).not.toHaveBeenCalled();
  });

  it("refuses to save a report whose narrative states figures the data does not support", async () => {
    const { generateReport } = await import("@/app/pro/(hamilton)/reports/actions");
    mocks.getFeesByInstitution.mockResolvedValue([
      {
        fee_name: "Domestic wire",
        fee_category: "wire_transfer",
        amount: 35,
        frequency: "per wire",
        review_status: "pending",
        extraction_confidence: 0.76,
        source_url: "https://example.com/fees",
      },
    ]);
    mocks.generateSection.mockImplementation(async (input: SectionInput) => ({
      narrative: `${input.title}: peers now charge $97 for this fee.`,
      wordCount: 8,
      model: "mock",
      usage: { inputTokens: 10, outputTokens: 8 },
    }));

    const result = await generateReport(reportParams());

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("$97") });
    expect(mocks.saveHamiltonReport).not.toHaveBeenCalled();
  });

  it("does not persist profile-name slugs for reports without a selected institution", async () => {
    const { generateReport } = await import("@/app/pro/(hamilton)/reports/actions");

    const result = await generateReport({
      templateType: "peer_benchmarking",
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
      evidencePolicy: "provisional-first",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(mocks.saveHamiltonReport).toHaveBeenCalledWith(
      expect.objectContaining({
        institutionId: "",
        selectedSource: "profile",
        selectedFeeDeltaCount: 0,
      }),
    );
    expect(mocks.completeHamiltonRefreshJobsForInstitution).not.toHaveBeenCalled();
  });

  it("builds the answer page, named local competitors and dollar exhibits, and briefs later sections with the answer", async () => {
    const { generateReport } = await import("@/app/pro/(hamilton)/reports/actions");
    mocks.getFeesByInstitution.mockResolvedValue([
      {
        fee_name: "Domestic wire",
        fee_category: "wire_transfer",
        amount: 35,
        review_status: "pending",
        extraction_confidence: 0.8,
        source_url: "https://example.com/fees",
      },
    ]);
    mocks.getFinancialsByInstitution.mockResolvedValue(
      ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"].map((report_date) => ({
        report_date,
        source: "fdic",
        service_charge_income: 375,
      })),
    );
    mocks.getLocalMarketCompetitors.mockResolvedValue({
      basis: "branch_counties",
      label: "Flora, IL area",
      county_fips: [17025],
      sod_year: 2026,
      competitors: [
        { institution_id: 1, institution_name: "First  Flora Bank", charter_type: "bank", market_deposits: 1, fees: { wire_transfer: 25 }, document_url: "https://a.example/fees", document_date: "2026-09-01" },
        { institution_id: 2, institution_name: "Clay County Bank", charter_type: "bank", market_deposits: 1, fees: { wire_transfer: 30 }, document_url: null, document_date: null },
        { institution_id: 3, institution_name: "Prairie Trust", charter_type: "bank", market_deposits: 1, fees: { wire_transfer: 40 }, document_url: null, document_date: null },
      ],
    });
    mocks.getLocalFeeMoves.mockResolvedValue([
      { institution_id: 2, institution_name: "Clay County Bank", fee_category: "wire_transfer", previous_amount: 25, new_amount: 30, detected_at: "2026-10-05" },
    ]);
    mocks.generateSection.mockImplementation(async (input: SectionInput) => ({
      narrative:
        input.type === "executive_summary"
          ? [
              "HEADLINE: Hamilton Federal Credit Union charges $35 for a domestic wire, $5 above the local median.",
              "DECISION: Lower the domestic wire fee to $30 || WHY: Clay County Bank charges $30, the local median; the row is provisional. || CONFIDENCE: Medium - 3 local competitors, provisional row",
            ].join("\n")
          : input.type === "recommendation"
            ? "Clay County Bank already charges $30, so business customers will notice. The row is provisional.\n\nWATCH: Prairie Trust's wire price"
            : "The provisional $35 wire sits above Clay County Bank at $30.",
      wordCount: 30,
      model: "mock",
      usage: { inputTokens: 10, outputTokens: 8 },
    }));

    const result = await generateReport({ ...reportParams(), clientGoal: "lower_risk" });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const summaryInput = mocks.generateSection.mock.calls.find(([input]) => input.type === "executive_summary")?.[0] as SectionInput;
    expect(summaryInput.context).toContain("CLIENT GOAL: lower regulatory and complaint risk");
    expect(result.report.answer).toEqual({
      goal: "Lower regulatory risk",
      headline: "Hamilton Federal Credit Union charges $35 for a domestic wire, $5 above the local median.",
      decisions: [
        {
          action: "Lower the domestic wire fee to $30",
          why: "Clay County Bank charges $30, the local median; the row is provisional.",
          confidence: "Medium",
          confidenceReason: "3 local competitors, provisional row",
        },
      ],
    });
    expect(result.report.exhibits?.map((exhibit) => exhibit.id)).toEqual(["local_market", "peer_range", "dollar_impact", "competitor_moves", "regulatory"]);
    expect(result.report.exhibits?.[0].rows[0]).toEqual([
      "Wire Transfer",
      "$35.00",
      "$30.00",
      "$25.00 to $40.00",
      "First Flora Bank $25.00; Clay County Bank $30.00; Prairie Trust $40.00",
    ]);
    expect(result.report.exhibits?.[2].title).toContain("$1.5M in deposit service charges in 2025");
    expect(result.report.watchlist).toEqual(["Prairie Trust's wire price"]);
    expect(result.report.sources?.map((source) => source.label)).toContain("First Flora Bank fee schedule");

    const calls = mocks.generateSection.mock.calls.map(([input]) => input as SectionInput);
    expect(calls[0].type).toBe("executive_summary");
    for (const input of calls.slice(1)) expect(input.context).toContain("ANSWER PAGE");
    for (const input of calls) expect(input.context).toContain("REGULATORY RULES");
    expect(calls[0].data.exhibits).toMatchObject({
      local_market: { comparisons: [expect.objectContaining({ local_median: 30, position_vs_local: "above" })] },
      fee_impacts: [expect.objectContaining({ reference: "local median", gap_amount: -5, income_per_1000_amount: -5000 })],
    });
  });
});

describe("landing board draft confirmation boundary", () => {
  it("rejects an unconfirmed request before evidence reads or persistence", async () => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 7, role: "admin" });
    const { saveLandingResearchReport } = await import("@/app/pro/(hamilton)/reports/actions");
    const result = await saveLandingResearchReport({ research: {}, confirmed: false });
    expect(result.success).toBe(false);
    expect(mocks.saveHamiltonReport).not.toHaveBeenCalled();
    expect(mocks.generateSection).not.toHaveBeenCalled();
  });
  it("rejects a signed-out caller even with explicit confirmation", async () => {
    vi.clearAllMocks(); mocks.getCurrentUser.mockResolvedValue(null);
    const { saveLandingResearchReport } = await import("@/app/pro/(hamilton)/reports/actions");
    expect((await saveLandingResearchReport({ research: {}, confirmed: true })).success).toBe(false);
    expect(mocks.saveHamiltonReport).not.toHaveBeenCalled();
  });
});

it("saves exact confirmed geographic scope through the existing report store without provider calls", async () => {
  vi.clearAllMocks(); mocks.getCurrentUser.mockResolvedValue({ id: 7, role: "admin" });
  const research = { version: 1, task: "board_report", scope: { kind: "state", stateCode: "DC" }, charter: "credit_union", categories: ["money_order"] };
  mocks.landingResearch.mockResolvedValue({ comparisons: [{ category: "money_order", selected: { median: 0, institutions: 8, lastUpdated: "2026-10-10" }, national: { median: 3 } }] });
  mocks.saveHamiltonReport.mockResolvedValue("saved-id");
  const { saveLandingResearchReport } = await import("@/app/pro/(hamilton)/reports/actions");
  expect(await saveLandingResearchReport({ research, confirmed: true })).toEqual({ success: true, reportId: "saved-id" });
  expect(mocks.landingResearch).toHaveBeenCalledWith({ ...research, task: "compare" });
  expect(mocks.saveHamiltonReport).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, institutionId: "", reportType: "landing_research", evidencePolicy: "verified-only", reportJson: expect.objectContaining({ title: "DC — board research draft", exhibits: [expect.objectContaining({ rows: [["Money Order", "$0.00", "8", "$3.00", "2026-10-10"]] })] }) }));
  expect(mocks.generateSection).not.toHaveBeenCalled();
  expect(mocks.recordProRequest).toHaveBeenCalledWith(expect.objectContaining({ operation: "report", userId: 7, detail: expect.objectContaining({ research }) }));
});
