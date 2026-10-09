import type { FeePublicationStatus } from "@/lib/institution-quality";
import type { HamiltonEvidencePolicy } from "@/lib/hamilton/request-contract";
import type { SelectedInstitutionFeeDelta, UnlikeFeeComparison } from "@/lib/hamilton/report-evidence";

export interface ReportSynthesisInstitutionInput {
  id: number;
  institution_name: string;
  fee_publication_status?: FeePublicationStatus | null;
  insight_readiness?: string | null;
  confidence_summary?: string | null;
  published_fee_count?: number | null;
  provisional_fee_count?: number | null;
  latest_source_status?: string | null;
}

export interface ReportSynthesisFinancialInput {
  report_date: string | null;
  /** fdic/ncua rows are in thousands; ffiec rows use other scales and are not accepted here. */
  source?: string | null;
  total_assets: number | null;
  total_deposits: number | null;
  service_charge_income: number | null;
  total_revenue: number | null;
  fee_income_ratio: number | null;
  roa: number | null;
}

export interface ReportSynthesisFeeInput {
  fee_name: string;
  fee_category?: string | null;
  amount: number | null;
  frequency?: string | null;
  review_status: string;
  extraction_confidence?: number | null;
  source_url?: string | null;
}

export interface ReportSynthesisPipelineFeeInput {
  fee_name: string;
  canonical_fee_key?: string | null;
  amount: number | null;
  frequency?: string | null;
  review_status?: string | null;
  extraction_confidence?: number | null;
  source_url?: string | null;
}

export interface ReportSynthesisRawFeeInput {
  fee_name: string;
  amount: number | null;
  frequency?: string | null;
  extraction_confidence?: number | null;
  source_url?: string | null;
}

export interface ReportSynthesisEvidenceInput {
  verified_fee_preview?: ReportSynthesisPipelineFeeInput[] | null;
  raw_fee_preview?: ReportSynthesisRawFeeInput[] | null;
  pipeline_counts?: unknown | null;
}

export interface ReportSynthesisPeerContextInput {
  label: string;
  source: string;
  filters: unknown;
  peerSetId: string | null;
  fallbackReason: string | null;
}

/** Call Report figures as a customer reads them: whole dollars and percents. */
export interface CustomerFinancials {
  report_date: string | null;
  total_assets_dollars: number | null;
  total_deposits_dollars: number | null;
  service_charge_income_dollars: number | null;
  total_revenue_dollars: number | null;
  fee_income_ratio_pct: number | null;
  roa_pct: number | null;
}

export interface SelectedInstitutionReportData {
  id: number;
  name: string;
  confidence_summary: string | null;
  verified_fee_count: number;
  provisional_fee_count: number;
  financials: CustomerFinancials | null;
  fee_rows: Array<{
    fee_name: string;
    fee_category: string | null;
    amount: number | null;
    frequency: string | null;
    evidence_tier: "verified" | "provisional";
    excluded_from_verified_benchmark: boolean;
  }>;
  /** Fees read from the schedule but not yet confirmed; directional only. */
  fees_under_review: Array<{
    fee_name: string;
    fee_category: string | null;
    amount: number | null;
    frequency: string | null;
    evidence_tier: "provisional";
  }>;
  fee_peer_deltas: Array<Omit<SelectedInstitutionFeeDelta, "confidence">>;
  /** Fees whose peer comparison is not like for like (business schedule or another charge basis). */
  fee_comparisons_not_like_for_like: UnlikeFeeComparison[];
  benchmark_scope: string;
  peer_group_note: string | null;
  can_generate_verified_benchmark_conclusions: boolean;
  revenue_trend: Array<Record<string, unknown>>;
  peer_ranking: Record<string, unknown> | null;
}

export function buildSelectedInstitutionReportRules(params: {
  institutionId?: number | null;
}): string {
  if (!params.institutionId) return "";

  return `

SELECTED-INSTITUTION RULES:
1. Use selected_institution.fee_peer_deltas as the primary competitive-positioning evidence. These deltas are computed before generation from the selected institution's fee rows and the selected verified peer baseline.
2. If fee_peer_deltas is empty, do not write benchmark conclusions or pricing recommendations. Return a diligence/readiness explanation instead.
3. Provisional rows are directional only. When evidence_tier is provisional or excluded_from_verified_benchmark is true, label the conclusion as provisional and do not treat it as a verified benchmark score.
4. Do not convert national category medians into selected-institution recommendations unless selected_institution.fee_peer_deltas contains a matching selected institution row.
5. selected_institution.fee_comparisons_not_like_for_like lists fees charged on another basis or schedule than the peers' (for example per item against a monthly median, or a business schedule against consumer peers). For these, say the comparison is not like for like and give no above or below position.
6. Dollar figures in selected_institution are whole dollars and ratios are percents; quote them as given. Never describe data collection, sources, review steps, duplicates or reconciliation work: if evidence is thin, say so in one sentence about confidence.
`.trim();
}

export function buildSelectedInstitutionReportData(params: {
  selectedInstitution: ReportSynthesisInstitutionInput | null;
  latestFinancial: ReportSynthesisFinancialInput | null;
  selectedVisibleFees: ReportSynthesisFeeInput[];
  selectedEvidence: ReportSynthesisEvidenceInput | null;
  selectedFeeDeltas: SelectedInstitutionFeeDelta[];
  notLikeForLike?: UnlikeFeeComparison[];
  peerIndex: ReportSynthesisPeerContextInput;
  selectedRevenueTrend: unknown[];
  selectedPeerRanking: unknown;
  evidencePolicy: HamiltonEvidencePolicy;
}): SelectedInstitutionReportData | null {
  const selectedInstitution = params.selectedInstitution;
  if (!selectedInstitution) return null;

  const feesUnderReview = [
    ...(params.selectedEvidence?.verified_fee_preview ?? [])
      .filter((fee) => fee.review_status !== "rejected")
      .map((fee) => ({
        fee_name: fee.fee_name,
        fee_category: fee.canonical_fee_key ?? null,
        amount: fee.amount,
        frequency: fee.frequency ?? null,
        evidence_tier: "provisional" as const,
      })),
    ...(params.selectedEvidence?.raw_fee_preview ?? []).map((fee) => ({
      fee_name: fee.fee_name,
      fee_category: null,
      amount: fee.amount,
      frequency: fee.frequency ?? null,
      evidence_tier: "provisional" as const,
    })),
  ].slice(0, 25);

  return {
    id: selectedInstitution.id,
    name: selectedInstitution.institution_name,
    confidence_summary: selectedInstitution.confidence_summary ?? null,
    verified_fee_count: selectedInstitution.published_fee_count ?? 0,
    provisional_fee_count: selectedInstitution.provisional_fee_count ?? 0,
    financials: customerFinancials(params.latestFinancial),
    fee_rows: params.selectedVisibleFees.slice(0, 25).map((fee) => ({
      fee_name: fee.fee_name,
      fee_category: fee.fee_category ?? null,
      amount: fee.amount,
      frequency: fee.frequency ?? null,
      evidence_tier: fee.review_status === "approved" ? "verified" : "provisional",
      excluded_from_verified_benchmark: fee.review_status !== "approved",
    })),
    fees_under_review: feesUnderReview,
    fee_peer_deltas: params.selectedFeeDeltas.map(withoutConfidence),
    fee_comparisons_not_like_for_like: params.notLikeForLike ?? [],
    benchmark_scope: params.peerIndex.label,
    peer_group_note: params.peerIndex.fallbackReason,
    can_generate_verified_benchmark_conclusions: params.selectedFeeDeltas.some(
      (delta) => delta.evidence_tier === "verified",
    ),
    revenue_trend: params.selectedRevenueTrend.slice(0, 8).map(customerRevenueQuarter),
    peer_ranking: customerPeerRanking(params.selectedPeerRanking),
  };
}

function withoutConfidence(delta: SelectedInstitutionFeeDelta): Omit<SelectedInstitutionFeeDelta, "confidence"> {
  const rest: Partial<SelectedInstitutionFeeDelta> = { ...delta };
  delete rest.confidence;
  return rest as Omit<SelectedInstitutionFeeDelta, "confidence">;
}

const THOUSANDS = 1_000;

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function thousandsToDollars(value: unknown): number | null {
  const n = finiteNumber(value);
  return n === null ? null : Math.round(n * THOUSANDS);
}

/** A fraction (0.0239) as a one-decimal percent (2.4). */
function fractionToPct(value: unknown): number | null {
  const n = finiteNumber(value);
  return n === null ? null : Math.round(n * 1_000) / 10;
}

function customerFinancials(record: ReportSynthesisFinancialInput | null): CustomerFinancials | null {
  if (!record) return null;
  if (record.source && !["fdic", "ncua"].includes(record.source.toLowerCase())) return null;
  const roa = finiteNumber(record.roa);
  return {
    report_date: record.report_date,
    total_assets_dollars: thousandsToDollars(record.total_assets),
    total_deposits_dollars: thousandsToDollars(record.total_deposits),
    service_charge_income_dollars: thousandsToDollars(record.service_charge_income),
    total_revenue_dollars: thousandsToDollars(record.total_revenue),
    fee_income_ratio_pct: fractionToPct(record.fee_income_ratio),
    // roa is already a percent in fdic rows; zero is an NCUA placeholder.
    roa_pct: roa === null || roa === 0 ? null : Math.round(roa * 100) / 100,
  };
}

function customerRevenueQuarter(row: unknown): Record<string, unknown> {
  const quarter = (row ?? {}) as Record<string, unknown>;
  return {
    quarter: quarter.quarter ?? null,
    service_charge_income_dollars: thousandsToDollars(quarter.service_charge_income),
    fee_income_ratio_pct: fractionToPct(quarter.fee_income_ratio),
    yoy_change_pct: finiteNumber(quarter.yoy_change_pct),
  };
}

const PEER_TIER_LABELS: Record<string, string> = {
  micro: "institutions under $100M in assets",
  community: "institutions with $100M to $1B in assets",
  midsize: "institutions with $1B to $10B in assets",
  regional: "institutions with $10B to $250B in assets",
  mega: "institutions over $250B in assets",
};

function customerPeerRanking(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const ranking = value as Record<string, unknown>;
  const tier = typeof ranking.tier === "string" ? ranking.tier : null;
  return {
    peer_group: tier ? PEER_TIER_LABELS[tier] ?? "institutions of similar size" : null,
    service_charge_income_dollars: thousandsToDollars(ranking.sc_income),
    rank: finiteNumber(ranking.sc_rank),
    peer_count: finiteNumber(ranking.peer_count),
    peer_median_service_charge_income_dollars: thousandsToDollars(ranking.peer_median_sc),
    fee_income_ratio_pct: fractionToPct(ranking.fee_income_ratio),
    peer_median_fee_income_ratio_pct: fractionToPct(ranking.peer_median_fee_ratio),
  };
}

/** The fields of a state expert summary a report uses (see agents/hamilton/state-expert-summary). */
export interface StateExpertSummaryInput {
  stateCode: string;
  stateName: string | null;
  expertName: string;
  institutionCount: number;
  publishedFeeCount: number;
  peerLevels: Array<{ canonicalFeeKey: string; p25: number; median: number; p75: number; count: number }>;
  notableOutliers: Array<{
    institutionId: number;
    canonicalFeeKey: string;
    amount: number;
    peerMedian: number;
    peerCount: number;
  }>;
}

export interface StateExpertReportData {
  state_code: string;
  state_name: string | null;
  state_expert: string;
  institutions_in_state: number;
  published_fees_in_state: number;
  /** The selected institution's fees against the same fee's in-state levels. */
  state_fee_deltas: Array<{
    fee_name: string;
    fee_category: string;
    institution_amount: number;
    state_median: number;
    state_p25: number;
    state_p75: number;
    state_institution_count: number;
    position: "above_state_median" | "below_state_median" | "at_state_median";
  }>;
  /** The state's best-covered fee levels. */
  state_levels: Array<{ fee_category: string; median: number; p25: number; p75: number; institution_count: number }>;
  /** The selected institution's fees Darwin held as far outside their state peers. */
  selected_institution_state_outliers: Array<{
    fee_category: string;
    amount: number;
    state_median: number;
    state_peer_count: number;
  }>;
}

const STATE_LEVELS_IN_REPORT = 10;

/**
 * The state expert's view for a report on one institution: its fees against in-state
 * levels, the state's best-covered levels, and its own state outliers. Null when the
 * state has no levels with enough peers.
 */
export function buildStateExpertReportData(params: {
  summary: StateExpertSummaryInput | null;
  selectedInstitutionId: number | null;
  selectedFeeDeltas: Pick<SelectedInstitutionFeeDelta, "fee_name" | "fee_category" | "institution_amount">[];
}): StateExpertReportData | null {
  const summary = params.summary;
  if (!summary || summary.peerLevels.length === 0) return null;
  const levels = new Map(summary.peerLevels.map((level) => [level.canonicalFeeKey, level]));

  const stateFeeDeltas = params.selectedFeeDeltas.flatMap((delta) => {
    const level = levels.get(delta.fee_category);
    if (!level) return [];
    const gap = delta.institution_amount - level.median;
    const position: StateExpertReportData["state_fee_deltas"][number]["position"] =
      Math.abs(gap) < 0.01 ? "at_state_median" : gap > 0 ? "above_state_median" : "below_state_median";
    return [{
      fee_name: delta.fee_name,
      fee_category: delta.fee_category,
      institution_amount: delta.institution_amount,
      state_median: level.median,
      state_p25: level.p25,
      state_p75: level.p75,
      state_institution_count: level.count,
      position,
    }];
  });

  return {
    state_code: summary.stateCode,
    state_name: summary.stateName,
    state_expert: summary.expertName,
    institutions_in_state: summary.institutionCount,
    published_fees_in_state: summary.publishedFeeCount,
    state_fee_deltas: stateFeeDeltas,
    state_levels: summary.peerLevels.slice(0, STATE_LEVELS_IN_REPORT).map((level) => ({
      fee_category: level.canonicalFeeKey,
      median: level.median,
      p25: level.p25,
      p75: level.p75,
      institution_count: level.count,
    })),
    selected_institution_state_outliers: summary.notableOutliers
      .filter((outlier) => outlier.institutionId === params.selectedInstitutionId)
      .map((outlier) => ({
        fee_category: outlier.canonicalFeeKey,
        amount: outlier.amount,
        state_median: outlier.peerMedian,
        state_peer_count: outlier.peerCount,
      })),
  };
}

export const STATE_EXPERT_REPORT_RULES = `
STATE PEER RULES:
1. state_peers holds in-state fee levels from the state expert. Use state_peers.state_fee_deltas to say where the institution sits against banks and credit unions in its own state, citing the state median and the number of institutions behind it.
2. When the state position differs from the peer-baseline position (above one median, below the other), say so; that difference is the local competitive read.
3. Fees in selected_institution_state_outliers are far outside in-state peers. Name them as the institution's most exposed prices.
`.trim();
