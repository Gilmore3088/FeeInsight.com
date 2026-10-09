import type { CategoryChargeBasis, IndexEntry } from "@/lib/data-store/fee-index";

export type { CategoryChargeBasis };
import { institutionValue, MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/fee-stats";
import { isBusinessOnlyLink } from "@/lib/agents/magellan/link-coverage";
import { frequencyFamily } from "@/lib/fee-frequency";

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

/** A basis is the category's own when at least this share of peers' stated rows carry it. */
export const CHARGE_BASIS_MIN_SHARE = 0.8;
/** Below this many stated peer rows the basis is unknown, and frequency is not checked. */
export const CHARGE_BASIS_MIN_ROWS = 20;

/** A fee left out of the peer comparison because the two sides are not charged alike. */
export interface UnlikeFeeComparison {
  fee_name: string;
  fee_category: string;
  institution_amount: number;
  reason: "business_schedule" | "different_charge_basis" | "mixed_peer_basis";
  detail: string;
}

const BASIS_WORDS: Record<string, string> = {
  per_item: "per item",
  monthly: "monthly",
  annual: "annually",
  quarterly: "quarterly",
  daily: "daily",
  weekly: "weekly",
};

function basisWords(family: string): string {
  return BASIS_WORDS[family] ?? family.replace(/_/g, " ");
}

interface SelectedInstitutionFeeInput {
  fee_name: string;
  fee_category?: string | null;
  amount: number | null;
  frequency?: string | null;
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

type SelectedFeeComparisonParams = {
  selectedFees: Pick<
    SelectedInstitutionFeeInput,
    | "fee_name"
    | "fee_category"
    | "amount"
    | "review_status"
    | "extraction_confidence"
    | "source_url"
    | "frequency"
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
  /** How peers charge each category; without it only the schedule (business) check applies. */
  chargeBases?: CategoryChargeBasis[] | null;
  evidencePolicy?: string | null;
  limit?: number;
};

export function buildSelectedInstitutionFeeDeltas(params: SelectedFeeComparisonParams): SelectedInstitutionFeeDelta[] {
  return compareSelectedInstitutionFees(params).deltas;
}

/**
 * The selected institution's fees against the peer median, like for like only. Peer medians
 * leave out business-only schedules (fee-stats rule 6) and pool each category's charge basis,
 * so the institution's value is taken from its consumer rows charged on the peers' basis
 * (a row with no stated frequency counts as that basis). A category the institution states
 * only on a business schedule or only on another basis, or one whose peers mix bases, is
 * listed in `notLikeForLike` instead of being given an above/below position.
 */
export function compareSelectedInstitutionFees(params: SelectedFeeComparisonParams): {
  deltas: SelectedInstitutionFeeDelta[];
  notLikeForLike: UnlikeFeeComparison[];
} {
  const indexByCategory = new Map(
    params.indexEntries
      .filter((entry) => entry.median_amount !== null)
      .map((entry) => [entry.fee_category, entry]),
  );
  const basisByCategory = new Map(
    (params.chargeBases ?? [])
      .filter((basis) => basis.stated_rows >= CHARGE_BASIS_MIN_ROWS)
      .map((basis) => [basis.fee_category, basis]),
  );
  const verifiedOnly = params.evidencePolicy === "verified-only";
  const visible = params.selectedFees
    .filter((fee) => fee.review_status !== "rejected")
    .filter((fee) => !verifiedOnly || fee.review_status === "approved");

  const byCategory = new Map<string, typeof visible>();
  for (const fee of visible) {
    if (!fee.fee_category || toNumber(fee.amount) === null || !indexByCategory.has(fee.fee_category)) continue;
    const group = byCategory.get(fee.fee_category);
    if (group) group.push(fee);
    else byCategory.set(fee.fee_category, [fee]);
  }

  const comparable: typeof visible = [];
  const notLikeForLike: UnlikeFeeComparison[] = [];
  for (const [category, group] of byCategory) {
    const unlike = (reason: UnlikeFeeComparison["reason"], detail: string, rows: typeof group) => {
      const [value] = collapseToCategoryValues(rows);
      notLikeForLike.push({
        fee_name: value.fee_name,
        fee_category: category,
        institution_amount: toNumber(value.amount) as number,
        reason,
        detail,
      });
    };
    const basis = basisByCategory.get(category) ?? null;
    if (basis && basis.share < CHARGE_BASIS_MIN_SHARE) {
      unlike(
        "mixed_peer_basis",
        `Peers charge this fee on more than one basis (${Math.round(basis.share * 100)}% ${basisWords(basis.family)}), so one median does not compare like for like.`,
        group,
      );
      continue;
    }
    const consumer = group.filter((fee) => !fee.source_url || !isBusinessOnlyLink(fee.source_url));
    if (consumer.length === 0) {
      unlike(
        "business_schedule",
        "Stated only on a business schedule; the peer median covers consumer schedules.",
        group,
      );
      continue;
    }
    const sameBasis = basis
      ? consumer.filter((fee) => {
          const family = frequencyFamily(fee.frequency);
          return family === null || family === basis.family;
        })
      : consumer;
    if (sameBasis.length === 0) {
      const family = frequencyFamily(consumer[0].frequency) as string;
      unlike(
        "different_charge_basis",
        `Charged ${basisWords(family)}; peers charge it ${basisWords(basis!.family)}.`,
        consumer,
      );
      continue;
    }
    comparable.push(...sameBasis);
  }

  const deltas = collapseToCategoryValues(comparable)
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

  return { deltas, notLikeForLike: notLikeForLike.slice(0, params.limit ?? 12) };
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
    | "frequency"
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
  chargeBases?: CategoryChargeBasis[] | null;
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
    chargeBases: params.chargeBases,
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
