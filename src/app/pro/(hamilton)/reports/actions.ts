"use server";

import { reportGoal, type ReportClientGoal } from "@/lib/hamilton/report-goal";
import { partnerReviewContext, reviewAnswerPage } from "@/lib/hamilton/partner-review";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { loadHamiltonAccountContext } from "@/lib/hamilton/account-context-store";
import { accountIdentitySnapshot } from "@/lib/hamilton/account-context";
import { readHamiltonIdentitySnapshot } from "@/lib/hamilton/identity-display";
import { loadAnalysisRecord } from "@/app/pro/(hamilton)/analyze/actions";
import {
  getFeesByInstitution,
  getFinancialsByInstitution,
  getInstitutionById,
} from "@/lib/data-store";
import { sql } from "@/lib/data-store/connection";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/fee-stats";
import { getCategoryChargeBases } from "@/lib/data-store/fee-index";
import {
  getInstitutionPeerRanking,
  getInstitutionRevenueTrend,
} from "@/lib/data-store/call-reports";
import { getInstitutionFeeScheduleEvidence } from "@/lib/data-store/institution";
import { generateVerifiedSection, type VerifiedSectionOutput } from "@/lib/hamilton/generate";
import { checkProAiQuota, quotaExceededMessage } from "@/lib/hamilton/quota";
import { checkConsultantReportCap, reportCapMessage } from "@/lib/hamilton/report-cap";
import { recordProRequest } from "@/lib/agents/run-store";
import { logUsage } from "@/lib/research/history";
import { estimateAnthropicCostMicrousd } from "@/lib/ai-provider-usage";
import { getHamiltonModel, isProviderLimitError } from "@/lib/ai-provider";
import { HAMILTON_PAUSED_MESSAGE } from "@/lib/hamilton/provider-paused";
import type { SectionInput } from "@/lib/hamilton/types";
import {
  buildReportPeerCoveragePreview,
  compareSelectedInstitutionFees,
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
import { getLocalFeeMoves, getLocalMarketCompetitors } from "@/lib/data-store/local-market";
import { annualServiceCharges, buildReportExhibits } from "@/lib/hamilton/report-exhibits";
import { buildRegulatoryContext, REGULATORY_REPORT_RULES } from "@/lib/hamilton/regulatory-context";
import { getInstitutionComplaintYears } from "@/lib/data-store/complaints";
import { getEnforcementRecord } from "@/lib/data-store/registry-profile";
import { getFeeIncomeTrend } from "@/lib/hamilton/report-trend";
import {
  ANSWER_SECTION_FORMAT,
  TRADEOFF_SECTION_FORMAT,
  parseAnswerSection,
  parseTradeoffSection,
} from "@/lib/hamilton/report-answer";
import { validateHamiltonReportArtifact } from "@/lib/hamilton/report-quality";
import { basketItemsFor, sanitizeBasketItems } from "@/lib/hamilton/report-basket";
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
  /** Report basket: findings and tests the user added from Position, Ask and Test (re-validated here). */
  addedFindings?: unknown;
  /** The Goal picker: shapes how decisions are ranked and framed, never the figures. */
  clientGoal?: ReportClientGoal;
}

export type ReportNarrativeTone = "consulting" | "academic" | "executive" | "technical";

const TONE_GUIDANCE: Record<ReportNarrativeTone, string> = {
  executive: "AUDIENCE: the board. Lead with the headline and the decision; keep it short; no methodology detail.",
  consulting: "AUDIENCE: the internal pricing team. Decision-oriented; name the decision each finding raises.",
  technical: "AUDIENCE: analysts. Data-first; state the sample size and maturity behind every benchmark.",
  academic: "AUDIENCE: research readers. Fuller context; explain the method and its limits.",
};

function withTone(context: string, tone: ReportNarrativeTone | undefined, goal?: ReportClientGoal): string {
  const parts = [context, tone ? TONE_GUIDANCE[tone] ?? "" : "", reportGoal(goal).guidance];
  return parts.filter(Boolean).join("\n\n").trim();
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
    const [selectedInstitution, selectedFees, selectedEvidence, chargeBases] = await Promise.all([
      params.institutionId ? getInstitutionById(params.institutionId).catch(() => null) : null,
      params.institutionId ? getFeesByInstitution(params.institutionId).catch(() => []) : [],
      params.institutionId
        ? getInstitutionFeeScheduleEvidence(params.institutionId).catch(() => null)
        : null,
      params.institutionId ? getCategoryChargeBases().catch(() => null) : null,
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
        chargeBases,
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
11. exhibits.local_moves lists price changes by named local competitors since tracked_since. When a decision touches a fee a competitor changed, name the competitor and its old and new amount. When moves is empty, say nothing about competitor changes, and never claim what happened before tracked_since.
12. exhibits.fee_income_trend, when present, is the institution's fee income after inflation (in dollars_of dollars), with tests already run. Use it to say whether pricing is fighting a declining or a growing income line. Quote real_cagr_pct against industry_real_cagr_pct, and a structural_break only when significant is true, naming its quarter. Never compute a growth rate or test result yourself; when it is null, say nothing about trend.
`.trim();

function buildExecutiveSummaryContext(
  params: GenerateReportParams,
  institutionName: string,
  period: string
): string {
  const head = (() => {
    switch (params.templateType) {
      case "peer_benchmarking":
        return `Write the answer page for ${institutionName}'s fee benchmark. Show where it sits against its local competitors (exhibits.local_market) and peers, and the decisions that puts in front of management. Period: ${period}.`;
      case "regional_landscape":
        return `Write the answer page on ${institutionName}'s regional market. Lead with how its prices compare with the named local competitors in exhibits.local_market, then the decisions that follow. Period: ${period}.`;
      case "category_deep_dive": {
        const cat = params.focusCategory
          ? params.focusCategory.replace(/_/g, " ")
          : "the focus category";
        return `Write the answer page on ${institutionName}'s ${cat} pricing: where it sits against local competitors and peers, and the decision it puts in front of management. Period: ${period}.`;
      }
      case "competitive_positioning":
        return `Write the answer page on ${institutionName}'s competitive position: the fees where it is most exposed against named local competitors and peers, and the decision each raises. Period: ${period}.`;
    }
  })();

  return `${head}\n\n${ANSWER_SECTION_FORMAT}\n\n${NO_FLUFF_RULES}\n\n${buildSelectedInstitutionReportRules(params)}`.trim();
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
        return `Explain what is behind ${institutionName}'s position. In two or three short paragraphs, each opening with its takeaway, compare its amounts with the named local competitors in exhibits.local_market and with the peer median and spread, and say which gaps are deliberate-looking (a fee the market is moving away from) and which look like prices never revisited.`;
      case "regional_landscape":
        return `Explain the local market behind ${institutionName}'s position in two or three short paragraphs, each opening with its takeaway. Name the competitors in exhibits.local_market that set the high and low prices, and compare the local pattern with the state and peer figures.`;
      case "category_deep_dive": {
        const cat = params.focusCategory
          ? params.focusCategory.replace(/_/g, " ")
          : "the focus category";
        return `Explain what is behind ${institutionName}'s ${cat} position in two or three short paragraphs, each opening with its takeaway: the named local competitors, the peer spread, and where the sample is thin (use the maturity and count fields).`;
      }
      case "competitive_positioning":
        return `Explain what is behind ${institutionName}'s position in two or three short paragraphs, each opening with its takeaway. For its most exposed fees, name the local competitors priced above and below it and say whether it has pricing room, parity, or a vulnerability.`;
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
13. Cover the decision points on the answer page, in its order, and no others. At most 3.
14. For each, lay out the options management could weigh (keep the price, move toward the local or peer anchor, restructure the fee), each with one concrete consequence: who notices, the complaint or regulatory exposure, or the income figure from exhibits.fee_impacts.
15. Never choose an option. Never tell the institution to raise, lower, hold, cut or drop a fee, and never write "we recommend" or "should". End each decision point with the question management faces.
16. If you can ground only 0 or 1 decision points, write only that many. Better short than generic.
`.trim();

function buildRecommendationContext(
  params: GenerateReportParams,
  institutionName: string
): string {
  const head = (() => {
    switch (params.templateType) {
      case "peer_benchmarking":
        return `Write the trade-offs for ${institutionName}'s fee decision points: for each (largest value in exhibits.fee_impacts first), the options management could weigh, who notices, and what each option risks.`;
      case "regional_landscape":
        return `Write the trade-offs for ${institutionName}'s regional decision points: for each, the named local competitors customers will compare it with and what each option risks.`;
      case "category_deep_dive": {
        const cat = params.focusCategory
          ? params.focusCategory.replace(/_/g, " ")
          : "the focus category";
        return `Write the trade-offs for ${institutionName}'s ${cat} decision point (keep the price, move toward the local or peer anchor, or restructure it): who notices and what each option risks.`;
      }
      case "competitive_positioning":
        return `Write the trade-offs for ${institutionName}'s positioning decision points, most exposed fees first: which local competitors customers will compare it with and what each option risks.`;
    }
  })();

  return `${head}\n\n${TRADEOFF_SECTION_FORMAT}\n\n${DECISION_POINT_RULES}\n\n${buildSelectedInstitutionReportRules(params)}`.trim();
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

/** Resolve saved Ask references with numeric-user scoping before using their historical identity. */
async function authenticatedReportFindings(raw: unknown, institutionId: string | null) {
  const findings = await Promise.all(sanitizeBasketItems(raw).map(async (item) => {
    if (item.source === "Ask" && item.savedAnalysisId) {
      const saved = await loadAnalysisRecord(item.savedAnalysisId);
      if (!saved || typeof saved.responseJson.hamiltonView !== "string") return null;
      const identity = readHamiltonIdentitySnapshot(saved.responseJson.identityContext);
      return {
        ...item,
        // A saved-answer reference authenticates its original content as well as
        // its identity; browser edits cannot relabel another institution's answer.
        title: saved.responseJson.title,
        detail: [saved.responseJson.hamiltonView, saved.responseJson.whatThisMeans].filter(Boolean).join(" "),
        institutionId: saved.institutionId,
        ...(identity ? { identityContext: identity } : { identityContext: undefined }),
      };
    }
    // Browser metadata can identify a research selection but cannot establish who the
    // account represented when a historic answer was generated.
    return { ...item, identityContext: undefined };
  }));
  return basketItemsFor(findings.filter((item) => item !== null), institutionId);
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
      chargeBases,
      accountContext,
    ] = await Promise.all([
      params.institutionId ? getInstitutionById(params.institutionId).catch(() => null) : null,
      params.institutionId ? getFeesByInstitution(params.institutionId).catch(() => []) : [],
      // Two years of quarters across sources, enough for one complete calendar year.
      params.institutionId ? getFinancialsByInstitution(params.institutionId, 24).catch(() => []) : [],
      params.institutionId ? getInstitutionRevenueTrend(params.institutionId).catch(() => []) : [],
      params.institutionId ? getInstitutionPeerRanking(params.institutionId).catch(() => null) : null,
      params.institutionId ? getInstitutionFeeScheduleEvidence(params.institutionId).catch(() => null) : null,
      params.institutionId ? getCategoryChargeBases().catch(() => null) : null,
      loadHamiltonAccountContext(user),
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
      selectedInstitution?.institution_name ?? "Unscoped fee research";
    const reportTitle = `${TEMPLATE_TITLES[params.templateType]} - ${institutionName} - ${params.dateFrom} to ${params.dateTo}`;
    const period = `${params.dateFrom} to ${params.dateTo}`;
    const selectedVisibleFees = selectedFees.filter((fee) => fee.review_status !== "rejected");
    const selectedVerifiedFees = selectedVisibleFees.filter((fee) => fee.review_status === "approved");
    const selectedProvisionalFees = selectedVisibleFees.filter((fee) => fee.review_status !== "approved");
    const evidencePolicy = params.evidencePolicy ?? "provisional-first";
    const addedFindings = await authenticatedReportFindings(
      params.addedFindings, selectedInstitution ? String(selectedInstitution.id) : null,
    );
    const selectedSourceContext = resolveReportSelectedSource(params);
    const identityContext = accountIdentitySnapshot(selectedInstitution?.id ?? null, accountContext, {
      researchInstitutionName: selectedInstitution?.institution_name ?? null,
      researchSelectionSource: selectedSourceContext.selectedSourceLabel,
      peerSetId: normalizeCanonicalInstitutionId(peerIndex.peerSetId) ? Number(peerIndex.peerSetId) : null,
      peerBaselineLabel: peerIndex.label,
      peerBaselineSource: peerIndex.source,
      peerBaselineFallbackReason: peerIndex.fallbackReason,
    });
    const { deltas: selectedFeeDeltas, notLikeForLike } = compareSelectedInstitutionFees({
      selectedFees: selectedVisibleFees,
      indexEntries: indexData,
      chargeBases,
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
      report.identityContext = identityContext;
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
      notLikeForLike,
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

    // Consultant exhibits, built from data only: named local competitors (FDIC branch
    // deposits), the peer range, and dollar sensitivity from the institution's filings.
    const localMarket = selectedInstitution
      ? await getLocalMarketCompetitors({
          institutionId: selectedInstitution.id,
          certNumber: selectedInstitution.cert_number,
          city: selectedInstitution.city,
          stateCode: selectedInstitution.state_code,
          categories: selectedFeeDeltas.map((delta) => delta.fee_category),
        }).catch(() => null)
      : null;
    const localMoves = localMarket
      ? await getLocalFeeMoves({
          institutionIds: localMarket.competitors.map((competitor) => competitor.institution_id),
          categories: selectedFeeDeltas.map((delta) => delta.fee_category),
        }).catch(() => [])
      : [];
    const exhibitSet = buildReportExhibits({
      institutionName,
      deltas: selectedFeeDeltas,
      peerLabel: peerIndex.label,
      market: localMarket,
      serviceCharges: annualServiceCharges(selectedFinancials),
      feeScheduleUrl: selectedInstitution?.fee_schedule_url ?? null,
      moves: localMoves,
    });
    // Regulation: the federal rules that bear on these fees, the state chartering
    // agency, and the institution's CFPB complaint record.
    const regulatory = buildRegulatoryContext({
      institutionName,
      stateCode: selectedInstitution?.state_code,
      charterType: selectedInstitution?.charter_type,
      fees: selectedFeeDeltas,
      complaintYears: selectedInstitution
        ? await getInstitutionComplaintYears(selectedInstitution.id).catch(() => [])
        : [],
      enforcement: selectedInstitution
        ? await getEnforcementRecord(selectedInstitution.id).catch(() => null)
        : null,
    });
    // Fee income over time: real (GDP price index), seasonally adjusted, tested for
    // trend, stationarity and structural breaks, against the industry. Computed, never modeled.
    const feeIncomeTrend = selectedInstitution
      ? await getFeeIncomeTrend(selectedInstitution.id, institutionName).catch(() => null)
      : null;
    const exhibitData = { ...exhibitSet.data, regulatory: regulatory.data, fee_income_trend: feeIncomeTrend?.data ?? null };
    const withExpertRules = (context: string) => `${withStateRules(context)}\n\n${REGULATORY_REPORT_RULES}`;

    // 2-4. The three sections: the answer page, what is behind it, and the trade-offs.
    const strategicSectionType = getStrategicSectionType(params.templateType);
    const sectionInputs: SectionInput[] = [
      {
        type: "executive_summary",
        title: "The Answer",
        data: {
          report_type: params.templateType,
          period,
          institution_name: institutionName,
          selected_institution: selectedInstitutionData,
          state_peers: statePeers,
          exhibits: exhibitData,
          focus_category: params.focusCategory ?? null,
          findings_added_by_reader: addedFindings.map((f) => ({ from: f.source, finding: f.title, detail: f.detail })),
          categories: topCategories.map((c) => ({
            fee_category: c.fee_category,
            median_amount: c.median_amount,
            p25_amount: c.p25_amount,
            p75_amount: c.p75_amount,
            institution_count: c.institution_count,
            maturity: c.maturity_tier,
          })),
        },
        context: withTone(
          withExpertRules(
            buildExecutiveSummaryContext(params, institutionName, period) +
              (addedFindings.length > 0
                ? "\n\nThe reader added the findings in findings_added_by_reader from their own analysis. Address each one in the summary, using only figures present in DATA."
                : ""),
          ),
          params.narrativeTone,
          params.clientGoal,
        ),
      },
      {
        type: strategicSectionType,
        title: "What Is Behind It",
        data: {
          report_type: params.templateType,
          period,
          institution_name: institutionName,
          selected_institution: selectedInstitutionData,
          state_peers: statePeers,
          exhibits: exhibitData,
          focus_category: params.focusCategory ?? null,
          top_fees: topCategories.slice(0, 5).map((c) => ({
            fee_category: c.fee_category,
            median_amount: c.median_amount,
            p25_amount: c.p25_amount,
            p75_amount: c.p75_amount,
            institution_count: c.institution_count,
          })),
        },
        context: withTone(withExpertRules(buildStrategicContext(params, institutionName)), params.narrativeTone, params.clientGoal),
      },
      {
        type: "recommendation",
        title: "Trade-offs and What to Watch",
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
          exhibits: exhibitData,
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
        context: withTone(withExpertRules(buildRecommendationContext(params, institutionName)), params.narrativeTone, params.clientGoal),
      },
    ];

    // Paid model calls from here on: enforce the daily quota, and record the outcome
    // (one usage row per report, one pro_request run in the ledger) however it ends.
    const quota = await checkProAiQuota(user);
    if (!quota.allowed) return { success: false, error: quotaExceededMessage(quota) };
    const reportCap = await checkConsultantReportCap(user);
    if (!reportCap.allowed) return { success: false, error: reportCapMessage(reportCap) };
    const ledgerBase = {
      userId: user.id,
      institutionId: selectedInstitution?.id ?? null,
      title: `Hamilton report: ${reportTitle}`,
    };
    // Partner review of the answer page (filled in once the answer is drafted).
    const partnerReview = { problems: [] as string[], rewritten: false, remaining: 0 };
    // Drafts the partner review replaced or rejected: billed, so counted in usage.
    const billedDrafts: VerifiedSectionOutput[] = [];
    const recordReportOutcome = async (
      status: "completed" | "failed",
      summary: string,
      sections: VerifiedSectionOutput[],
      extra: Record<string, unknown> = {},
    ) => {
      sections = [...sections, ...billedDrafts];
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
          partner_review: partnerReview,
          ...extra,
        },
      });
    };

    // One retry per section, so a provider hiccup never discards (and re-bills) the
    // sections that worked.
    const verifiedSections: VerifiedSectionOutput[] = [];
    // A usage or billing limit at the provider: no retry, and the reader is told it is paused.
    let providerPaused = false;
    const generateWithRetry = async (input: SectionInput): Promise<VerifiedSectionOutput | null> => {
      try {
        return await generateVerifiedSection(input);
      } catch (firstError) {
        if (isProviderLimitError(firstError)) {
          providerPaused = true;
          await recordReportOutcome("failed", `Section "${input.title}" refused: provider usage limit.`, verifiedSections);
          return null;
        }
        try {
          return await generateVerifiedSection(input);
        } catch (retryError) {
          providerPaused = isProviderLimitError(retryError);
          await recordReportOutcome("failed", `Section "${input.title}" failed after a retry.`, verifiedSections);
          return null;
        }
      }
    };
    const sectionFailed = (input: SectionInput): GenerateReportResult => ({
      success: false,
      error: providerPaused
        ? HAMILTON_PAUSED_MESSAGE
        : `Hamilton couldn't write the ${input.title} section right now. Please try again in a minute.`,
    });

    // The answer page comes first; the other two sections explain and stress-test
    // its decisions, so they receive it as context and run together.
    let answerResult = await generateWithRetry(sectionInputs[0]);
    if (!answerResult) return sectionFailed(sectionInputs[0]);
    // Partner review: a draft that fails the checklist goes back once with the
    // problems named; the rewrite is kept only if it fixes more than it breaks.
    const reviewInput = {
      institutionName,
      feeNames: selectedFeeDeltas.map((delta) => getDisplayName(delta.fee_category)),
      competitorNames: exhibitSet.data.local_market?.comparisons.flatMap((row) => row.competitors.map((c) => c.name)) ?? [],
    };
    const firstProblems = reviewAnswerPage({ ...reviewInput, narrative: answerResult.section.narrative });
    partnerReview.problems = firstProblems;
    partnerReview.remaining = firstProblems.length;
    if (firstProblems.length > 0) {
      const rewrite = await generateVerifiedSection({
        ...sectionInputs[0],
        context: `${sectionInputs[0].context ?? ""}\n\n${partnerReviewContext(firstProblems, answerResult.section.narrative)}`.trim(),
      }).catch(() => null);
      if (rewrite) {
        const remaining = reviewAnswerPage({ ...reviewInput, narrative: rewrite.section.narrative });
        if (remaining.length < firstProblems.length && rewrite.status !== "needs_review") {
          billedDrafts.push(answerResult);
          answerResult = rewrite;
          partnerReview.rewritten = true;
          partnerReview.remaining = remaining.length;
        } else {
          billedDrafts.push(rewrite);
        }
      }
    }
    verifiedSections.push(answerResult);
    const answerContext = `ANSWER PAGE (already written; explain and stress-test these decisions, do not contradict or add to them):\n${answerResult.section.narrative}`;
    const followUps = await Promise.all(
      sectionInputs.slice(1).map((input) =>
        generateWithRetry({ ...input, context: `${input.context ?? ""}\n\n${answerContext}`.trim() }),
      ),
    );
    for (const [index, result] of followUps.entries()) {
      if (!result) return sectionFailed(sectionInputs[index + 1]);
      verifiedSections.push(result);
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
      label: getDisplayName(delta.fee_category),
      current: `${formatAmount(delta.institution_amount)} (${delta.evidence_tier})`,
      proposed: `${formatAmount(delta.peer_median)} peer median`,
    }));
    const tradeoffRows =
      selectedInstitution && selectedFeeDeltas.length > 0
        ? selectedFeeDeltas.slice(0, 3).map((delta) => ({
            label: getDisplayName(delta.fee_category),
            value:
              `${formatAmount(delta.institution_amount)} vs ${formatAmount(delta.peer_median)} peer median ` +
              `(${formatSignedAmount(delta.delta_amount)})`,
          }))
        : topCategories.slice(0, 3).map((c) => ({
            label: getDisplayName(c.fee_category),
            value:
              c.median_amount != null
                ? `$${c.median_amount.toFixed(2)} median`
                : "Insufficient data",
          }));

    // 5. Assemble ReportSummaryResponse
    const answer = parseAnswerSection(summarySection.narrative);
    const tradeoffSection = parseTradeoffSection(recommendationSection.narrative);
    const report: ReportSummaryResponse = {
      title: reportTitle,
      identityContext,
      ...(answer ? { answer: { ...answer, goal: params.clientGoal && params.clientGoal !== "balanced" ? reportGoal(params.clientGoal).label : null } } : {}),
      exhibits: [
        ...exhibitSet.exhibits,
        ...(feeIncomeTrend ? [feeIncomeTrend.exhibits[0]] : []),
        ...(regulatory.exhibit ? [regulatory.exhibit] : []),
        ...(feeIncomeTrend ? feeIncomeTrend.exhibits.slice(1) : []),
      ],
      watchlist: tradeoffSection.watch,
      sources: [...exhibitSet.sources, ...(feeIncomeTrend?.sources ?? []), ...regulatory.sources],
      executiveSummary: answer
        ? [answer.headline, ...answer.decisions.map((decision) => `${decision.action.replace(/\.$/, "")}. ${decision.why}`.trim())]
        : summarySection.narrative.split("\n\n").filter((p) => p.trim().length > 0),
      snapshot: snapshotRows,
      strategicRationale: strategicSection.narrative,
      tradeoffs: tradeoffRows,
      recommendation: tradeoffSection.body || recommendationSection.narrative,
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
    if (addedFindings.length > 0) {
      report.addedFindings = addedFindings.map((f) => ({ source: f.source, title: f.title, detail: f.detail, ...(f.identityContext ? { identityContext: f.identityContext } : {}) }));
    }
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
    if (isProviderLimitError(err)) return { success: false, error: HAMILTON_PAUSED_MESSAGE };
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

/** Explicitly confirmed landing selection; uses the same user-scoped report library/PDF workflow. */
export async function saveLandingResearchReport(input: { research: unknown; confirmed: boolean }): Promise<{ success: true; reportId: string } | { success: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) return { success: false, error: "Hamilton access required." };
  if (input.confirmed !== true) return { success: false, error: "Confirm the selection before creating a report." };
  try {
    const { parseLandingResearch } = await import("@/lib/hamilton/landing-research-handoff");
    const { buildLandingReport } = await import("@/lib/hamilton/landing-report");
    const selection = parseLandingResearch(input.research);
    if (selection.task !== "board_report") return { success: false, error: "Choose the board-report workflow." };
    const result = selection.scope.kind === "local"
      ? await (await import("@/lib/hamilton/local-market-answer")).getLocalMarketAnswer(selection.scope.institutionId, { categories: selection.categories, charter: selection.charter })
      : await (await import("@/lib/hamilton/landing-geographic-research")).loadLandingGeographicResearch({ ...selection, task: "compare" });
    if (!result) return { success: false, error: "No branch market is on file for this institution yet." };
    const report = buildLandingReport(selection, result, new Date().toISOString());
    const accountContext = await loadHamiltonAccountContext(user);
    const researchInstitution = selection.scope.kind === "local" ? await getInstitutionById(selection.scope.institutionId) : null;
    report.identityContext = accountIdentitySnapshot(selection.scope.kind === "local" ? selection.scope.institutionId : null, accountContext, {
      researchInstitutionName: researchInstitution?.institution_name ?? null,
      researchSelectionSource: "Explicitly confirmed landing research selection",
      peerBaselineLabel: report.exhibits?.[0]?.subtitle ?? null,
      peerBaselineSource: "published-fee-index",
      peerBaselineFallbackReason: "No account institution or fallback cohort was substituted.",
    });
    const quality = validateHamiltonReportArtifact({ report, selectedInstitutionId: selection.scope.kind === "local" ? selection.scope.institutionId : null });
    if (!quality.ok) return { success: false, error: quality.error };
    const reportId = await saveHamiltonReport({
      userId: user.id,
      institutionId: selection.scope.kind === "local" ? String(selection.scope.institutionId) : "",
      reportType: "landing_research", reportJson: report, evidencePolicy: "verified-only",
      selectedSource: "url", selectedSourceLabel: "Landing research selection",
      peerBaselineLabel: report.exhibits![0].subtitle,
      peerFallbackReason: "Explicit landing selection; no fallback cohort or account institution was substituted.",
    });
    await recordProRequest({ operation: "report", title: report.title, status: "completed",
      summary: "Saved explicitly confirmed published-fee research draft", userId: user.id,
      institutionId: selection.scope.kind === "local" ? selection.scope.institutionId : null,
      detail: { report_id: reportId, research: selection, provider_call_queued: false, evidence_policy: "verified-only" },
    });
    return { success: true, reportId };
  } catch (error) {
    console.error("[landing-report]", error);
    return { success: false, error: "Could not save this research selection. Please retry." };
  }
}
