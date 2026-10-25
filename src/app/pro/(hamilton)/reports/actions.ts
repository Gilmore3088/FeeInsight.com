"use server";

import { reportGoal } from "@/lib/hamilton/report-goal";
import { partnerReviewContext, reviewAnswerPage } from "@/lib/hamilton/partner-review";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { reportStartError } from "@/lib/report-access";
import { loadHamiltonAccountContext } from "@/lib/hamilton/account-context-store";
import { accountIdentitySnapshot } from "@/lib/hamilton/account-context";
import { readHamiltonIdentitySnapshot } from "@/lib/hamilton/identity-display";
import { readSavedAnalysisRecord } from "@/lib/hamilton/saved-analysis-record";
import { getFeesByInstitution, getInstitutionById } from "@/lib/data-store";
import { sql } from "@/lib/data-store/connection";
import { getInstitutionFeeScheduleEvidence } from "@/lib/data-store/institution";
import { generateVerifiedSection, type SectionTracking, type VerifiedSectionOutput } from "@/lib/hamilton/generate";
import { bindHamiltonTaskReader, bindHamiltonTaskRun, currentHamiltonTask, hamiltonTaskBudgetDetail, runHamiltonTask } from "@/lib/hamilton/task-budget";
import { runWithHamiltonRetry, type HamiltonFault } from "@/lib/hamilton/task-faults";
import {
  completeReportRun,
  failReportRun,
  failReportSection,
  openReportRun,
  REPORT_RUN_BUSY_MESSAGE,
  ReportRunLeaseLostError,
  reportSectionStepKey,
  reportTaskKey,
  saveReportSection,
  sectionInputHash,
  startReportSection,
  type ReportRunHandle,
} from "@/lib/hamilton/report-run";
import { checkProAiQuota, quotaExceededMessage } from "@/lib/hamilton/quota";
import { checkConsultantReportCap, reportCapMessage } from "@/lib/hamilton/report-cap";
import { recordProRequest } from "@/lib/agents/run-store";
import { logUsage } from "@/lib/research/history";
import { estimateAnthropicCostMicrousd, type ProviderUsage } from "@/lib/ai-provider-usage";
import { getHamiltonModel, isProviderLimitError } from "@/lib/ai-provider";
import { HAMILTON_PAUSED_MESSAGE } from "@/lib/hamilton/provider-paused";
import type { SectionInput } from "@/lib/hamilton/types";
import { buildReportPeerCoveragePreview, type ReportPeerCoveragePreview } from "@/lib/hamilton/report-evidence";
import { parseAnswerSection, parseTradeoffSection } from "@/lib/hamilton/report-answer";
import { validateHamiltonReportArtifact } from "@/lib/hamilton/report-quality";
import { basketItemsFor, sanitizeBasketItems, type ReportBasketItem } from "@/lib/hamilton/report-basket";
import { reportFindingReadingEnabled, savedAnswerFinding } from "@/lib/hamilton/report-saved-finding";
import { scheduleGateShadow } from "@/lib/hamilton/output-gate-shadow-store";
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
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import type { ReportArtifactMetadata, ReportSummaryResponse } from "@/lib/hamilton/types";
import type { HamiltonEvidencePolicy } from "@/lib/hamilton/request-contract";
import { assembleReportInputs, type GenerateReportParams, type ReportTemplateType } from "@/lib/hamilton/report-inputs";

export type { ReportTemplateType, GenerateReportParams, ReportNarrativeTone } from "@/lib/hamilton/report-inputs";

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



function formatSignedAmount(amount: number): string {
  const sign = amount >= 0 ? "+" : "-";
  return `${sign}${formatAmount(Math.abs(amount))}`;
}



export async function previewReportPeerCoverage(
  params: PreviewReportPeerCoverageParams,
): Promise<PreviewReportPeerCoverageResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Authentication required" };
  const blocked = await reportStartError(user);
  if (blocked) return { success: false, error: blocked };
  if (!normalizeCanonicalInstitutionId(params.institutionId)) {
    return { success: false, error: "Choose a research institution to check report coverage." };
  }

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
 * Resolve saved Ask references with numeric-user scoping before using their historical identity.
 * A saved answer is read through its saved claims (#1077 step 6, #1899; report-saved-finding.ts):
 * the finding's detail is its supported sentences only, and the claims and Hamilton's reading ride
 * with it, server side, for the report to print under the label when that is switched on.
 */
async function authenticatedReportFindings(raw: unknown, institutionId: string | null): Promise<ReportBasketItem[]> {
  const findings = await Promise.all(sanitizeBasketItems(raw).map(async (item): Promise<ReportBasketItem | null> => {
    if (item.source === "Ask" && item.savedAnalysisId) {
      // The server-only read: the saved claims are kept here (never in what a browser receives).
      const saved = await readSavedAnalysisRecord(item.savedAnalysisId);
      if (!saved || typeof saved.responseJson.hamiltonView !== "string") return null;
      // An answer that failed the evidence gate when it was saved is not a finding to restate.
      if (saved.responseJson.answerEvidence?.passed === false) return null;
      const { detail, reading, claims } = savedAnswerFinding(saved.responseJson);
      // No supported sentence left: the title alone is model prose with nothing behind it.
      if (!detail) return null;
      const identity = readHamiltonIdentitySnapshot(saved.responseJson.identityContext);
      return {
        ...item,
        // A saved-answer reference authenticates its original content as well as
        // its identity; browser edits cannot relabel another institution's answer.
        title: saved.responseJson.title,
        detail,
        ...(claims ? { savedClaims: claims } : {}),
        ...(reading.length ? { reading } : {}),
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
  // One report is one Hamilton task: every paid call in it is checked against the task's caps
  // and the reader's day before it is made (#1921, task-budget.ts).
  return runHamiltonTask("report", {}, () => writeReport(params));
}

async function writeReport(params: GenerateReportParams): Promise<GenerateReportResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Authentication required" };
  // generateSection() below makes paid model calls: Pro only.
  const blocked = await reportStartError(user);
  if (blocked) return { success: false, error: blocked };
  if (!normalizeCanonicalInstitutionId(params.institutionId)) {
    return { success: false, error: "Choose a research institution before writing this report." };
  }

  let recordPaidFailure: ((summary: string) => Promise<void>) | undefined;
  try {
    // 1-4. The institution's data and the three section inputs (report-inputs.ts, shared with the paid eval).
    const assembled = await assembleReportInputs({
      params,
      userId: user.id,
      loadAccountContext: () => loadHamiltonAccountContext(user),
      resolveFindings: (institutionId) => authenticatedReportFindings(params.addedFindings, institutionId),
    });
    if (assembled.kind === "not_found") {
      return { success: false, error: "Selected institution not found" };
    }
    if (assembled.kind === "insufficient") {
      const { report, artifactMetadata, selectedInstitution } = assembled;
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
    const {
      sectionInputs,
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
    } = assembled;

    // Paid model calls from here on: enforce the daily quota, and record the outcome
    // (one usage row per report, one pro_request run in the ledger) however it ends.
    const quota = await checkProAiQuota(user);
    if (!quota.allowed) return { success: false, error: quotaExceededMessage(quota) };
    const reportCap = await checkConsultantReportCap(user);
    if (!reportCap.allowed) return { success: false, error: reportCapMessage(reportCap) };
    bindHamiltonTaskReader(user.id);

    // A durable run (#1921, report-run.ts): each finished section is saved on the run before the
    // next, so a request cut short resumes without writing (or paying for) a section twice.
    // With the ledger unavailable the report is written as before, without checkpoints.
    const opened = await openReportRun({
      userId: user.id,
      institutionId: selectedInstitution?.id ?? null,
      title: `Hamilton report: ${reportTitle}`,
      taskKey: reportTaskKey(user.id, params),
      sectionTitles: sectionInputs.map((input) => input.title),
      detail: { template: params.templateType },
    });
    if (opened.kind === "busy") return { success: false, error: REPORT_RUN_BUSY_MESSAGE };
    if (opened.kind === "already_saved") {
      const saved = await getHamiltonReportById(opened.run.reportId, user.id);
      if (saved) {
        await completeReportRun(opened.run, `Report saved (${saved.id}); found already saved when the run resumed.`, { report_id: saved.id, resumed: true });
        return { success: true, reportId: saved.id, report: saved.report_json, artifactMetadata: saved.artifact_metadata };
      }
    }
    let durable: ReportRunHandle | null = opened.kind === "unavailable" ? null : opened.run;
    if (durable) await bindHamiltonTaskRun(durable.runId, { resumed: durable.resumed });
    const ledgerBase = {
      userId: user.id,
      institutionId: selectedInstitution?.id ?? null,
      title: `Hamilton report: ${reportTitle}`,
    };
    // Partner review of the answer page (filled in once the answer is drafted).
    const partnerReview = { problems: [] as string[], rewritten: false, remaining: 0 };
    // Drafts the partner review replaced or rejected: billed, so counted in usage.
    const billedDrafts: VerifiedSectionOutput[] = [];
    const providerResponses: Array<{ usage: ProviderUsage | undefined; model: string }> = [];
    const tracking = {
      onProviderResponse: (usage: ProviderUsage | undefined, model: string) => {
        providerResponses.push({ usage, model });
      },
      gateIdentity: {
        researchInstitutionId: identityContext?.researchInstitutionId ?? selectedInstitution?.id ?? null,
        accountInstitutionId: identityContext?.accountInstitutionId ?? null,
        accountInstitutionName: identityContext?.accountInstitutionName ?? null,
      },
    };
    let outcomeRecorded = false;
    const recordReportOutcome = async (
      status: "completed" | "failed",
      summary: string,
      sections: VerifiedSectionOutput[],
      extra: Record<string, unknown> = {},
    ) => {
      if (outcomeRecorded) return;
      outcomeRecorded = true;
      // The one output gate in shadow (#1077 step 6): one run per section the report kept, written
      // after the response. It never decides; the figure check and the report's own gates do.
      for (const kept of sections) {
        if (kept.gateShadow) scheduleGateShadow(kept.gateShadow, { userId: user.id, researchInstitutionId: selectedInstitution?.id ?? null });
      }
      sections = [...sections, ...billedDrafts];
      // Returned sections omit discarded figure drafts and failed partner rewrites.
      // The request-owned observer includes each returned generation response once after siblings settle.
      const inputTokens = providerResponses.reduce((sum, item) => sum + (item.usage?.inputTokens ?? 0), 0);
      const outputTokens = providerResponses.reduce((sum, item) => sum + (item.usage?.outputTokens ?? 0), 0);
      const model = providerResponses[0]?.model ?? getHamiltonModel();
      const estimates = providerResponses.map((item) => item.usage ? estimateAnthropicCostMicrousd(item.model, item.usage) : null);
      const costMicrousd = estimates.every((estimate) => estimate !== null)
        ? estimates.reduce<number>((sum, estimate) => sum + (estimate ?? 0), 0) : null;
      // Denial before a returned response consumes no user model-call quota. The ledger
      // remains authoritative for unknown charges; zero here is a legacy column placeholder.
      if (providerResponses.length > 0) {
        await logUsage(user.id, null, "hamilton-report", inputTokens, outputTokens, Math.round((costMicrousd ?? 0) / 10_000)).catch(() => {});
      }
      const outcomeDetail = {
        template: params.templateType,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_microusd: costMicrousd,
        provider_response_events: providerResponses.length,
        unknown_usage_response_events: providerResponses.filter((item) => !item.usage).length,
        token_counts_include_unknown_placeholders: providerResponses.some((item) => !item.usage),
        sections: sections.map((item) => ({ words: item.section.wordCount, status: item.status })),
        partner_review: partnerReview,
        reused_sections: reusedSections,
        durable_run_id: durable?.runId ?? null,
        task_budget: hamiltonTaskBudgetDetail(currentHamiltonTask()),
        ...extra,
      };
      // A durable run is closed with the outcome; without one, the outcome is its own run, as before.
      const closed = durable
        ? status === "completed"
          ? await completeReportRun(durable, summary, outcomeDetail)
          : await failReportRun(durable, summary, outcomeDetail)
        : false;
      if (!closed) await recordProRequest({ ...ledgerBase, operation: "report", status, summary, detail: outcomeDetail });
    };

    // Each section runs under the bounded retry policy (task-faults.ts): a provider error, a
    // timeout or malformed output is tried once more; a usage limit, a budget cap, the provider
    // stop or an unfinished reply is not. A provider hiccup never discards (and re-bills) the
    // sections that worked: they are saved on the run first.
    const verifiedSections: VerifiedSectionOutput[] = [];
    const reusedSections: string[] = [];
    recordPaidFailure = (summary) => recordReportOutcome("failed", summary, verifiedSections);
    let lastFault: HamiltonFault | null = null;
    let lastAttempts: Array<{ attempt: number; fault: string | null }> = [];
    type ResponseSink = Array<{ usage: ProviderUsage | undefined; model: string }>;
    const sectionTracking = (sink: ResponseSink): SectionTracking => ({
      ...tracking,
      ...(durable ? { agentRunId: durable.runId } : {}),
      onProviderResponse: (usage, model) => {
        tracking.onProviderResponse(usage, model);
        sink.push({ usage, model });
      },
    });
    const generateWithRetry = async (input: SectionInput, sectionTrack: SectionTracking): Promise<VerifiedSectionOutput | null> => {
      const outcome = await runWithHamiltonRetry(() => generateVerifiedSection(input, sectionTrack));
      if (outcome.ok) return outcome.value ?? null;
      lastFault = outcome.fault ?? null;
      lastAttempts = outcome.attempts;
      return null;
    };
    // Ledger writes for a section. A lost lease stops the request; any other ledger error turns
    // checkpoints off for the rest of this request, and the report is written as before.
    const ledger = async (write: (run: ReportRunHandle) => Promise<void>): Promise<void> => {
      if (!durable) return;
      try {
        await write(durable);
      } catch (error) {
        if (error instanceof ReportRunLeaseLostError) throw error;
        console.error("[hamilton-report] run checkpoint failed; continuing without checkpoints", error);
        durable = null;
      }
    };
    /**
     * One section: reused when this run (or a failed run of the same request within the hour)
     * already wrote it from the same input; otherwise written, then saved before anything else.
     */
    const runSection = async (
      index: number,
      input: SectionInput,
      write: (sectionTrack: SectionTracking) => Promise<VerifiedSectionOutput | null>,
    ): Promise<VerifiedSectionOutput | null> => {
      const key = reportSectionStepKey(index);
      const inputHash = sectionInputHash(input);
      const saved = durable?.checkpoints.get(key);
      if (saved && saved.inputHash === inputHash) {
        reusedSections.push(key);
        return saved.output as VerifiedSectionOutput;
      }
      await ledger((run) => startReportSection(run, key));
      const sink: ResponseSink = [];
      const result = await write(sectionTracking(sink));
      if (result && result.status === "ok") {
        // The gate-shadow thunk is not data; a reused section records no shadow verdict.
        const storable = { status: result.status, section: result.section, figuresChecked: result.figuresChecked, citation: result.citation };
        await ledger((run) => saveReportSection(run, key, { inputHash, output: storable, providerResponses: sink }));
      } else if (!result && lastFault) {
        const fault: HamiltonFault = lastFault;
        const attempts = lastAttempts;
        await ledger((run) => failReportSection(run, key, fault, attempts));
      }
      return result;
    };
    const sectionFailed = (input: SectionInput): GenerateReportResult => {
      const fault = lastFault as HamiltonFault | null;
      const paused = fault !== null && (fault.kind === "provider_paused" || fault.kind === "stopped");
      return {
        success: false,
        error: paused
          ? HAMILTON_PAUSED_MESSAGE
          : fault?.kind === "budget"
            ? fault.readerMessage
            : `Hamilton couldn't write the ${input.title} section right now. Please try again in a minute.`,
      };
    };

    // Partner review: a draft that fails the checklist goes back once with the
    // problems named; the rewrite is kept only if it fixes more than it breaks.
    const reviewInput = {
      institutionName,
      feeNames: selectedFeeDeltas.map((delta) => getDisplayName(delta.fee_category)),
      competitorNames: exhibitSet.data.local_market?.comparisons.flatMap((row) => row.competitors.map((c) => c.name)) ?? [],
    };

    // The answer page comes first; the other two sections explain and stress-test
    // its decisions, so they receive it as context and run together. The answer is saved after
    // partner review, so a resumed run never reviews or rewrites it again.
    const answerResult = await runSection(0, sectionInputs[0], async (sectionTrack) => {
      let answer = await generateWithRetry(sectionInputs[0], sectionTrack);
      if (!answer) return null;
      const firstProblems = reviewAnswerPage({ ...reviewInput, narrative: answer.section.narrative });
      partnerReview.problems = firstProblems;
      partnerReview.remaining = firstProblems.length;
      if (firstProblems.length > 0) {
        const rewrite = await generateVerifiedSection({
          ...sectionInputs[0],
          context: `${sectionInputs[0].context ?? ""}\n\n${partnerReviewContext(firstProblems, answer.section.narrative)}`.trim(),
        }, sectionTrack).catch(() => null);
        if (rewrite) {
          const remaining = reviewAnswerPage({ ...reviewInput, narrative: rewrite.section.narrative });
          if (remaining.length < firstProblems.length && rewrite.status !== "needs_review") {
            billedDrafts.push(answer);
            answer = rewrite;
            partnerReview.rewritten = true;
            partnerReview.remaining = remaining.length;
          } else {
            billedDrafts.push(rewrite);
          }
        }
      }
      return answer;
    });
    if (!answerResult) {
      await recordReportOutcome("failed", `Section "${sectionInputs[0].title}" could not finish. Report not saved.`, verifiedSections, { fault: (lastFault as HamiltonFault | null)?.kind ?? null });
      return sectionFailed(sectionInputs[0]);
    }
    verifiedSections.push(answerResult);
    const answerContext = `ANSWER PAGE (already written; explain and stress-test these decisions, do not contradict or add to them):\n${answerResult.section.narrative}`;
    const followUps = await Promise.all(
      sectionInputs.slice(1).map((input, offset) => {
        const withAnswer = { ...input, context: `${input.context ?? ""}\n\n${answerContext}`.trim() };
        return runSection(offset + 1, withAnswer, (sectionTrack) => generateWithRetry(withAnswer, sectionTrack));
      }),
    );
    // All started work has settled; include successful siblings before the one final receipt.
    for (const result of followUps) if (result) verifiedSections.push(result);
    const failedFollowUp = followUps.findIndex((result) => result === null);
    if (failedFollowUp >= 0) {
      await recordReportOutcome("failed", "A report section could not finish. Report not saved.", verifiedSections, { fault: (lastFault as HamiltonFault | null)?.kind ?? null });
      return sectionFailed(sectionInputs[failedFollowUp + 1]);
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
      // #1924: the stamp of the peer index read behind the report's medians, saved with it.
      datasetStamps: [{ label: peerIndex.label, stamp: peerIndex.stamp }],
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
      // A saved answer's reading prints under its label only with the switch on (off by default).
      const printReading = reportFindingReadingEnabled();
      report.addedFindings = addedFindings.map((f) => ({
        source: f.source, title: f.title, detail: f.detail,
        ...(printReading && f.reading?.length ? { reading: [...f.reading] } : {}),
        ...(f.identityContext ? { identityContext: f.identityContext } : {}),
      }));
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
      // H03-T09: the institution's own published rows the report read. Peer figures come from
      // the peer index (medians), which names no rows.
      feeRefs: [...selectedVerifiedFees, ...selectedProvisionalFees].map((fee) => ({
        feePublishedId: fee.id,
        institutionId: fee.institution_id ?? null,
        sourceDocumentId: null,
        sourceContentHash: null,
      })),
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
      // Chosen when the run opened: a replay of this run saves nothing new (#1921).
      ...(durable ? { reportId: durable.reportId } : {}),
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
    await recordPaidFailure?.("Report generation or saving failed. Report was not completed.").catch(() => {});
    if (err instanceof ReportRunLeaseLostError) return { success: false, error: REPORT_RUN_BUSY_MESSAGE };
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
  if (!user || !canAccessPremium(user)) return [];
  return getRecentHamiltonReports(user.id);
}

/**
 * Load active scenarios for the scenario selector.
 */
export async function loadActiveScenarios() {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) return [];
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
  if (!user || !canAccessPremium(user)) return null;
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
  if (!user) return { success: false, error: "Hamilton access required." };
  const blocked = await reportStartError(user);
  if (blocked) return { success: false, error: blocked };
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
