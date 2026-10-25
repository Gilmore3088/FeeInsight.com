import { describe, expect, it } from "vitest";
import {
  buildReportPeerCoveragePreview,
  buildSelectedInstitutionFeeDeltas,
  compareSelectedInstitutionFees,
} from "./report-evidence";
import { SPECIAL_UNIT_FREQUENCIES, UNIT_LABELS } from "@/lib/fee-unit";

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

  it("collapses an institution's variants to one delta per category, overdraft at its highest tier, preferring verified rows", () => {
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
      institution_amount: 40,
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

describe("compareSelectedInstitutionFees (like for like)", () => {
  it("keeps special units out, retaining ordinary own prices (#2248)", () => {
    const research = {
      fee_category: "account_research", median_amount: 25, p25_amount: 15, p75_amount: 35,
      institution_count: 80, maturity_tier: "strong" as const,
    };
    for (const frequency of SPECIAL_UNIT_FREQUENCIES) {
      const selectedFees = [
        { fee_name: "Research", fee_category: "account_research", amount: 10, frequency,
          review_status: "approved", source_url: "https://example.com/consumer/fees" },
      ];
      const onlySpecial = compareSelectedInstitutionFees({ selectedFees, indexEntries: [research] });
      expect(onlySpecial.deltas, frequency).toEqual([]);
      expect(onlySpecial.notLikeForLike[0]).toMatchObject({
        reason: "different_charge_basis", detail: `Charged ${UNIT_LABELS[frequency]}; comparison unavailable`,
      });
      const mixed = compareSelectedInstitutionFees({
        selectedFees: [
          { fee_name: "Research by unit", fee_category: "account_research", amount: 10, frequency, review_status: "approved" },
          { fee_name: "Flat research", fee_category: "account_research", amount: 30, frequency: "per_item", review_status: "approved" },
        ],
        indexEntries: [research],
      });
      expect(mixed.deltas).toEqual([expect.objectContaining({ institution_amount: 30 })]);
    }
  });

  const entries = [
    { fee_category: "monthly_maintenance", median_amount: 10, p25_amount: 5, p75_amount: 12, institution_count: 900, maturity_tier: "strong" as const },
    { fee_category: "safe_deposit_box", median_amount: 50, p25_amount: 35, p75_amount: 75, institution_count: 900, maturity_tier: "strong" as const },
    { fee_category: "bill_pay", median_amount: 5, p25_amount: 3, p75_amount: 8, institution_count: 300, maturity_tier: "strong" as const },
  ];

  it("does not compare a fee stated only on a business schedule with consumer peers", () => {
    // Security Federal Bank: its three monthly maintenance rows are all on a business schedule.
    const { deltas, notLikeForLike } = compareSelectedInstitutionFees({
      selectedFees: [
        { fee_name: "Monthly service fee (per month)", fee_category: "monthly_maintenance", amount: 39.95, frequency: "monthly", review_status: "approved", source_url: "https://www.securityfederalbank.com/assets/files/mzGcsIYr/BusinessFeeSchedule2026.pdf" },
      ],
      indexEntries: entries,
    });
    expect(deltas).toHaveLength(0);
    expect(notLikeForLike).toEqual([
      expect.objectContaining({ fee_category: "monthly_maintenance", institution_amount: 39.95, reason: "business_schedule" }),
    ]);
  });

  it("compares only the consumer rows when a bank states the fee on both schedules", () => {
    const { deltas } = compareSelectedInstitutionFees({
      selectedFees: [
        { fee_name: "Basic Checking", fee_category: "monthly_maintenance", amount: 8, frequency: "monthly", review_status: "approved", source_url: "https://a.com/personal/fees.pdf" },
        { fee_name: "Commercial Checking", fee_category: "monthly_maintenance", amount: 25, frequency: "monthly", review_status: "approved", source_url: "https://a.com/commercial-fees.pdf" },
      ],
      indexEntries: entries,
    });
    expect(deltas).toEqual([expect.objectContaining({ institution_amount: 8, delta_amount: -2, position: "below_peer_median" })]);
  });

  it("compares a category on its own charging basis and leaves other bases out (#1901)", () => {
    // Rushford State Bank: a $10 monthly late fee beside annual box rent; peers charge annually.
    const { deltas, notLikeForLike } = compareSelectedInstitutionFees({
      selectedFees: [
        { fee_name: "Safe Deposit Box, monthly late fee", fee_category: "safe_deposit_box", amount: 10, frequency: "monthly", review_status: "approved", source_url: "https://a.com/fees" },
        { fee_name: "Safe Deposit Box 3x5", fee_category: "safe_deposit_box", amount: 40, frequency: "annual", review_status: "approved", source_url: "https://a.com/fees" },
        { fee_name: "Safe Deposit Box 5x10", fee_category: "safe_deposit_box", amount: 80, frequency: null, review_status: "approved", source_url: "https://a.com/fees" },
      ],
      indexEntries: entries,
    });
    expect(notLikeForLike).toHaveLength(0);
    expect(deltas).toEqual([expect.objectContaining({ fee_name: "Safe Deposit Box 3x5 (2 variants)", institution_amount: 60 })]);

    const monthlyOnly = compareSelectedInstitutionFees({
      selectedFees: [
        { fee_name: "Safe Deposit Box, monthly late fee", fee_category: "safe_deposit_box", amount: 10, frequency: "monthly", review_status: "approved", source_url: "https://a.com/fees" },
      ],
      indexEntries: entries,
    });
    expect(monthlyOnly.deltas).toHaveLength(0);
    expect(monthlyOnly.notLikeForLike[0]).toMatchObject({
      reason: "different_charge_basis",
      detail: "Monthly charge, not annual; the peer median compares one charging basis.",
    });
  });

  it("compares a monthly bill pay subscription with the monthly median and leaves per-payment fees out (#1901)", () => {
    // Bill pay's peers stated monthly (273 institutions) and per payment (about 220) on Oct 25;
    // the median now holds only the monthly ones, so the bank's per-payment fee is not placed in it.
    const { deltas, notLikeForLike } = compareSelectedInstitutionFees({
      selectedFees: [
        { fee_name: "Bill Pay", fee_category: "bill_pay", amount: 6, frequency: "monthly", review_status: "approved", source_url: null },
        { fee_name: "Expedited payment", fee_category: "bill_pay", amount: 15, frequency: "per_item", review_status: "approved", source_url: null },
      ],
      indexEntries: entries,
    });
    expect(notLikeForLike).toHaveLength(0);
    expect(deltas).toEqual([expect.objectContaining({ fee_name: "Bill Pay", institution_amount: 6, delta_amount: 1 })]);

    const perPaymentOnly = buildSelectedInstitutionFeeDeltas({
      selectedFees: [
        { fee_name: "Bill payment", fee_category: "bill_pay", amount: 1, frequency: "per_transaction", review_status: "approved", source_url: null },
      ],
      indexEntries: entries,
    });
    expect(perPaymentOnly).toHaveLength(0);
  });

  it("leaves a monthly price out of a per-event category's comparison (#1901)", () => {
    const nsf = { fee_category: "nsf", median_amount: 30, p25_amount: 25, p75_amount: 32, institution_count: 900, maturity_tier: "strong" as const };
    const { deltas, notLikeForLike } = compareSelectedInstitutionFees({
      selectedFees: [
        { fee_name: "NSF", fee_category: "nsf", amount: 9, frequency: "monthly", review_status: "approved", source_url: null },
      ],
      indexEntries: [nsf],
    });
    expect(deltas).toHaveLength(0);
    expect(notLikeForLike[0]).toMatchObject({
      reason: "different_charge_basis",
      detail: "Monthly charge, not per item; the peer median compares one charging basis.",
    });
  });

  it("keeps a fee with no stated frequency, as the medians do", () => {
    const deltas = buildSelectedInstitutionFeeDeltas({
      selectedFees: [
        { fee_name: "Bill Pay", fee_category: "bill_pay", amount: 6, frequency: null, review_status: "approved", source_url: null },
      ],
      indexEntries: entries,
    });
    expect(deltas).toHaveLength(1);
  });
});
