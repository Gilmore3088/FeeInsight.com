import { describe, expect, it } from "vitest";
import type { SelectedInstitutionFeeDelta } from "@/lib/hamilton/report-evidence";
import {
  buildSelectedInstitutionReportData,
  buildSelectedInstitutionReportRules,
  buildStateExpertReportData,
} from "./report-synthesis";

function delta(overrides: Partial<SelectedInstitutionFeeDelta> = {}): SelectedInstitutionFeeDelta {
  return {
    fee_name: "Domestic wire",
    fee_category: "wire_transfer",
    institution_amount: 35,
    peer_median: 20,
    peer_p25: 15,
    peer_p75: 25,
    delta_amount: 15,
    delta_percent: 75,
    position: "above_peer_median",
    evidence_tier: "provisional",
    excluded_from_verified_benchmark: true,
    institution_count: 40,
    maturity: "strong",
    confidence: 0.76,
    source_url: "https://example.com/fees",
    ...overrides,
  };
}

describe("selected institution report synthesis", () => {
  it("adds selected-institution grounding rules only when an institution is selected", () => {
    expect(buildSelectedInstitutionReportRules({ institutionId: null })).toBe("");

    const rules = buildSelectedInstitutionReportRules({ institutionId: 2945 });
    expect(rules).toContain("selected_institution.fee_peer_deltas");
    expect(rules).toContain("do not write benchmark conclusions");
    expect(rules).toContain("Provisional rows are directional only");
    expect(rules).toContain("do not treat it as a verified benchmark score");
  });

  it("labels provisional rows and blocks verified benchmark conclusions for provisional-only deltas", () => {
    const reportData = buildSelectedInstitutionReportData({
      selectedInstitution: {
        id: 2945,
        institution_name: "Hamilton Federal Credit Union",
        fee_publication_status: "provisional",
        insight_readiness: "directional_analysis",
        confidence_summary: "Official source is present but not approved.",
        published_fee_count: 1,
        provisional_fee_count: 2,
        latest_source_status: "accepted",
      },
      latestFinancial: {
        report_date: "2026-06-30",
        total_assets: 1_500_000_000,
        total_deposits: 1_200_000_000,
        service_charge_income: 1_500_000,
        total_revenue: 25_000_000,
        fee_income_ratio: 0.06,
        roa: 0.8,
      },
      selectedVisibleFees: [
        {
          fee_name: "Overdraft",
          fee_category: "overdraft",
          amount: 30,
          frequency: "per item",
          review_status: "approved",
          extraction_confidence: 0.94,
          source_url: "https://example.com/fees",
        },
        {
          fee_name: "Domestic wire",
          fee_category: "wire_transfer",
          amount: 35,
          frequency: "per wire",
          review_status: "pending",
          extraction_confidence: 0.76,
          source_url: "https://example.com/fees",
        },
      ],
      selectedEvidence: {
        verified_fee_preview: [
          {
            fee_name: "Cashier check",
            canonical_fee_key: "cashiers_check",
            amount: 10,
            frequency: "per check",
            review_status: "pending_review",
            extraction_confidence: 0.66,
            source_url: "https://example.com/fees",
          },
          {
            fee_name: "Rejected row",
            canonical_fee_key: "rejected",
            amount: 99,
            frequency: "per event",
            review_status: "rejected",
            extraction_confidence: 0.1,
            source_url: "https://example.com/fees",
          },
        ],
        raw_fee_preview: [
          {
            fee_name: "Raw source row",
            amount: 5,
            frequency: "monthly",
            extraction_confidence: 0.55,
            source_url: "https://example.com/fees",
          },
        ],
        pipeline_counts: { raw_fee_count: 1, verified_fee_count: 1 },
      },
      selectedFeeDeltas: [delta()],
      peerIndex: {
        label: "Custom CU peers",
        source: "saved-peer-set",
        filters: { state_code: "TN" },
        peerSetId: "peer-set-1",
        fallbackReason: null,
      },
      selectedRevenueTrend: Array.from({ length: 10 }, (_, index) => ({ quarter: index })),
      selectedPeerRanking: { rank: 4, count: 19 },
      evidencePolicy: "provisional-first",
    });

    expect(reportData).not.toBeNull();
    expect(reportData?.financials?.service_charge_income).toBe(1_500_000);
    expect(reportData?.fee_rows).toEqual([
      expect.objectContaining({
        fee_name: "Overdraft",
        evidence_tier: "verified",
        excluded_from_verified_benchmark: false,
      }),
      expect.objectContaining({
        fee_name: "Domestic wire",
        evidence_tier: "provisional",
        excluded_from_verified_benchmark: true,
      }),
    ]);
    expect(reportData?.pipeline_fee_rows).toEqual([
      expect.objectContaining({
        fee_name: "Cashier check",
        evidence_tier: "provisional",
        pipeline_stage: "verified_unpublished",
      }),
      expect.objectContaining({
        fee_name: "Raw source row",
        evidence_tier: "provisional",
        pipeline_stage: "raw_unverified",
      }),
    ]);
    expect(reportData?.fee_peer_deltas[0]).toMatchObject({
      evidence_tier: "provisional",
      excluded_from_verified_benchmark: true,
    });
    expect(reportData?.can_generate_verified_benchmark_conclusions).toBe(false);
    expect(reportData?.revenue_trend).toHaveLength(8);
    expect(reportData?.peer_set_id).toBe("peer-set-1");
    expect(reportData?.evidence_policy).toBe("provisional-first");
  });

  it("allows verified benchmark conclusions only when a verified delta exists", () => {
    const reportData = buildSelectedInstitutionReportData({
      selectedInstitution: {
        id: 8109,
        institution_name: "Verified Bank",
      },
      latestFinancial: null,
      selectedVisibleFees: [],
      selectedEvidence: null,
      selectedFeeDeltas: [
        delta({
          evidence_tier: "verified",
          excluded_from_verified_benchmark: false,
        }),
      ],
      peerIndex: {
        label: "Verified national index",
        source: "national",
        filters: null,
        peerSetId: null,
        fallbackReason: "Saved peer set was too sparse.",
      },
      selectedRevenueTrend: [],
      selectedPeerRanking: null,
      evidencePolicy: "verified-only",
    });

    expect(reportData?.can_generate_verified_benchmark_conclusions).toBe(true);
    expect(reportData?.peer_fallback_reason).toBe("Saved peer set was too sparse.");
    expect(reportData?.evidence_policy).toBe("verified-only");
  });
});

describe("buildStateExpertReportData", () => {
  const summary = {
    stateCode: "GA",
    stateName: "Georgia",
    expertName: "Robert W. Woodruff",
    institutionCount: 210,
    publishedFeeCount: 1450,
    peerLevels: [
      { canonicalFeeKey: "overdraft", p25: 28, median: 32, p75: 35, count: 60 },
      { canonicalFeeKey: "stop_payment", p25: 25, median: 30, p75: 32, count: 40 },
    ],
    notableOutliers: [
      { institutionId: 7, canonicalFeeKey: "nsf", amount: 45, peerMedian: 28, peerCount: 30 },
      { institutionId: 9, canonicalFeeKey: "overdraft", amount: 60, peerMedian: 32, peerCount: 60 },
    ],
  };

  it("places the institution's fees against in-state levels and keeps its own outliers", () => {
    const data = buildStateExpertReportData({
      summary,
      selectedInstitutionId: 7,
      selectedFeeDeltas: [
        { fee_name: "Overdraft", fee_category: "overdraft", institution_amount: 35 },
        { fee_name: "Stop payment", fee_category: "stop_payment", institution_amount: 30 },
        { fee_name: "Wire out", fee_category: "wire_domestic_outgoing", institution_amount: 25 },
      ],
    });

    expect(data?.state_expert).toBe("Robert W. Woodruff");
    expect(data?.state_fee_deltas).toEqual([
      expect.objectContaining({ fee_category: "overdraft", state_median: 32, position: "above_state_median" }),
      expect.objectContaining({ fee_category: "stop_payment", state_median: 30, position: "at_state_median" }),
    ]);
    expect(data?.selected_institution_state_outliers).toEqual([
      { fee_category: "nsf", amount: 45, state_median: 28, state_peer_count: 30 },
    ]);
    expect(data?.state_levels).toHaveLength(2);
  });

  it("returns null without a summary or any state levels", () => {
    expect(buildStateExpertReportData({ summary: null, selectedInstitutionId: 7, selectedFeeDeltas: [] })).toBeNull();
    expect(
      buildStateExpertReportData({ summary: { ...summary, peerLevels: [] }, selectedInstitutionId: 7, selectedFeeDeltas: [] }),
    ).toBeNull();
  });
});
