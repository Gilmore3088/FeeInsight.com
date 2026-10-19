/**
 * The inputs of a Hamilton report (the Reports screen): the institution's data, peer index,
 * exhibits and regulation, assembled into the three section inputs the model writes from. Shared by
 * the report action (`reports/actions.ts`) and the paid answer eval (#1079), so the eval scores
 * the answer page a Pro reader gets. Reads only; nothing here calls a model or saves. Server only.
 */

import { reportGoal, type ReportClientGoal } from "@/lib/hamilton/report-goal";
import { accountIdentitySnapshot, type HamiltonAccountContext } from "@/lib/hamilton/account-context";
import { getFeesByInstitution, getFinancialsByInstitution, getInstitutionById } from "@/lib/data-store";
import { financialSourceForCharter } from "@/lib/data-store/financial-peer-contract";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/fee-stats";
import { getCategoryChargeBases } from "@/lib/data-store/fee-index";
import { getInstitutionPeerRanking, getInstitutionRevenueTrend } from "@/lib/data-store/call-reports";
import { getInstitutionFeeScheduleEvidence } from "@/lib/data-store/institution";
import type { SectionInput } from "@/lib/hamilton/types";
import { compareSelectedInstitutionFees } from "@/lib/hamilton/report-evidence";
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
import { ANSWER_SECTION_FORMAT, TRADEOFF_SECTION_FORMAT } from "@/lib/hamilton/report-answer";
import type { ReportBasketItem } from "@/lib/hamilton/report-basket";
import { resolveHamiltonPeerIndex } from "@/lib/hamilton/peer-index";
import { getFeePublicationStatusLabel } from "@/lib/institution-quality";
import {
  getHamiltonContextSourceLabel,
  normalizeHamiltonContextSource,
  normalizeHamiltonPersistedContextSource,
  type HamiltonContextSource,
  type HamiltonPersistedContextSource,
} from "@/lib/hamilton/context-source";
import type { ReportArtifactMetadata } from "@/lib/hamilton/types";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
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

const TEMPLATE_TITLES: Record<ReportTemplateType, string> = {
  peer_benchmarking: "Peer Benchmarking Report",
  regional_landscape: "Regional Fee Landscape",
  category_deep_dive: "Category Deep Dive",
  competitive_positioning: "Competitive Positioning",
};

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
13. Never tell the institution to raise, lower, hold, cut or drop a fee, and never write "we recommend". Say where its prices sit and the question that puts to management; the decision is management's.
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
        return `Explain what is behind ${institutionName}'s position in two or three short paragraphs, each opening with its takeaway. For its most exposed fees, name the local competitors priced above and below it, say whether it sits above, at or below them, and name the question that puts to management. Do not say whether it should raise, lower or drop the fee.`;
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
14. Cover the decision points on the answer page, in its order, and no others. At most 3.
15. For each, lay out the options management could weigh (keep the price, move toward the local or peer anchor, restructure the fee), each with one concrete consequence: who notices, the complaint or regulatory exposure, or the income figure from exhibits.fee_impacts.
16. Never choose an option. Never tell the institution to raise, lower, hold, cut or drop a fee, and never write "we recommend" or "should". End each decision point with the question management faces.
17. If you can ground only 0 or 1 decision points, write only that many. Better short than generic.
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

/** The institution, data and section inputs of one report, or why there is no report to write. */
export async function assembleReportInputs(input: {
  params: GenerateReportParams;
  /** The reader, for their saved peer group; null uses the institution's default peers. */
  userId: number | string | null;
  loadAccountContext: () => Promise<HamiltonAccountContext>;
  /** The reader's added findings, already authenticated, for the chosen institution. */
  resolveFindings: (institutionId: string | null) => Promise<ReportBasketItem[]>;
}) {
  const { params } = input;
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
    input.loadAccountContext(),
  ]);
  if (params.institutionId && !selectedInstitution) {
    return { kind: "not_found" as const };
  }
  const peerIndex = await resolveHamiltonPeerIndex({
    userId: input.userId,
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
  const addedFindings = await input.resolveFindings(selectedInstitution ? String(selectedInstitution.id) : null);
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
  // The canonical charter determines which regulator's financial definition the report can use.
  const financialSource = financialSourceForCharter(selectedInstitution?.charter_type);
  const comparableFinancials = selectedFinancials.filter((record) => financialSource !== null && record.source === financialSource);
  const latestFinancial = comparableFinancials[0] ?? null;

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
            source: latestFinancial.source,
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
    return { kind: "insufficient" as const, report, artifactMetadata, selectedInstitution };
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
    serviceCharges: annualServiceCharges(comparableFinancials),
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
    ? await getFeeIncomeTrend(selectedInstitution.id, institutionName, financialSource).catch(() => null)
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

  return {
    kind: "ready" as const,
    sectionInputs,
    chargeBases,
    institutionName,
    reportTitle,
    period,
    selectedInstitution,
    selectedInstitutionData,
    selectedFeeDeltas,
    topCategories,
    indexData,
    peerIndex,
    exhibitSet,
    feeIncomeTrend,
    regulatory,
    addedFindings,
    evidencePolicy,
    selectedSourceContext,
    selectedVerifiedFees,
    selectedProvisionalFees,
    identityContext,
  };
}
