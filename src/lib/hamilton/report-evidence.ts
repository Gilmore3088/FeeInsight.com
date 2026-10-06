import type { IndexEntry } from "@/lib/data-store/fee-index";
import { institutionValue, MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/fee-stats";

export interface SelectedInstitutionFeeDelta {
  fee_name: string;
  fee_category: string;
  institution_amount: number;
  peer_median: number;
  peer_p25: number | null;
  peer_p75: number | null;
  delta_amount: number;
  delta_percent: number | null;
  position: "above_peer_median" | "below_peer_median" | "at_peer_median";
  evidence_tier: "verified" | "provisional";
  excluded_from_verified_benchmark: boolean;
  institution_count: number;
  maturity: IndexEntry["maturity_tier"];
  confidence: number | null;
  source_url: string | null;
}

export type ReportPeerCoverageReadiness =
  | "verified_comparison_ready"
  | "directional_comparison_ready"
  | "peer_index_only"
  | "source_diligence"
  | "source_needed";

export interface ReportPeerCoveragePreview {
  readiness: ReportPeerCoverageReadiness;
  readinessLabel: string;
  readinessDetail: string;
  evidencePolicy: string;
  peerBaselineSource: string | null;
  peerBaselineLabel: string | null;
  peerFallbackReason: string | null;
  usablePeerCategoryCount: number;
  focusCategoryCovered: boolean | null;
  focusCategoryPeerInstitutionCount: number | null;
  selectedVerifiedFeeCount: number;
  selectedProvisionalFeeCount: number;
  selectedFeeDeltaCount: number;
  selectedVerifiedFeeDeltaCount: number;
  selectedProvisionalFeeDeltaCount: number;
  canGenerateSelectedInstitutionBenchmarkConclusions: boolean;
}

interface SelectedInstitutionFeeInput {
  fee_name: string;
  fee_category?: string | null;
  amount: number | null;
  review_status: string;
  extraction_confidence?: number | null;
  source_url?: string | null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function classifyDelta(delta: number): SelectedInstitutionFeeDelta["position"] {
  if (Math.abs(delta) < 0.005) return "at_peer_median";
  return delta > 0 ? "above_peer_median" : "below_peer_median";
}

export function buildSelectedInstitutionFeeDeltas(params: {
  selectedFees: Pick<
    SelectedInstitutionFeeInput,
    | "fee_name"
    | "fee_category"
    | "amount"
    | "review_status"
    | "extraction_confidence"
    | "source_url"
  >[];
  indexEntries: Pick<
    IndexEntry,
    | "fee_category"
    | "median_amount"
    | "p25_amount"
    | "p75_amount"
    | "institution_count"
    | "maturity_tier"
  >[];
  evidencePolicy?: string | null;
  limit?: number;
}): SelectedInstitutionFeeDelta[] {
  const indexByCategory = new Map(
    params.indexEntries
      .filter((entry) => entry.median_amount !== null)
      .map((entry) => [entry.fee_category, entry]),
  );
  const verifiedOnly = params.evidencePolicy === "verified-only";

  return collapseToCategoryValues(
    params.selectedFees
      .filter((fee) => fee.review_status !== "rejected")
      .filter((fee) => !verifiedOnly || fee.review_status === "approved"),
  )
    .map((fee) => {
      const category = fee.fee_category;
      const institutionAmount = toNumber(fee.amount);
      const indexEntry = category ? indexByCategory.get(category) : undefined;
      const peerMedian = toNumber(indexEntry?.median_amount);
      if (!category || institutionAmount === null || peerMedian === null) return null;
      const delta = Math.round((institutionAmount - peerMedian) * 100) / 100;
      const deltaPercent =
        peerMedian === 0
          ? null
          : Math.round(((delta / peerMedian) * 100) * 10) / 10;
      const evidenceTier = fee.review_status === "approved" ? "verified" : "provisional";

      return {
        fee_name: fee.fee_name,
        fee_category: category,
        institution_amount: institutionAmount,
        peer_median: peerMedian,
        peer_p25: toNumber(indexEntry?.p25_amount),
        peer_p75: toNumber(indexEntry?.p75_amount),
        delta_amount: delta,
        delta_percent: deltaPercent,
        position: classifyDelta(delta),
        evidence_tier: evidenceTier,
        excluded_from_verified_benchmark: evidenceTier !== "verified",
        institution_count: Number(indexEntry?.institution_count ?? 0),
        maturity: indexEntry?.maturity_tier ?? "insufficient",
        confidence: toNumber(fee.extraction_confidence),
        source_url: fee.source_url ?? null,
      } satisfies SelectedInstitutionFeeDelta;
    })
    .filter((delta): delta is SelectedInstitutionFeeDelta => delta !== null)
    .sort((a, b) => Math.abs(b.delta_amount) - Math.abs(a.delta_amount))
    .slice(0, params.limit ?? 12);
}

/**
 * One value per category for the selected institution, as the statistics contract
 * counts it: the median of its amounts (overdraft's highest tier). Verified (approved) rows win over provisional
 * ones; variants are folded into the first fee name.
 */
function collapseToCategoryValues<T extends SelectedInstitutionFeeInput>(fees: T[]): T[] {
  const byCategory = new Map<string, T[]>();
  const uncategorized: T[] = [];
  for (const fee of fees) {
    if (!fee.fee_category || toNumber(fee.amount) === null) {
      uncategorized.push(fee);
      continue;
    }
    const group = byCategory.get(fee.fee_category);
    if (group) group.push(fee);
    else byCategory.set(fee.fee_category, [fee]);
  }
  const collapsed: T[] = [];
  for (const group of byCategory.values()) {
    const approved = group.filter((fee) => fee.review_status === "approved");
    const used = approved.length > 0 ? approved : group;
    const amounts = used.map((fee) => toNumber(fee.amount) as number);
    const first = used[0];
    const confidences = used.map((fee) => toNumber(fee.extraction_confidence)).filter((c): c is number => c !== null);
    collapsed.push({
      ...first,
      fee_name: used.length > 1 ? `${first.fee_name} (${used.length} variants)` : first.fee_name,
      amount: Math.round(institutionValue(first.fee_category, amounts) * 100) / 100,
      extraction_confidence: confidences.length > 0 ? Math.max(...confidences) : first.extraction_confidence ?? null,
      source_url: used.find((fee) => fee.source_url)?.source_url ?? null,
    });
  }
  return [...collapsed, ...uncategorized];
}

export function buildReportPeerCoveragePreview(params: {
  hasSelectedInstitution: boolean;
  selectedFees: Pick<
    SelectedInstitutionFeeInput,
    | "fee_name"
    | "fee_category"
    | "amount"
    | "review_status"
    | "extraction_confidence"
    | "source_url"
  >[];
  indexEntries: Pick<
    IndexEntry,
    | "fee_category"
    | "median_amount"
    | "p25_amount"
    | "p75_amount"
    | "institution_count"
    | "maturity_tier"
  >[];
  evidencePolicy?: string | null;
  peerBaselineSource?: string | null;
  peerBaselineLabel?: string | null;
  peerFallbackReason?: string | null;
  pipelineFeeCount?: number | null;
  focusCategory?: string | null;
}): ReportPeerCoveragePreview {
  const evidencePolicy = params.evidencePolicy ?? "provisional-first";
  const selectedVisibleFees = params.selectedFees.filter((fee) => fee.review_status !== "rejected");
  const selectedVerifiedFeeCount = selectedVisibleFees.filter(
    (fee) => fee.review_status === "approved",
  ).length;
  const selectedProvisionalFeeCount = selectedVisibleFees.length - selectedVerifiedFeeCount;
  const selectedFeeDeltas = buildSelectedInstitutionFeeDeltas({
    selectedFees: selectedVisibleFees,
    indexEntries: params.indexEntries,
    evidencePolicy,
  });
  const selectedVerifiedFeeDeltaCount = selectedFeeDeltas.filter(
    (delta) => delta.evidence_tier === "verified",
  ).length;
  const selectedProvisionalFeeDeltaCount = selectedFeeDeltas.length - selectedVerifiedFeeDeltaCount;
  const usablePeerCategoryCount = params.indexEntries.filter(
    (entry) => entry.median_amount !== null && entry.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN,
  ).length;
  const focusEntry = params.focusCategory
    ? params.indexEntries.find((entry) => entry.fee_category === params.focusCategory)
    : null;
  const focusCategoryCovered = focusEntry
    ? focusEntry.median_amount !== null && focusEntry.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN
    : params.focusCategory
      ? false
      : null;
  const focusCategoryPeerInstitutionCount = focusEntry
    ? Number(focusEntry.institution_count ?? 0)
    : null;
  const pipelineFeeCount = Number(params.pipelineFeeCount ?? 0);
  const hasInstitutionEvidence =
    selectedVisibleFees.length > 0 || pipelineFeeCount > 0;

  const readiness: ReportPeerCoverageReadiness = (() => {
    if (!params.hasSelectedInstitution) return "peer_index_only";
    if (selectedVerifiedFeeDeltaCount > 0) return "verified_comparison_ready";
    if (selectedFeeDeltas.length > 0) return "directional_comparison_ready";
    if (hasInstitutionEvidence) return "source_diligence";
    return "source_needed";
  })();

  const readinessCopy: Record<
    ReportPeerCoverageReadiness,
    { label: string; detail: string }
  > = {
    verified_comparison_ready: {
      label: "Verified comparisons ready",
      detail: "Selected-institution approved fee rows can be compared against the verified peer baseline.",
    },
    directional_comparison_ready: {
      label: "Directional only",
      detail: "Selected-institution fee deltas are available, but none are approved for verified benchmark scoring.",
    },
    peer_index_only: {
      label: "Peer index ready",
      detail: "No selected institution is attached; the report can use verified peer index coverage only.",
    },
    source_diligence: {
      label: "Diligence brief",
      detail: "Selected-institution evidence exists, but Hamilton cannot compute fee deltas against the selected peer baseline.",
    },
    source_needed: {
      label: "Source needed",
      detail: "No selected-institution fee evidence is available for competitive conclusions.",
    },
  };

  return {
    readiness,
    readinessLabel: readinessCopy[readiness].label,
    readinessDetail: readinessCopy[readiness].detail,
    evidencePolicy,
    peerBaselineSource: params.peerBaselineSource ?? null,
    peerBaselineLabel: params.peerBaselineLabel ?? null,
    peerFallbackReason: params.peerFallbackReason ?? null,
    usablePeerCategoryCount,
    focusCategoryCovered,
    focusCategoryPeerInstitutionCount,
    selectedVerifiedFeeCount,
    selectedProvisionalFeeCount,
    selectedFeeDeltaCount: selectedFeeDeltas.length,
    selectedVerifiedFeeDeltaCount,
    selectedProvisionalFeeDeltaCount,
    canGenerateSelectedInstitutionBenchmarkConclusions:
      selectedVerifiedFeeDeltaCount > 0,
  };
}
