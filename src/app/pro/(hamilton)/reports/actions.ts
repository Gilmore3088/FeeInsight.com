"use server";

import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import {
  getFeesByInstitution,
  getFinancialsByInstitution,
  getInstitutionById,
} from "@/lib/data-store";
import { sql } from "@/lib/data-store/connection";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/fee-stats";
import {
  getInstitutionPeerRanking,
  getInstitutionRevenueTrend,
} from "@/lib/data-store/call-reports";
import { getInstitutionFeeScheduleEvidence } from "@/lib/data-store/institution";
import { generateVerifiedSection, type VerifiedSectionOutput } from "@/lib/hamilton/generate";
import { checkProAiQuota, quotaExceededMessage } from "@/lib/hamilton/quota";
import { recordProRequest } from "@/lib/agents/run-store";
import { logUsage } from "@/lib/research/history";
import { estimateAnthropicCostMicrousd } from "@/lib/ai-provider-usage";
import { getHamiltonModel } from "@/lib/ai-provider";
import type { SectionInput } from "@/lib/hamilton/types";
import {
  buildReportPeerCoveragePreview,
  buildSelectedInstitutionFeeDeltas,
  type ReportPeerCoveragePreview,
} from "@/lib/hamilton/report-evidence";
import { buildInsufficientEvidenceReport } from "@/lib/hamilton/report-readiness";
import {
  buildSelectedInstitutionReportData,
  buildSelectedInstitutionReportRules,
  buildStateExpertReportData,
  STATE_EXPERT_REPORT_RULES,
} from "@/lib/hamilton/report-synthesis";
import { stateExpertSummary } from "@/lib/agents/hamilton/state-expert-summary";
import { validateHamiltonReportArtifact } from "@/lib/hamilton/report-quality";
import { resolveHamiltonPeerIndex } from "@/lib/hamilton/peer-index";
import { completeHamiltonRefreshJobsForInstitution } from "@/lib/hamilton/refresh-jobs";
import {
  saveHamiltonReport,
  getRecentHamiltonReports,
  getActiveScenarios,
  getHamiltonReportById,
  getHamiltonScenarioById,
} from "@/lib/hamilton/pro-tables";
import { formatAmount } from "@/lib/format";
import { getFeePublicationStatusLabel } from "@/lib/institution-quality";
import {
  getHamiltonContextSourceLabel,
  normalizeHamiltonContextSource,
  normalizeHamiltonPersistedContextSource,
  type HamiltonContextSource,
  type HamiltonPersistedContextSource,
} from "@/lib/hamilton/context-source";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import type { ReportArtifactMetadata, ReportSummaryResponse } from "@/lib/hamilton/types";
import type { HamiltonEvidencePolicy } from "@/lib/hamilton/request-contract";

export type ReportTemplateType =
  | "peer_benchmarking"
  | "regional_landscape"
  | "category_deep_dive"
  | "competitive_positioning";

export interface GenerateReportParams {
  templateType: ReportTemplateType;
  dateFrom: string;
  dateTo: string;
  peerSetId?: string;
  scenarioId?: string;
  focusCategory?: string;
  institutionId?: number;
  selectedInstitutionName?: string;
  evidencePolicy?: HamiltonEvidencePolicy;
  selectedSource?: HamiltonContextSource;
  selectedSourceLabel?: string | null;
  /** The Audience picker: shapes the narrative's register, never its figures. */
  narrativeTone?: ReportNarrativeTone;
}

export type ReportNarrativeTone = "consulting" | "academic" | "executive" | "technical";

const TONE_GUIDANCE: Record<ReportNarrativeTone, string> = {
  executive: "AUDIENCE: the board. Lead with the headline and the decision; keep it short; no methodology detail.",
  consulting: "AUDIENCE: the internal pricing team. Action-oriented; name the next step for each finding.",
  technical: "AUDIENCE: analysts. Data-first; state the sample size and maturity behind every benchmark.",
  academic: "AUDIENCE: research readers. Fuller context; explain the method and its limits.",
};

function withTone(context: string, tone: ReportNarrativeTone | undefined): string {
  return tone ? `${context}\n\n${TONE_GUIDANCE[tone] ?? ""}`.trim() : context;
}

export type GenerateReportResult =
  | {
      success: true;
      reportId: string;
      report: ReportSummaryResponse;
      artifactMetadata: ReportArtifactMetadata;
    }
  | {
      success: false;
      error: string;
    };

export interface PreviewReportPeerCoverageParams {
  templateType: ReportTemplateType;
  peerSetId?: string;
  focusCategory?: string;
  institutionId?: number;
  evidencePolicy?: HamiltonEvidencePolicy;
}

export type PreviewReportPeerCoverageResult =
  | {
      success: true;
      preview: ReportPeerCoveragePreview;
    }
  | {
      success: false;
      error: string;
    };

const TEMPLATE_TITLES: Record<ReportTemplateType, string> = {
  peer_benchmarking: "Peer Benchmarking Report",
  regional_landscape: "Regional Fee Landscape",
  category_deep_dive: "Category Deep Dive",
  competitive_positioning: "Competitive Positioning",
};

function formatSignedAmount(amount: number): string {
  const sign = amount >= 0 ? "+" : "-";
  return `${sign}${formatAmount(Math.abs(amount))}`;
}

function resolveReportSelectedSource(params: GenerateReportParams): {
  selectedSource: HamiltonPersistedContextSource;
  selectedSourceLabel: string | null;
} {
  const fallback: HamiltonPersistedContextSource = params.institutionId ? "manual" : "profile";
  const rawSource = normalizeHamiltonContextSource(params.selectedSource, fallback);
  const selectedSource = normalizeHamiltonPersistedContextSource(rawSource, fallback);
  return {
    selectedSource,
    selectedSourceLabel:
      rawSource === selectedSource && params.selectedSourceLabel
        ? params.selectedSourceLabel
        : getHamiltonContextSourceLabel(selectedSource),
  };
}

export async function previewReportPeerCoverage(
  params: PreviewReportPeerCoverageParams,
): Promise<PreviewReportPeerCoverageResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Authentication required" };
  if (!canAccessPremium(user)) return { success: false, error: "Pro subscription required" };

  try {
    const [selectedInstitution, selectedFees, selectedEvidence] = await Promise.all([
      params.institutionId ? getInstitutionById(params.institutionId).catch(() => null) : null,
      params.institutionId ? getFeesByInstitution(params.institutionId).catch(() => []) : [],
      params.institutionId
        ? getInstitutionFeeScheduleEvidence(params.institutionId).catch(() => null)
        : null,
    ]);

    if (params.institutionId && !selectedInstitution) {
      return { success: false, error: "Selected institution not found" };
    }

    const peerIndex = await resolveHamiltonPeerIndex({
      userId: user.id,
      peerSetId: params.peerSetId ?? null,
      selectedInstitution,
      approvedOnly: true,
      minUsableCategories: 3,
    });
    const pipelineCounts = selectedEvidence?.pipeline_counts ?? null;
    const pipelineFeeCount =
      Number(pipelineCounts?.raw_fee_count ?? 0) +
      Number(pipelineCounts?.verified_fee_count ?? 0);

    return {
      success: true,
      preview: buildReportPeerCoveragePreview({
        hasSelectedInstitution: Boolean(selectedInstitution),
        selectedFees,
        indexEntries: peerIndex.entries,
        evidencePolicy: params.evidencePolicy ?? "provisional-first",
        peerBaselineSource: peerIndex.source,
        peerBaselineLabel: peerIndex.label,
        peerFallbackReason: peerIndex.fallbackReason,
        pipelineFeeCount,
        focusCategory:
          params.templateType === "category_deep_dive"
            ? params.focusCategory ?? null
            : null,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Peer preview failed: ${message}` };
  }
}

/**
 * Build context string for the executive summary section by template type.
 * Each template type uses a different analytical lens.
 */
/**
 * Shared no-fluff rules. Same banned phrases + grounding requirements as
 * DECISION_POINT_RULES. The model can be funny in its choice of how to
 * express things — but it cannot be vague, can't invent numbers, and can't
 * reach for consultancy-speak when it has nothing to say.
 */
const NO_FLUFF_RULES = `
HARD RULES — fail any, rewrite the section:
1. Cite a specific dollar value, percentile, or fee category from the DATA payload at least twice. If the data is thin, write a shorter section saying only what is known.
2. NEVER cite a percentage, dollar amount, growth rate, or institution count absent from the DATA payload. Invented sources like "industry studies show" or "research indicates", and any range or percentage not in DATA, are forbidden.
3. Banned phrases (corporate-speak with no specific meaning): "strategic void", "must establish leadership", "deploying systematic intelligence", "data-sophisticated rivals", "revenue leakage", "willingness-to-pay", "dual strategy", "create sustainable competitive advantage", "market intelligence superiority", "precision pricing", "competitive positioning superiority". Banned even ironically.
4. Write in the active voice. Say who does what. Format only, with placeholders and not a fact: "[Competitor from DATA] charges \$[amount from DATA] for [fee]" — not "[fee] was raised".
5. State claims in positive form. Prefer "X outpaces Y" over "X is not below Y". Prefer "declined" over "did not increase".
6. Use definite, specific, concrete language. Format only: "\$[amount] [fee] at [institution] ([period])", every value taken from DATA — not "elevated fee structures at large banks recently".
7. Cut needless words. "In order to" → "to". "Due to the fact that" → "because". "At this point in time" → "now". "A large number of" → "many". If a word adds nothing, delete it.
8. Plain banker English. Short sentences. When you name a number, name what it is a number OF.
9. Place the sharpest fact at the end of the sentence — the emphatic position. End on the figure from DATA rather than a comment about it ("which is notable").
10. If a sentence could appear unchanged in any other bank's report, delete it.
`.trim();

function buildExecutiveSummaryContext(
  params: GenerateReportParams,
  institutionName: string,
  period: string
): string {
  const head = (() => {
    switch (params.templateType) {
      case "peer_benchmarking":
        return `Compare ${institutionName}'s fees to peers using the categories in the DATA payload. Lead with the 1–2 categories where the gap is largest (above or below peer median). Cite dollar figures from the payload. Period: ${period}.`;
      case "regional_landscape":
        return `Describe the regional fee pattern visible in the DATA payload. Lead with the single most striking geographic difference (e.g. "FL CU NSF median is \$28; national CU median is \$26"). Period: ${period}.`;
      case "category_deep_dive": {
        const cat = params.focusCategory
          ? params.focusCategory.replace(/_/g, " ")
          : "the focus category";
        return `Summarize the ${cat} distribution at ${institutionName}'s peer set. Lead with the median, the P25–P75 spread, and the number of institutions observed. Period: ${period}.`;
      }
      case "competitive_positioning":
        return `Assess competitive position across the categories in the DATA payload. Lead with the 1–2 categories where ${institutionName} is most exposed (highest variance from peer median). Period: ${period}.`;
    }
  })();

  return `${head}\n\n${NO_FLUFF_RULES}\n\n${buildSelectedInstitutionReportRules(params)}`.trim();
}

/**
 * Build context string for the strategic section by template type.
 */
function buildStrategicContext(
  params: GenerateReportParams,
  institutionName: string
): string {
  const head = (() => {
    switch (params.templateType) {
      case "peer_benchmarking":
        return `Explain WHY the peer gaps in the DATA payload exist for ${institutionName}. For each category in top_fees, cite the peer median + spread, then offer one observation about the gap (e.g. "P25 cluster at \$20 suggests overdraft-fee compression among CUs under \$5B"). Stop after 3 such observations.`;
      case "regional_landscape":
        return `Explain WHY the regional pattern in the DATA payload looks the way it does. Anchor each observation to a specific region or fee category from the payload. Stop after 3 observations.`;
      case "category_deep_dive": {
        const cat = params.focusCategory
          ? params.focusCategory.replace(/_/g, " ")
          : "the focus category";
        return `Explain WHY the ${cat} distribution looks the way it does for ${institutionName}'s peer set. Use the maturity field to flag where the sample is thin. Stop after 3 observations.`;
      }
      case "competitive_positioning":
        return `Explain WHY ${institutionName} sits where it does on the categories in top_fees. For each, cite the peer P25/median/P75 and identify whether it has pricing power, parity, or vulnerability. Stop after 3 categories.`;
    }
  })();

  return `${head}\n\n${NO_FLUFF_RULES}\n\n${buildSelectedInstitutionReportRules(params)}`.trim();
}

/**
 * Decision-point rules (layered on top of NO_FLUFF_RULES). Hamilton is decision support
 * (James, 2026-10-05 23:27 UTC): this section lays out what management could weigh and
 * what each option would do, and never says which to choose. An opinion is given only on
 * an explicit ask, through the Ask bar, with its objective named.
 */
const DECISION_POINT_RULES = `
${NO_FLUFF_RULES}

DECISION-POINT RULES:
6. Output AT MOST 3 decision points, largest distance from the peer median first. Generic advice about "establishing leadership" or "building frameworks" is forbidden.
7. Each decision point names (a) the fee category, (b) the institution's amount and the peer P25, median and P75 with the institution count from the DATA payload, and (c) the options management could weigh (keep the price, move toward a peer anchor, restructure the fee), each with one observable consequence (revenue direction, percentile shift, or customer and regulatory exposure). If you cannot ground a decision point in the DATA payload, omit it.
8. Never choose an option. Never tell the institution to raise, lower, hold, cut or drop a fee, and never write "we recommend" or "should". End each decision point with the question management faces.
9. If you can ground 0 or 1 decision points, return only that many. Better empty than meaningless.
`.trim();

function buildRecommendationContext(
  params: GenerateReportParams,
  institutionName: string
): string {
  const head = (() => {
    switch (params.templateType) {
      case "peer_benchmarking":
        return `Lay out up to 3 fee decision points for ${institutionName}, each anchored to a peer-median or P75 figure from the DATA payload. Order by distance from the peer median, largest first.`;
      case "regional_landscape":
        return `Lay out up to 3 regional decision points for ${institutionName}, each tied to a specific market position visible in the DATA payload (e.g. "FL CU median is $X, ${institutionName} sits at $Y").`;
      case "category_deep_dive": {
        const cat = params.focusCategory
          ? params.focusCategory.replace(/_/g, " ")
          : "the focus category";
        return `Lay out up to 3 decision points for ${institutionName} in the ${cat} category. Each must name the current peer P25/median/P75 anchor and what keeping, moving toward an anchor, or restructuring the fee would change.`;
      }
      case "competitive_positioning":
        return `Lay out up to 3 positioning decision points for ${institutionName}, starting with the categories furthest from the peer median in the DATA payload.`;
    }
  })();

  return `${head}\n\n${DECISION_POINT_RULES}\n\n${buildSelectedInstitutionReportRules(params)}`.trim();
}

/**
 * Get the SectionType for the strategic section based on template.
 */
function getStrategicSectionType(
  templateType: ReportTemplateType
): "peer_comparison" | "regional_analysis" | "trend_analysis" | "peer_competitive" {
  switch (templateType) {
    case "peer_benchmarking":
      return "peer_comparison";
    case "regional_landscape":
      return "regional_analysis";
    case "category_deep_dive":
      return "trend_analysis";
    case "competitive_positioning":
      return "peer_competitive";
  }
}

/**
 * Generate a Hamilton report from a template and configuration.
 * Assembles fee data, calls generateSection() for key sections,
 * saves to hamilton_reports, and returns the assembled report.
 */
export async function generateReport(
  params: GenerateReportParams
): Promise<GenerateReportResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Authentication required" };
  // generateSection() below makes paid model calls: Pro only.
  if (!canAccessPremium(user)) return { success: false, error: "Pro subscription required" };

  try {
    // 1. Fetch selected institution data as grounding for Hamilton
    const [
      selectedInstitution,
      selectedFees,
      selectedFinancials,
      selectedRevenueTrend,
      selectedPeerRanking,
      selectedEvidence,
    ] = await Promise.all([
      params.institutionId ? getInstitutionById(params.institutionId).catch(() => null) : null,
      params.institutionId ? getFeesByInstitution(params.institutionId).catch(() => []) : [],
      params.institutionId ? getFinancialsByInstitution(params.institutionId).catch(() => []) : [],
      params.institutionId ? getInstitutionRevenueTrend(params.institutionId).catch(() => []) : [],
      params.institutionId ? getInstitutionPeerRanking(params.institutionId).catch(() => null) : null,
      params.institutionId ? getInstitutionFeeScheduleEvidence(params.institutionId).catch(() => null) : null,
    ]);
    const peerIndex = await resolveHamiltonPeerIndex({
      userId: user.id,
      peerSetId: params.peerSetId ?? null,
      selectedInstitution,
      approvedOnly: true,
      minUsableCategories: 3,
    });
    const indexData = peerIndex.entries;
    const allCategories = indexData.filter((e) => e.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN);

    // For category_deep_dive, filter to focus category if provided
    const topCategories =
      params.templateType === "category_deep_dive" && params.focusCategory
        ? allCategories
            .filter((e) => e.fee_category === params.focusCategory)
            .concat(allCategories.filter((e) => e.fee_category !== params.focusCategory).slice(0, 9))
            .slice(0, 10)
        : allCategories.slice(0, 15);

    const institutionName =
      selectedInstitution?.institution_name ??
      params.selectedInstitutionName ??
      user.institution_name ??
      "Your Institution";
    const reportTitle = `${TEMPLATE_TITLES[params.templateType]} - ${institutionName} - ${params.dateFrom} to ${params.dateTo}`;
    const period = `${params.dateFrom} to ${params.dateTo}`;
    const selectedVisibleFees = selectedFees.filter((fee) => fee.review_status !== "rejected");
    const selectedVerifiedFees = selectedVisibleFees.filter((fee) => fee.review_status === "approved");
    const selectedProvisionalFees = selectedVisibleFees.filter((fee) => fee.review_status !== "approved");
    const evidencePolicy = params.evidencePolicy ?? "provisional-first";
    const selectedSourceContext = resolveReportSelectedSource(params);
    const selectedFeeDeltas = buildSelectedInstitutionFeeDeltas({
      selectedFees: selectedVisibleFees,
      indexEntries: indexData,
      evidencePolicy,
    });
    const pipelineCounts = selectedEvidence?.pipeline_counts ?? null;
    const pipelineFeeCount =
      Number(pipelineCounts?.raw_fee_count ?? 0) +
      Number(pipelineCounts?.verified_fee_count ?? 0);
    const hasSelectedInstitutionEvidence =
      selectedVerifiedFees.length > 0 ||
      selectedProvisionalFees.length > 0 ||
      pipelineFeeCount > 0;
    // ffiec rows duplicate fdic quarters at other scales; reports read the thousands-scale sources.
    const latestFinancial = selectedFinancials.find((record) => record.source !== "ffiec") ?? null;

    if (
      params.institutionId &&
      selectedInstitution &&
      (!hasSelectedInstitutionEvidence || selectedFeeDeltas.length === 0)
    ) {
      const report = buildInsufficientEvidenceReport({
        institutionName,
        period,
        statusLabel: getFeePublicationStatusLabel(
          selectedInstitution.fee_publication_status ?? "unavailable",
        ),
        verifiedCount: selectedInstitution.published_fee_count ?? 0,
        provisionalCount: selectedInstitution.provisional_fee_count ?? 0,
        assetSize: selectedInstitution.asset_size,
        latestSourceStatus: selectedInstitution.latest_source_status ?? null,
        latestFinancial: latestFinancial
          ? {
              report_date: latestFinancial.report_date,
              total_assets: latestFinancial.total_assets,
              service_charge_income: latestFinancial.service_charge_income,
            }
          : null,
      });
      const artifactMetadata: ReportArtifactMetadata = {
        evidencePolicy: selectedFeeDeltas.length > 0 ? evidencePolicy : "source-diligence",
        selectedSource: selectedSourceContext.selectedSource,
        selectedSourceLabel: selectedSourceContext.selectedSourceLabel,
        peerSetId: peerIndex.peerSetId,
        peerBaselineSource: peerIndex.source,
        peerBaselineLabel: peerIndex.label,
        peerFallbackReason: peerIndex.fallbackReason,
        selectedVerifiedFeeCount: selectedVerifiedFees.length,
        selectedProvisionalFeeCount: selectedProvisionalFees.length,
        selectedFeeDeltaCount: selectedFeeDeltas.length,
      };
      const reportId = await saveHamiltonReport({
        userId: user.id,
        institutionId: selectedInstitution.id.toString(),
        reportType: params.templateType,
        reportJson: report,
        scenarioId: params.scenarioId ?? null,
        evidencePolicy: artifactMetadata.evidencePolicy,
        peerSetId: artifactMetadata.peerSetId,
        peerBaselineSource: artifactMetadata.peerBaselineSource,
        peerBaselineLabel: artifactMetadata.peerBaselineLabel,
        peerFallbackReason: artifactMetadata.peerFallbackReason,
        selectedSource: artifactMetadata.selectedSource,
        selectedSourceLabel: artifactMetadata.selectedSourceLabel,
        selectedVerifiedFeeCount: artifactMetadata.selectedVerifiedFeeCount,
        selectedProvisionalFeeCount: artifactMetadata.selectedProvisionalFeeCount,
        selectedFeeDeltaCount: artifactMetadata.selectedFeeDeltaCount,
      });
      await completeHamiltonRefreshJobsForInstitution({
        institutionId: selectedInstitution.id,
        jobTypes: ["report_refresh", "watchlist_review"],
        completedByUserId: user.id,
      }).catch(() => {});
      return { success: true, reportId, report, artifactMetadata };
    }

    const selectedInstitutionData = buildSelectedInstitutionReportData({
      selectedInstitution,
      latestFinancial: latestFinancial
        ? {
            report_date: latestFinancial.report_date,
            source: latestFinancial.source,
            total_assets: latestFinancial.total_assets,
            total_deposits: latestFinancial.total_deposits,
            service_charge_income: latestFinancial.service_charge_income,
            total_revenue: latestFinancial.total_revenue,
            fee_income_ratio: latestFinancial.fee_income_ratio,
            roa: latestFinancial.roa,
          }
        : null,
      selectedVisibleFees,
      selectedEvidence,
      selectedFeeDeltas,
      peerIndex,
      selectedRevenueTrend,
      selectedPeerRanking,
      evidencePolicy,
    });
    // The state expert's in-state levels for this institution (Postgres reads only).
    const statePeers = buildStateExpertReportData({
      summary: selectedInstitution?.state_code
        ? await stateExpertSummary(selectedInstitution.state_code).catch(() => null)
        : null,
      selectedInstitutionId: selectedInstitution?.id ?? null,
      selectedFeeDeltas,
    });
    const withStateRules = (context: string) =>
      statePeers ? `${context}\n\n${STATE_EXPERT_REPORT_RULES}` : context;

    // 2-4. Generate the three sections in parallel — they're independent
    // (no shared state, no ordering constraint). Was sequential and took
    // ~28s total; parallel cuts to ~10s (longest single call wins).
    const strategicSectionType = getStrategicSectionType(params.templateType);
    const sectionInputs: SectionInput[] = [
      {
        type: "executive_summary",
        title: "Executive Summary",
        data: {
          report_type: params.templateType,
          period,
          institution_name: institutionName,
          selected_institution: selectedInstitutionData,
          state_peers: statePeers,
          focus_category: params.focusCategory ?? null,
          categories: topCategories.map((c) => ({
            fee_category: c.fee_category,
            median_amount: c.median_amount,
            p25_amount: c.p25_amount,
            p75_amount: c.p75_amount,
            institution_count: c.institution_count,
            maturity: c.maturity_tier,
          })),
        },
        context: withTone(withStateRules(buildExecutiveSummaryContext(params, institutionName, period)), params.narrativeTone),
      },
      {
        type: strategicSectionType,
        title: "Strategic Analysis",
        data: {
          report_type: params.templateType,
          period,
          institution_name: institutionName,
          selected_institution: selectedInstitutionData,
          state_peers: statePeers,
          focus_category: params.focusCategory ?? null,
          top_fees: topCategories.slice(0, 5).map((c) => ({
            fee_category: c.fee_category,
            median_amount: c.median_amount,
            p25_amount: c.p25_amount,
            p75_amount: c.p75_amount,
            institution_count: c.institution_count,
          })),
        },
        context: withTone(withStateRules(buildStrategicContext(params, institutionName)), params.narrativeTone),
      },
      {
        type: "recommendation",
        title: "For management to weigh",
        // Pass actual peer-anchored fee data so the model can lay out
        // specific decision points instead of consultancy fluff. The
        // DECISION_POINT_RULES context block forbids inventing figures
        // not present in this payload, and forbids choosing an option.
        data: {
          report_type: params.templateType,
          institution_name: institutionName,
          period,
          selected_institution: selectedInstitutionData,
          state_peers: statePeers,
          focus_category: params.focusCategory ?? null,
          peer_anchored_fees: selectedInstitution
            ? selectedFeeDeltas.slice(0, 5)
            : topCategories.slice(0, 5).map((c) => ({
                fee_category: c.fee_category,
                peer_median: c.median_amount,
                peer_p25: c.p25_amount,
                peer_p75: c.p75_amount,
                institution_count: c.institution_count,
                maturity: c.maturity_tier,
              })),
        },
        context: withTone(withStateRules(buildRecommendationContext(params, institutionName)), params.narrativeTone),
      },
    ];

    // Sections are independent: run them together, retry only a section that failed,
    // so one provider hiccup never discards (and re-bills) the sections that worked.
    // Paid model calls from here on: enforce the daily quota, and record the outcome
    // (one usage row per report, one pro_request run in the ledger) however it ends.
    const quota = await checkProAiQuota(user);
    if (!quota.allowed) return { success: false, error: quotaExceededMessage(quota) };
    const ledgerBase = {
      userId: user.id,
      institutionId: selectedInstitution?.id ?? null,
      title: `Hamilton report: ${reportTitle}`,
    };
    const recordReportOutcome = async (
      status: "completed" | "failed",
      summary: string,
      sections: VerifiedSectionOutput[],
      extra: Record<string, unknown> = {},
    ) => {
      const inputTokens = sections.reduce((sum, item) => sum + (item.section.usage?.inputTokens ?? 0), 0);
      const outputTokens = sections.reduce((sum, item) => sum + (item.section.usage?.outputTokens ?? 0), 0);
      const model = sections[0]?.section.model ?? getHamiltonModel();
      const costMicrousd = estimateAnthropicCostMicrousd(model, { inputTokens, outputTokens }) ?? 0;
      await logUsage(user.id, null, "hamilton-report", inputTokens, outputTokens, Math.round(costMicrousd / 10_000)).catch(() => {});
      await recordProRequest({
        ...ledgerBase,
        operation: "report",
        status,
        summary,
        detail: {
          template: params.templateType,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_microusd: costMicrousd,
          sections: sections.map((item) => ({ words: item.section.wordCount, status: item.status })),
          ...extra,
        },
      });
    };

    const settled = await Promise.allSettled(sectionInputs.map((input) => generateVerifiedSection(input)));
    const verifiedSections: VerifiedSectionOutput[] = [];
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "fulfilled") {
        verifiedSections.push(outcome.value);
        continue;
      }
      try {
        verifiedSections.push(await generateVerifiedSection(sectionInputs[index]));
      } catch {
        await recordReportOutcome("failed", `Section "${sectionInputs[index].title}" failed after a retry.`, verifiedSections);
        return {
          success: false,
          error: `Hamilton couldn't write the ${sectionInputs[index].title} section right now. Please try again in a minute.`,
        };
      }
    }

    // Every $ and % in the narrative must trace to the data the model was given.
    const unverified = verifiedSections.flatMap((result) => (result.status === "needs_review" ? result.unmatched : []));
    if (unverified.length > 0) {
      await recordReportOutcome("failed", "Report not saved: figures could not be traced to the data.", verifiedSections, {
        unverified_figures: [...new Set(unverified)],
      });
      return {
        success: false,
        error:
          `Hamilton could not verify ${unverified.length === 1 ? "this figure" : "these figures"} against the report data: ` +
          `${[...new Set(unverified)].join(", ")}. The report was not saved; please try again.`,
      };
    }
    const [summarySection, strategicSection, recommendationSection] = verifiedSections.map((result) => result.section);

    const snapshotRows = selectedFeeDeltas.slice(0, 5).map((delta) => ({
      label: delta.fee_category.replace(/_/g, " "),
      current: `${formatAmount(delta.institution_amount)} (${delta.evidence_tier})`,
      proposed: `${formatAmount(delta.peer_median)} peer median`,
    }));
    const tradeoffRows =
      selectedInstitution && selectedFeeDeltas.length > 0
        ? selectedFeeDeltas.slice(0, 3).map((delta) => ({
            label: delta.fee_category.replace(/_/g, " "),
            value:
              `${formatAmount(delta.institution_amount)} vs ${formatAmount(delta.peer_median)} peer median ` +
              `(${formatSignedAmount(delta.delta_amount)})`,
          }))
        : topCategories.slice(0, 3).map((c) => ({
            label: c.fee_category.replace(/_/g, " "),
            value:
              c.median_amount != null
                ? `$${c.median_amount.toFixed(2)} median`
                : "Insufficient data",
          }));

    // 5. Assemble ReportSummaryResponse
    const report: ReportSummaryResponse = {
      title: reportTitle,
      executiveSummary: summarySection.narrative
        .split("\n\n")
        .filter((p) => p.trim().length > 0),
      snapshot: snapshotRows,
      strategicRationale: strategicSection.narrative,
      tradeoffs: tradeoffRows,
      recommendation: recommendationSection.narrative,
      implementationNotes: [
        `Report generated ${new Date().toLocaleDateString()}`,
        `Analysis period: ${period}`,
        `Peer group: ${peerIndex.label}`,
        ...(peerIndex.fallbackReason ? [`Peer group note: ${peerIndex.fallbackReason}`] : []),
        `Covers ${indexData.length} fee categories in the peer group`,
        selectedInstitution
          ? `${selectedFeeDeltas.length} of ${selectedInstitution.institution_name}'s fees compared with the peer median`
          : "Figures come from published fee schedules",
        "Verified benchmark conclusions exclude provisional fees; provisional figures are labeled.",
      ],
      exportControls: {
        pdfEnabled: true,
        shareEnabled: false,
      },
    };
    const artifactQuality = validateHamiltonReportArtifact({
      report,
      selectedInstitutionId: selectedInstitution?.id ?? null,
      selectedFeeDeltas,
      canGenerateVerifiedBenchmarkConclusions:
        selectedInstitutionData?.can_generate_verified_benchmark_conclusions ?? false,
    });
    if (!artifactQuality.ok) {
      await recordReportOutcome("failed", `Report failed the quality gate: ${artifactQuality.error}`, verifiedSections);
      return { success: false, error: artifactQuality.error };
    }

    // 6. Save to hamilton_reports
    const institutionId =
      normalizeCanonicalInstitutionId(selectedInstitution?.id) ?? "";
    const artifactMetadata: ReportArtifactMetadata = {
      evidencePolicy,
      selectedSource: selectedSourceContext.selectedSource,
      selectedSourceLabel: selectedSourceContext.selectedSourceLabel,
      peerSetId: peerIndex.peerSetId,
      peerBaselineSource: peerIndex.source,
      peerBaselineLabel: peerIndex.label,
      peerFallbackReason: peerIndex.fallbackReason,
      selectedVerifiedFeeCount: selectedVerifiedFees.length,
      selectedProvisionalFeeCount: selectedProvisionalFees.length,
      selectedFeeDeltaCount: selectedFeeDeltas.length,
    };
    const reportId = await saveHamiltonReport({
      userId: user.id,
      institutionId,
      reportType: params.templateType,
      reportJson: report,
      scenarioId: params.scenarioId ?? null,
      evidencePolicy: artifactMetadata.evidencePolicy,
      peerSetId: artifactMetadata.peerSetId,
      peerBaselineSource: artifactMetadata.peerBaselineSource,
      peerBaselineLabel: artifactMetadata.peerBaselineLabel,
      peerFallbackReason: artifactMetadata.peerFallbackReason,
      selectedSource: artifactMetadata.selectedSource,
      selectedSourceLabel: artifactMetadata.selectedSourceLabel,
      selectedVerifiedFeeCount: artifactMetadata.selectedVerifiedFeeCount,
      selectedProvisionalFeeCount: artifactMetadata.selectedProvisionalFeeCount,
      selectedFeeDeltaCount: artifactMetadata.selectedFeeDeltaCount,
    });
    if (selectedInstitution) {
      await completeHamiltonRefreshJobsForInstitution({
        institutionId: selectedInstitution.id,
        jobTypes: ["report_refresh", "watchlist_review"],
        completedByUserId: user.id,
      }).catch(() => {});
    }

    await recordReportOutcome("completed", `Report saved (${reportId}).`, verifiedSections, { report_id: reportId });
    return { success: true, reportId, report, artifactMetadata };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Report generation failed: ${message}` };
  }
}

/**
 * Load user's recent reports for the left rail.
 */
export async function loadRecentReports() {
  const user = await getCurrentUser();
  if (!user) return [];
  return getRecentHamiltonReports(user.id);
}

/**
 * Load active scenarios for the scenario selector.
 */
export async function loadActiveScenarios() {
  const user = await getCurrentUser();
  if (!user) return [];
  return getActiveScenarios(user.id);
}

/**
 * Load a single report by ID.
 */
export async function loadReport(reportId: string) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) return null;
  return getHamiltonReportById(reportId, user.id);
}

/**
 * Load a scenario by ID for the current user.
 * Filters by userId to prevent IDOR (T-53-04).
 */
export async function loadScenarioById(scenarioId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  return getHamiltonScenarioById(scenarioId, user.id);
}

/**
 * Load a published BFI-authored report by ID.
 * Published reports use sentinel user_id = 0 and are accessible to all authenticated pro users.
 * Authentication is required — unauthenticated requests return null.
 */
export async function loadPublishedReport(reportId: string) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) return null;
  const rows = await sql`
    SELECT
      id,
      report_type,
      report_json,
      evidence_policy,
      peer_set_id,
      peer_baseline_source,
      peer_baseline_label,
      peer_fallback_reason,
      selected_source,
      selected_source_label,
      selected_verified_fee_count,
      selected_provisional_fee_count,
      selected_fee_delta_count,
      created_at
    FROM hamilton_reports
    WHERE id = ${reportId}
      AND status = 'published'
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return {
    id: rows[0].id as string,
    report_type: rows[0].report_type as string,
    report_json: rows[0].report_json as ReportSummaryResponse,
    created_at: rows[0].created_at as string,
    artifact_metadata: {
      evidencePolicy: rows[0].evidence_policy as HamiltonEvidencePolicy,
      selectedSource: rows[0].selected_source as ReportArtifactMetadata["selectedSource"],
      selectedSourceLabel: rows[0].selected_source_label as string | null,
      peerSetId: rows[0].peer_set_id as string | null,
      peerBaselineSource: rows[0].peer_baseline_source as ReportArtifactMetadata["peerBaselineSource"],
      peerBaselineLabel: rows[0].peer_baseline_label as string | null,
      peerFallbackReason: rows[0].peer_fallback_reason as string | null,
      selectedVerifiedFeeCount: Number(rows[0].selected_verified_fee_count ?? 0),
      selectedProvisionalFeeCount: Number(rows[0].selected_provisional_fee_count ?? 0),
      selectedFeeDeltaCount: Number(rows[0].selected_fee_delta_count ?? 0),
    },
  };
}
