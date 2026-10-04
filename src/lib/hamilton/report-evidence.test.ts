import { describe, expect, it } from "vitest";
import {
  buildReportPeerCoveragePreview,
  buildSelectedInstitutionFeeDeltas,
} from "./report-evidence";

const indexEntries = [
  {
    fee_category: "overdraft",
    median_amount: 30,
    p25_amount: 25,
    p75_amount: 35,
    institution_count: 80,
    maturity_tier: "strong" as const,
  },
  {
    fee_category: "wire_transfer",
    median_amount: 20,
    p25_amount: 15,
    p75_amount: 25,
    institution_count: 40,
    maturity_tier: "provisional" as const,
  },
];

describe("buildSelectedInstitutionFeeDeltas", () => {
  it("computes deterministic selected-institution deltas against the verified index", () => {
    const deltas = buildSelectedInstitutionFeeDeltas({
      selectedFees: [
        {
          fee_name: "Domestic wire",
          fee_category: "wire_transfer",
          amount: 35,
          review_status: "pending",
          extraction_confidence: 0.71,
          source_url: "https://example.com/fees",
        },
        {
          fee_name: "Overdraft",
          fee_category: "overdraft",
          amount: 35,
          review_status: "approved",
          extraction_confidence: 0.96,
          source_url: "https://example.com/fees",
        },
      ],
      indexEntries,
      evidencePolicy: "provisional-first",
    });

    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({
      fee_category: "wire_transfer",
      institution_amount: 35,
      peer_median: 20,
      delta_amount: 15,
      delta_percent: 75,
      position: "above_peer_median",
      evidence_tier: "provisional",
      excluded_from_verified_benchmark: true,
    });
    expect(deltas[1]).toMatchObject({
      fee_category: "overdraft",
      delta_amount: 5,
      evidence_tier: "verified",
      excluded_from_verified_benchmark: false,
    });
  });

  it("collapses an institution's variants to one delta per category at its median, preferring verified rows", () => {
    const deltas = buildSelectedInstitutionFeeDeltas({
      selectedFees: [
        { fee_name: "Overdraft", fee_category: "overdraft", amount: 30, review_status: "approved" },
        { fee_name: "Overdraft (2nd item)", fee_category: "overdraft", amount: 35, review_status: "approved" },
        { fee_name: "Overdraft (business)", fee_category: "overdraft", amount: 40, review_status: "approved" },
        { fee_name: "Overdraft (draft)", fee_category: "overdraft", amount: 99, review_status: "pending" },
      ],
      indexEntries,
      evidencePolicy: "provisional-first",
    });

    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      fee_category: "overdraft",
      fee_name: "Overdraft (3 variants)",
      institution_amount: 35,
      evidence_tier: "verified",
    });
  });

  it("excludes provisional rows when the report policy is verified-only", () => {
    const deltas = buildSelectedInstitutionFeeDeltas({
      selectedFees: [
        {
          fee_name: "Domestic wire",
          fee_category: "wire_transfer",
          amount: 35,
          review_status: "pending",
          extraction_confidence: 0.71,
          source_url: null,
        },
        {
          fee_name: "Overdraft",
          fee_category: "overdraft",
          amount: 35,
          review_status: "approved",
          extraction_confidence: 0.96,
          source_url: null,
        },
      ],
      indexEntries,
      evidencePolicy: "verified-only",
    });

    expect(deltas).toHaveLength(1);
    expect(deltas[0].fee_category).toBe("overdraft");
    expect(deltas[0].evidence_tier).toBe("verified");
  });

  it("returns no deltas for missing categories or benchmark medians", () => {
    const deltas = buildSelectedInstitutionFeeDeltas({
      selectedFees: [
        {
          fee_name: "Unmapped fee",
          fee_category: null,
          amount: 10,
          review_status: "approved",
          extraction_confidence: 0.9,
          source_url: null,
        },
        {
          fee_name: "Unknown category",
          fee_category: "not_in_index",
          amount: 10,
          review_status: "approved",
          extraction_confidence: 0.9,
          source_url: null,
        },
      ],
      indexEntries,
    });

    expect(deltas).toEqual([]);
  });
});

describe("buildReportPeerCoveragePreview", () => {
  it("marks selected institutions ready when approved fee deltas are available", () => {
    const preview = buildReportPeerCoveragePreview({
      hasSelectedInstitution: true,
      selectedFees: [
        {
          fee_name: "Overdraft",
          fee_category: "overdraft",
          amount: 35,
          review_status: "approved",
          extraction_confidence: 0.96,
          source_url: "https://example.com/fees",
        },
      ],
      indexEntries,
      peerBaselineSource: "selected-institution-default",
      peerBaselineLabel: "FL bank peers",
    });

    expect(preview.readiness).toBe("verified_comparison_ready");
    expect(preview.selectedVerifiedFeeCount).toBe(1);
    expect(preview.selectedVerifiedFeeDeltaCount).toBe(1);
    expect(preview.selectedFeeDeltaCount).toBe(1);
    expect(preview.canGenerateSelectedInstitutionBenchmarkConclusions).toBe(true);
  });

  it("labels provisional-only selected deltas as directional, not verified benchmark ready", () => {
    const preview = buildReportPeerCoveragePreview({
      hasSelectedInstitution: true,
      selectedFees: [
        {
          fee_name: "Domestic wire",
          fee_category: "wire_transfer",
          amount: 35,
          review_status: "pending",
          extraction_confidence: 0.71,
          source_url: "https://example.com/fees",
        },
      ],
      indexEntries,
      evidencePolicy: "provisional-first",
      peerBaselineSource: "saved-peer-set",
      peerBaselineLabel: "Custom peers",
    });

    expect(preview.readiness).toBe("directional_comparison_ready");
    expect(preview.selectedProvisionalFeeCount).toBe(1);
    expect(preview.selectedProvisionalFeeDeltaCount).toBe(1);
    expect(preview.canGenerateSelectedInstitutionBenchmarkConclusions).toBe(false);
  });

  it("routes selected institutions with evidence but no comparable deltas to diligence", () => {
    const preview = buildReportPeerCoveragePreview({
      hasSelectedInstitution: true,
      selectedFees: [
        {
          fee_name: "Unmapped fee",
          fee_category: null,
          amount: 10,
          review_status: "approved",
          extraction_confidence: 0.9,
          source_url: null,
        },
      ],
      indexEntries,
      pipelineFeeCount: 2,
    });

    expect(preview.readiness).toBe("source_diligence");
    expect(preview.selectedFeeDeltaCount).toBe(0);
    expect(preview.canGenerateSelectedInstitutionBenchmarkConclusions).toBe(false);
  });

  it("shows source-needed for empty selected institutions", () => {
    const preview = buildReportPeerCoveragePreview({
      hasSelectedInstitution: true,
      selectedFees: [],
      indexEntries,
      pipelineFeeCount: 0,
      peerBaselineSource: "national",
      peerBaselineLabel: "Verified national index",
      peerFallbackReason: "Selected-institution peer filters were too sparse.",
    });

    expect(preview.readiness).toBe("source_needed");
    expect(preview.peerFallbackReason).toBe("Selected-institution peer filters were too sparse.");
    expect(preview.selectedFeeDeltaCount).toBe(0);
  });

  it("shows peer-index-only readiness when no institution is selected", () => {
    const preview = buildReportPeerCoveragePreview({
      hasSelectedInstitution: false,
      selectedFees: [],
      indexEntries,
      focusCategory: "overdraft",
    });

    expect(preview.readiness).toBe("peer_index_only");
    expect(preview.usablePeerCategoryCount).toBe(2);
    expect(preview.focusCategoryCovered).toBe(true);
    expect(preview.focusCategoryPeerInstitutionCount).toBe(80);
  });
});
