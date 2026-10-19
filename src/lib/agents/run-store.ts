import { sql, withTransaction } from "@/lib/data-store/connection";
import { feeSourceFetch } from "@/lib/agents/fee-source-fetch";
import { mapEvent, mapRun, mapStep } from "./run-row-mappers";
import { getExecutionBackend } from "@/lib/execution-backend";
import { reportReviewStates } from "@/lib/agents/atlas/report-review-states";
import { runDarwinVerify } from "@/lib/agents/darwin/verify";
import { runHamiltonCategoryGuard } from "@/lib/agents/hamilton/category-guard";
import { collapsePublishedDuplicates } from "@/lib/agents/hamilton/duplicate-collapse";
import { fillBlankFrequencies, FREQUENCY_FILL_VERSION } from "@/lib/agents/hamilton/frequency-fill";
import { repairSourceLinks, resourceSourceLinks, SOURCE_LINK_VERSION } from "@/lib/agents/hamilton/source-link";
import { requeueGuardRejectedFees } from "@/lib/agents/hamilton/guard-requeue";
import { rollBackRetiredCompanionFees } from "@/lib/agents/hamilton/companion-retire";
import { rollBackUnreproducedFees } from "@/lib/agents/hamilton/rules-recheck";
import { takeDownUntraceableFees } from "@/lib/agents/hamilton/source-check";
import { reviewKnoxBatches } from "@/lib/agents/knox/batch-review";
import { newerCopyReceiptNote, retireFeesDroppedFromNewerCopy } from "@/lib/agents/hamilton/newer-copy-retire";
import { refreshFeesFromCurrentCopy } from "@/lib/agents/hamilton/refresh-copy";
import { secondLookFeesNotOnCurrentCopy } from "@/lib/agents/hamilton/current-copy";
import {
  currentMonth,
  mailingAddress,
  runMarketingScore,
  runMarketingSend,
  runMarketingWrite,
  summarizeScore,
  summarizeSend,
  summarizeWrite,
} from "@/lib/agents/marketing/monthly";
import { runStateEditions, summarizeStateEditions } from "@/lib/agents/marketing/state-edition";
import { runHamiltonPublish } from "@/lib/agents/hamilton/publish";
import {
  movedSweepCounts,
  PUBLISH_SWEEPS_SPLIT_LIVE,
  PUBLISH_SWEEPS_STEP_KEY,
  publishSweepMode,
  runPublishSweepsStep,
  runsMovedSweep,
  sweepsAfterRows,
  sweepsBeforeGuardRequeue,
  sweepsBeforeNewerCopy,
  sweepsBeforeRefreshCopy,
  sweepsBeforeRows,
  timedSweep,
  type MovedSweepContext,
} from "@/lib/agents/hamilton/publish-sweeps";
import { runGuideDraft } from "@/lib/agents/guides/draft";
import { runKnoxExtract } from "@/lib/agents/knox/extract";
import { consumeRereadRequests, rereadFeedbackDetail } from "@/lib/agents/knox/reread-feedback";
import { fileHeldByName, previewHeldNameRules, recheckHeldRates, recheckHeldRows, recheckPromotedRows, recheckSupersededRows, recheckUntracedRows, refileSupersededRows, RANGE_BAND_LIMIT, setAsideRangeBands } from "@/lib/agents/knox/held-recheck";
import { refreshFeeIndexCache } from "@/lib/data-store/fee-index";
import { runMagellanDiscovery } from "@/lib/agents/magellan/discovery";
import { runMagellanFetch } from "@/lib/agents/magellan/fetch";
import { runAddressVariantFetch, type RunAddressVariantFetchResult } from "@/lib/agents/magellan/address-variant-fetch";
import { runSavedLinkFetch, type RunSavedLinkFetchResult } from "@/lib/agents/magellan/saved-link-fetch";
import { reviewLinkBatches } from "@/lib/agents/magellan/batch-review";
import { recordLinkOutcomes } from "@/lib/agents/magellan/outcomes";
import { recordAuditMisses } from "@/lib/agents/deming/audit-misses";
import { runChangeOutcomes, summarizeChangeOutcomes } from "@/lib/agents/deming/change-outcomes";
import { refreshPageClassifier } from "@/lib/agents/magellan/page-classifier";
import { isRegistryStepKey, runRegistryStep } from "@/lib/agents/magellan/registry";
import {
  clusterPublicDiscoveryFindings,
  runPublicDiscoveryAudit,
  summarizePublicDiscoveryDiagnosis,
} from "@/lib/agents/public-discovery";
import { runRosettaRead } from "@/lib/agents/rosetta/read";
import { runRosettaPaidRead } from "@/lib/agents/rosetta/paid-read";
import { runMagellanPaidFind } from "@/lib/agents/magellan/paid-find";
import { runKnoxPaidExtract } from "@/lib/agents/knox/paid-extract";
import { runDarwinReleaseHeld } from "@/lib/agents/darwin/release-held";
import { releaseRecordedPasses } from "@/lib/agents/darwin/release-review";
import { runDarwinConditionalZeroResolve } from "@/lib/agents/darwin/conditional-zero-resolve";
import { runDarwinScheduleRefile } from "@/lib/agents/darwin/schedule-refile";
import { runDarwinAdjudicate } from "@/lib/agents/darwin/adjudicate";
import { countLiveFragmentNames, liveFragmentDetail, liveFragmentFindingsDetail, recheckLiveFragmentNames } from "@/lib/agents/darwin/live-fragment-check";
import { countHourlyFees, hourlyDetail, hourlyFindingsDetail, recheckHourlyFrequencies } from "@/lib/agents/darwin/hourly-frequency-check";
import { countNonDepositFees, nonDepositDetail, nonDepositFindingsDetail, recheckNonDepositDocuments } from "@/lib/agents/darwin/non-deposit-document-check";
import { recheckTranslatedCopies, translatedCopyDetail } from "@/lib/agents/darwin/translated-copy-check";
import { canadianDocumentDetail, recheckCanadianDocuments } from "@/lib/agents/darwin/canadian-document-check";
import { lineConflictDetail, recheckLineConflicts } from "@/lib/agents/darwin/line-conflict-check";
import { documentOwnerDetail } from "@/lib/agents/darwin/document-owner";
import { findingsDetail as releaseRepairFindingsDetail, releaseRepairDetail, runReleaseRepairStep } from "@/lib/agents/darwin/release-repair";
import { AUDIENCE_RELABEL_VERSION, dryRunFullTotals, runAudienceRelabel, type AudienceRelabelMode } from "@/lib/agents/darwin/audience-relabel";
import { runDailyBrief } from "@/lib/agents/daily-brief";
import { runSundayMaintenance, summarizeSundayMaintenance } from "@/lib/agents/deming/sunday-maintenance";
import { runFeeAlertDispatch, summarizeFeeAlertDispatch } from "@/lib/agents/fee-alerts";
import { runProDigest, summarizeProDigest } from "@/lib/agents/pro-digest";
import { runProSeatCheck, summarizeProSeatCheck } from "@/lib/hamilton/pro-seat-check";
import { PREVIEW_INSTITUTION_ID, runCompetitorAlerts, summarizeCompetitorAlerts } from "@/lib/hamilton/competitor-alerts";
import { runBriefingRefresh, summarizeBriefingRefresh } from "@/lib/hamilton/briefing-snapshots";
import { runLeadWatch, summarizeLeadWatch } from "@/lib/leads/lead-alerts";
import { runIndexNowPing, summarizeIndexNow } from "@/lib/seo/indexnow";
import { runAnswerKeyScore, summarizeAnswerKeyScore } from "@/lib/agents/answer-key-score";
import { runScoreboardSnapshot, summarizeScoreboard } from "@/lib/agents/scoreboard";
import { runDemingRegression, summarizeDemingRegression, DEMING_REGRESSION_VERSION } from "@/lib/agents/deming/regression";
import { freshAuditDetail, runFreshAudit, summarizeFreshAudit } from "@/lib/agents/deming/fresh-audit";
import { benchmarkHealthDetail, runBenchmarkHealth, summarizeBenchmarkHealth } from "@/lib/agents/deming/benchmark-health";
import { playbookContradictionsDetail, runPlaybookContradictions, summarizePlaybookContradictions } from "@/lib/agents/deming/playbook-contradictions";
import { dataQualityDetail, runDataQuality, summarizeDataQuality } from "@/lib/agents/deming/data-quality";
import { readSourceHealth, sourceHealthDetail, summarizeSourceHealth } from "@/lib/agents/hoovie/source-health";
import { knoxMissesDetail, runKnoxMisses, summarizeKnoxMisses } from "@/lib/agents/deming/knox-misses";
import { runBayesLedger, summarizeBayesLedger, BAYES_LEDGER_VERSION } from "@/lib/agents/bayes/ledger";
import { runScheduleCheck, summarizeScheduleCheck, SCHEDULE_CHECK_VERSION } from "@/lib/agents/atlas/schedule-check";
import { cityRepairDetail, runCityRepair, summarizeCityRepair } from "@/lib/agents/atlas/city-repair";
import { handLinkRepairDetail, runHandLinkRepair, summarizeHandLinkRepair } from "@/lib/agents/atlas/hand-link-repair";
import { runStorageRetention, storageRetentionDetail, summarizeStorageRetention } from "@/lib/agents/atlas/storage-retention";
import { coldTierDetail, runColdTier, summarizeColdTier } from "@/lib/agents/hoovie/storage-tiers";
import { answerKeyRelabelDetail, runAnswerKeyRelabels, summarizeAnswerKeyRelabels } from "@/lib/agents/atlas/answer-key-relabels";
import { inSavepoint } from "@/lib/agents/savepoint";
import { MARKET_SPREAD_WORKFLOW, runMarketSpread, summarizeMarketSpread } from "@/lib/agents/content/market-spread";
import { FEE_DEPTH_WORKFLOW, runFeeDepth, summarizeFeeDepth } from "@/lib/agents/content/fee-depth";
import { runOdByState, summarizeOdByStateResult } from "@/lib/agents/content/od-by-state";
import { DEFAULT_DRAFT_AGENT } from "@/lib/data-store/content-drafts";
import { refreshContactPicks, runContactFinder, summarizeContactFinder, summarizeContactPicks } from "@/lib/agents/growth/contacts";
import { outreachCampaignsFromEnv, runOutreachDrafts, runOutreachFollowUps, summarizeOutreach, withdrawNonBuyerDrafts } from "@/lib/agents/growth/outreach";
import { runLearningReport, summarizeLearning } from "@/lib/agents/growth/learning";
import { runQuoteDrafts, summarizeQuoteDrafts } from "@/lib/agents/growth/quote";
import { runMondayPlan, runProposals, summarizeMondayPlan, summarizeProposals } from "@/lib/agents/growth/draper";
import { runMarketIntel, summarizeMarketIntel } from "@/lib/agents/growth/sherlock";
import { runConversionCheck, summarizeConversionCheck } from "@/lib/agents/growth/norman";
import { runToolCheck, summarizeToolCheck } from "@/lib/agents/growth/edison";
import { runGrowthIntake, summarizeGrowthIntake } from "@/lib/agents/growth/intake";
import { lessonsLine, recentLessons, skippedSubjects } from "@/lib/agents/growth/lessons";
import { PRESS_WORKFLOW, runPressPitches, summarizePressPitches } from "@/lib/agents/growth/bernays";
import { runGrowthScore, summarizeGrowthScore } from "@/lib/agents/growth/score";
import { isStudyStep, runStudyStep, summarizeStudyStep } from "@/lib/agents/hamilton/studies";
import { assertAutomationEnabled, getAutomationControl, getMarketingControl, getPipelineControl, type AutomationControlState } from "@/lib/automation-control";
import { normalizeStateCode, syncStateLaneProfiles } from "./state-lane-memory";
import { laneRecheckParam, numericRunParam, stringRunParam } from "./run-params";
export { laneRecheckParam } from "./run-params";
import { runStateExpertStep } from "./state-expert/step";
import { workListLedger } from "./state-expert/work-list";
import { tallyByInstitution, type Sample } from "./flow-model";
import { runReportCloseStep, runReportReconcileStep, runReportRenderStep } from "@/lib/report-engine/render-job";
import type {
  AdminAgent,
  AgentRunEventSnapshot,
  AgentRunKind,
  AgentRunStatus,
  AgentRunSnapshot,
  AgentRunStepDefinition,
  AgentRunStepStatus,
  AgentRunStepSnapshot,
  AgentRunTriggerSource,
} from "./types";
import {
  isProviderStep,
  MARKETING_STEP_KEYS,
  MAX_STEP_ATTEMPTS,
  PAUSE_EXEMPT_STEP_KEYS,
  pauseScopeForStep,
  OPTIONAL_PAID_PASS_STEP_KEYS,
  PROVIDER_STEP_KEYS,
  STALE_RUNNING_STEP_MINUTES,
} from "./types";

const ACTIVE_STATUSES = ["queued", "running", "cancel_requested"];
/** Category-guard rollbacks per publish step; a larger guard change comes down over several steps. */
const CATEGORY_GUARD_STEP_LIMIT = 100;
const RUN_KINDS_WITH_LEDGER = ["workflow", "workflow_lane", "state_agent", "report", "manual_repair", "dry_run"] as const;
const RUN_SUMMARY_MAX_LENGTH = 2_000;

type SqlTag = typeof sql;
export interface AgentRunSelectionScope {
  agent: AdminAgent;
  kind: AgentRunKind;
  source: string;
}

/**
 * Every institution's totals for a fee step, so the live board's counts are the step's real
 * numbers rather than whatever fell into the ten sample rows. Capped to keep events small.
 */
/**
 * The deploy (git commit) this code runs from, or null outside Vercel. Recorded on every
 * step failure so a failure from an old deploy can be told apart from one the current
 * code still has (wakeLanesAfterRecovery).
 */
export function currentDeploy(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA || null;
}

function institutionResults(stepKey: string, rows: Sample[]) {
  return tallyByInstitution(stepKey, rows).slice(0, 50);
}

/** A completed run's summary is what its steps actually reported, never stock text. */
export async function completedRunSummary(db: SqlTag, runId: number, completed: number, total: number): Promise<string> {
  const steps = await db<Array<{ summary: string | null }>>`
    SELECT summary
      FROM agent_run_steps
     WHERE agent_run_id = ${runId}
       AND summary IS NOT NULL
     ORDER BY sequence, id
  `;
  const head = `Completed ${completed} of ${total} step${total === 1 ? "" : "s"}.`;
  const text = [head, ...steps.map((step) => String(step.summary).trim()).filter(Boolean)].join(" ");
  return text.length > RUN_SUMMARY_MAX_LENGTH ? `${text.slice(0, RUN_SUMMARY_MAX_LENGTH - 1)}…` : text;
}

interface AgenticStepExecution {
  status: Extract<AgentRunStepStatus, "completed" | "skipped">;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface AgentRunExecutionResult {
  runId: number;
  status: AgentRunStatus | "missing";
  terminal: boolean;
  executedSteps: number;
  message: string;
  /** True when the run was left queued because its first real step would not finish by the tick deadline. */
  heldForDeadline?: boolean;
}

export interface ExecuteQueuedAgentRunsResult {
  selected: number;
  results: AgentRunExecutionResult[];
}

export interface StartAgentRunInput {
  agent: AdminAgent;
  kind: AgentRunKind;
  title: string;
  stateCode?: string;
  params?: Record<string, unknown>;
  triggeredBy: string;
  triggerSource?: AgentRunTriggerSource;
  idempotencyKey?: string;
  /** Once-per-key scheduled work: serialize lookup/create and also reuse terminal history. */
  reuseTerminal?: boolean;
  steps: AgentRunStepDefinition[];
  summary?: string;
}

export interface StartAgentRunResult {
  run: AgentRunSnapshot;
  steps: AgentRunStepSnapshot[];
  reused: boolean;
}

function isTerminalRunStatus(status: string): boolean {
  return !ACTIVE_STATUSES.includes(status);
}

function runParamsForStep(
  run: AgentRunSnapshot,
  step: AgentRunStepSnapshot,
): Record<string, unknown> {
  return { ...run.params, ...step.input };
}

async function countRows(tx: SqlTag, table: string, where = "TRUE"): Promise<number> {
  const [row] = await tx.unsafe(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`);
  return Number(row?.count ?? 0);
}

interface KnoxDecisionQueueSnapshot {
  pending: number;
  confirmed: number;
  overridden: number;
  total: number;
}

async function getKnoxDecisionQueueSnapshot(tx: SqlTag): Promise<KnoxDecisionQueueSnapshot> {
  const rows = await tx<{ bucket: string; cnt: string | number }[]>`
    SELECT
      CASE
        WHEN ko.decision IS NULL THEN 'pending'
        WHEN ko.decision = 'confirm' THEN 'confirmed'
        WHEN ko.decision = 'override' THEN 'overridden'
        ELSE 'other'
      END AS bucket,
      COUNT(*) AS cnt
    FROM agent_messages am
    LEFT JOIN knox_overrides ko ON ko.rejection_msg_id = am.message_id
    WHERE am.sender_agent = 'knox'
      AND am.intent = 'reject'
    GROUP BY 1
  `;
  const counts: KnoxDecisionQueueSnapshot = {
    pending: 0,
    confirmed: 0,
    overridden: 0,
    total: 0,
  };
  for (const row of rows) {
    const count = Number(row.cnt ?? 0);
    if (row.bucket === "pending") counts.pending = count;
    if (row.bucket === "confirmed") counts.confirmed = count;
    if (row.bucket === "overridden") counts.overridden = count;
    counts.total += count;
  }
  return counts;
}

async function countInstitutionRows(
  tx: SqlTag,
  stateCode?: string,
): Promise<{ total: number; missingWebsite: number }> {
  if (stateCode) {
    const [row] = await tx`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE website_url IS NULL OR btrim(website_url) = '')::int AS missing_website
        FROM institution_sources
       WHERE upper(btrim(state_code)) = ${stateCode}
    `;
    return {
      total: Number(row?.total ?? 0),
      missingWebsite: Number(row?.missing_website ?? 0),
    };
  }

  return {
    total: await countRows(tx, "institution_sources"),
    missingWebsite: await countRows(tx, "institution_sources", "website_url IS NULL"),
  };
}

async function executeAgenticStep(
  tx: SqlTag,
  run: AgentRunSnapshot,
  step: AgentRunStepSnapshot,
): Promise<AgenticStepExecution> {
  const params = runParamsForStep(run, step);
  const stateCode = normalizeStateCode(
    stringRunParam(params, ["state_code", "stateCode", "state"]),
  ) ?? undefined;

  // Regulator-data steps (registry-*) share one dispatcher in magellan/registry.
  if (isRegistryStepKey(step.stepKey)) {
    return runRegistryStep({
      stepKey: step.stepKey,
      runId: run.id,
      partitionKey: stringRunParam(params, ["partition_key"]),
      dryRun: run.runKind === "dry_run",
      db: tx,
    });
  }

  // Hamilton's answer eval: the quality bar asked of a spread of real institutions. Read-only, no model calls.
  // Atlas's hourly nationwide lane sync (state-lane-scheduler.ts), from its own route.
  if (step.stepKey === "lane-sync") {
    const { runNationwideLaneSync } = await import("@/lib/agents/state-lane-scheduler");
    const synced = await runNationwideLaneSync();
    const seconds = Math.round((synced.ms.profiles + synced.ms.unchecked + synced.ms.second_looks + synced.ms.priorities) / 1000);
    return {
      status: "completed",
      summary: `Synced every state's lane and profiles (${synced.profiles.lanesTouched.toLocaleString()} lanes, ${synced.profiles.profilesTouched.toLocaleString()} profiles); woke ${synced.uncheckedWoken.toLocaleString()} lane(s) with unchecked live fees and ${synced.secondLookWoken.toLocaleString()} with a pending second look; ${synced.priorities.error ? `the priority refresh failed (${synced.priorities.error}), so every lane kept its score` : `rescored ${synced.priorities.updated.toLocaleString()} lane(s)`}; ${seconds} s.`,
      detail: {
        lanes_touched: synced.profiles.lanesTouched,
        profiles_touched: synced.profiles.profilesTouched,
        profile_sync_failures: synced.profiles.failures,
        unchecked_woken: synced.uncheckedWoken,
        second_look_woken: synced.secondLookWoken,
        priorities_updated: synced.priorities.updated,
        priorities_error: synced.priorities.error,
        part_ms: synced.ms,
      },
    };
  }

  if (step.stepKey === "hamilton-answer-eval") {
    const { runAnswerEval } = await import("@/lib/hamilton/answer-eval");
    const result = await runAnswerEval({ perGroup: Number(params.per_group) > 0 ? Number(params.per_group) : 1 });
    return {
      status: "completed",
      summary: `Answered ${result.answers} questions for ${result.institutions} of ${result.planned} institutions; ${result.passed} met the bar; ${result.correctness.correct} of ${result.correctness.checked} checked tie to the live catalog.${result.pro ? ` Replayed ${result.pro.questions}${result.pro.planned && result.pro.planned > result.pro.questions ? ` of ${result.pro.planned}` : ""} Pro questions: ${result.pro.passed} met the bar, ${result.pro.correctness.correct} of ${result.pro.correctness.checked} checked tie to the catalog, ${result.pro.askedBack} still asked back.` : ""}${result.timedOut ? " Stopped at the time budget." : ""}`,
      detail: { ...result },
    };
  }

  // Hamilton's paid answer eval (#1079): a provider step, capped at five paid samples a day.
  if (step.stepKey === "hamilton-paid-answer-eval") {
    const { runPaidAnswerEval } = await import("@/lib/hamilton/paid-answer-eval");
    const result = await runPaidAnswerEval({ agentRunId: run.id });
    const memo = result.paths[0];
    const names: Record<string, string> = { simulate: "Simulate", written_answer: "Written answer", report: "Report answer page" };
    const simulateLine = result.paths
      .filter((p) => p.path !== "memo" && p.sampled > 0)
      .map((p) => ` ${names[p.path] ?? p.path}: ${p.passed} of ${p.answers} passed; ${p.correctness.correct} of ${p.correctness.checked} checked tie.`)
      .join("");
    return {
      status: "completed",
      summary: result.note ?? `Wrote ${memo.passed} of ${memo.answers} paid memos (cap ${result.cap} a day, ${result.usedBefore} used before); ${memo.correctness.correct} of ${memo.correctness.checked} checked tie to the live catalog.${simulateLine}`,
      detail: { ...result },
    };
  }

  // Hamilton's studies (study-*) share one dispatcher in hamilton/studies.
  if (isStudyStep(step.stepKey)) {
    const result = await runStudyStep(step.stepKey, {
      db: tx,
      runId: run.id,
      dryRun: run.runKind === "dry_run",
      force: params.force === true || params.force === "true",
    });
    return {
      status: "completed",
      summary: summarizeStudyStep(result),
      detail: {
        schema_ready: result.schemaReady,
        study_key: result.studyKey,
        as_of: result.asOf,
        stored: result.stored,
        already_current: result.alreadyCurrent,
        study_id: result.studyId,
        n: result.n,
        placements: result.placements,
        headline: result.headline,
        dry_run: result.dryRun,
      },
    };
  }

  switch (step.stepKey) {
    case "enhance": {
      const memory = await syncStateLaneProfiles(tx, stateCode);
      const { total, missingWebsite } = await countInstitutionRows(tx, stateCode);
      return {
        status: "completed",
        summary: `Profile inventory checked${stateCode ? ` for ${stateCode}` : ""}: ${total.toLocaleString()} institutions, ${missingWebsite.toLocaleString()} missing websites, ${memory.backlogMissingUrls.toLocaleString()} missing fee URLs.`,
        detail: {
          state_code: stateCode ?? null,
          total_institutions: total,
          missing_website_url: missingWebsite,
          profiles_touched: memory.profilesTouched,
          backlog_missing_urls: memory.backlogMissingUrls,
          backlog_stale_sources: memory.backlogStaleSources,
          backlog_ocr: memory.backlogOcr,
          backlog_manual_review: memory.backlogManualReview,
          failures: memory.failures,
          corrections: memory.corrections,
        },
      };
    }
    case "state-expert": {
      return runStateExpertStep({
        db: tx,
        runId: run.id,
        stepId: step.id,
        stateCode,
        dryRun: run.runKind === "dry_run",
      });
    }
    case "discover":
    case "rescue": {
      // A quarterly re-check run asks discovery to re-validate every link and re-search
      // dead and needs-human banks; Magellan reads `recheck` from the run params.
      const recheck = laneRecheckParam(params);
      const discovery = await runMagellanDiscovery({
        runId: run.id,
        stepId: step.id,
        mode: step.stepKey === "rescue" ? "rescue" : "discover",
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["discovery_limit", "rescue_limit", "limit", "size"]),
        upgradeSlots: numericRunParam(params, ["upgrade_slots"]),
        stateCode,
      });
      // Outcome ledger: judge one slot of banks' links by the live fees they produced and
      // write the judgements to the shared learning store.
      const linkOutcomes = await recordLinkOutcomes(tx, {
        runId: run.id,
        stateCode,
        dryRun: run.runKind === "dry_run",
      });
      // Error review: every chunk of judged links is scored against Darwin and the answer
      // key, per finder; finders that keep failing run last (magellan/batch-review.ts).
      const batchReview = await reviewLinkBatches(tx, { runId: run.id, dryRun: run.runKind === "dry_run" });
      // MG-4: retrain the shadow fee-page classifier from the ledger when it is 6+ hours old.
      const pageClassifier = await refreshPageClassifier(tx, { runId: run.id, dryRun: run.runKind === "dry_run" });
      return {
        status: "completed",
        summary: `Magellan processed ${discovery.processed.toLocaleString()} institutions and discovered ${discovery.discovered.toLocaleString()} fee schedule URLs (${discovery.retryAfter.toLocaleString()} retry later, ${discovery.dead.toLocaleString()} no source, ${discovery.needsHuman.toLocaleString()} need human review).`,
        detail: {
          link_outcomes: linkOutcomes,
          batch_review: batchReview,
          page_classifier: { ...pageClassifier, scored_with: discovery.pageClassifier },
          selected_institutions: discovery.selected,
          processed_institutions: discovery.processed,
          discovered_fee_urls: discovery.discovered,
          dead_institutions: discovery.dead,
          needs_human: discovery.needsHuman,
          retry_after: discovery.retryAfter,
          failures: discovery.failures,
          attempted_urls: discovery.attemptedUrls,
          discovery_codes: discovery.codes,
          resumed_searches: discovery.resumed,
          found_by: discovery.foundBy,
          websites_repaired: discovery.websitesRepaired,
          blocked_homepage_rescues: discovery.blockedHomepageRescues,
          method_version: discovery.methodVersion,
          learning_log: discovery.learning,
          second_documents_status: discovery.secondDocuments?.status ?? null,
          second_documents_checked: discovery.secondDocuments?.checked ?? 0,
          second_documents_found: discovery.secondDocuments?.found ?? 0,
          restored_fee_pages: discovery.restoredFeePages?.restored ?? 0,
          restored_fee_page_samples: discovery.restoredFeePages?.samples ?? [],
          kept_refused_answers: discovery.keptRefusedAnswers?.kept ?? 0,
          kept_refused_answer_samples: discovery.keptRefusedAnswers?.samples ?? [],
          search_miss_lessons: discovery.searchMisses,
          discovery_limit: discovery.limit,
          dry_run: discovery.dryRun,
          recheck,
          sample_results: discovery.results.slice(0, 10).map((result) => ({
            institution_id: result.institutionId,
            outcome: result.outcome,
            code: result.code,
            found_by: result.foundBy,
            url: result.url,
            confidence: result.confidence,
            reason: result.reason,
            platform: result.platform,
          })),
        },
      };
    }
    case "fetch": {
      const recheck = laneRecheckParam(params);
      const fetched = await runMagellanFetch({
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["fetch_limit", "limit", "size"]),
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
        newLinksOnly: params.new_links_only === true,
        requestedUrl: typeof params.fee_schedule_url === "string" ? params.fee_schedule_url : null,
      });
      // Fee links the plain fetch keeps failing to reach, tried at the bank's other
      // spellings of the address (#1051). Free; a failure here never fails the step.
      let addressVariants: RunAddressVariantFetchResult | null = null;
      if (run.runKind !== "dry_run") {
        try {
          addressVariants = await runAddressVariantFetch({
            db: sql,
            fetchImpl: feeSourceFetch,
            runId: run.id,
            stepId: step.id,
            institutionId: numericRunParam(params, ["institution_id"]) ?? null,
          });
        } catch (error) {
          console.error("Address variant fetch failed:", error);
        }
      }
      // Saved fee links the plain fetch never asked for (it asks for the remembered address
      // first), stored beside it for the current-copy check (#1881). Free; never fails the step.
      let savedLinks: RunSavedLinkFetchResult | null = null;
      if (run.runKind !== "dry_run") {
        try {
          savedLinks = await runSavedLinkFetch({
            db: sql,
            fetchImpl: feeSourceFetch,
            runId: run.id,
            stepId: step.id,
            institutionId: numericRunParam(params, ["institution_id"]) ?? null,
          });
        } catch (error) {
          console.error("Saved link fetch failed:", error);
        }
      }
      return {
        status: "completed",
        summary: `Magellan fetched ${fetched.succeeded.toLocaleString()} new source documents from ${fetched.processed.toLocaleString()} selected institutions (${fetched.unchanged.toLocaleString()} unchanged, ${fetched.failed.toLocaleString()} failed, ${fetched.skipped.toLocaleString()} skipped).`,
        detail: {
          address_variants: addressVariants
            ? {
                selected: addressVariants.selected,
                tried: addressVariants.tried,
                recovered: addressVariants.recovered,
                failed: addressVariants.failed,
                results: addressVariants.results.slice(0, 10),
              }
            : null,
          saved_links: savedLinks
            ? {
                selected: savedLinks.selected,
                tried: savedLinks.tried,
                stored: savedLinks.stored,
                matched: savedLinks.matched,
                failed: savedLinks.failed,
                switch_live: savedLinks.live,
                results: savedLinks.results.slice(0, 10),
                would_fetch: savedLinks.wouldFetch,
              }
            : null,
          selected_institutions: fetched.selected,
          processed_institutions: fetched.processed,
          fetched_documents: fetched.succeeded,
          unchanged_documents: fetched.unchanged,
          reused_documents: fetched.reusedDocuments,
          companion_pages_status: fetched.companions?.status ?? null,
          companion_pages_fetched: fetched.companions?.fetched ?? 0,
          companion_pages_unchanged: fetched.companions?.unchanged ?? 0,
          companion_pages_failed: fetched.companions?.failed ?? 0,
          companion_pages_retired: fetched.companions?.review.retired.length ?? 0,
          companion_pages_renamed: fetched.companions?.review.renamed.length ?? 0,
          companion_pages_retired_samples: (fetched.companions?.review.retired ?? []).slice(0, 10).map((page) => ({
            companion_source_id: page.companionId,
            institution_id: page.institutionId,
            url: page.url,
          })),
          stored_documents: fetched.storedDocuments,
          vault: fetched.vault,
          failed_fetches: fetched.failed,
          skipped_fetches: fetched.skipped,
          fetched_bytes: fetched.bytes,
          fetch_limit: fetched.limit,
          dry_run: fetched.dryRun,
          recheck,
          outcomes: fetched.outcomes,
          learning_log: fetched.learning,
          sample_results: fetched.results.slice(0, 10).map((result) => ({
            institution_id: result.institutionId,
            outcome: result.outcome,
            final_url: result.finalUrl,
            status_code: result.statusCode,
            document_type: result.documentType,
            content_hash: result.contentHash,
            attempt_outcome: result.attemptOutcome,
            reason: result.reason,
          })),
        },
      };
    }
    case "discover-paid":
    case "read-paid":
    case "extract-paid":
    case "verify-paid": {
      const runner = step.stepKey === "discover-paid"
        ? runMagellanPaidFind
        : step.stepKey === "read-paid"
          ? runRosettaPaidRead
          : step.stepKey === "extract-paid"
            ? runKnoxPaidExtract
            : runDarwinAdjudicate;
      const paid = await runner({
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["paid_limit"]),
        stateCode,
        db: tx,
      });
      const dollars = (paid.costMicrousd / 1_000_000).toFixed(2);
      // A pass switched off because its verdicts could not act (#1111) says so.
      const skipped = paid.results.flatMap((entry) => (typeof entry.skipped === "string" ? [`${entry.pass}: ${entry.skipped}`] : []));
      return {
        status: "completed",
        summary: paid.budgetStopped && paid.processed === 0
          ? `Paid pass skipped: ${paid.budgetReason ?? "budget cap"}.`
          : paid.processed === 0 && skipped.length > 0
            ? `Paid pass skipped, $0 spent (${skipped.join("; ")}).`
            : `Paid pass: ${paid.succeeded.toLocaleString()} of ${paid.processed.toLocaleString()} succeeded for $${dollars}${paid.budgetStopped ? `; then stopped: ${(paid.budgetReason ?? "a budget cap (which cap was not recorded)").replace(/\.$/, "")}` : ""}.`,
        detail: {
          selected: paid.selected,
          processed: paid.processed,
          succeeded: paid.succeeded,
          failed: paid.failed,
          budget_stopped: paid.budgetStopped,
          budget_reason: paid.budgetReason,
          cost_microusd: paid.costMicrousd,
          dry_run: paid.dryRun,
          sample_results: paid.results.slice(0, 10),
          // Every work-list entry, which the 10-entry sample usually cuts (#1269).
          ...(step.stepKey === "discover-paid" ? { work_lists: workListLedger(paid.results) } : {}),
        },
      };
    }
    case "read": {
      const read = await runRosettaRead({
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["read_limit", "limit", "size"]),
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
      });
      return {
        status: "completed",
        summary: `Rosetta read ${read.completed.toLocaleString()} text artifacts from ${read.processed.toLocaleString()} selected documents (${read.needsOcr.toLocaleString()} need OCR, ${read.failed.toLocaleString()} failed, ${read.empty.toLocaleString()} empty).`,
        detail: {
          selected_documents: read.selected,
          processed_documents: read.processed,
          text_artifacts: read.completed,
          empty_documents: read.empty,
          needs_ocr: read.needsOcr,
          failed_reads: read.failed,
          skipped_reads: read.skipped,
          skipped_known_failures: read.skippedKnownFailures,
          wrong_documents: read.wrongDocuments + read.triagedWrongDocuments,
          sent_back_to_magellan: read.sentBackToMagellan,
          read_from_vault: read.readFromVault,
          reread_documents: read.reread,
          table_rows: read.tableRows,
          ocr_read: read.ocrRead,
          js_fallback_read: read.jsFallbackRead,
          handed_to_magellan: read.handedToMagellan,
          deferred_scans: read.deferred,
          triaged_texts: read.triagedTexts,
          reopened_fee_pages: read.reopenedFeePages,
          reopened_bans_lifted: read.reopenedBansLifted,
          reopened_links_restored: read.reopenedLinksRestored,
          reopened_unreadable_pdfs: read.reopenedUnreadablePdfs,
          thin_copies_set_aside: read.thinCopiesSetAside,
          text_survival_refreshed: read.textSurvivalRefreshed,
          texts_held_up: read.textsHeldUp,
          texts_lost_fees: read.textsLostFees,
          reader_escalations: read.readerEscalations,
          reader_escalations_used: read.readerEscalationsUsed,
          formats_backfilled: read.formatsBackfilled,
          outcomes: read.outcomes,
          learning_log: read.learning,
          read_chars: read.chars,
          read_limit: read.limit,
          dry_run: read.dryRun,
          sample_results: read.results.slice(0, 10).map((result) => ({
            source_document_id: result.sourceDocumentId,
            institution_id: result.institutionId,
            institution_name: result.institutionName,
            status: result.status,
            source_url: result.sourceUrl,
            document_type: result.documentType,
            content_type: result.contentType,
            char_count: result.charCount,
            attempt_outcome: result.attemptOutcome,
            format: result.format,
            error: result.error,
          })),
        },
      };
    }
    case "extract": {
      const extraction = await runKnoxExtract({
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["extract_limit", "limit", "size"]),
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
        db: tx,
      });
      // Lines promoted from held that today's rules no longer file the same go back on hold.
      const promotionRecheck = await recheckPromotedRows(tx, {
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
      });
      // Lines older rules held as unclassified get today's rules too.
      const heldRecheck = await recheckHeldRows(tx, {
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
      });
      // Held lines whose name a person labelled, or the live store settles across banks, go to
      // Darwin under that category (#1102).
      const nameFile = await fileHeldByName(tx, {
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
      });
      // Lines held because the self-check could not trace them get today's self-check too.
      const untracedRecheck = await recheckUntracedRows(tx, {
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
      });
      // Lines a re-read retired that the current text still prints the same way go back to Darwin.
      // Not scoped to the run's lane: the paid-reader rows are few (43 on 9 Oct), and a lane
      // reaches its own banks' rows only when that state comes round.
      const supersededRecheck = await recheckSupersededRows(tx, {
        dryRun: run.runKind === "dry_run",
      });
      // Free-pass rows a re-read retired before #1147 (1,626 on 12 Oct), 200 a pass (#1093 step 2).
      const supersededFreeRecheck = await recheckSupersededRows(tx, {
        dryRun: run.runKind === "dry_run",
        source: "free",
      });
      // Retired rows today's free team reads under a new category, and taken-over rows with a stale
      // category flag (#1093; James switched it on Oct 15). A state lane re-files only its state's
      // rows and a direct run only its bank's: unscoped, every lane read all banks' rows, which took
      // zero-document extracts from 7 s to 53 s. Switched off, a lane skips the read-only sample.
      const supersededRefile = await refileSupersededRows(tx, {
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
        // A state lane only (a state and no institution): a direct run for one bank carries its
        // state too, and still reads the sample, which is the evidence for turning the pass on.
        skipSample: Boolean(stateCode) && numericRunParam(params, ["institution_id"]) == null,
      });
      // Held percentage fees in categories that publish rates go to Darwin as rate fees.
      const rateRecheck = await recheckHeldRates(tx, {
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
      });
      // Held range lines with no category that are deposit or loan rate bands, set aside as not fees
      // (#1102). Switch off: counted only, nothing written.
      const rangeBands = await setAsideRangeBands(tx, {
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
      });
      // Held unclassified lines the held-name rules would send to Darwin (#1102). Switch off: read only.
      const heldNamePreview = await previewHeldNameRules(tx, { institutionId: numericRunParam(params, ["institution_id"]), stateCode });
      // Darwin's re-read requests for fee names it could not name (#1511): each line read again with
      // today's rules, once per rules version. Switch off: a one-bank run counts and reads a sample
      // read only (one event); a state or all-bank lane skips it (no index on the request kind).
      const rereadFeedback = await consumeRereadRequests(tx, {
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
        skipSample: numericRunParam(params, ["institution_id"]) == null,
      });
      const rereadNote = rereadFeedback.pending > 0
        ? ` Darwin's re-read requests: ${rereadFeedback.pending.toLocaleString()} pending, ${rereadFeedback.read.toLocaleString()} read with today's rules (${rereadFeedback.live && !rereadFeedback.dryRun ? `${rereadFeedback.resolved.toLocaleString()} settled, ${rereadFeedback.renamed.length.toLocaleString()} renamed, ${rereadFeedback.sentToDarwin.length.toLocaleString()} sent to Darwin` : "switch off: nothing written"}).`
        : "";
      // Every 500 settled reads: the batch's error rate and its misses, written for learning.
      const batchReview = await reviewKnoxBatches(tx, { runId: run.id, dryRun: run.runKind === "dry_run" });
      const batchNote = batchReview.batches
        .map((batch) => ` Batch review of reads ${batch.firstFeeRawId}-${batch.lastFeeRawId}: ${batch.errorRate == null ? "none judged" : `${(batch.errorRate * 100).toFixed(1)}% wrong`} (${batch.darwinRejected} rejected by Darwin, ${batch.takenDown} taken down, of ${batch.judged} judged).`)
        .join("");
      return {
        status: "completed",
        summary: `Knox extracted ${extraction.insertedFees.toLocaleString()} raw fee observations and ${extraction.freeFees.toLocaleString()} free fees from ${extraction.processedDocuments.toLocaleString()} Rosetta text artifacts (${extraction.extractedFees.toLocaleString()} candidates, ${extraction.skippedFees.toLocaleString()} skipped). Re-read ${heldRecheck.checked.toLocaleString()} held lines with today's rules: ${heldRecheck.promoted.toLocaleString()} categorized and sent to Darwin, ${heldRecheck.setAside.toLocaleString()} set aside (kept, logged), ${promotionRecheck.withdrawn.toLocaleString()} earlier promotions put back on hold. Filed ${nameFile.filed.toLocaleString()} held lines by their name (${nameFile.bySource.label.toLocaleString()} labelled, ${nameFile.bySource.store.toLocaleString()} settled across banks) and ${nameFile.dryRun ? "would send them" : "sent them"} to Darwin, of ${nameFile.checked.toLocaleString()} a name decision covers. Re-traced ${untracedRecheck.checked.toLocaleString()} untraced held lines: ${untracedRecheck.promoted.toLocaleString()} sent to Darwin. Re-read ${supersededRecheck.checked.toLocaleString()} lines a re-read retired: ${supersededRecheck.promoted.toLocaleString()} ${supersededRecheck.live ? "sent to Darwin" : "would go to Darwin (dry read)"}, ${supersededRecheck.liveTwin.toLocaleString()} kept back for a live twin. Re-read ${supersededFreeRecheck.checked.toLocaleString()} free lines a re-read retired: ${supersededFreeRecheck.promoted.toLocaleString()} ${supersededFreeRecheck.live ? "sent to Darwin" : "would go to Darwin (dry read)"}, ${supersededFreeRecheck.liveTwin.toLocaleString()} kept back for a live twin, ${supersededFreeRecheck.notRead.toLocaleString()} not read the same way today. Re-file of retired lines under today's category (${supersededRefile.mode === "live" ? "live" : supersededRefile.mode === "dry_run" ? "dry run, nothing written" : supersededRefile.mode === "skipped" ? "switch off: not sampled in a state lane" : "switch off: a read-only sample, nothing written"}): ${supersededRefile.candidates.toLocaleString()} candidates at ${supersededRefile.candidateInstitutions.toLocaleString()} banks (${supersededRefile.candidatesDarwinDecided.toLocaleString()} already judged by Darwin, left retired); of ${supersededRefile.checked.toLocaleString()} read, ${supersededRefile.refiled.toLocaleString()} ${supersededRefile.dryRun ? "would go" : "sent"} to Darwin under today's category, ${supersededRefile.liveTwin.toLocaleString()} kept back for a live twin, ${supersededRefile.notRead.toLocaleString()} not read today; ${supersededRefile.staleHintRows.toLocaleString()} taken-over rows with a stale category flag${supersededRefile.dryRun ? "" : ` (${supersededRefile.staleHintRepaired.toLocaleString()} repaired)`}. Re-read ${rateRecheck.checked.toLocaleString()} held percentage fees: ${rateRecheck.promoted.toLocaleString()} sent to Darwin as rates. Held range lines with no category (${rangeBands.live ? "" : "switch off, "}${rangeBands.dryRun ? "nothing written" : "live"}): ${rangeBands.candidates.toLocaleString()} in this lane read as deposit or loan rate bands; ${rangeBands.bands.toLocaleString()} of the ${rangeBands.checked.toLocaleString()} read this step (at most ${RANGE_BAND_LIMIT.toLocaleString()} a step) are bands at ${rangeBands.institutions.toLocaleString()} banks${rangeBands.dryRun ? " and would be set aside as not fees" : `, ${rangeBands.setAside.toLocaleString()} set aside as not fees`}.${heldNamePreview.live ? "" : ` Held-name rules (switch off, read only): ${heldNamePreview.passChecks.toLocaleString()} held lines would go to Darwin and pass its category and source checks, at ${heldNamePreview.institutions.toLocaleString()} banks (${heldNamePreview.wouldRelease.toLocaleString()} read under them, of ${heldNamePreview.candidates.toLocaleString()} candidates).`}${rereadNote}${batchNote}`,
        detail: {
          held_recheck: heldRecheck,
          held_name_file: nameFile,
          untraced_recheck: untracedRecheck,
          superseded_recheck: supersededRecheck,
          superseded_free_recheck: supersededFreeRecheck,
          superseded_refile: supersededRefile,
          promotion_recheck: promotionRecheck,
          held_rate_recheck: rateRecheck,
          range_band_set_aside: rangeBands,
          held_name_preview: heldNamePreview,
          reread_feedback: rereadFeedbackDetail(rereadFeedback),
          batch_review: batchReview,
          selected_text_artifacts: extraction.selectedDocuments,
          processed_text_artifacts: extraction.processedDocuments,
          extracted_fee_candidates: extraction.extractedFees,
          inserted_raw_fee_observations: extraction.insertedFees,
          inserted_free_fees: extraction.freeFees,
          skipped_fee_candidates: extraction.skippedFees,
          held_for_review: extraction.heldForReview,
          // v68: priced lines no rule names that were neither read nor held, by reason.
          dropped_priced_lines: extraction.droppedLines,
          replaced_older_rows: extraction.retiredOlderRows,
          retired_older_copy_rows: extraction.retiredOlderCopyRows,
          outcomes: extraction.outcomes,
          learning_log: extraction.learning,
          lessons_loaded: extraction.lessonsLoaded,
          lesson_refiles: extraction.lessonRefiles,
          takedown_lessons_loaded: extraction.takedownLessonsLoaded,
          takedown_holds: extraction.takedownHolds,
          takedown_lessons_unknown: extraction.takedownLessonsUnknown ?? {},
          takedown_guard_declines: extraction.takedownGuardDeclines ?? {},
          calibration_groups: extraction.calibrationGroups,
          calibrated_below_publish_floor: extraction.calibratedBelowPublishFloor,
          layouts: Object.fromEntries(Object.entries(extraction.layouts).slice(0, 12)),
          extract_limit: extraction.limit,
          dry_run: extraction.dryRun,
          institution_results: institutionResults(
            "extract",
            extraction.results.map((result) => ({
              institution_id: result.institutionId,
              inserted: result.inserted,
              free_inserted: result.freeInserted,
              held_inserted: result.heldInserted,
            })),
          ),
          sample_results: extraction.results.slice(0, 10).map((result) => ({
            document_text_id: result.documentTextId,
            source_document_id: result.sourceDocumentId,
            institution_id: result.institutionId,
            source_url: result.sourceUrl,
            extracted: result.extracted,
            inserted: result.inserted,
            free_inserted: result.freeInserted,
            held_inserted: result.heldInserted,
            skipped: result.skipped,
            sample_candidates: result.candidates.slice(0, 5).map((candidate) => ({
              fee_name: candidate.feeName,
              amount: candidate.amount,
              frequency: candidate.frequency,
              canonical_hint: candidate.canonicalHint,
              confidence: candidate.confidence,
            })),
          })),
        },
      };
    }
    case "classify":
    case "verify": {
      const verification = await runDarwinVerify({
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["verify_limit", "classify_limit", "limit", "size"]),
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
        db: tx,
      });
      // Held fees get a way out: each is judged against the bank's schedule.
      const release = await runDarwinReleaseHeld({
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
        db: tx,
      });
      // Fees the v17 review passed while the release did not act: released after today's free holds
      // under their own switch (DARWIN_RECORDED_RELEASE_ACTS), after a ledger dry run; off, a count only.
      const recordedRelease = await releaseRecordedPasses(tx, { runId: run.id, stepId: step.id, dryRun: run.runKind === "dry_run" });
      // A "returned check" Hamilton took off NSF beside the schedule's own NSF fee is filed as an RDI.
      const scheduleRefile = await runDarwinScheduleRefile({
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        db: tx,
      });
      // #1115: a $0 held as conditional is a duplicate of a priced twin, free on the bank's own
      // schedule, or rejected for Knox's next read.
      const conditionalZero = await runDarwinConditionalZeroResolve({
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        db: tx,
      });
      // #1443: Darwin re-reads a share of live fees' names each step against the narrow live twin
      // of the cut-off name hold (live-fragment-check.ts); a report only while its switch is off.
      const liveFragments = await recheckLiveFragmentNames(tx, {
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
      });
      // The whole live table in one read, on request (`fragment_full_count: true`), for the dry-run count.
      const liveFragmentsFull = params.fragment_full_count === true || params.fragment_full_count === "true"
        ? await countLiveFragmentNames(tx)
        : null;
      // #1456: Darwin re-reads a share of live fees' names each step for an hourly price
      // (hourly-frequency-check.ts); a report only while its switch is off.
      const hourly = await recheckHourlyFrequencies(tx, {
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
      });
      // The whole live table in one read, on request (`hourly_full_count: true`), for the dry-run count.
      const hourlyFull = params.hourly_full_count === true || params.hourly_full_count === "true"
        ? await countHourlyFees(tx)
        : null;
      // #1442: Darwin re-reads a share of live fees' source document addresses each step for a
      // brokerage, wealth, loan, card or rate page (non-deposit-document-check.ts); a report only
      // while its switch is off.
      const nonDeposit = await recheckNonDepositDocuments(tx, {
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
      });
      // #1909: fees read from a bank's Spanish copy of a schedule whose English line is live
      // (translated-copy-check.ts); a report only on a dry run or with its switch off.
      const translatedCopy = await recheckTranslatedCopies(tx, {
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
      });
      // #2022: fees read from a Canadian bank's document (canadian-document-check.ts), at most hourly.
      const canadianDocument = await recheckCanadianDocuments(tx, {
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
      });
      const canadianDocumentNote = canadianDocument.matched > 0
        ? ` Canadian document re-check: ${canadianDocument.matched.toLocaleString()} live fee(s) on ${canadianDocument.documents.toLocaleString()} Canadian bank document(s) (${canadianDocument.live && !canadianDocument.dryRun ? `${canadianDocument.flagged.toLocaleString()} flagged, ${canadianDocument.takenDown.length.toLocaleString()} archived` : canadianDocument.dryRun ? "dry run: would take down, nothing written" : "switch off: would take down, nothing written"}).`
        : "";
      const translatedCopyNote = translatedCopy.matched > 0
        ? ` Spanish copy re-check: ${translatedCopy.matched.toLocaleString()} of ${translatedCopy.checked.toLocaleString()} live fee(s) on Spanish copies of a schedule have an English twin at the same price (${translatedCopy.live && !translatedCopy.dryRun ? `${translatedCopy.flagged.toLocaleString()} flagged, ${translatedCopy.takenDown.length.toLocaleString()} archived` : translatedCopy.dryRun ? "dry run: would take down, nothing written" : "switch off: would take down, nothing written"}); ${(translatedCopy.keptSpanishOnly + translatedCopy.keptEnglishName).toLocaleString()} stay.`
        : "";
      // #1440: one printed line live under two categories or two frequencies; Darwin keeps one
      // reading (line-conflict-check.ts). Every conflicting line each step; a report only while its
      // switch is off.
      const lineConflict = await recheckLineConflicts(tx, {
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
      });
      const lineConflictNote = lineConflict.lines > 0
        ? ` One line, two reads: ${lineConflict.lines.toLocaleString()} live line(s) (${lineConflict.byKind.category.toLocaleString()} under two categories, ${lineConflict.byKind.frequency.toLocaleString()} with two frequencies), ${lineConflict.wouldRetire.toLocaleString()} row(s) would be retired, ${lineConflict.byExempt.undecided.toLocaleString()} undecided (${lineConflict.live && !lineConflict.dryRun ? `${lineConflict.flagged.toLocaleString()} flagged, ${lineConflict.takenDown.length.toLocaleString()} archived` : "switch off: nothing written"}).`
        : "";
      // The whole live table in one read, on request (`non_deposit_full_count: true`), for the dry-run count.
      const nonDepositFull = params.non_deposit_full_count === true || params.non_deposit_full_count === "true"
        ? await countNonDepositFees(tx)
        : null;
      // #1367 repair: fees the release published before it checked the category are read again under
      // today's release check (release-repair.ts); a report only while its switch is off.
      // Never fails the verify step: any throw comes back as `error` with no result.
      const { result: releaseRepair, full: releaseRepairFull, error: releaseRepairError } = await runReleaseRepairStep(tx, {
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        // Every released fee in one read-only pass, on request (`release_repair_full_count: true`).
        fullCount: params.release_repair_full_count === true || params.release_repair_full_count === "true",
      });
      const releaseRepairNote = releaseRepair && releaseRepair.wouldTakeDown > 0
        ? ` Release re-check: ${releaseRepair.wouldTakeDown.toLocaleString()} of ${releaseRepair.checked.toLocaleString()} released fee(s) read fail both the text check and the category model (${releaseRepair.live && !releaseRepair.dryRun ? `${releaseRepair.flagged.toLocaleString()} flagged, ${releaseRepair.takenDown.length.toLocaleString()} archived` : "switch off: would take down, nothing written"}).`
        : "";
      const releaseRepairFullNote = releaseRepairFull
        ? ` All released fees: ${releaseRepairFull.wouldTakeDown.toLocaleString()} of ${releaseRepairFull.checked.toLocaleString()} fail both the text check and the category model (${releaseRepairFull.textOnly.toLocaleString()} text only, ${releaseRepairFull.modelOnly.toLocaleString()} model only).`
        : "";
      const liveFragmentNote = liveFragments.matched > 0
        ? ` Live name re-check: ${liveFragments.matched.toLocaleString()} of ${liveFragments.checked.toLocaleString()} live fee(s) read have a fragment name: ${liveFragments.wouldTakeDown.toLocaleString()} takedown, ${liveFragments.wouldRename.toLocaleString()} rename (${liveFragments.wouldRenameByVia.tail.toLocaleString()} by the fee the line ends on), ${liveFragments.exempt.toLocaleString()} exempt, ${liveFragments.wouldReread.toLocaleString()} kept live to ask Knox to re-read (${liveFragments.live && !liveFragments.dryRun ? `${liveFragments.takenDown.length.toLocaleString()} archived, ${liveFragments.renamed.length.toLocaleString()} renamed, ${liveFragments.rereadRequested.length.toLocaleString()} re-read request(s)` : "switch off: nothing written"}).`
        : "";
      const hourlyNote = hourly.matched > 0
        ? ` Hourly re-check: ${hourly.wouldSet.toLocaleString()} of ${hourly.checked.toLocaleString()} live fee(s) read are priced by the hour with no hourly frequency (${hourly.wouldSetFromLine.toLocaleString()} only on their line${hourly.lineLive ? "" : ", line switch off: not written"}), ${hourly.exempt.toLocaleString()} exempt (${hourly.live && !hourly.dryRun ? `${hourly.set.length.toLocaleString()} set hourly` : "switch off: nothing written"}).`
        : "";
      const hourlyFullNote = hourlyFull
        ? ` Whole live table: ${hourlyFull.wouldSet.toLocaleString()} live fees would be set hourly (${hourlyFull.wouldSetFromLine.toLocaleString()} only on their line), ${hourlyFull.exempt.toLocaleString()} exempt.`
        : "";
      const nonDepositNote = nonDeposit.matched > 0 || nonDeposit.brokerageDocument > 0
        ? ` Non-deposit document re-check: ${nonDeposit.matched.toLocaleString()} of ${nonDeposit.checked.toLocaleString()} live fee(s) read would come down from a brokerage or wealth (${nonDeposit.byKind.brokerage.toLocaleString()}) or loan, card or rate (${nonDeposit.byKind.loan.toLocaleString()}) document (${nonDeposit.byRule.lending_category.toLocaleString()} lending category, ${nonDeposit.byRule.lending_wording_on_loan_document.toLocaleString()} lending wording on a loan document); ${nonDeposit.brokerageDocument.toLocaleString()} deposit-category fee(s) on brokerage documents (own sub-switch${nonDeposit.live && nonDeposit.brokerageLive ? "" : ", off: they stay"}); ${(nonDeposit.keptDepositCategory + nonDeposit.keptGenericOnRatePage).toLocaleString()} fee(s) there stay live. Takedowns: ${nonDeposit.live && !nonDeposit.dryRun ? `${nonDeposit.flagged.toLocaleString()} flagged, ${nonDeposit.takenDown.length.toLocaleString()} archived` : "switch off, none made, nothing written"}.`
        : "";
      const nonDepositFullNote = nonDepositFull
        ? ` Whole live table: ${nonDepositFull.matched.toLocaleString()} live fees would come down from non-deposit documents (${nonDepositFull.byRule.lending_category.toLocaleString()} lending category, ${nonDepositFull.byRule.lending_wording_on_loan_document.toLocaleString()} lending wording on a loan document; ${nonDepositFull.byKind.brokerage.toLocaleString()} brokerage or wealth, ${nonDepositFull.byKind.loan.toLocaleString()} loan, card or rate) on ${nonDepositFull.documents.toLocaleString()} document(s); ${nonDepositFull.brokerageDocument.toLocaleString()} deposit-category fees on brokerage documents need their own sub-switch; ${(nonDepositFull.keptDepositCategory + nonDepositFull.keptGenericOnRatePage).toLocaleString()} fees there stay.`
        : "";
      // #1455: whose schedule each shared or vendor-served document is, by its own text.
      const documentOwner = verification.documentOwner;
      const documentOwnerNote = documentOwner && documentOwner.pairs > 0
        ? ` Document owner: ${documentOwner.pairs.toLocaleString()} shared document pair(s) read, ${documentOwner.wouldTakeDown.length.toLocaleString()} live fee(s) on another bank's schedule (${documentOwner.live ? `${documentOwner.takenDown.length.toLocaleString()} archived` : "switch off: would take down, nothing written"}).`
        : "";
      const liveFragmentFullNote = liveFragmentsFull
        ? ` Whole live table: ${liveFragmentsFull.matched.toLocaleString()} of ${liveFragmentsFull.checked.toLocaleString()} live fees have a fragment name (${liveFragmentsFull.wouldTakeDown.toLocaleString()} takedown, ${liveFragmentsFull.wouldRename.toLocaleString()} rename, ${liveFragmentsFull.wouldReread.toLocaleString()} kept for re-read, ${liveFragmentsFull.exempt.toLocaleString()} exempt).`
        : "";
      return {
        status: "completed",
        summary: `Darwin verified ${verification.verifiedFees.toLocaleString()} raw fee observations from ${verification.processedRawFees.toLocaleString()} selected rows (${verification.skippedFees.toLocaleString()} skipped).${conditionalZero.selected > 0 ? ` Settled ${conditionalZero.selected.toLocaleString()} conditional-$0 hold(s) (${conditionalZero.verified.toLocaleString()} verified free on the bank's schedule).` : ""}${verification.categoryChange && verification.categoryChange.candidates > 0 ? ` ${verification.categoryChange.candidates.toLocaleString()} row(s) Knox re-filed since Darwin's decision ${verification.categoryChange.live ? `(${verification.categoryChange.selected.toLocaleString()} judged again under today's category)` : "(switch off: counted, not judged again)"}.` : ""}${verification.categoryChange && verification.categoryChange.takeoverProof.rows > 0 ? ` ${verification.categoryChange.takeoverProof.rows.toLocaleString()} row(s) a re-read took over under a new category ${verification.categoryChange.takeoverProof.live ? "(judged again)" : "(take-over proof switch off: counted, not judged again)"}.` : ""}${liveFragmentNote}${liveFragmentFullNote}${hourlyNote}${hourlyFullNote}${nonDepositNote}${nonDepositFullNote}${translatedCopyNote}${canadianDocumentNote}${lineConflictNote}${releaseRepairNote}${releaseRepairFullNote}${documentOwnerNote}`,
        detail: {
          selected_raw_fees: verification.selectedRawFees,
          processed_raw_fees: verification.processedRawFees,
          verified_fee_observations: verification.verifiedFees,
          skipped_raw_fees: verification.skippedFees,
          verified_free_fees: verification.zeroFeesVerified,
          category_model_disputes: verification.categoryModelDisputes,
          peer_fallback_checks: verification.peerFallbackChecks,
          peer_fallback_outliers: verification.peerFallbackOutliers,
          learned_envelope_holds: verification.learnedEnvelopeHolds,
          // #1295: rows Knox re-filed since Darwin's decision; a count and sample while the switch is off.
          category_change_rejudge: verification.categoryChange,
          document_owner: documentOwnerDetail(documentOwner),
          held_release: {
            selected: release.selected,
            acted: release.acted,
            verdicts: release.verdicts,
            released: release.released,
            feedback_written: release.feedbackWritten,
          },
          recorded_pass_release: recordedRelease,
          live_fragment_check: liveFragmentDetail(liveFragments),
          ...(liveFragmentsFull ? { live_fragment_full_count: liveFragmentFindingsDetail(liveFragmentsFull) } : {}),
          hourly_frequency_check: hourlyDetail(hourly),
          ...(hourlyFull ? { hourly_frequency_full_count: hourlyFindingsDetail(hourlyFull) } : {}),
          non_deposit_document_check: nonDepositDetail(nonDeposit),
          translated_copy_check: translatedCopyDetail(translatedCopy),
          canadian_document_check: canadianDocumentDetail(canadianDocument),
          line_conflict_check: lineConflictDetail(lineConflict),
          ...(nonDepositFull ? { non_deposit_document_full_count: nonDepositFindingsDetail(nonDepositFull) } : {}),
          release_repair: releaseRepair ? releaseRepairDetail(releaseRepair) : { error: releaseRepairError },
          ...(releaseRepairFull ? { release_repair_full_count: releaseRepairFindingsDetail(releaseRepairFull) } : {}),
          schedule_refile: { selected: scheduleRefile.selected, refiled: scheduleRefile.refiled },
          conditional_zero: { selected: conditionalZero.selected, verdicts: conditionalZero.verdicts, verified: conditionalZero.verified },
          feedback_written: verification.feedbackWritten,
          reason_counts: verification.reasonCounts,
          outcomes: verification.outcomes,
          learning_log: verification.learning,
          verify_limit: verification.limit,
          dry_run: verification.dryRun,
          institution_results: institutionResults(
            "classify",
            verification.results.map((result) => ({ institution_id: result.institutionId, status: result.status, reason: result.reason })),
          ),
          sample_results: verification.results.slice(0, 10).map((result) => ({
            fee_raw_id: result.feeRawId,
            institution_id: result.institutionId,
            fee_name: result.feeName,
            amount: result.amount,
            canonical_fee_key: result.canonicalFeeKey,
            status: result.status,
            decision: result.decision,
            reason_code: result.reasonCode,
            reason: result.reason,
            fee_verified_id: result.feeVerifiedId,
          })),
        },
      };
    }
    case "review": {
      const decisions = await getKnoxDecisionQueueSnapshot(tx);
      return {
        status: "completed",
        // The decisions queue was retired (James, Oct 9): its verdicts are on record, not reviewed.
        summary: `Knox decision queue is retired: ${decisions.pending.toLocaleString()} verdicts were never confirmed and stay on record; ${decisions.confirmed.toLocaleString()} confirmed and ${decisions.overridden.toLocaleString()} overridden.`,
        detail: {
          pending_knox_decisions: decisions.pending,
          confirmed_knox_decisions: decisions.confirmed,
          overridden_knox_decisions: decisions.overridden,
          total_knox_decisions: decisions.total,
          queue_retired: true,
          dry_run: run.runKind === "dry_run",
        },
      };
    }
    case "guide-draft": {
      const category = stringRunParam(params, [
        "fee_category",
        "primary_category",
        "category",
      ]);
      if (!category) {
        return {
          status: "skipped",
          summary: "Guide draft skipped: no fee category supplied.",
          detail: { reason: "missing_fee_category" },
        };
      }
      const drafted = await runGuideDraft({
        runId: run.id,
        primaryCategory: category,
        slug: stringRunParam(params, ["guide_slug", "slug"]) ?? undefined,
        dryRun: run.runKind === "dry_run",
        db: tx,
      });
      const detail = {
        guide_slug: drafted.slug,
        primary_category: drafted.primaryCategory,
        draft_status: drafted.status,
        word_count: drafted.wordCount,
        issue_count: drafted.issues.length,
        issues: drafted.issues.slice(0, 10),
        published_guide_preserved: drafted.publishedGuidePreserved,
        dry_run: drafted.dryRun,
      };
      if (drafted.status === "drafted") {
        return {
          status: "completed",
          summary: `Guide draft for ${drafted.primaryCategory} saved for human review (${drafted.wordCount.toLocaleString()} words). Publishing requires a recorded approval.`,
          detail,
        };
      }
      return {
        status: "skipped",
        summary:
          drafted.status === "skipped"
            ? `Guide draft skipped: ${drafted.primaryCategory} has no published benchmark to write about.`
            : `Guide draft rejected on ${drafted.issues.length.toLocaleString()} validation issue(s); the published guide was left untouched.`,
        detail,
      };
    }
    case PUBLISH_SWEEPS_STEP_KEY: {
      // The 40 sweeps a lane publish no longer runs once PUBLISH_SWEEPS_SPLIT_LIVE is on, over
      // every state's live fees (hamilton/publish-sweeps.ts). Live, it holds the publish lock as
      // a publish step does; off, it is a rolled-back dry run and takes no lock.
      const live = PUBLISH_SWEEPS_SPLIT_LIVE && run.runKind !== "dry_run";
      if (live) await tx`SELECT pg_advisory_xact_lock(hashtext('agents.hamilton.publish'))`;
      return runPublishSweepsStep(tx, {
        runId: run.id,
        stepId: step.id,
        live,
        categoryGuardLimit: CATEGORY_GUARD_STEP_LIMIT,
      });
    }
    case "publish":
    case "publish-index":
    case "publish-context": {
      // Lanes run side by side, and the outlier and duplicate sweeps below touch every
      // state's live rows. One publish step at a time keeps two sweeps from locking the
      // same rows in opposite orders; the lock ends with this step's transaction.
      await tx`SELECT pg_advisory_xact_lock(hashtext('agents.hamilton.publish'))`;
      // Phase times go on the step's detail (`phase_ms`), so a slow publish names its slow part.
      const publishStartedAt = Date.now();
      // Each sweep's milliseconds, keyed by the result it returns (`sweep_ms` on the step detail):
      // measurement only, to show which sweeps hold the step (2026-10-17 finding).
      const sweepMs: Record<string, number> = {};
      const institutionId = numericRunParam(params, ["institution_id"]);
      // Moved sweeps (hamilton/publish-sweeps.ts), in today's order: restores, the fold, rollbacks,
      // the hand lists, the page sweeps and the category guard. A state lane skips them once
      // PUBLISH_SWEEPS_SPLIT_LIVE is on (the `publish-sweeps` step runs them); off, every step runs them.
      const sweepMode = publishSweepMode({ stepKey: step.stepKey, stateCode, institutionId });
      const sweepCtx: MovedSweepContext = {
        db: tx,
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId,
        researchSplitFullCount: params.research_split_full_count === true || params.research_split_full_count === "true",
        categoryGuardLimit: CATEGORY_GUARD_STEP_LIMIT,
        sweepMs,
        mode: sweepMode,
      };
      const {
        outlierRestores, offTaxonomyRestores, taxonomyFold, outlierRollbacks, offTaxonomyRollbacks, limitRollbacks,
        businessSchedule, sameLineDuplicates, otherBank, evalVerdicts, handAmounts, cutNameDuplicates, accountTypeHold,
        handTakedowns, handAudience, closedInstitution, articlePage, productPage, productPageConflict, crossPage, categoryGuard,
      } = await sweepsBeforeGuardRequeue(sweepCtx);
      const categoryGuardRollbacks = categoryGuard.dryRun
        ? Math.min(categoryGuard.failingFees, categoryGuard.limit)
        : categoryGuard.rolledBackFees;
      // A verified row the guard rejected at publish and never published is re-read once per
      // guard version under publish's own name; one today's guard passes goes back in the queue.
      const guardRequeue = await timedSweep(sweepMs, "guardRequeue", () => requeueGuardRejectedFees(tx, {
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        institutionId,
      }));
      // Fees read from companion pages Magellan has since retired (a HELOC PDF, a
      // derivatives notice) come down before anything new publishes.
      const companionRetire = await timedSweep(sweepMs, "companionRetire", () => rollBackRetiredCompanionFees(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
        stateCode,
      }));
      const companionRollbacks = companionRetire.rollbacks;
      const { earlyDuplicateCollapses, nearNameCollapse, pageCopyRestore, pageCopyCollapse, frequencyFill } =
        await sweepsBeforeNewerCopy(sweepCtx);
      // A fee line the bank removed from a newer copy of its page comes down (shadow
      // mode until NEWER_COPY_RETIRE_LIVE is turned on: it reports and changes nothing).
      const newerCopy = await timedSweep(sweepMs, "newerCopy", () => retireFeesDroppedFromNewerCopy(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
        stateCode,
      }));
      const newerCopyRetired = newerCopy.live ? newerCopy.retired.length : 0;
      const newerCopyRestored = newerCopy.live ? (run.runKind === "dry_run" ? newerCopy.proposedRestores : newerCopy.restored) : 0;
      const { identicalCopy } = await sweepsBeforeRefreshCopy(sweepCtx);
      // A live fee the current copy of its page still states at the same amount moves to
      // that copy, so it no longer points at a superseded copy and its date is current.
      const refreshCopy = await timedSweep(sweepMs, "refreshCopy", () => refreshFeesFromCurrentCopy(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
        stateCode,
      }));
      // A live fee the current copy does not restate at its price is read against the
      // current copy's text; one it no longer states comes down only on a second look.
      const currentCopy = await timedSweep(sweepMs, "currentCopy", () => secondLookFeesNotOnCurrentCopy(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
        stateCode,
      }));
      // State lanes re-check their live Knox fees against today's rules, a batch of
      // documents per step, once per Knox version.
      const rulesRecheck = stateCode || institutionId
        ? await timedSweep(sweepMs, "rulesRecheck", () => rollBackUnreproducedFees(tx, {
            runId: run.id,
            batchId: `agentic-run-${run.id}`,
            dryRun: run.runKind === "dry_run",
            institutionId,
            stateCode,
          }))
        : null;
      // Moved sweeps (hamilton/publish-sweeps.ts): name and lineup tidies, restore second looks,
      // change pairing and the cross-page restore, before the rows publish.
      const { nameRetidy, extractionNotes, accountNames, lineupCorrect, restoreRecheck, lostRestore, changePairing, crossPageRestore } =
        await sweepsBeforeRows(sweepCtx);
      const recheckRollbacks = rulesRecheck?.rollbacks.length ?? 0;
      // #1342: imported fees with no traceable document take a stored document of their own
      // institution that prints them (shared source check); those the source-link repair took
      // down for want of one come back. Off with SOURCE_LINK_RESOURCE_ON.
      const sourceLinkResource = await timedSweep(sweepMs, "sourceLinkResource", () => resourceSourceLinks(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
        stateCode,
      }));
      const recheckRestores = rulesRecheck?.restores.length ?? 0;
      const publishRowsStartedAt = Date.now();
      const published = await timedSweep(sweepMs, "published", () => runHamiltonPublish({
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["publish_limit", "limit", "size"]),
        institutionId,
        stateCode,
        minConfidence: numericRunParam(params, [
          "publish_min_confidence",
          "min_confidence",
          "confidence_threshold",
        ]),
        minInstitutionFees: numericRunParam(params, ["publish_min_institution_fees"]),
        // The row loop stops here (after PUBLISH_MIN_ROWS_PER_STEP rows) so the whole step ends
        // inside the tick; the rows it leaves publish on the next step (2026-10-17 finding).
        deadlineAt: publishStartedAt + PUBLISH_ROW_DEADLINE_MS,
        topUpDeadlineAt: publishStartedAt + PUBLISH_TOP_UP_DEADLINE_MS,
        db: tx,
      }));
      const publishRowsEndedAt = Date.now();
      // #1069: a fee this step just published that repeats a live row (a new read that only
      // fills its frequency or names its audience) is collapsed now, not on the state's next
      // step: until then the catalog listed the fee twice (88 a day, about 40 hours, Oct 13).
      const lateDuplicateCollapses = published.dryRun || published.publishedFees === 0
        ? []
        : await timedSweep(sweepMs, "lateDuplicateCollapses", () => collapsePublishedDuplicates(tx, {
            runId: run.id,
            batchId: `agentic-run-${run.id}`,
            dryRun: false,
            institutionId,
          }));
      const duplicateCollapses = [
        ...earlyDuplicateCollapses,
        ...(nearNameCollapse.live ? nearNameCollapse.collapses : []),
        ...(pageCopyCollapse.live ? pageCopyCollapse.collapses : []),
        ...lateDuplicateCollapses,
      ];
      // Every live fee must be stated in the bank's own stored schedule: every publish
      // step source-checks a batch of institutions (its state's or institution's when it
      // has one, any state's otherwise) after publishing, so fees published in this step
      // are checked too.
      const sourceCheck = await timedSweep(sweepMs, "sourceCheck", () => takeDownUntraceableFees(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
        stateCode,
      }));
      const sourceTakedowns = sourceCheck?.takedowns.length ?? 0;
      // The five moved sweeps after the rows (hamilton/publish-sweeps.ts): links and learning feedback.
      const { importedTwins, sourceLinkFill, linkDrift, feedbackSync, holdFeedback } = await sweepsAfterRows(sweepCtx);
      const indexRefresh = published.dryRun
        ? null
        : await timedSweep(sweepMs, "indexRefresh", () => refreshFeeIndexCache(tx, {
            runId: run.id,
            force:
              published.publishedFees > 0 ||
              outlierRollbacks.length > 0 ||
              offTaxonomyRollbacks.length > 0 ||
              taxonomyFold.movedLive > 0 ||
              taxonomyFold.handRefiled > 0 ||
              taxonomyFold.handFlagsCleared > 0 ||
              taxonomyFold.noHomeRolledBack > 0 ||
              outlierRestores.length > 0 ||
              offTaxonomyRestores.length > 0 ||
              limitRollbacks.length > 0 ||
              businessSchedule.rolledBack.length > 0 ||
              businessSchedule.restored > 0 ||
              sameLineDuplicates.rolledBack.length > 0 ||
              sameLineDuplicates.restored > 0 ||
              otherBank.rolledBack.length > 0 ||
              crossPageRestore.restored.length > 0 ||
              pageCopyRestore.restored.length > 0 ||
              sourceLinkResource.restored > 0 ||
              (!linkDrift.dryRun && linkDrift.archived.length > 0) ||
              articlePage.rolledBack.length > 0 ||
              closedInstitution.rolledBack.length > 0 ||
              productPage.rolledBack.length > 0 ||
              productPageConflict.rolledBack.length > 0 ||
              crossPage.rolledBack.length > 0 ||
              categoryGuardRollbacks > 0 ||
              categoryGuard.liveRefiledFees > 0 ||
              companionRollbacks.length > 0 ||
              duplicateCollapses.length > 0 ||
              frequencyFill.filled.length > 0 ||
              frequencyFill.held.length > 0 ||
              newerCopyRetired > 0 ||
              newerCopyRestored > 0 ||
              currentCopy.takenDown.length > 0 ||
              recheckRollbacks > 0 ||
              recheckRestores > 0 ||
              restoreRecheck.rolledBack.length > 0 ||
              lostRestore.restored > 0 ||
              sourceTakedowns > 0 ||
              (sourceCheck?.restored ?? 0) > 0,
          }));
      const outlierNote =
        outlierRollbacks.length > 0
          ? ` ${published.dryRun ? "Would roll back" : "Rolled back"} ${outlierRollbacks.length.toLocaleString()} live fee(s) outside their category range.`
          : "";
      const foldNote =
        taxonomyFold.moved + taxonomyFold.noHomeRolledBack + taxonomyFold.noHomeHeld > 0
          ? ` ${published.dryRun ? "Would fold" : "Folded"} ${taxonomyFold.moved.toLocaleString()} fee(s) from retired categories into the top 50${taxonomyFold.noHomeRolledBack > 0 ? `; ${published.dryRun ? "would take" : "took"} down ${taxonomyFold.noHomeRolledBack.toLocaleString()} with no home there after a second look` : ""}${taxonomyFold.noHomeHeld > 0 ? `; kept ${taxonomyFold.noHomeHeld.toLocaleString()} with no home live until James decides` : ""}.`
          : "";
      const handRefileNote =
        (taxonomyFold.handRefiled > 0
          ? ` ${published.dryRun ? "Would re-file" : "Re-filed"} ${taxonomyFold.handRefiled.toLocaleString()} misread fee(s) under the page's own name.`
          : "") +
        (taxonomyFold.handFlagsCleared > 0
          ? ` ${published.dryRun ? "Would clear" : "Cleared"} the pending takedown on ${taxonomyFold.handFlagsCleared.toLocaleString()} hand-fixed fee(s) that now trace.`
          : "") +
        (taxonomyFold.pendingResearchSplit && taxonomyFold.pendingResearchSplit.wouldMove > 0
          ? ` Research split (off, nothing moved): it would move ${taxonomyFold.pendingResearchSplit.wouldMoveLive.toLocaleString()} live and ${(taxonomyFold.pendingResearchSplit.wouldMove - taxonomyFold.pendingResearchSplit.wouldMoveLive).toLocaleString()} verified fee(s) out of account research (${Object.entries(taxonomyFold.pendingResearchSplit.byRoute).map(([route, count]) => `${route} ${count.toLocaleString()}`).join(", ")})${taxonomyFold.pendingResearchSplit.capped ? `, in the first ${taxonomyFold.pendingResearchSplit.scanned.toLocaleString()} rows read (run with research_split_full_count for every row)` : ""}.`
          : "");
      const offTaxonomyNote =
        (offTaxonomyRollbacks.length > 0
          ? ` ${published.dryRun ? "Would roll back" : "Rolled back"} ${offTaxonomyRollbacks.length.toLocaleString()} live fee(s) whose category is not in the fee taxonomy.`
          : "") +
        (outlierRestores.length + offTaxonomyRestores.length > 0
          ? ` ${published.dryRun ? "Would restore" : "Restored"} ${(outlierRestores.length + offTaxonomyRestores.length).toLocaleString()} earlier range or taxonomy takedown(s) that pass today.`
          : "");
      const limitNote =
        limitRollbacks.length > 0
          ? ` ${published.dryRun ? "Would roll back" : "Rolled back"} ${limitRollbacks.length.toLocaleString()} live fee(s) whose figure is a transaction limit, not a price.`
          : "";
      const businessNote =
        businessSchedule.rolledBack.length > 0
          ? ` ${published.dryRun ? "Would archive" : "Archived"} ${businessSchedule.rolledBack.length.toLocaleString()} business-schedule fee(s) beside the bank's consumer fee.`
          : "";
      const sameLineNote =
        sameLineDuplicates.rolledBack.length > 0
          ? ` ${published.dryRun ? "Would archive" : "Archived"} ${sameLineDuplicates.rolledBack.length.toLocaleString()} duplicate same-line fee(s).`
          : "";
      const otherBankNote =
        otherBank.rolledBack.length > 0
          ? ` ${published.dryRun ? "Would archive" : "Archived"} ${otherBank.rolledBack.length.toLocaleString()} fee(s) read from another institution's website or a host that does not name the bank.`
          : "";
      const evalVerdictNote =
        evalVerdicts.rolledBack.length > 0
          ? ` ${published.dryRun ? "Would archive" : "Archived"} ${evalVerdicts.rolledBack.length.toLocaleString()} fee(s) the complete-record eval or a name rule found wrong.`
          : "";
      const lostRestoreNote =
        lostRestore.candidates > 0
          ? ` Judged ${lostRestore.candidates.toLocaleString()} lost re-check take-down(s) of Oct 5-11: ${lostRestore.passed.length.toLocaleString()} passed the restore bar (${published.dryRun ? "would restore" : `${lostRestore.restored.toLocaleString()} restored`}), ${lostRestore.failed.length.toLocaleString()} failed, ${lostRestore.skipped.length.toLocaleString()} skipped.`
          : "";
      const pageCopyRestoreNote =
        pageCopyRestore.restored.length > 0
          ? ` ${published.dryRun ? "Would restore" : "Restored"} ${pageCopyRestore.restored.length.toLocaleString()} page cop(ies) whose kept copy came down.`
          : "";
      const crossPageNote =
        crossPageRestore.restored.length > 0
          ? ` ${published.dryRun ? "Would restore" : "Restored"} ${crossPageRestore.restored.length.toLocaleString()} live fee(s) another page's price had superseded.`
          : "";
      const resourceCount = published.dryRun
        ? { linked: sourceLinkResource.resources.filter((fee) => !fee.restore).length, restored: sourceLinkResource.resources.filter((fee) => fee.restore).length }
        : { linked: sourceLinkResource.linked, restored: sourceLinkResource.restored };
      const linkDriftNote =
        linkDrift.repoints.length + linkDrift.archived.length + linkDrift.flagged > 0
          ? ` ${linkDrift.dryRun ? "Would re-point" : "Re-pointed"} ${linkDrift.repoints.length.toLocaleString()} live fee link(s) that opened another page to their own document; ${linkDrift.flagged.toLocaleString()} that do not trace there flagged for a second look, ${linkDrift.archived.length.toLocaleString()} ${linkDrift.dryRun ? "would be archived" : "archived"}.`
          : "";
      const sourceLinkFillNote =
        sourceLinkFill.fills.length > 0
          ? ` ${published.dryRun ? "Would link" : "Linked"} ${sourceLinkFill.fills.length.toLocaleString()} live fee(s) with no link to their own document.`
          : "";
      const resourceNote =
        resourceCount.linked + resourceCount.restored > 0
          ? ` ${published.dryRun ? "Would re-source" : "Re-sourced"} ${(resourceCount.linked + resourceCount.restored).toLocaleString()} fee(s) with no traceable document from a stored document of their own institution (${resourceCount.restored.toLocaleString()} ${published.dryRun ? "would be restored" : "restored"}).`
          : "";
      const restoreRecheckNote =
        restoreRecheck.failing.length > 0 || restoreRecheck.passing > 0
          ? ` Second look on ${restoreRecheck.unchecked.toLocaleString()} unchecked restore(s): ${restoreRecheck.passing.toLocaleString()} clear the restore bar, ${restoreRecheck.failing.length.toLocaleString()} fail it, ${restoreRecheck.rolledBack.length.toLocaleString()} ${published.dryRun ? "would be archived" : "archived"}.`
          : "";
      const closedNote =
        closedInstitution.rolledBack.length > 0
          ? ` ${published.dryRun ? "Would archive" : "Archived"} ${closedInstitution.rolledBack.length.toLocaleString()} live fee(s) of ${closedInstitution.institutions.toLocaleString()} institution(s) that no longer operate.`
          : "";
      const articleNote =
        articlePage.rolledBack.length > 0
          ? ` ${published.dryRun ? "Would archive" : "Archived"} ${articlePage.rolledBack.length.toLocaleString()} fee(s) read from an article page, not a fee schedule.`
          : "";
      const productNote =
        productPage.rolledBack.length > 0
          ? ` ${published.dryRun ? "Would archive" : "Archived"} ${productPage.rolledBack.length.toLocaleString()} $0 fee(s) read from a product page's benefits, not a fee schedule.`
          : "";
      const productConflictNote =
        productPageConflict.rolledBack.length > 0
          ? ` ${published.dryRun ? "Would archive" : "Archived"} ${productPageConflict.rolledBack.length.toLocaleString()} product-page fee(s) the bank's own schedule prices differently.`
          : productPageConflict.conflicts > 0 && !productPageConflict.live
            ? ` Flagged ${productPageConflict.conflicts.toLocaleString()} product-page fee(s) the bank's own schedule prices differently (logged; the takedown is off until a hand check).`
            : "";
      const crossPageConflictNote =
        crossPage.rolledBack.length > 0
          ? ` ${published.dryRun ? "Would archive" : "Archived"} ${crossPage.rolledBack.length.toLocaleString()} older price(s) for a product another current page prices differently.`
          : "";
      const categoryGuardNote =
        categoryGuardRollbacks > 0
          ? ` ${published.dryRun ? "Would roll back" : "Rolled back"} ${categoryGuardRollbacks.toLocaleString()} live fee(s) whose name contradicts their category.`
          : "";
      const guardRefileNote =
        categoryGuard.liveRefiledFees > 0
          ? ` ${published.dryRun ? "Would re-file" : "Re-filed"} ${categoryGuard.liveRefiledFees.toLocaleString()} live fee(s) under the type their name names.`
          : "";
      const guardRequeueNote =
        guardRequeue.requeued.length > 0
          ? ` ${published.dryRun ? "Would re-queue" : "Re-queued"} ${guardRequeue.requeued.length.toLocaleString()} guard-rejected row(s) today's guard passes.`
          : "";
      const companionNote =
        companionRollbacks.length > 0
          ? ` ${published.dryRun ? "Would roll back" : "Rolled back"} ${companionRollbacks.length.toLocaleString()} live fee(s) read from pages that are not consumer fee pages (loan or HELOC documents).`
          : "";
      const recheckNote =
        (recheckRollbacks > 0
          ? ` ${published.dryRun ? "Would roll back" : "Rolled back"} ${recheckRollbacks.toLocaleString()} live fee(s) today's Knox rules no longer read from their document, after a 12-hour second look.`
          : "") +
        ((rulesRecheck?.flagged ?? 0) > 0
          ? ` ${published.dryRun ? "Would flag" : "Flagged"} ${(rulesRecheck?.flagged ?? 0).toLocaleString()} live fee(s) today's Knox rules no longer read for a 12-hour second look (still live).`
          : "") +
        (recheckRestores > 0
          ? ` ${published.dryRun ? "Would restore" : "Restored"} ${recheckRestores.toLocaleString()} earlier re-check takedown(s) today's Knox rules read again.`
          : "");
      const sourceNote =
        sourceTakedowns > 0 || (sourceCheck?.relinked ?? 0) > 0 || (sourceCheck?.restored ?? 0) > 0
          ? ` Source check: ${published.dryRun ? "would take down" : "took down"} ${sourceTakedowns.toLocaleString()} live fee(s) not stated in the bank's stored schedule${sourceCheck?.relinked ? `, relinked ${sourceCheck.relinked.toLocaleString()} to a stored schedule` : ""}${sourceCheck?.restored ? `, ${published.dryRun ? "would restore" : "restored"} ${sourceCheck.restored.toLocaleString()} earlier takedown(s) that now trace` : ""}.`
          : "";
      const newerCopyNote = newerCopyReceiptNote(newerCopy, published.dryRun);
      const refreshNote =
        refreshCopy.refreshed > 0
          ? ` ${published.dryRun ? "Would move" : "Moved"} ${refreshCopy.refreshed.toLocaleString()} live fee(s) to the current copy of their page (same name and amount).`
          : "";
      const currentCopyNote =
        currentCopy.failing > 0 || currentCopy.takenDown.length > 0
          ? ` Current-copy check: ${currentCopy.failing.toLocaleString()} live fee(s) not restated at their price on the current copy of their page (${currentCopy.flagged.toLocaleString()} newly flagged for a second look), ${currentCopy.takenDown.length.toLocaleString()} archived.`
          : "";
      const duplicateNote =
        duplicateCollapses.length > 0
          ? ` ${published.dryRun ? "Would close" : "Closed"} ${duplicateCollapses.length.toLocaleString()} duplicate live fee(s).`
          : "";
      const frequencyNote =
        (frequencyFill.filled.length > 0
          ? ` ${published.dryRun ? "Would set" : "Set"} the frequency of ${frequencyFill.filled.length.toLocaleString()} live fee(s) from their own schedule row (${frequencyFill.filled.filter((row) => row.from == null).length.toLocaleString()} blank).`
          : "") +
        (frequencyFill.held.length > 0
          ? ` ${published.dryRun ? "Would hold" : "Held"} ${frequencyFill.held.length.toLocaleString()} live NSF or overdraft fee(s) whose own line prices them by the period.`
          : "") +
        (frequencyFill.planWouldHold.length > 0
          ? ` Overdraft plan hold (switch off): ${frequencyFill.planWouldHold.length.toLocaleString()} live optional overdraft plan fee(s) priced by the period beside the bank's per-item fee would be held.`
          : "");
      return {
        status: "completed",
        summary: `Hamilton published ${published.publishedFees.toLocaleString()} verified fee observations from ${published.processedVerifiedFees.toLocaleString()} selected rows (${published.skippedFees.toLocaleString()} skipped).${(published.identityDeferredFees ?? 0) > 0 ? ` ${published.identityDeferredFees!.toLocaleString()} deferred because selected verification or identity changed; left pending for a stable read.` : ""}${published.heldInstitutions.length > 0 ? ` Held ${published.heldFees.toLocaleString()} rows from ${published.heldInstitutions.length.toLocaleString()} institutions with fewer than ${published.minInstitutionFees} fees.` : ""}${outlierNote}${foldNote}${handRefileNote}${offTaxonomyNote}${limitNote}${businessNote}${sameLineNote}${otherBankNote}${evalVerdictNote}${closedNote}${articleNote}${productNote}${productConflictNote}${crossPageConflictNote}${categoryGuardNote}${guardRefileNote}${guardRequeueNote}${companionNote}${newerCopyNote}${refreshNote}${currentCopyNote}${nameRetidy.renames.length > 0 ? ` ${published.dryRun ? "Would tidy" : "Tidied"} ${nameRetidy.renames.length.toLocaleString()} run-on live fee name(s).` : ""}${accountNames.renames.length > 0 ? ` ${published.dryRun ? "Would name" : "Named"} ${accountNames.renames.length.toLocaleString()} generic live monthly fee(s) by their account.` : ""}${recheckNote}${restoreRecheckNote}${lostRestoreNote}${crossPageNote}${pageCopyRestoreNote}${resourceNote}${sourceLinkFillNote}${linkDriftNote}${sourceNote}${duplicateNote}${frequencyNote}${indexRefresh?.refreshed ? ` Index refreshed: ${indexRefresh.categories} categories.` : ""}`,
        detail: {
          selected_verified_fees: published.selectedVerifiedFees,
          processed_verified_fees: published.processedVerifiedFees,
          published_fees: published.publishedFees,
          skipped_verified_fees: published.skippedFees,
          identity_deferred_verified_fees: published.identityDeferredFees ?? 0,
          superseded_fees: published.supersededFees,
          outlier_rollbacks: outlierRollbacks.length,
          outlier_restores: outlierRestores.length,
          off_taxonomy_restores: offTaxonomyRestores.length,
          outlier_rollback_samples: outlierRollbacks.slice(0, 10).map((rollback) => ({
            fee_published_id: rollback.feePublishedId,
            institution_id: rollback.institutionId,
            canonical_fee_key: rollback.canonicalFeeKey,
            fee_name: rollback.feeName,
            amount: rollback.amount,
            reason: rollback.reason,
          })),
          taxonomy_fold: taxonomyFold,
          off_taxonomy_rollbacks: offTaxonomyRollbacks.length,
          off_taxonomy_rollback_samples: offTaxonomyRollbacks.slice(0, 10).map((rollback) => ({
            fee_published_id: rollback.feePublishedId,
            institution_id: rollback.institutionId,
            canonical_fee_key: rollback.canonicalFeeKey,
            fee_name: rollback.feeName,
            amount: rollback.amount,
          })),
          business_schedule: {
            business_fees: businessSchedule.businessFees,
            with_consumer_fee: businessSchedule.withConsumerFee,
            flagged: businessSchedule.flagged,
            waiting: businessSchedule.waiting,
            rolled_back: businessSchedule.rolledBack.length,
            restored: businessSchedule.restored,
          },
          same_line_duplicates: {
            candidates: sameLineDuplicates.candidates,
            duplicates: sameLineDuplicates.duplicates,
            flagged: sameLineDuplicates.flagged,
            waiting: sameLineDuplicates.waiting,
            rolled_back: sameLineDuplicates.rolledBack.length,
            restored: sameLineDuplicates.restored,
          },
          other_bank_document: {
            other_bank_fees: otherBank.otherBankFees,
            names_own_bank: otherBank.namesOwnBank,
            flagged: otherBank.flagged,
            waiting: otherBank.waiting,
            unconfirmed_host_fees: otherBank.unconfirmedHostFees,
            unconfirmed_host_flagged: otherBank.unconfirmedHostFlagged,
            unconfirmed_host_waiting: otherBank.unconfirmedHostWaiting,
            rolled_back: otherBank.rolledBack.length,
            links_cleared: otherBank.linksCleared,
          },
          hand_amount_correction: {
            corrected: handAmounts.corrected.map((fix) => ({ fee_published_id: fix.feePublishedId, from: fix.from, to: fix.to })),
            rejected_twins: handAmounts.rejectedTwins,
            skipped: handAmounts.skipped.length,
          },
          account_type_hold: {
            held_live: accountTypeHold.heldLive.length,
            held_waiting: accountTypeHold.heldWaiting.length,
            restored_held: accountTypeHold.restoredHeld.length,
            typed_rejected: accountTypeHold.typedRejected.length,
            checked_untyped: accountTypeHold.checkedUntyped,
            recheck_no_product: accountTypeHold.recheckNoProduct,
            error: accountTypeHold.error,
          },
          cut_name_duplicate: {
            taken_down: cutNameDuplicates.takenDown.map((item) => ({ fee_published_id: item.feePublishedId, kept_fee_published_id: item.keepFeePublishedId })),
            skipped: cutNameDuplicates.skipped.length,
            error: cutNameDuplicates.error,
          },
          hand_takedown: {
            taken_down: handTakedowns.takenDown.map((item) => ({ fee_published_id: item.feePublishedId, reason: item.reason })),
            skipped: handTakedowns.skipped.length,
            waiting_rejected: handTakedowns.waitingRejected.length,
            returns_live: handTakedowns.returnsLive,
            returns: handTakedowns.returns.map((item) => ({ fee_published_id: item.feePublishedId, reason: item.reason })),
            error: handTakedowns.error,
          },
          hand_audience_fix: {
            fixed: handAudience.fixed.map((item) => ({ fee_published_id: item.feePublishedId, from: item.from, to: item.to })),
            skipped: handAudience.skipped.length,
            error: handAudience.error,
          },
          eval_verdict: {
            eval_matched: evalVerdicts.evalMatched,
            eval_changed: evalVerdicts.evalChanged,
            rule_failing: evalVerdicts.ruleFailing,
            deferred: evalVerdicts.deferred,
            deferred_ids: evalVerdicts.deferredIds,
            flagged: evalVerdicts.flagged,
            waiting: evalVerdicts.waiting,
            rolled_back: evalVerdicts.rolledBack.length,
            flags: evalVerdicts.flags,
            flag_samples: evalVerdicts.flagSamples.slice(0, 10).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              flag: fee.flag,
              canonical_fee_key: fee.canonicalFeeKey,
              fee_name: fee.feeName,
              amount: fee.amount,
            })),
            samples: evalVerdicts.rolledBack.slice(0, 11).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              fee_name: fee.feeName,
              reason: fee.reason,
            })),
          },
          cross_page_restore: {
            superseded: crossPageRestore.superseded,
            cross_page: crossPageRestore.crossPage,
            restored: crossPageRestore.restored.length,
            failing: crossPageRestore.failing.length,
            business_left_down: crossPageRestore.businessLeftDown,
          },
          source_link_resource: {
            on: sourceLinkResource.on,
            candidates: sourceLinkResource.candidates,
            linked: resourceCount.linked,
            restored: resourceCount.restored,
            misses: sourceLinkResource.misses.map((fee) => ({ fee_published_id: fee.feePublishedId, taken_down: fee.takenDown, why: fee.why })),
            error: sourceLinkResource.error,
            changes: sourceLinkResource.resources.map((fee) => ({
              fee_published_id: fee.feePublishedId,
              action: fee.restore ? "restored" : "resourced",
              source_document_id: fee.sourceDocumentId,
              url: fee.url,
            })),
          },
          change_pairing: {
            unpaired: changePairing.unpaired,
            like_for_like: changePairing.likeForLike,
            cross_page: changePairing.crossPage,
            lists_both: changePairing.listsBoth,
            no_pair: changePairing.noPair,
            written: changePairing.written,
          },
          lost_recheck_restore: {
            candidates: lostRestore.candidates,
            passed: lostRestore.passed.length,
            restored: lostRestore.restored,
            failed: lostRestore.failed.length,
            skipped: lostRestore.skipped.length,
          },
          restore_recheck: {
            unchecked: restoreRecheck.unchecked,
            without_text: restoreRecheck.withoutText,
            passing: restoreRecheck.passing,
            failing: restoreRecheck.failing.length,
            flagged: restoreRecheck.flagged,
            waiting: restoreRecheck.waiting,
            rolled_back: restoreRecheck.rolledBack.length,
          },
          closed_institution: {
            live_fees: closedInstitution.liveFees,
            institutions: closedInstitution.institutions,
            rolled_back: closedInstitution.rolledBack.length,
          },
          article_page: {
            article_fees: articlePage.articleFees,
            flagged: articlePage.flagged,
            waiting: articlePage.waiting,
            rolled_back: articlePage.rolledBack.length,
          },
          cross_page_conflict: {
            fees_checked: crossPage.pairsChecked,
            conflicts: crossPage.conflicts,
            flagged: crossPage.flagged,
            waiting: crossPage.waiting,
            rolled_back: crossPage.rolledBack.length,
          },
          product_page_conflict: {
            live: productPageConflict.live,
            conflicts: productPageConflict.conflicts,
            flagged: productPageConflict.flagged,
            waiting: productPageConflict.waiting,
            rolled_back: productPageConflict.rolledBack.length,
          },
          product_page: {
            enabled: productPage.enabled,
            product_fees: productPage.productFees,
            flagged: productPage.flagged,
            waiting: productPage.waiting,
            rolled_back: productPage.rolledBack.length,
          },
          limit_rollbacks: limitRollbacks.length,
          limit_rollback_samples: limitRollbacks.slice(0, 10).map((rollback) => ({
            fee_published_id: rollback.feePublishedId,
            institution_id: rollback.institutionId,
            canonical_fee_key: rollback.canonicalFeeKey,
            fee_name: rollback.feeName,
            amount: rollback.amount,
            reason: rollback.reason,
          })),
          guard_requeue: {
            scanned: guardRequeue.scanned,
            requeued: guardRequeue.requeued.length,
            still_failing: guardRequeue.stillFailing,
            guard_version: guardRequeue.guardVersion,
            samples: guardRequeue.requeued.slice(0, 10).map((fee) => ({
              fee_verified_id: fee.feeVerifiedId,
              institution_id: fee.institutionId,
              canonical_fee_key: fee.canonicalFeeKey,
              fee_name: fee.feeName,
              publish_name: fee.publishName,
            })),
          },
          category_guard_rollbacks: categoryGuardRollbacks,
          category_guard_failing: categoryGuard.failingFees,
          category_guard_live_refiled: categoryGuard.liveRefiledFees,
          category_guard_version: categoryGuard.guardVersion,
          // v70: live card-product misfiles held live while CARD_PRODUCT_TAKEDOWN_LIVE is off (0 while on).
          category_guard_card_product_pending: categoryGuard.cardProductPending,
          category_guard_card_product_samples: categoryGuard.cardProductPendingSamples.slice(0, 10),
          category_guard_samples: categoryGuard.failures.slice(0, 10).map((failure) => ({
            fee_published_id: failure.feePublishedId,
            institution_id: failure.institutionId,
            canonical_fee_key: failure.canonicalFeeKey,
            fee_name: failure.feeName,
            amount: failure.amount,
            code: failure.code,
          })),
          companion_retire_rollbacks: companionRollbacks.length,
          companion_retire_rejected_verified: companionRetire.rejectedVerified,
          companion_retire_samples: companionRollbacks.slice(0, 10).map((rollback) => ({
            fee_published_id: rollback.feePublishedId,
            institution_id: rollback.institutionId,
            canonical_fee_key: rollback.canonicalFeeKey,
            fee_name: rollback.feeName,
            amount: rollback.amount,
            companion_source_id: rollback.companionSourceId,
          })),
          imported_twin_checked: importedTwins.checked,
          imported_twin_linked: importedTwins.linked,
          source_link_fill: {
            on: sourceLinkFill.on,
            scanned: sourceLinkFill.scanned,
            filled: sourceLinkFill.fills.length,
            untraceable_left_live: sourceLinkFill.untraceable,
            error: sourceLinkFill.error,
            fills: sourceLinkFill.fills.map((fee) => ({ fee_published_id: fee.feePublishedId, source_document_id: fee.sourceDocumentId, url: fee.url })),
          },
          source_link_drift: {
            live: linkDrift.live,
            dry_run: linkDrift.dryRun,
            scanned: linkDrift.scanned,
            repointed: linkDrift.repoints.length,
            flagged_for_second_look: linkDrift.flagged,
            awaiting_second_look: linkDrift.waiting,
            archived: linkDrift.archived.length,
            skipped: linkDrift.skipped,
            error: linkDrift.error,
            repoints: linkDrift.repoints.slice(0, 50).map((fee) => ({ fee_published_id: fee.feePublishedId, from: fee.from, to: fee.to })),
            failing: linkDrift.failing.slice(0, 50).map((fee) => ({ fee_published_id: fee.feePublishedId, link: fee.link, reason: fee.reason })),
          },
          identical_copy_documents: identicalCopy.documents,
          identical_copy_rows_moved: identicalCopy.rowsMoved,
          extraction_note_move: { moved: extractionNotes.moved, remaining: extractionNotes.remaining },
          name_retidy: {
            institutions_checked: nameRetidy.institutionsChecked,
            messy_names: nameRetidy.messyFees,
            renamed: nameRetidy.renames.length,
            skipped: nameRetidy.skipped,
          },
          account_names: {
            institutions_checked: accountNames.institutionsChecked,
            generic_names: accountNames.genericFees,
            renamed: accountNames.renames.length,
            skipped: accountNames.skipped,
          },
          lineup_correct: {
            documents_checked: lineupCorrect.documentsChecked,
            rows_checked: lineupCorrect.rowsChecked,
            rows_corrected: lineupCorrect.corrected.length,
          },
          refresh_copy_checked: refreshCopy.checked,
          refresh_copy_refreshed: refreshCopy.refreshed,
          refresh_copy_skipped: refreshCopy.skipped,
          refresh_copy_samples: refreshCopy.samples.slice(0, 10),
          current_copy: {
            documents_checked: currentCopy.documentsChecked,
            unrecognized: currentCopy.unrecognized,
            stated: currentCopy.stated,
            failing: currentCopy.failing,
            flagged: currentCopy.flagged,
            waiting: currentCopy.waiting,
            cleared: currentCopy.cleared,
            taken_down: currentCopy.takenDown.length,
            confirm_live: currentCopy.confirmLive,
          },
          newer_copy_live: newerCopy.live,
          newer_copy_documents: newerCopy.documentsChecked,
          newer_copy_unrecognized: newerCopy.unrecognized,
          newer_copy_still_stated: newerCopy.stillStated,
          newer_copy_still_named: newerCopy.stillNamed,
          newer_copy_retired: newerCopy.retired.length,
          newer_copy_restored: newerCopy.restored,
          newer_copy_proposed_restores: newerCopy.proposedRestores,
          newer_copy_blocked_restores: newerCopy.blockedRestores,
          newer_copy_restore_block_reasons: newerCopy.restoreBlockReasons,
          newer_copy_not_updated_restores: newerCopy.notUpdatedRestores,
          newer_copy_write_failed: newerCopy.writeFailed,
          newer_copy_failed_restores: newerCopy.failedRestores,
          newer_copy_samples: newerCopy.retired.slice(0, 10).map((fee) => ({
            fee_published_id: Number(fee.fee_published_id),
            institution_id: Number(fee.institution_id),
            older_document_id: Number(fee.source_document_id),
            newer_document_id: Number(fee.newer_document_id),
            canonical_fee_key: fee.canonical_fee_key,
            fee_name: fee.fee_name,
            amount: fee.amount == null ? null : Number(fee.amount),
          })),
          rules_recheck_documents: rulesRecheck?.documentsChecked ?? 0,
          rules_recheck_fees: rulesRecheck?.liveFeesChecked ?? 0,
          rules_recheck_rollbacks: recheckRollbacks,
          rules_recheck_flagged: rulesRecheck?.flagged ?? 0,
          rules_recheck_waiting: rulesRecheck?.waitingSecondLook ?? 0,
          rules_recheck_restores: recheckRestores,
          rules_recheck_samples: (rulesRecheck?.rollbacks ?? []).slice(0, 10).map((rollback) => ({
            fee_published_id: rollback.feePublishedId,
            institution_id: rollback.institutionId,
            source_document_id: rollback.sourceDocumentId,
            canonical_fee_key: rollback.canonicalFeeKey,
            fee_name: rollback.feeName,
            amount: rollback.amount,
          })),
          account_type_hold_feedback: {
            on: holdFeedback.on,
            due: holdFeedback.due,
            zeroed: holdFeedback.zeroed,
            error: holdFeedback.error,
          },
          learning_feedback: feedbackSync.ready
            ? {
                takedowns: feedbackSync.takedowns,
                restores: feedbackSync.restores,
                category_rejects: feedbackSync.categoryRejects,
                answer_key_fees: feedbackSync.answerKeyFees,
                written: feedbackSync.written,
                relabeled: feedbackSync.relabeled,
              }
            : false,
          source_check_institutions: sourceCheck?.institutionsChecked ?? 0,
          source_check_fees: sourceCheck?.liveFeesChecked ?? 0,
          source_check_traced: sourceCheck?.traced ?? 0,
          source_check_relinked: sourceCheck?.relinked ?? 0,
          source_check_takedowns: sourceTakedowns,
          source_check_restored: sourceCheck?.restored ?? 0,
          source_check_samples: (sourceCheck?.takedowns ?? []).slice(0, 10).map((row) => ({
            fee_published_id: row.feePublishedId,
            institution_id: row.institutionId,
            canonical_fee_key: row.canonicalFeeKey,
            fee_name: row.feeName,
            amount: row.amount,
            reason: row.reason,
          })),
          frequency_fills: frequencyFill.filled.length,
          frequency_holds: frequencyFill.held.length,
          // #1360: the overdraft plan hold's dry run while OVERDRAFT_PLAN_HOLD_LIVE is off.
          frequency_plan_would_hold: frequencyFill.planWouldHold.map((row) => ({
            fee_published_id: row.feePublishedId,
            institution_id: row.institutionId,
            amount: row.amount,
            frequency: row.frequency,
            source_line: row.sourceLine,
          })),
          frequency_fill_scanned: frequencyFill.scanned,
          frequency_fill_error: frequencyFill.writeError,
          frequency_fill_samples: frequencyFill.filled.slice(0, 10).map((row) => ({
            fee_published_id: row.feePublishedId,
            from: row.from,
            frequency: row.frequency,
            source_line: row.sourceLine.slice(0, 120),
          })),
          duplicate_collapses: duplicateCollapses.length,
          // #1069 step 1 (shadow while `live` is false): rows this step published that the exact
          // duplicate collapse would close, and how many the step's own late collapse did close.
          publish_duplicate_check: {
            live: published.duplicateCheck.live,
            with_live_copy: published.duplicateCheck.withLiveCopy,
            would_refuse: published.duplicateCheck.wouldRefuse,
            refused: published.duplicateCheck.refused,
            would_replace: published.duplicateCheck.wouldReplace,
            closed_by_late_collapse: published.results.filter(
              (result) =>
                result.exactDuplicate?.kind === "refuse" &&
                result.feePublishedId != null &&
                lateDuplicateCollapses.some((row) => row.feePublishedId === result.feePublishedId),
            ).length,
            samples: published.duplicateCheck.samples,
          },
          // #1069 step 2 (shadow while `live` is false): rows this step was about to publish that
          // the other-bank, unconfirmed-host or business-schedule sweep would take down.
          publish_sweep_check: {
            live: published.sweepCheck.live,
            would_refuse: published.sweepCheck.wouldRefuse,
            refused: published.sweepCheck.refused,
            by_rule: published.sweepCheck.byRule,
            error: published.sweepCheck.error,
            samples: published.sweepCheck.samples,
          },
          // Rows this step was about to publish that the page-copy collapse would close (page-copy-refuse.ts).
          page_copy_check: {
            live: published.pageCopyCheck.live,
            would_refuse: published.pageCopyCheck.wouldRefuse,
            refused: published.pageCopyCheck.refused,
            samples: published.pageCopyCheck.samples,
          },
          near_name_collapse: {
            live: nearNameCollapse.live,
            documents: nearNameCollapse.documents,
            pairs: nearNameCollapse.pairs,
            apart_on_page: nearNameCollapse.apartOnPage,
            not_printed: nearNameCollapse.notPrinted,
            no_text: nearNameCollapse.noText,
            [nearNameCollapse.live && run.runKind !== "dry_run" ? "closed" : "would_close"]: nearNameCollapse.collapses.length,
            samples: nearNameCollapse.collapses.slice(0, 10).map((row) => ({
              fee_published_id: row.feePublishedId,
              fee_name: row.feeName,
              kept_fee_published_id: row.keptFeePublishedId,
              kept_fee_name: row.keptFeeName,
              source_document_id: row.sourceDocumentId,
              amount: row.amount,
            })),
          },
          page_copy_restore: {
            ...(pageCopyRestore.error ? { error: pageCopyRestore.error } : {}),
            kept_down: pageCopyRestore.keptDown,
            carried_on: pageCopyRestore.carriedOn,
            kept_judged: pageCopyRestore.keptJudged,
            failing: pageCopyRestore.failing.length,
            [run.runKind === "dry_run" ? "would_restore" : "restored"]: pageCopyRestore.restored.length,
            samples: pageCopyRestore.restored.slice(0, 10).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              kept_fee_published_id: fee.keptFeePublishedId,
              fee_name: fee.feeName,
              amount: fee.amount,
            })),
          },
          page_copy_collapse: {
            live: pageCopyCollapse.live,
            ...(pageCopyCollapse.error ? { error: pageCopyCollapse.error } : {}),
            institutions: pageCopyCollapse.institutions,
            pairs: pageCopyCollapse.pairs,
            apart_on_page: pageCopyCollapse.apartOnPage,
            unproven: pageCopyCollapse.unproven,
            other_document: pageCopyCollapse.otherDocument,
            renamed: pageCopyCollapse.renamed,
            [pageCopyCollapse.live && run.runKind !== "dry_run" ? "closed" : "would_close"]: pageCopyCollapse.collapses.length,
            samples: pageCopyCollapse.collapses.slice(0, 10).map((row) => ({
              fee_published_id: row.feePublishedId,
              fee_name: row.feeName,
              source_document_id: row.sourceDocumentId,
              kept_fee_published_id: row.keptFeePublishedId,
              kept_fee_name: row.keptFeeName,
              kept_source_document_id: row.keptSourceDocumentId,
              amount: row.amount,
              ...(row.renamed ? { renamed: true } : {}),
            })),
            renamed_samples: pageCopyCollapse.collapses.filter((row) => row.renamed).slice(0, 10).map((row) => ({
              fee_published_id: row.feePublishedId,
              fee_name: row.feeName,
              kept_fee_published_id: row.keptFeePublishedId,
              kept_fee_name: row.keptFeeName,
              amount: row.amount,
            })),
            [pageCopyCollapse.live && run.runKind !== "dry_run" ? "kept_names_carried" : "would_carry_kept_name"]: pageCopyCollapse.collapses.filter((row) => row.keptNewName).length,
            carried_name_samples: pageCopyCollapse.collapses.filter((row) => row.keptNewName).slice(0, 10).map((row) => ({
              kept_fee_published_id: row.keptFeePublishedId,
              kept_fee_name: row.keptFeeName,
              kept_new_name: row.keptNewName,
              amount: row.amount,
            })),
          },
          duplicate_collapse_samples: duplicateCollapses.slice(0, 10).map((row) => ({
            fee_published_id: row.feePublishedId,
            kept_fee_published_id: row.keptFeePublishedId,
            institution_id: row.institutionId,
            canonical_fee_key: row.canonicalFeeKey,
            fee_name: row.feeName,
            amount: row.amount,
          })),
          published_free_fees: published.zeroFeesPublished,
          outcomes: published.outcomes,
          learning_log: published.learning,
          publish_limit: published.limit,
          publish_time_box: {
            deadline_ms: PUBLISH_ROW_DEADLINE_MS,
            top_up_deadline_ms: PUBLISH_TOP_UP_DEADLINE_MS,
            stopped: published.timeBox.stopped,
            rows_left: published.timeBox.rowsLeft,
            top_up_skipped: published.timeBox.topUpSkipped,
          },
          sweep_ms: sweepMs,
          // Which moved sweeps this step ran (hamilton/publish-sweeps.ts) and what each changed, or
          // in a dry run would change: set beside the `publish-sweeps` dry run's own `sweep_counts`.
          sweep_mode: sweepMode,
          sweep_counts: movedSweepCounts(
            {
              outlierRestores, offTaxonomyRestores, taxonomyFold, outlierRollbacks, offTaxonomyRollbacks, limitRollbacks,
              businessSchedule, sameLineDuplicates, otherBank, evalVerdicts, handAmounts, cutNameDuplicates, accountTypeHold,
              handTakedowns, handAudience, closedInstitution, articlePage, productPage, productPageConflict, crossPage, categoryGuard,
              earlyDuplicateCollapses, nearNameCollapse, pageCopyRestore, pageCopyCollapse, frequencyFill, identicalCopy,
              nameRetidy, extractionNotes, accountNames, lineupCorrect, restoreRecheck, lostRestore, changePairing, crossPageRestore,
              importedTwins, sourceLinkFill, linkDrift, feedbackSync, holdFeedback,
            },
            (key) => runsMovedSweep(sweepMode, key),
          ),
          phase_ms: {
            sweeps_before: publishRowsStartedAt - publishStartedAt,
            publish_rows: publishRowsEndedAt - publishRowsStartedAt,
            sweeps_after: Date.now() - publishRowsEndedAt,
          },
          publish_min_confidence: published.minConfidence,
          publish_min_institution_fees: published.minInstitutionFees,
          held_thin_fees: published.heldFees,
          held_thin_institutions: published.heldInstitutions.slice(0, 25).map((entry) => ({
            institution_id: entry.institutionId,
            institution_name: entry.institutionName,
            fee_count: entry.feeCount,
            held_rows: entry.heldRows,
          })),
          publish_batch_id: published.batchId,
          dry_run: published.dryRun,
          index_refreshed: indexRefresh?.refreshed ?? false,
          index_categories: indexRefresh?.categories ?? 0,
          institution_results: institutionResults(
            "publish",
            published.results.map((result) => ({ institution_id: result.institutionId, status: result.status, reason: result.reason })),
          ),
          sample_results: published.results.slice(0, 10).map((result) => ({
            fee_verified_id: result.feeVerifiedId,
            identity_deferred: result.identityDeferred ?? false,
            institution_id: result.institutionId,
            fee_name: result.feeName,
            amount: result.amount,
            canonical_fee_key: result.canonicalFeeKey,
            status: result.status,
            reason: result.reason,
            fee_published_id: result.feePublishedId,
            superseded_fee_published_id: result.supersededFeePublishedId,
          })),
        },
      };
    }
    case "category-guard": {
      const guard = await runHamiltonCategoryGuard({
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["category_guard_limit", "limit"]),
        institutionId: numericRunParam(params, ["institution_id"]),
        db: tx,
      });
      const indexRefresh = guard.rolledBackFees > 0 || guard.liveRefiledFees > 0
        ? await refreshFeeIndexCache(tx, { runId: run.id, force: true })
        : null;
      return {
        status: "completed",
        summary: guard.dryRun
          ? `Hamilton category guard (dry run): ${guard.failingFees.toLocaleString()} of ${guard.scannedFees.toLocaleString()} live guarded fees would be rolled back.`
          : `Hamilton category guard rolled back ${guard.rolledBackFees.toLocaleString()} of ${guard.failingFees.toLocaleString()} failing live fees (${guard.scannedFees.toLocaleString()} scanned).${indexRefresh?.refreshed ? ` Index refreshed: ${indexRefresh.categories} categories.` : ""}`,
        detail: {
          scanned_fees: guard.scannedFees,
          failing_fees: guard.failingFees,
          rolled_back_fees: guard.rolledBackFees,
          rejected_verified_fees: guard.rejectedVerifiedFees,
          flagged_fees: guard.flaggedFees,
          awaiting_second_look: guard.awaitingSecondLook,
          restored_fees: guard.restoredFees,
          refiled_fees: guard.refiledFees,
          live_refiled_fees: guard.liveRefiledFees,
          card_product_pending: guard.cardProductPending,
          card_product_pending_samples: guard.cardProductPendingSamples,
          category_guard_limit: guard.limit,
          rollback_batch_id: guard.rollbackBatchId,
          guard_version: guard.guardVersion,
          by_code: guard.byCode,
          by_category: guard.byCategory,
          dry_run: guard.dryRun,
          index_refreshed: indexRefresh?.refreshed ?? false,
          sample_failures: guard.failures.slice(0, 50).map((failure) => ({
            fee_published_id: failure.feePublishedId,
            institution_id: failure.institutionId,
            canonical_fee_key: failure.canonicalFeeKey,
            fee_name: failure.feeName,
            amount: failure.amount,
            code: failure.code,
          })),
        },
      };
    }
    case "audience-relabel": {
      // Darwin's audience decision for live fees verified before migration 47 (#1059).
      const relabel = await runAudienceRelabel(tx, {
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        // One bounded batch per step; the tick queues the next from `next_after_id` (audience-relabel-schedule.ts).
        afterId: numericRunParam(params, ["after_id"]) ?? 0,
        sampleKey: typeof params.day === "string" ? params.day : null,
        // A run does what it was queued for: a full dry run queued before a deploy never writes.
        mode: (["off", "dry_run_full", "live", "rollback"] as const).includes(params.mode as AudienceRelabelMode)
          ? (params.mode as AudienceRelabelMode)
          : undefined,
      });
      const changed = relabel.relabeled + relabel.restored;
      // The full dry run's last batch adds the chain's totals, the numbers the live switch waits on.
      const totals = relabel.mode === "dry_run_full" && relabel.done
        ? await dryRunFullTotals(tx, relabel, numericRunParam(params, ["after_id"]) ?? 0)
        : null;
      if (totals) {
        await tx`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (${run.id}, ${step.id}, 'audience_relabel.dry_run_totals', 'completed',
                  ${`Full dry run done: ${totals.fees.toLocaleString()} live unknown fees on ${totals.documents.toLocaleString()} documents in ${totals.batches} batches; ${Object.entries(totals.shares).map(([audience, share]) => `${audience} ${share}%`).join(", ")}.`},
                  ${JSON.stringify(totals)}::jsonb)
        `;
      }
      const indexRefresh = changed > 0 ? await refreshFeeIndexCache(tx, { runId: run.id, force: true }) : null;
      const counts = Object.entries(relabel.byAudience).map(([audience, n]) => `${n.toLocaleString()} ${audience}`).join(", ");
      return {
        status: "completed",
        summary: relabel.mode === "rollback"
          ? `Darwin audience relabel rolled back: ${relabel.restored.toLocaleString()} fees back to their old audience${relabel.dryRun ? " (dry run, nothing written)" : ""}; ${relabel.remaining.toLocaleString()} recorded fees left.`
          : `Darwin audience relabel${relabel.dryRun ? " (dry run, nothing written)" : ""}: ${relabel.fees.toLocaleString()} live fees verified as unknown or mixed-schedule both on ${relabel.documents.toLocaleString()} documents; decisions ${counts || "none"}. ${relabel.dryRun ? "" : `${relabel.relabeled.toLocaleString()} written, ${relabel.publishedTouched.toLocaleString()} live rows updated.`} ${relabel.remaining.toLocaleString()} documents left${relabel.mode === "off" ? " outside this sample" : ""}.${totals ? ` Full dry run done: ${Object.entries(totals.shares).map(([audience, share]) => `${audience} ${share}%`).join(", ")} of ${totals.fees.toLocaleString()} fees.` : ""}`.replace(/\s+/g, " ").trim(),
        detail: {
          audience_relabel_version: AUDIENCE_RELABEL_VERSION,
          mode: relabel.mode,
          dry_run: relabel.dryRun,
          documents: relabel.documents,
          fees: relabel.fees,
          by_audience: relabel.byAudience,
          by_source: relabel.bySource,
          by_change: relabel.byChange,
          relabeled: relabel.relabeled,
          published_touched: relabel.publishedTouched,
          restored: relabel.restored,
          dry_run_totals: totals,
          after_id: numericRunParam(params, ["after_id"]) ?? 0,
          next_after_id: relabel.nextAfterId,
          remaining: relabel.remaining,
          done: relabel.done,
          index_refreshed: indexRefresh?.refreshed ?? false,
          samples: relabel.samples,
        },
      };
    }
    case "frequency-fill": {
      // The frequency half of a guard catch-up run (hamilton/guard-catch-up.ts): every live fee,
      // not one lane's, so a frequency fix reaches live rows on the tick after its deploy.
      const fill = await fillBlankFrequencies(tx, {
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
      });
      const blanks = fill.filled.filter((row) => row.from == null).length;
      const cleared = fill.filled.filter((row) => row.frequency == null).length;
      return {
        status: "completed",
        summary: `${fill.dryRun ? "Would set" : "Set"} the frequency of ${fill.filled.length.toLocaleString()} of ${fill.scanned.toLocaleString()} candidate live fees from their own schedule row (${blanks.toLocaleString()} blank, ${cleared.toLocaleString()} cleared)${fill.held.length > 0 ? `, and ${fill.dryRun ? "would hold" : "held"} ${fill.held.length.toLocaleString()} whose own line prices them by the period` : ""}.`,
        detail: {
          frequency_fill_version: FREQUENCY_FILL_VERSION,
          frequency_fill_scanned: fill.scanned,
          frequency_fills: fill.filled.length,
          frequency_holds: fill.held.length,
          frequency_filled_blank: blanks,
          frequency_cleared: cleared,
          dry_run: fill.dryRun,
          frequency_fill_samples: fill.filled.slice(0, 25).map((row) => ({
            fee_published_id: row.feePublishedId,
            institution_id: row.institutionId,
            canonical_fee_key: row.canonicalFeeKey,
            amount: row.amount,
            from: row.from,
            to: row.frequency,
          })),
        },
      };
    }
    case "source-link-repair": {
      // Started by hand (admin, dry run first): live fees with no source link take their own
      // document's URL or come down (hamilton/source-link.ts).
      const repair = await repairSourceLinks(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        limit: numericRunParam(params, ["source_link_limit", "limit"]),
      });
      return {
        status: "completed",
        summary: `${repair.resourced.length > 0 ? `${repair.dryRun ? "Would re-source" : "Re-sourced"} ${repair.resourced.length.toLocaleString()} fee(s) from a stored document of their own institution that prints them (${repair.resourced.filter((fee) => fee.restore).length.toLocaleString()} ${repair.dryRun ? "would be restored" : "restored"}). ` : ""}${repair.dryRun ? "Would link" : "Linked"} ${repair.fills.length.toLocaleString()} of ${repair.scanned.toLocaleString()} live fees with no source link to their own document, and ${repair.dryRun ? "would take down" : "took down"} ${repair.takedowns.length.toLocaleString()} with no traceable document.`,
        detail: {
          source_link_version: SOURCE_LINK_VERSION,
          dry_run: repair.dryRun,
          resourced: repair.resourced.map((fee) => ({
            fee_published_id: fee.feePublishedId,
            action: fee.restore ? "restored" : "resourced",
            institution_id: fee.institutionId,
            source_document_id: fee.sourceDocumentId,
            url: fee.url,
            source_line: fee.sourceLine,
          })),
          scanned: repair.scanned,
          filled: repair.fills.length,
          taken_down: repair.takedowns.length,
          takedown_reasons: repair.takedowns.reduce<Record<string, number>>((counts, fee) => {
            counts[fee.reason] = (counts[fee.reason] ?? 0) + 1;
            return counts;
          }, {}),
          takedowns: repair.takedowns.map((fee) => ({
            fee_published_id: fee.feePublishedId,
            institution_id: fee.institutionId,
            canonical_fee_key: fee.canonicalFeeKey,
            amount: fee.amount,
            reason: fee.reason,
          })),
          fill_samples: repair.fills.slice(0, 25).map((fee) => ({
            fee_published_id: fee.feePublishedId,
            institution_id: fee.institutionId,
            source_document_id: fee.sourceDocumentId,
            url: fee.url,
          })),
        },
      };
    }
    case "public-discovery":
    case "public-audit": {
      const audit = await runPublicDiscoveryAudit({
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["public_discovery_limit", "route_limit", "limit", "size"]),
        stateCode,
        db: tx,
      });
      return {
        status: "completed",
        summary: `Atlas public discovery checked ${audit.processed.toLocaleString()} of ${audit.selected.toLocaleString()} selected routes (${audit.findings.toLocaleString()} findings, ${audit.criticalFindings.toLocaleString()} critical).`,
        detail: {
          selected_routes: audit.selected,
          processed_routes: audit.processed,
          observed_routes: audit.observed,
          failed_routes: audit.failed,
          public_findings: audit.findings,
          critical_public_findings: audit.criticalFindings,
          warning_public_findings: audit.warningFindings,
          route_templates: audit.routeTemplates,
          public_discovery_limit: audit.limit,
          state_code: stateCode ?? null,
          dry_run: audit.dryRun,
          sample_results: audit.routes.slice(0, 10),
        },
      };
    }
    case "public-cluster": {
      const clusters = await clusterPublicDiscoveryFindings({
        runId: run.id,
        stateCode,
        db: tx,
      });
      return {
        status: "completed",
        summary: `Darwin grouped public discovery into ${clusters.clusters.toLocaleString()} route-template cluster${clusters.clusters === 1 ? "" : "s"} (${clusters.systemicCandidates.toLocaleString()} systemic candidates).`,
        detail: {
          public_discovery_clusters: clusters.clusters,
          systemic_candidates: clusters.systemicCandidates,
          findings_tagged: clusters.findingsTagged,
          critical_public_findings: clusters.criticalFindings,
          state_code: stateCode ?? null,
          sample_clusters: clusters.summaryRows,
        },
      };
    }
    case "public-diagnose": {
      const diagnosis = await summarizePublicDiscoveryDiagnosis({
        runId: run.id,
        stateCode,
        db: tx,
      });
      return {
        status: "completed",
        summary: diagnosis.summary,
        detail: {
          public_findings: diagnosis.findings,
          critical_public_findings: diagnosis.criticalFindings,
          systemic_candidates: diagnosis.systemicCandidates,
          top_issue: diagnosis.topIssue,
          state_code: stateCode ?? null,
        },
      };
    }
    case "daily-brief": {
      const result = await runDailyBrief({ dryRun: run.runKind === "dry_run" });
      return {
        status: "completed",
        summary: result.deliveryStatus === "sent"
          ? `Atlas emailed the morning brief to ${[result.recipient, ...result.cc].join(", ")}.`
          : `Atlas wrote the daily brief but did not email it: ${result.deliveryReason ?? result.deliveryStatus}.`,
        detail: {
          delivery_status: result.deliveryStatus,
          delivery_reason: result.deliveryReason,
          subject: result.brief.subject,
          lines: result.brief.lines,
          needs_you: result.brief.needsYou?.map((item) => ({ id: item.id, severity: item.severity, title: item.title })) ?? null,
          funnel: result.funnel,
        },
      };
    }
    case "fee-alert-dispatch": {
      const result = await runFeeAlertDispatch({ dryRun: run.runKind === "dry_run" });
      return {
        status: "completed",
        summary: summarizeFeeAlertDispatch(result),
        detail: { ...result },
      };
    }
    case "briefing-refresh": {
      const institutionId = Number(params.institution_id);
      const result = await runBriefingRefresh({
        dryRun: run.runKind === "dry_run",
        institutionId: Number.isInteger(institutionId) && institutionId > 0 ? institutionId : null,
        runId: run.id,
      });
      const preview =
        result.workspaces === 0 && !result.dryRun
          ? await runBriefingRefresh({ dryRun: true, institutionId: PREVIEW_INSTITUTION_ID })
          : null;
      return {
        status: "completed",
        summary: [summarizeBriefingRefresh(result), preview && `Preview for institution ${PREVIEW_INSTITUTION_ID}: ${summarizeBriefingRefresh(preview)}`]
          .filter(Boolean)
          .join(" "),
        detail: { ...result, preview },
      };
    }
    case "competitor-alerts": {
      const institutionId = Number(params.institution_id);
      const result = await runCompetitorAlerts({
        dryRun: run.runKind === "dry_run",
        institutionId: Number.isInteger(institutionId) && institutionId > 0 ? institutionId : null,
      });
      const preview =
        result.banks === 0 && !result.dryRun
          ? await runCompetitorAlerts({ dryRun: true, institutionId: PREVIEW_INSTITUTION_ID })
          : null;
      return {
        status: "completed",
        summary: [summarizeCompetitorAlerts(result), preview && `Preview for institution ${PREVIEW_INSTITUTION_ID}: ${summarizeCompetitorAlerts(preview)}`]
          .filter(Boolean)
          .join(" "),
        detail: { ...result, preview },
      };
    }
    case "pro-digest": {
      const result = await runProDigest({ dryRun: run.runKind === "dry_run" });
      return {
        status: "completed",
        summary: summarizeProDigest(result),
        detail: { ...result },
      };
    }
    case "pro-seat-check": {
      const result = await runProSeatCheck({ dryRun: run.runKind === "dry_run" });
      // A failed check fails the step, so it shows red on the run ledger.
      if (!result.passed && !result.dryRun) throw new Error(summarizeProSeatCheck(result));
      return {
        status: "completed",
        summary: summarizeProSeatCheck(result),
        detail: { ...result },
      };
    }
    case "lead-watch": {
      const result = await runLeadWatch({ dryRun: run.runKind === "dry_run" });
      return {
        status: "completed",
        summary: summarizeLeadWatch(result),
        detail: {
          overdue: result.overdue.length,
          email_failed: result.emailFailed.length,
          alert: result.alert,
          alert_reason: result.alertReason,
          dry_run: result.dryRun,
          lead_ids: [...result.overdue, ...result.emailFailed].map((lead) => lead.id),
        },
      };
    }
    case "indexnow-ping": {
      const result = await runIndexNowPing({ dryRun: run.runKind === "dry_run" });
      // A rejected ping fails the step (and is retried) so it shows on the run ledger.
      if (result.error) throw new Error(summarizeIndexNow(result));
      return {
        status: "completed",
        summary: summarizeIndexNow(result),
        detail: {
          submitted: result.submitted,
          changed_institutions: result.changedInstitutions,
          url_count: result.urls.length,
          http_status: result.httpStatus,
          skipped: result.skipped,
          dry_run: result.dryRun,
          sample_urls: result.urls.slice(0, 10),
        },
      };
    }
    case "score-answer-key": {
      // First James's answer-key decisions (atlas/answer-key-relabels.ts, #1099), so today's score
      // reads the corrected key. It writes only answer_key_fees.canonical_key/conditions on the
      // listed lines, in its own savepoint: a failed relabel is reported and never stops the score.
      const relabel = await inSavepoint(tx, (scope) => runAnswerKeyRelabels({ db: scope, dryRun: run.runKind === "dry_run" }))
        .then((value) => ({ value, error: null as string | null }))
        .catch((error: unknown) => ({ value: null, error: error instanceof Error ? error.message : String(error) }));
      const result = await runAnswerKeyScore({ runId: run.id, stepId: step.id, dryRun: run.runKind === "dry_run", db: tx });
      const score = result.score;
      const relabelLine = relabel.value ? summarizeAnswerKeyRelabels(relabel.value) : `Atlas's answer-key relabel failed: ${relabel.error}.`;
      return {
        status: "completed",
        summary: `${relabelLine} ${summarizeAnswerKeyScore(result)}`,
        detail: {
          answer_key_relabel: relabel.value ? answerKeyRelabelDetail(relabel.value) : { error: relabel.error },
          schema_ready: result.schemaReady,
          reference_eligibility: result.reference ?? null,
          reference_checks: result.referenceChecks ?? null,
          score_run_id: result.scoreRunId,
          scorer_version: score?.scorerVersion ?? null,
          series: (result.series ?? []).map((entry) => ({
            scorer_version: entry.scorerVersion,
            score_run_id: entry.scoreRunId,
            precision: entry.score.overall.precision,
            recall: entry.score.overall.recall,
          })),
          banks_scored: score?.banksScored ?? 0,
          fees_expected: score?.feesExpected ?? 0,
          precision: score?.overall.precision ?? null,
          recall: score?.overall.recall ?? null,
          by_stage: score?.byStage ?? {},
          by_document_type: score?.byDocumentType ?? {},
          by_category: score?.byCategory ?? {},
          // #1099: Knox's misses on documents Rosetta read right, by category and document type.
          knox_misses: score?.knoxMisses ?? null,
          dry_run: result.dryRun,
        },
      };
    }
    case "deming-regression": {
      const result = await runDemingRegression({ runId: run.id, dryRun: run.runKind === "dry_run", db: tx });
      return {
        status: "completed",
        summary: summarizeDemingRegression(result),
        detail: {
          version: DEMING_REGRESSION_VERSION,
          schema_ready: result.schemaReady,
          dry_run: result.dryRun,
          promoted: result.promoted,
          promoted_active: result.promotedActive,
          promoted_by_severity: result.promotedBySeverity,
          replayed: result.replayed,
          caught: result.caught,
          regressions: result.regressions.length,
          regression_cases: result.regressions.slice(0, 50),
          activated: result.activated,
          retired: result.retired,
          active_total: result.activeTotal,
          candidate_total: result.candidateTotal,
        },
      };
    }
    case "deming-fresh-audit": {
      const result = await runFreshAudit({ db: tx });
      // New misses become candidate test cases and go to their owners (#1119).
      const writes = await recordAuditMisses(tx, result, { runId: run.id, dryRun: run.runKind === "dry_run" });
      const routed = writes.cases + writes.feedback > 0
        ? ` Saved ${writes.cases.toLocaleString()} new miss${writes.cases === 1 ? "" : "es"} as test cases and sent ${writes.feedback.toLocaleString()} to their owners.`
        : "";
      return {
        status: "completed",
        summary: `${summarizeFreshAudit(result)}${routed}`,
        detail: { ...freshAuditDetail(result), audit_misses: writes },
      };
    }
    case "deming-change-outcomes": {
      const result = await runChangeOutcomes({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run" });
      return {
        status: "completed",
        summary: summarizeChangeOutcomes(result),
        detail: { ready: result.ready, entries: result.entries, started: result.started, pending: result.pending, judged: result.judged, hit_rate: result.hitRate },
      };
    }
    case "deming-sunday-maintenance": {
      const result = await runSundayMaintenance({ db: tx, dryRun: run.runKind === "dry_run" });
      return {
        status: "completed",
        summary: summarizeSundayMaintenance(result),
        detail: {
          ran: result.ran,
          reason: result.reason,
          delivery_status: result.deliveryStatus,
          delivery_reason: result.deliveryReason,
          subject: result.email?.subject ?? null,
          minutes: result.email?.minutes ?? null,
          rolled_over: result.email?.rolledOver ?? null,
          lines: result.email?.lines ?? null,
        },
      };
    }
    case "deming-benchmark-health": {
      const result = await runBenchmarkHealth({ db: tx });
      return { status: "completed", summary: summarizeBenchmarkHealth(result), detail: benchmarkHealthDetail(result) };
    }
    case "deming-data-quality": {
      // Read-only (#1065): two SELECTs over the live catalogs and one over the step's own history.
      const result = await runDataQuality({ db: tx });
      return { status: "completed", summary: summarizeDataQuality(result), detail: dataQualityDetail(result) };
    }
    case "deming-source-health": {
      // Read-only (#1866): one SELECT over registry_ingest_partitions and one over Atlas's newest table sizes.
      const report = await readSourceHealth({ db: tx });
      return { status: "completed", summary: summarizeSourceHealth(report), detail: sourceHealthDetail(report) };
    }
    case "deming-knox-misses": {
      // #1099: writes only eval_cases (new missed-fee cases and each case's replay); never a fee row.
      const result = await runKnoxMisses({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run" });
      return { status: "completed", summary: summarizeKnoxMisses(result), detail: knoxMissesDetail(result) };
    }
    case "deming-playbook-check": {
      // Read-only (#1105): one SELECT over the playbooks; the step's ledger row is its only write.
      const result = await runPlaybookContradictions({ db: tx });
      return { status: "completed", summary: summarizePlaybookContradictions(result), detail: playbookContradictionsDetail(result) };
    }
    case "atlas-city-repair": {
      const result = await runCityRepair({ db: tx, dryRun: run.runKind === "dry_run" });
      // #2022: registry links checked by hand (Natbank's own U.S. pages), the same guarded kind of repair.
      // Its own savepoint: a failure leaves the city repairs written and is reported in the detail.
      let links: Awaited<ReturnType<typeof runHandLinkRepair>> | null = null;
      let linksError: string | null = null;
      try {
        links = await inSavepoint(tx, (scope) => runHandLinkRepair({ db: scope, dryRun: run.runKind === "dry_run" }));
      } catch (error) {
        linksError = error instanceof Error ? error.message : String(error);
      }
      return {
        status: "completed",
        summary: links && links.candidates.length > 0 ? `${summarizeCityRepair(result)} ${summarizeHandLinkRepair(links)}` : summarizeCityRepair(result),
        detail: { ...cityRepairDetail(result), hand_links: links ? handLinkRepairDetail(links) : { error: linksError } },
      };
    }
    case "atlas-storage-retention": {
      const result = await runStorageRetention({ db: tx, dryRun: run.runKind === "dry_run" });
      // #1870: Hoovie's cold-tier plan on the same connection. Counts only; export is off and nothing prunes.
      const cold = await runColdTier({ db: tx, dryRun: run.runKind === "dry_run", runId: run.id });
      return {
        status: "completed",
        summary: `${summarizeStorageRetention(result)} ${summarizeColdTier(cold)}`,
        detail: { ...storageRetentionDetail(result), cold_tier: coldTierDetail(cold) },
      };
    }
    case "schedule-check": {
      const result = await runScheduleCheck({ db: tx });
      return {
        status: "completed",
        summary: summarizeScheduleCheck(result),
        detail: {
          version: SCHEDULE_CHECK_VERSION,
          checked_at: result.checkedAt,
          ...result.counts,
          schedules: result.rows,
        },
      };
    }
    case "bayes-replay-ledger": {
      const result = await runBayesLedger({ runId: run.id, dryRun: run.runKind === "dry_run", db: tx });
      return {
        status: "completed",
        summary: summarizeBayesLedger(result),
        detail: {
          version: BAYES_LEDGER_VERSION,
          schema_ready: result.schemaReady,
          dry_run: result.dryRun,
          closed: result.closed,
          open: result.open,
          stuck: result.stuck,
          not_counted: result.notCounted,
          failed: result.failed,
          queued_records: result.queuedRecords,
          jobs: result.jobs,
        },
      };
    }
    case "scoreboard-snapshot": {
      const result = await runScoreboardSnapshot({ runId: run.id, dryRun: run.runKind === "dry_run", db: tx });
      return {
        status: "completed",
        summary: summarizeScoreboard(result),
        detail: {
          schema_ready: result.schemaReady,
          stored: result.stored,
          snapshot_date: result.snapshotDate,
          ...result.numbers,
          agent_health: result.agentHealth ?? null,
        },
      };
    }
    case "content-market-spread": {
      // The brief: the drafting agent's lessons from skipped drafts, read before it drafts; a
      // subject James skipped stays out of the next drafts.
      const lessons = await recentLessons(tx, DEFAULT_DRAFT_AGENT);
      const result = await runMarketSpread({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run", avoidSubjects: skippedSubjects(lessons, MARKET_SPREAD_WORKFLOW) });
      return { status: "completed", summary: [summarizeMarketSpread(result), lessonsLine(lessons)].filter(Boolean).join(" "), detail: { ...result, lessons } };
    }
    case "content-fee-depth": {
      const lessons = await recentLessons(tx, DEFAULT_DRAFT_AGENT);
      const result = await runFeeDepth({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run", avoidSubjects: skippedSubjects(lessons, FEE_DEPTH_WORKFLOW) });
      return { status: "completed", summary: [summarizeFeeDepth(result), lessonsLine(lessons)].filter(Boolean).join(" "), detail: { ...result, lessons } };
    }
    case "content-od-by-state": {
      const lessons = await recentLessons(tx, "ernest");
      const result = await runOdByState({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run" });
      return { status: "completed", summary: [summarizeOdByStateResult(result), lessonsLine(lessons)].filter(Boolean).join(" "), detail: { ...result, lessons } };
    }
    case "growth-contacts": {
      const result = await runContactFinder({
        db: tx,
        runId: run.id,
        limit: numericRunParam(params, ["limit"]),
        dryRun: run.runKind === "dry_run",
      });
      return { status: "completed", summary: summarizeContactFinder(result), detail: { ...result } };
    }
    case "growth-contact-picks": {
      // Ranks every saved contact with today's rules and stores its role, confidence and
      // primary/backup pick; on its first run this is the backfill for rows saved before the columns.
      const result = await refreshContactPicks({ db: tx, dryRun: run.runKind === "dry_run" });
      return { status: "completed", summary: summarizeContactPicks(result), detail: { ...result } };
    }
    case "growth-outreach": {
      const followUps = await runOutreachFollowUps({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run" });
      const result = await runOutreachDrafts({
        db: tx,
        runId: run.id,
        limit: numericRunParam(params, ["limit"]),
        dryRun: run.runKind === "dry_run",
        campaigns: outreachCampaignsFromEnv(process.env.OUTREACH_CAMPAIGNS),
      });
      // Always say how many follow-ups were due, so a run with none shows the check happened.
      const followUpLine = run.runKind === "dry_run"
        ? ` Follow-ups (day 6 and final day 13): ${followUps.due} due, would draft ${followUps.due}.`
        : ` Follow-ups (day 6 and final day 13): ${followUps.due} due, ${followUps.drafted} drafted.`;
      return { status: "completed", summary: summarizeOutreach(result) + followUpLine, detail: { ...result, followUps } };
    }
    case "growth-withdraw": {
      // Started by the agent tick (growth/withdraw.ts) when unreviewed first emails no longer
      // qualify; the same withdrawal a real outreach run makes first. Free, no model calls.
      const dryRun = run.runKind === "dry_run";
      const withdrawn = await withdrawNonBuyerDrafts(tx, dryRun);
      const summary = dryRun
        ? `Would withdraw ${withdrawn} unreviewed first email${withdrawn === 1 ? "" : "s"} that no longer qualif${withdrawn === 1 ? "ies" : "y"}.`
        : `Withdrew ${withdrawn} unreviewed first email${withdrawn === 1 ? "" : "s"} that no longer qualif${withdrawn === 1 ? "ies" : "y"} (older format or wording, not a decision-maker, or a quoted fee no longer live).`;
      return { status: "completed", summary, detail: { dryRun, withdrawn } };
    }
    case "growth-quote": {
      // Free: a quote email per qualified lead, drafted into the queue; nothing sends.
      const result = await runQuoteDrafts({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run" });
      return { status: "completed", summary: summarizeQuoteDrafts(result), detail: { ...result } };
    }
    case "growth-learning": {
      const result = await runLearningReport({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run" });
      return { status: "completed", summary: summarizeLearning(result), detail: { ...result } };
    }
    case "growth-proposals": {
      const result = await runProposals({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run" });
      return { status: "completed", summary: summarizeProposals(result), detail: { ...result } };
    }
    case "growth-plan": {
      const result = await runMondayPlan({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run" });
      return { status: "completed", summary: summarizeMondayPlan(result), detail: { ...result } };
    }
    case "growth-intel": {
      const result = await runMarketIntel({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run" });
      return { status: "completed", summary: summarizeMarketIntel(result), detail: { ...result } };
    }
    case "growth-conversion": {
      const result = await runConversionCheck({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run" });
      return { status: "completed", summary: summarizeConversionCheck(result), detail: { ...result } };
    }
    case "growth-press": {
      // BERNAYS's brief: an outlet or finding James skipped with a reason stays out while the lesson stands.
      const lessons = await recentLessons(tx, "bernays");
      const result = await runPressPitches({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run", avoidSubjects: skippedSubjects(lessons, PRESS_WORKFLOW) });
      return { status: "completed", summary: [summarizePressPitches(result), lessonsLine(lessons)].filter(Boolean).join(" "), detail: { ...result, lessons } };
    }
    case "growth-tools": {
      const result = await runToolCheck({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run", state: stringRunParam(params, ["state"]) });
      return { status: "completed", summary: summarizeToolCheck(result), detail: { ...result } };
    }
    case "growth-intake": {
      const result = await runGrowthIntake({ db: tx, runId: run.id, item: params.item, dryRun: run.runKind === "dry_run" });
      // A refused filing fails the step, so it shows red in the run ledger.
      if (result.errors.length) throw new Error(summarizeGrowthIntake(result));
      return { status: "completed", summary: summarizeGrowthIntake(result), detail: { ...result } };
    }
    case "growth-score": {
      const result = await runGrowthScore({ db: tx, runId: run.id, dryRun: run.runKind === "dry_run" });
      return { status: "completed", summary: summarizeGrowthScore(result), detail: { ...result } };
    }
    case "marketing-score": {
      const result = await runMarketingScore({
        db: tx,
        runId: run.id,
        month: stringRunParam(params, ["month"]) ?? currentMonth(),
        dryRun: run.runKind === "dry_run",
      });
      return { status: "completed", summary: summarizeScore(result), detail: { ...result } };
    }
    case "marketing-write": {
      const result = await runMarketingWrite({
        db: tx,
        runId: run.id,
        month: stringRunParam(params, ["month"]) ?? currentMonth(),
        dryRun: run.runKind === "dry_run",
      });
      return { status: "completed", summary: summarizeWrite(result), detail: { ...result } };
    }
    case "marketing-states": {
      const result = await runStateEditions({
        db: tx,
        month: stringRunParam(params, ["month"]) ?? currentMonth(),
        mailingAddress: mailingAddress(),
        dryRun: run.runKind === "dry_run",
      });
      return { status: "completed", summary: summarizeStateEditions(result), detail: { ...result } };
    }
    case "marketing-send": {
      const month = stringRunParam(params, ["month"]);
      if (!month) throw new Error("marketing-send needs a month (YYYY-MM).");
      const result = await runMarketingSend({ month });
      // A refused or partly failed send fails the step, so it shows red in the run ledger.
      if (result.refused || result.failures.length) throw new Error(summarizeSend(result));
      return { status: "completed", summary: summarizeSend(result), detail: { ...result } };
    }
    case "report-render":
      return runReportRenderStep(tx, stringRunParam(params, ["report_job_id"]));
    case "report-reconcile":
      return runReportReconcileStep(tx, stringRunParam(params, ["report_job_id"]));
    case "report-close":
      return runReportCloseStep(tx, stringRunParam(params, ["report_job_id"]));
    default:
      return {
        status: "skipped",
        summary: `${step.title} has no TypeScript worker implementation yet.`,
        detail: { missing_worker: step.stepKey },
      };
  }
}

async function blockRunForBackend(runId: number): Promise<AgentRunExecutionResult> {
  return blockAgentRun(runId, {
    message: "Worker execution is waiting for EXECUTION_BACKEND=agentic_v1.",
    stepError: "Waiting for EXECUTION_BACKEND=agentic_v1",
    runError: "agentic execution backend is disabled",
    summary: "Run record created; execution is blocked until EXECUTION_BACKEND=agentic_v1.",
    detail: {
      reason: "agentic execution backend is disabled",
      retired_external_worker_blocked: true,
    },
  });
}

async function blockRunForAutomationStop(
  runId: number,
  reason: string,
): Promise<AgentRunExecutionResult> {
  return blockAgentRun(runId, {
    message: reason,
    stepError: reason,
    runError: reason,
    summary: "Run record created; execution is blocked by the automation safety stop.",
    detail: {
      reason,
      automation_stop_active: true,
    },
  });
}

async function blockAgentRun(
  runId: number,
  input: {
    message: string;
    stepError: string;
    runError: string;
    summary: string;
    detail: Record<string, unknown>;
  },
): Promise<AgentRunExecutionResult> {
  await withTransaction(async (tx) => {
    await tx`
      INSERT INTO agent_run_events
        (agent_run_id, event_type, status, message, detail)
      VALUES
        (${runId}, 'run.blocked', 'blocked',
         ${input.message},
         ${JSON.stringify(input.detail)}::jsonb)
    `;
    await tx`
      UPDATE agent_run_steps
         SET status = 'blocked',
             error_summary = ${input.stepError},
             updated_at = NOW()
       WHERE agent_run_id = ${runId}
         AND sequence = (
           SELECT MIN(sequence)
             FROM agent_run_steps
            WHERE agent_run_id = ${runId}
              AND status IN ('queued', 'running')
         )
    `;
    await tx`
      UPDATE agent_runs
         SET status = 'blocked',
             error_summary = ${input.runError},
             summary = COALESCE(summary, ${input.summary}),
             updated_at = NOW()
       WHERE id = ${runId}
         AND status IN ('queued', 'running')
    `;
  });
  return {
    runId,
    status: "blocked",
    terminal: true,
    executedSteps: 0,
    message: input.message,
  };
}

interface PreparedAgenticStep {
  run: AgentRunSnapshot;
  step: AgentRunStepSnapshot;
}

async function prepareNextAgenticStep(runId: number, { pauseExemptOnly = false, expectedStepKey }: {
  pauseExemptOnly?: boolean;
  expectedStepKey?: string;
} = {}): Promise<
  | { kind: "ready"; prepared: PreparedAgenticStep }
  | { kind: "missing" }
  | { kind: "terminal"; status: AgentRunStatus; message: string }
  | { kind: "busy"; status: AgentRunStatus; message: string }
  | { kind: "held"; status: AgentRunStatus; message: string }
> {
  return withTransaction(async (tx) => {
    const [runRow] = await tx`
      SELECT id, agent_name, run_kind, title, status, started_at, completed_at,
             updated_at, trigger_source, triggered_by, correlation_id, backend,
             progress_current, progress_total, current_stage, error_summary,
             summary, params_json
        FROM agent_runs
       WHERE id = ${runId}
       FOR UPDATE
    `;
    if (!runRow) return { kind: "missing" };
    if (isTerminalRunStatus(String(runRow.status))) {
      return {
        kind: "terminal",
        status: String(runRow.status) as AgentRunStatus,
        message: `Run is already ${String(runRow.status)}.`,
      };
    }
    if (String(runRow.status) !== "queued") {
      return {
        kind: "busy",
        status: String(runRow.status) as AgentRunStatus,
        message: `Run is already ${String(runRow.status)}.`,
      };
    }

    const run = mapRun(runRow);

    const stepRows = await tx`
      SELECT id, agent_run_id, step_key, agent_name, title, input_payload, status, sequence,
             summary, error_summary, queued_at, started_at, completed_at, updated_at
        FROM agent_run_steps
       WHERE agent_run_id = ${runId}
       ORDER BY sequence ASC, id ASC
    `;
    const steps = stepRows.map(mapStep);
    const step = steps.find((candidate) => candidate.status === "queued");
    if (!step) {
      const failed = steps.find((candidate) => candidate.status === "failed");
      if (failed) {
        await tx`
          UPDATE agent_runs
             SET status = 'failed',
                 current_stage = ${failed.stepKey},
                 error_summary = ${failed.error ?? "Agent run has a failed step."},
                 completed_at = COALESCE(completed_at, NOW()),
                 updated_at = NOW()
           WHERE id = ${runId}
        `;
        return {
          kind: "terminal",
          status: "failed",
          message: failed.error ?? "Agent run has a failed step.",
        };
      }
      const finishedSteps = steps.filter((candidate) => candidate.status === "completed" || candidate.status === "skipped").length;
      const summary = await completedRunSummary(tx, runId, finishedSteps, steps.length);
      await tx`
        UPDATE agent_runs
           SET status = 'completed',
               progress_current = ${finishedSteps},
               progress_total = ${steps.length},
               current_stage = NULL,
               summary = COALESCE(summary, ${summary}),
               completed_at = COALESCE(completed_at, NOW()),
               updated_at = NOW()
         WHERE id = ${runId}
      `;
      return {
        kind: "terminal",
        status: "completed",
        message: "Run had no queued steps and is now completed.",
      };
    }

    // Recheck the actual earliest step while holding the run's claim lock: another
    // tick may have completed the peeked measurement and exposed the paused tail.
    if (pauseExemptOnly && !PAUSE_EXEMPT_STEP_KEYS.includes(step.stepKey)) {
      return { kind: "held", status: run.status, message: "Next step is outside the pause-exempt continuation; run left queued." };
    }
    // A concurrent executor may have advanced past the paid step we intended to skip.
    // Never mark its newly exposed free work (or another provider job) as skipped.
    if (expectedStepKey != null && step.stepKey !== expectedStepKey) {
      return { kind: "held", status: run.status, message: "Next step changed before the paid skip; run left queued." };
    }
    const alreadyStarted = steps.some((candidate) => candidate.startedAt !== null);

    await tx`
      UPDATE agent_runs
         SET status = 'running',
             current_stage = ${step.stepKey},
             updated_at = NOW()
       WHERE id = ${runId}
    `;
    if (!alreadyStarted) {
      await tx`
        INSERT INTO agent_run_events
          (agent_run_id, event_type, status, message, detail)
        VALUES
          (${runId}, 'run.started', 'running',
           'Agentic TypeScript runner started.',
           ${JSON.stringify({ backend: run.backend, step_count: steps.length })}::jsonb)
      `;
    }
    await tx`
      UPDATE agent_run_steps
         SET status = 'running',
             started_at = COALESCE(started_at, NOW()),
             updated_at = NOW()
       WHERE id = ${step.id}
    `;
    await tx`
      INSERT INTO agent_run_events
        (agent_run_id, step_id, event_type, status, message, detail)
      VALUES
        (${runId}, ${step.id}, 'step.started', 'running',
         ${`${step.agent} started ${step.title}.`},
         ${JSON.stringify({ step_key: step.stepKey, agent: step.agent })}::jsonb)
    `;

    return { kind: "ready", prepared: { run, step } };
  });
}

async function finishAgenticStep(
  runId: number,
  step: AgentRunStepSnapshot,
  outcome: AgenticStepExecution,
): Promise<AgentRunExecutionResult> {
  return withTransaction(async (tx) => {
    const [current] = await tx`
      SELECT ar.status AS run_status, ars.status AS step_status
        FROM agent_runs ar
        JOIN agent_run_steps ars ON ars.agent_run_id = ar.id
       WHERE ar.id = ${runId}
         AND ars.id = ${step.id}
       FOR UPDATE OF ar, ars
    `;
    const runStatus = String(current?.run_status ?? "missing");
    const stepStatus = String(current?.step_status ?? "missing");
    if (runStatus === "cancelled" || runStatus === "cancel_requested" || stepStatus === "cancelled") {
      await tx`
        UPDATE agent_run_steps
           SET status = 'cancelled',
               error_summary = COALESCE(error_summary, 'Cancelled before this step result was committed.'),
               completed_at = COALESCE(completed_at, NOW()),
               updated_at = NOW()
         WHERE id = ${step.id}
      `;
      await tx`
        INSERT INTO agent_run_events
          (agent_run_id, step_id, event_type, status, message, detail)
        VALUES
          (${runId}, ${step.id}, 'step.cancelled', 'cancelled',
           'Step result was discarded because the run was cancelled.',
           ${JSON.stringify({ step_key: step.stepKey, agent: step.agent })}::jsonb)
      `;
      return {
        runId,
        status: "cancelled",
        terminal: true,
        executedSteps: 0,
        message: "Run was cancelled before the step result was committed.",
      };
    }

    await tx`
      UPDATE agent_run_steps
         SET status = ${outcome.status},
             summary = ${outcome.summary},
             error_summary = NULL,
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = ${step.id}
    `;
    await tx`
      INSERT INTO agent_run_events
        (agent_run_id, step_id, event_type, status, message, detail)
      VALUES
        (${runId}, ${step.id}, 'step.finished', ${outcome.status},
         ${outcome.summary},
         ${JSON.stringify(outcome.detail ?? {})}::jsonb)
    `;

    const [progress] = await tx`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('completed', 'skipped'))::int AS completed_steps,
        COUNT(*)::int AS total_steps
        FROM agent_run_steps
       WHERE agent_run_id = ${runId}
    `;
    const [nextStep] = await tx`
      SELECT step_key
        FROM agent_run_steps
       WHERE agent_run_id = ${runId}
         AND status = 'queued'
       ORDER BY sequence ASC, id ASC
       LIMIT 1
    `;
    const completed = Number(progress?.completed_steps ?? 0);
    const total = Number(progress?.total_steps ?? 0);

    if (nextStep) {
      await tx`
        UPDATE agent_runs
           SET status = 'queued',
               progress_current = ${completed},
               progress_total = ${total},
               current_stage = ${String(nextStep.step_key)},
               updated_at = NOW()
         WHERE id = ${runId}
      `;
      await tx`
        INSERT INTO agent_run_events
          (agent_run_id, event_type, status, message, detail)
        VALUES
          (${runId}, 'run.queued', 'queued',
           ${`Next agent step queued: ${String(nextStep.step_key)}.`},
           ${JSON.stringify({
             next_step: String(nextStep.step_key),
             completed_steps: completed,
             total_steps: total,
           })}::jsonb)
      `;
      return {
        runId,
        status: "queued",
        terminal: false,
        executedSteps: 1,
        message: `Completed ${step.stepKey}; next step queued.`,
      };
    }

    const summary = await completedRunSummary(tx, runId, completed, total);
    await tx`
      UPDATE agent_runs
         SET status = 'completed',
             progress_current = ${completed},
             progress_total = ${total},
             current_stage = NULL,
             summary = ${summary},
             error_summary = NULL,
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = ${runId}
    `;
    await tx`
      INSERT INTO agent_run_events
        (agent_run_id, event_type, status, message, detail)
      VALUES
        (${runId}, 'run.completed', 'completed',
         ${summary},
         ${JSON.stringify({ completed_steps: completed, total_steps: total })}::jsonb)
    `;
    await updateStateLaneTerminalStatus(tx, runId, "completed");
    return {
      runId,
      status: "completed",
      terminal: true,
      executedSteps: 1,
      message: "Agentic run completed.",
    };
  });
}

async function updateStateLaneTerminalStatus(
  tx: SqlTag,
  runId: number,
  status: "completed" | "failed",
): Promise<void> {
  try {
    await tx`
      WITH run_scope AS (
        SELECT COALESCE(
                 NULLIF(upper(btrim(state_code)), ''),
                 NULLIF(upper(btrim(params_json->>'state_code')), '')
               ) AS state_code
          FROM agent_runs
         WHERE id = ${runId}
           AND run_kind IN ('workflow_lane', 'state_agent')
      )
      UPDATE public.agent_state_lanes lane
         SET last_success_at = CASE
               WHEN ${status} = 'completed' THEN NOW()
               ELSE lane.last_success_at
             END,
             failure_count = CASE
               WHEN ${status} = 'failed' THEN lane.failure_count + 1
               ELSE lane.failure_count
             END,
             -- Check back within the hour either way: the scheduler then decides whether
             -- the state is due a monthly full pass, has a backlog to catch up on, or is
             -- idle until next month (state-lane-scheduler.ts).
             next_run_after = NOW() + INTERVAL '1 hour',
             lease_token = NULL,
             lease_expires_at = NULL,
             updated_at = NOW()
        FROM run_scope
       WHERE lane.state_code = run_scope.state_code
    `;
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).toLowerCase();
    if (!message.includes("agent_state_lanes") && !message.includes("does not exist")) {
      throw error;
    }
  }
}

/**
 * A failed run never reaches its later steps. Close them as cancelled so they
 * stop reading as queued work in the ledger and admin views.
 */
async function cancelStepsAfterRunFailure(
  tx: SqlTag,
  runId: number,
  failedStepKey: string,
): Promise<void> {
  const cancelled = await tx`
    UPDATE agent_run_steps
       SET status = 'cancelled',
           error_summary = COALESCE(error_summary, ${`Not run: step ${failedStepKey} failed earlier in this run.`}),
           completed_at = COALESCE(completed_at, NOW()),
           updated_at = NOW()
     WHERE agent_run_id = ${runId}
       AND status = 'queued'
     RETURNING id
  `;
  if (cancelled.length > 0) {
    await tx`
      INSERT INTO agent_run_events
        (agent_run_id, event_type, status, message, detail)
      VALUES
        (${runId}, 'run.steps_cancelled', 'cancelled',
         ${`Cancelled ${cancelled.length} queued steps after ${failedStepKey} failed.`},
         ${JSON.stringify({ failed_step: failedStepKey, cancelled_steps: cancelled.length })}::jsonb)
    `;
  }
}

async function failAgenticStep(
  runId: number,
  step: AgentRunStepSnapshot,
  error: unknown,
): Promise<AgentRunExecutionResult> {
  const message = error instanceof Error ? error.message : String(error);
  await withTransaction(async (tx) => {
    const [progress] = await tx`
      SELECT COUNT(*) FILTER (WHERE status IN ('completed', 'skipped'))::int AS completed_steps
        FROM agent_run_steps
       WHERE agent_run_id = ${runId}
    `;
    const completed = Number(progress?.completed_steps ?? 0);
    await tx`
      UPDATE agent_run_steps
         SET status = 'failed',
             error_summary = ${message},
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = ${step.id}
    `;
    await tx`
      INSERT INTO agent_run_events
        (agent_run_id, step_id, event_type, status, message, detail)
      VALUES
        (${runId}, ${step.id}, 'step.failed', 'failed',
         ${message},
         ${JSON.stringify({ step_key: step.stepKey, agent: step.agent, deploy: currentDeploy() })}::jsonb)
    `;
    await tx`
      UPDATE agent_runs
         SET status = 'failed',
             progress_current = ${completed},
             current_stage = ${step.stepKey},
             error_summary = ${message},
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = ${runId}
    `;
    await tx`
      INSERT INTO agent_run_events
        (agent_run_id, event_type, status, message, detail)
      VALUES
        (${runId}, 'run.failed', 'failed',
         ${message},
         ${JSON.stringify({ failed_step: step.stepKey, completed_steps: completed })}::jsonb)
    `;
    await cancelStepsAfterRunFailure(tx, runId, step.stepKey);
    await updateStateLaneTerminalStatus(tx, runId, "failed");
  });
  return {
    runId,
    status: "failed",
    terminal: true,
    executedSteps: 0,
    message,
  };
}

export interface ReapStaleAgentStepsResult {
  requeued: Array<{ runId: number; stepId: number; stepKey: string; attempt: number }>;
  dead: Array<{ runId: number; stepId: number; stepKey: string; attempts: number }>;
  orphanRunsRequeued: number[];
}

export { MAX_STEP_ATTEMPTS, STALE_RUNNING_STEP_MINUTES };

/**
 * Recover work that a killed invocation left `running`. Runs first in every tick.
 * Each stale step goes back to `queued` (attempt + 1); after MAX_STEP_ATTEMPTS it is
 * marked failed and its run fails, so a poison step can never wedge a lane forever.
 * Every transition writes an agent_run_events row.
 */
export async function reapStaleAgentSteps({
  staleAfterMinutes = STALE_RUNNING_STEP_MINUTES,
  maxAttempts = MAX_STEP_ATTEMPTS,
  scope = null,
}: { staleAfterMinutes?: number; maxAttempts?: number; scope?: AgentRunSelectionScope | null } = {}): Promise<ReapStaleAgentStepsResult> {
  const result: ReapStaleAgentStepsResult = { requeued: [], dead: [], orphanRunsRequeued: [] };
  const staleSteps = await sql`
    SELECT s.id, s.agent_run_id, s.step_key,
           (SELECT COUNT(*)::int
              FROM agent_run_events e
             WHERE e.step_id = s.id
               AND e.event_type = 'step.reaped') AS prior_reaps
      FROM agent_run_steps s
      JOIN agent_runs r ON r.id = s.agent_run_id
     WHERE s.status = 'running'
       AND s.updated_at < NOW() - make_interval(mins => ${staleAfterMinutes})
       AND r.run_kind = ANY(${[...RUN_KINDS_WITH_LEDGER]})
       AND (${scope === null}::boolean OR (
         r.agent_name = ${scope?.agent ?? null} AND r.run_kind = ${scope?.kind ?? null}
         AND r.params_json->>'source' = ${scope?.source ?? null}
       ))
     ORDER BY s.updated_at ASC
     LIMIT 50
  `;

  for (const row of staleSteps) {
    const runId = Number(row.agent_run_id);
    const stepId = Number(row.id);
    const stepKey = String(row.step_key);
    const attempt = Number(row.prior_reaps ?? 0) + 1;

    if (attempt >= maxAttempts) {
      const message = `Step ${stepKey} was left running ${attempt} times (timeout or crash); marked failed after ${maxAttempts} attempts.`;
      await withTransaction(async (tx) => {
        await tx`
          UPDATE agent_run_steps
             SET status = 'failed', error_summary = ${message}, completed_at = NOW(), updated_at = NOW()
           WHERE id = ${stepId} AND status = 'running'
        `;
        await tx`
          UPDATE agent_runs
             SET status = 'failed', current_stage = ${stepKey}, error_summary = ${message},
                 completed_at = NOW(), updated_at = NOW()
           WHERE id = ${runId} AND status IN ('running', 'queued')
        `;
        await tx`
          INSERT INTO agent_run_events
            (agent_run_id, step_id, event_type, status, message, detail)
          VALUES
            (${runId}, ${stepId}, 'step.dead', 'failed', ${message},
             ${JSON.stringify({ step_key: stepKey, attempts: attempt, reaper: true, deploy: currentDeploy() })}::jsonb)
        `;
        await cancelStepsAfterRunFailure(tx, runId, stepKey);
        await updateStateLaneTerminalStatus(tx, runId, "failed");
      });
      result.dead.push({ runId, stepId, stepKey, attempts: attempt });
      continue;
    }

    const message = `Step ${stepKey} was left running past ${staleAfterMinutes} minutes; re-queued (attempt ${attempt + 1} of ${maxAttempts}).`;
    await withTransaction(async (tx) => {
      await tx`
        UPDATE agent_run_steps
           SET status = 'queued', started_at = NULL, error_summary = ${message}, updated_at = NOW()
         WHERE id = ${stepId} AND status = 'running'
      `;
      await tx`
        UPDATE agent_runs
           SET status = 'queued', updated_at = NOW()
         WHERE id = ${runId} AND status = 'running'
      `;
      await tx`
        INSERT INTO agent_run_events
          (agent_run_id, step_id, event_type, status, message, detail)
        VALUES
          (${runId}, ${stepId}, 'step.reaped', 'queued', ${message},
           ${JSON.stringify({ step_key: stepKey, attempt, reaper: true })}::jsonb)
      `;
    });
    result.requeued.push({ runId, stepId, stepKey, attempt });
  }

  // A run marked running with no running step (crash between ledger writes) is
  // returned to the queue so its next queued step can execute.
  const orphanRuns = await sql`
    UPDATE agent_runs r
       SET status = 'queued', updated_at = NOW()
     WHERE r.status = 'running'
       AND r.run_kind = ANY(${[...RUN_KINDS_WITH_LEDGER]})
       AND r.updated_at < NOW() - make_interval(mins => ${staleAfterMinutes})
       AND (${scope === null}::boolean OR (
         r.agent_name = ${scope?.agent ?? null} AND r.run_kind = ${scope?.kind ?? null}
         AND r.params_json->>'source' = ${scope?.source ?? null}
       ))
       AND NOT EXISTS (
         SELECT 1 FROM agent_run_steps s
          WHERE s.agent_run_id = r.id AND s.status = 'running'
       )
     RETURNING r.id
  `;
  for (const row of orphanRuns) {
    const runId = Number(row.id);
    await sql`
      INSERT INTO agent_run_events
        (agent_run_id, event_type, status, message, detail)
      VALUES
        (${runId}, 'run.reaped', 'queued',
         'Run was marked running with no running step; returned to the queue.',
         ${JSON.stringify({ reaper: true })}::jsonb)
    `;
    result.orphanRunsRequeued.push(runId);
  }

  return result;
}

/** True when any queued ledger run's next step is a provider (paid) step. */
export async function hasQueuedProviderSteps(): Promise<boolean> {
  if (PROVIDER_STEP_KEYS.length === 0) return false;
  const [row] = await sql`
    SELECT 1
      FROM agent_run_steps s
      JOIN agent_runs r ON r.id = s.agent_run_id
     WHERE r.status = 'queued'
       AND r.run_kind = ANY(${[...RUN_KINDS_WITH_LEDGER]})
       AND s.status = 'queued'
       AND s.step_key = ANY(${[...PROVIDER_STEP_KEYS]}::text[])
     LIMIT 1
  `;
  return Boolean(row);
}

/** Queued step keys of a run in the order they run. */
async function peekQueuedStepKeys(runId: number, limit: number): Promise<string[]> {
  const rows = await sql`
    SELECT step_key
      FROM agent_run_steps
     WHERE agent_run_id = ${runId}
       AND status = 'queued'
     ORDER BY sequence ASC, id ASC
     LIMIT ${limit}::int
  `;
  return rows.map((row) => String(row.step_key));
}

async function peekNextQueuedStepKey(runId: number): Promise<string | null> {
  const [row] = await sql`
    SELECT step_key
      FROM agent_run_steps
     WHERE agent_run_id = ${runId}
       AND status = 'queued'
     ORDER BY sequence ASC, id ASC
     LIMIT 1
  `;
  return row ? String(row.step_key) : null;
}

async function providerStepGate(
  budgetAllowsProviderSteps: boolean,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (!budgetAllowsProviderSteps) {
    return { allowed: false, reason: "provider budget policy does not allow provider calls this tick" };
  }
  const control = await getAutomationControl();
  if (!control.enabled) {
    return {
      allowed: false,
      reason: `provider automation stop is active${control.reason ? ` (${control.reason})` : ""}`,
    };
  }
  return { allowed: true };
}

/**
 * About how long each step runs. A step starts only when it can finish by the caller's deadline,
 * so a short step can use the end of a tick that a long one could not.
 *
 * Lane steps were re-measured on 2026-10-15 from `agent_run_steps` (3 days, and state lanes over
 * the last 24 hours): about p90 with a margin, and never so far under p99 that a step started at
 * the deadline would run past the tick's 300 s limit (the deadline is 270 s). Measured seconds,
 * p90 / p99 / max: discover 106 / 111 / 117, fetch 14 / 41 / 62, read 6 / 18 / 73,
 * discover-paid 2 / 5 / 5, read-paid 60 / 127 / 153, extract 52 / 76 / 153 (23 / 62 before #1291's
 * scans), extract-paid 14 / 50 / 66, classify 15 / 28 / 46, verify-paid 0.4 / 3.5 / 13,
 * publish 78 / 131 / 164. Steps not re-measured keep their 2026-10-07 p99.
 *
 * Re-measured 2026-10-17 over 24 hours (`docs/project/findings/2026-10-17-steps-overrun-tick-budget.md`):
 * eleven steps ran past their setting at p99, and publish, extract, classify and discover-paid
 * were killed at the tick's 300 s limit (21 reaped steps started inside a tick). Each is now about
 * its p99, so a step starts only when it can finish inside the 270 s budget.
 */
const STEP_EXPECTED_MS: Record<string, number> = {
  // Reference observation stops at120s, leaving30s for scorer/ledger queries.
  "score-answer-key": 150_000,
  // Re-measured 2026-10-17: p50 65 s, p90 143 s, p99 160 s.
  "discover-paid": 165_000,
  "registry-cfpb": 180_000,
  // Paced to about ten Open States requests a minute; a run ends within about two minutes.
  "registry-state-bills": 120_000,
  // No new site or search starts after 90 s; one in flight can take a few 15 s fetches more.
  "registry-state-reg-news": 170_000,
  "registry-state-bill-news": 120_000,
  // No new item starts after 100 s; up to three page reads and model calls in flight.
  "registry-wire-research": 150_000,
  "read-paid": 110_000,
  read: 30_000,
  discover: 135_000,
  "report-render": 110_000,
  rescue: 110_000,
  "extract-paid": 80_000,
  "verify-paid": 10_000,
  fetch: 45_000,
  // 2026-10-17: Knox lessons' restored-fee read alone averages 53 s (pg_stat_statements).
  extract: 165_000,
  // 2026-10-17: p50 38 s, p90 133 s, p99 221 s, max 278 s (TX). The row loop now stops at
  // PUBLISH_ROW_DEADLINE_MS; re-measure from `phase_ms` before lowering this.
  publish: 225_000,
  // The 40 sweeps a lane publish hands off (hamilton/publish-sweeps.ts), unscoped: their sum per
  // lane publish step over 2026-10-17/18 was p50 about 100 s, p99 201 s. Re-measure from the
  // dry run's `step_ms` before changing it.
  "publish-sweeps": 205_000,
  classify: 160_000,
  // p50 238 s, p90 367 s, max 1,101 s: it never fits a tick, so the tick does not start it
  // (`TICK_EXCLUDED_STEP_KEYS`); its own route runs it.
  "hamilton-answer-eval": 400_000,
  // Up to five memos at once, each up to two 90 s model calls, after the free answers.
  "hamilton-paid-answer-eval": 280_000,
  // The hourly nationwide lane sync (state-lane-scheduler runNationwideLaneSync), run from its own
  // route, never the tick. Measured inside the tick over the 24 hours to 23:55 UTC 2026-10-18:
  // the first tick of each hour started its first step p50 80 s, p90 171 s, max 200 s in.
  "lane-sync": 200_000,
  // A few dozen draft rows and one catalog check each (growth/withdraw.ts).
  "growth-withdraw": 30_000,
  // Quick-prefixed steps measured over the 30 s quick default (2026-10-17 p99: 57 s, 89-110 s, 48 s).
  "public-discovery": 60_000,
  "registry-ncua-extras": 110_000,
  "registry-cfpb-card-agreements": 50_000,
  // Not measured yet (2026-10-18): each downloads and inflates a Board SDMX zip, H.15 about 68 MB
  // and H.8 about 75 MB, before the BLS/BEA or table reads; priced so a tick starts them early.
  "registry-fred": 150_000,
  "registry-national-series": 150_000,
};
/**
 * Steps the tick never starts, because they do not fit its 270 s budget even alone: the tick
 * always gives its first run a step, and Hamilton's answer eval (200-370 s) started that way
 * killed ticks (runs 6483 and 6552 failed after three tries, Oct 15). They run from their own
 * route (`/api/admin/crew/answer-eval`). The hourly lane sync (`lane-sync`) fits a tick but would
 * spend most of one before any lane work, as it did inside the tick until 2026-10-18; it runs
 * from `/api/admin/crew/lane-sync`.
 */
export const TICK_EXCLUDED_STEP_KEYS = ["hamilton-answer-eval", "hamilton-paid-answer-eval", "lane-sync"] as const;
/** Steps not listed above: most run in seconds, so this keeps an unknown long one safe. */
const DEFAULT_STEP_EXPECTED_MS = 120_000;
/**
 * Expected runtimes for a direct run, where they differ from a lane's. A Read-now / hand-found run
 * (`atlas.priority_institution`) reads one institution, so its steps are far shorter than a
 * state lane's; priced at lane p99s it waited 17-20 minutes per step (runs 8086 and 8104, Oct 17).
 * Re-measured over the 24 hours to 22:20 UTC 2026-10-17 (about p99, `agent_run_steps`): publish
 * 50 s, extract 106 s, classify 58 s, fetch 15 s, read 2 s. Publish re-priced to its p99, 120 s, on
 * 2026-10-18 like every other step: over the 24 hours to 23:55 UTC Read-now publishes ran p50 28 s,
 * p90 64 s, p99 117 s, max 127 s (16 of 89 over 55 s), and the two reaped that day (IA 44517,
 * WA 44631) took 61 s and 58 s on retry. A state re-search run
 * (`atlas.priority_state_research`) ran no step in that window, so it keeps the lane's prices.
 * A step not listed here uses `STEP_EXPECTED_MS`.
 */
const RUN_SOURCE_STEP_EXPECTED_MS: Record<string, Record<string, number>> = {
  "atlas.priority_institution": { publish: 120_000, extract: 110_000, classify: 60_000, fetch: 20_000, read: 5_000 },
};
/**
 * A publish step's row loop stops this long after the step began (once it has decided
 * PUBLISH_MIN_ROWS_PER_STEP rows); the rows left publish on the next step. TX's 278 s publish
 * (run 8004, Oct 17) ran past the tick's 300 s limit when it started 163 s in.
 */
export const PUBLISH_ROW_DEADLINE_MS = 120_000;
/**
 * The cross-state top-up read is skipped only when the publish step is already this far in. On
 * Oct 17 the sweeps before the rows took 96-129 s, so tying the skip to the row deadline (120 s)
 * skipped it on NC and WI. The rows phase with a top-up took under 8 s (AK, 242 rows) and the
 * sweeps after up to 31 s, so a step that starts the top-up by 160 s ends well under publish's
 * 225 s setting.
 */
export const PUBLISH_TOP_UP_DEADLINE_MS = 160_000;
/** Steps measured at a few seconds at most (state-expert, enhance, public-*, registry-*). */
const QUICK_STEP_EXPECTED_MS = 30_000;
const QUICK_STEP_PREFIXES = ["registry-", "public-", "state-expert", "enhance", "lead-watch", "indexnow-ping", "category-guard"];

/**
 * State lanes a tick advances side by side (James, 17 Oct 2026). One at a time, 55 lanes at about
 * 4 minutes a pass came round every 3-4 hours. Set to 1 to go back to one at a time. The scheduler
 * keeps at most MAX_ACTIVE_STATE_LANE_RUNS lane runs queued (state-lane-scheduler.ts).
 */
export const PARALLEL_STATE_LANES = 3;
/** The most lanes a tick may run side by side: each holds a database connection (pool of 5). */
const MAX_PARALLEL_LANES = 3;
/** Steps that take the publish lock; lanes run side by side take turns at them. */
const SERIAL_STEP_KEYS = new Set(["publish", "publish-index", "publish-context"]);

export interface StepTurns {
  /** Waits for this lane's turn; call the returned function when the step is done. */
  take(): Promise<() => void>;
}

export function createStepTurns(): StepTurns {
  let tail: Promise<void> = Promise.resolve();
  return {
    async take() {
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      return release;
    },
  };
}

function isQuickStep(stepKey: string): boolean {
  return !(stepKey in STEP_EXPECTED_MS) && QUICK_STEP_PREFIXES.some((prefix) => stepKey.startsWith(prefix));
}

/**
 * Expected time to reach real work: the run's leading quick steps plus the first step
 * that is not quick. A later run in a tick starts only when this fits, because a run
 * that ran its quick first steps counts as under way and goes ahead of failed-lane
 * retries in the next tick's order.
 */
export function expectedMsToFirstWork(stepKeys: string[], runSource: string | null = null): number {
  let total = 0;
  for (const key of stepKeys) {
    total += expectedStepMs(key, runSource);
    if (!isQuickStep(key)) break;
  }
  return total;
}

/** Direct runs that rank ahead of state lanes and leave the next lane room in the tick. */
export const LANE_ROOM_SOURCES = ["atlas.priority_institution", "atlas.priority_state_research"] as const;

export function isLaneRoomRun(source: string | null | undefined): boolean {
  return source != null && (LANE_ROOM_SOURCES as readonly string[]).includes(source);
}

/**
 * A direct run (`LANE_ROOM_SOURCES`: a state re-search or a Read-now / hand-found institution run)
 * idle this long, with no step finished since it was queued or since its last step, takes one step
 * without leaving lane room. A state re-search's `discover` never fit the room a fresh lane's
 * first work leaves of the 270 s tick, so while fresh lanes kept arriving behind it, it never
 * started (#1421). Since the 2026-10-17 re-measure a fresh lane's first work is ~185 s, so a
 * Read-now run's publish (225 s) or extract (165 s) no longer fits the ~85 s left either; it now
 * waits out lane room the same way.
 *
 * The bound is firm only when the re-search run is the tick's first row. Several waiting re-search
 * runs in one tick can each take a step ahead of the lane, so together they can still eat into
 * its room (#1586).
 */
export const LANE_ROOM_MAX_IDLE_MS = 15 * 60_000;

/**
 * Steps a direct run takes once it has waited out lane room. A state re-search run takes one: its
 * steps are lane-sized, and several waiting ones could eat a lane's room (#1586). A Read-now run
 * takes every step that fits the tick: its steps are seconds long, and one per wait-out left run
 * 8086 queued at publish 47+ minutes after its fetch (Oct 17).
 */
export function waitedOutMaxSteps(source: string | null | undefined, maxStepsPerRun: number): number {
  return source === "atlas.priority_institution" ? maxStepsPerRun : 1;
}

export function waitedOutLaneRoom(source: string | null | undefined, idleMs: number | null | undefined): boolean {
  return isLaneRoomRun(source) && Number(idleMs ?? 0) >= LANE_ROOM_MAX_IDLE_MS;
}

/** Expected time to a lane run's first real work, from its queued steps (`expectedMsToFirstWork`). */
async function laneFirstWorkMs(runId: number): Promise<number> {
  try {
    const steps = await sql<{ step_key: string }[]>`
      SELECT step_key FROM agent_run_steps
       WHERE agent_run_id = ${runId} AND status = 'queued'
       ORDER BY sequence ASC, id ASC
    `;
    return expectedMsToFirstWork(steps.map((step) => String(step.step_key)));
  } catch (error) {
    console.error("laneFirstWorkMs failed:", error);
    return 0;
  }
}

/** Publish sweep timing lives with the sweeps (hamilton/publish-sweeps.ts); re-exported for callers here. */
export { timedSweep };

/**
 * A step left queued because it could not finish by the tick's deadline: one `step.deferred`
 * event on the run ledger, naming the step, its expected time and the time the tick had left.
 * The step runs in a later tick. A failed write never stops the tick.
 */
export async function recordStepDeferral(runId: number, stepKey: string | null, expectedMs: number, msLeft: number): Promise<void> {
  try {
    await sql`
      INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
      VALUES (
        ${runId}, 'step.deferred', 'queued',
        ${`${stepKey ?? "Next step"} left queued: it needs about ${Math.round(expectedMs / 1000)} s and the tick has ${Math.max(0, Math.round(msLeft / 1000))} s left.`},
        ${JSON.stringify({ step_key: stepKey, expected_ms: expectedMs, ms_left: Math.max(0, Math.round(msLeft)) })}::jsonb
      )
    `;
  } catch (error) {
    console.error("recordStepDeferral failed:", error);
  }
}

export function expectedStepMs(stepKey: string | null, runSource: string | null = null): number {
  if (!stepKey) return DEFAULT_STEP_EXPECTED_MS;
  const bySource = runSource ? RUN_SOURCE_STEP_EXPECTED_MS[runSource]?.[stepKey] : undefined;
  if (bySource != null) return bySource;
  if (stepKey in STEP_EXPECTED_MS) return STEP_EXPECTED_MS[stepKey];
  if (QUICK_STEP_PREFIXES.some((prefix) => stepKey.startsWith(prefix))) return QUICK_STEP_EXPECTED_MS;
  return DEFAULT_STEP_EXPECTED_MS;
}

/**
 * Why a step must wait, or null when it may run: the marketing pause holds growth's
 * marketing steps, the pipeline pause holds every other step except the reporting ones
 * (`PAUSE_EXEMPT_STEP_KEYS`).
 */
export function heldByPause(
  stepKey: string,
  pipeline: Pick<AutomationControlState, "enabled" | "reason">,
  marketing: Pick<AutomationControlState, "enabled" | "reason">,
): string | null {
  const scope = pauseScopeForStep(stepKey);
  if (scope === "marketing" && !marketing.enabled) {
    return `Marketing is paused${marketing.reason ? `: ${marketing.reason}` : ""}; run left queued.`;
  }
  if (scope === "pipeline" && !pipeline.enabled) {
    return `Pipeline is paused${pipeline.reason ? `: ${pipeline.reason}` : ""}; run left queued.`;
  }
  return null;
}

/**
 * The oldest queued run started from `source` (`params_json.source`), any hour. A run whose next
 * step the tick never starts (`TICK_EXCLUDED_STEP_KEYS`) is picked up this way by its own route,
 * so a retry the reaper re-queued is never left queued.
 */
export async function oldestQueuedRunBySource(source: string): Promise<number | null> {
  const [row] = await sql<{ id: number | string }[]>`
    SELECT id FROM agent_runs
     WHERE status = 'queued' AND params_json->>'source' = ${source}
     ORDER BY id ASC
     LIMIT 1
  `;
  return row ? Number(row.id) : null;
}

export async function executeAgentRun(
  runId: number,
  options: {
    maxSteps?: number;
    allowProviderSteps?: boolean;
    /** Epoch ms by which a started step should finish; see STEP_EXPECTED_MS. */
    deadlineAt?: number;
    /** False makes the first step wait for the deadline; daily scoreboard work always waits. */
    alwaysRunFirstStep?: boolean;
    /** Leave a paid step queued for a later tick instead of running or skipping it. */
    deferProviderSteps?: boolean;
    /** Shared by the lanes a tick runs side by side; see SERIAL_STEP_KEYS. */
    stepTurns?: StepTurns;
    /** A caller's narrower continuation ceiling, including the actual locked step claim. */
    pauseExemptOnly?: boolean;
  } = {},
): Promise<AgentRunExecutionResult> {
  if (!Number.isInteger(runId) || runId < 1) {
    return {
      runId,
      status: "missing",
      terminal: true,
      executedSteps: 0,
      message: "Invalid agent run id.",
    };
  }

  const existing = await getAgentRun(runId);
  if (!existing) {
    return {
      runId,
      status: "missing",
      terminal: true,
      executedSteps: 0,
      message: "Agent run not found.",
    };
  }
  if (isTerminalRunStatus(existing.status)) {
    return {
      runId,
      status: existing.status,
      terminal: true,
      executedSteps: 0,
      message: `Run is already ${existing.status}.`,
    };
  }

  if (getExecutionBackend() !== "agentic_v1") {
    return blockRunForBackend(runId);
  }
  // Steps are priced by the run that holds them (`RUN_SOURCE_STEP_EXPECTED_MS`).
  const runSource = typeof existing.params?.source === "string" ? existing.params.source : null;

  // Deterministic work is paused by the pipeline control, growth's marketing steps by the
  // marketing control; each leaves the other's runs going. A paused run stays queued
  // (never terminal) so it resumes on its own when its control is re-enabled.
  const [pipeline, marketing] = await Promise.all([getPipelineControl(), getMarketingControl()]);
  const firstQueuedStep = pipeline.enabled && marketing.enabled ? null : await peekNextQueuedStepKey(runId);
  const held = firstQueuedStep ? heldByPause(firstQueuedStep, pipeline, marketing) : null;
  if (held) {
    return {
      runId,
      status: existing.status,
      terminal: false,
      executedSteps: 0,
      message: held,
    };
  }

  const maxSteps = Math.min(Math.max(Math.floor(options.maxSteps ?? 1), 1), 10);
  let executedSteps = 0;
  let lastResult: AgentRunExecutionResult | null = null;

  // The daily route only queues this workflow: even a tick's first run must leave
  // its 150-second reference score queued when it cannot fit the explicit deadline.
  const scoreboardDeadline = existing.agent === "atlas" && existing.runKind === "workflow"
    && runSource === "atlas.scoreboard" && options.deadlineAt != null;
  if ((options.alwaysRunFirstStep === false || scoreboardDeadline) && options.deadlineAt != null) {
    const keys = await peekQueuedStepKeys(runId, maxSteps);
    if (Date.now() + expectedMsToFirstWork(keys, runSource) > options.deadlineAt) {
      await recordStepDeferral(runId, keys[0] ?? null, expectedMsToFirstWork(keys, runSource), options.deadlineAt - Date.now());
      return {
        runId,
        status: existing.status,
        terminal: false,
        executedSteps: 0,
        message: "Next substantive step cannot finish by the tick deadline; run left queued.",
        heldForDeadline: true,
      };
    }
  }

  for (let index = 0; index < maxSteps; index += 1) {
    // A step that could not finish by the caller's deadline waits for the next tick; the
    // run stays queued. Other workflows may use the tick's first-step progress override;
    // the daily scoreboard always respects an explicit deadline.
    const nextStepKey = await peekNextQueuedStepKey(runId);
    if (options.pauseExemptOnly && nextStepKey && !PAUSE_EXEMPT_STEP_KEYS.includes(nextStepKey)) {
      return { runId, status: lastResult?.status ?? existing.status, terminal: false, executedSteps,
        message: "Next step is outside the pause-exempt continuation; run left queued." };
    }
    // A later step under a paused control waits, even when this run's first step did not.
    if (index > 0 && nextStepKey && heldByPause(nextStepKey, pipeline, marketing)) break;
    const firstOfTick = index === 0 && (options.alwaysRunFirstStep ?? true) && !scoreboardDeadline;
    if (!firstOfTick && options.deadlineAt != null
      && Date.now() + expectedStepMs(nextStepKey, runSource) > options.deadlineAt) {
      await recordStepDeferral(runId, nextStepKey, expectedStepMs(nextStepKey, runSource), options.deadlineAt - Date.now());
      break;
    }
    // Provider steps (paid model calls) additionally require the global automation
    // stop to be clear and the caller to have provider budget for this tick.
    if (nextStepKey && isProviderStep(nextStepKey)) {
      if (options.deferProviderSteps) {
        return {
          runId,
          status: lastResult?.status ?? existing.status,
          terminal: false,
          executedSteps,
          message: "Paid step left queued for a later tick (this tick's paid-run cap is used).",
        };
      }
      const gate = await providerStepGate(options.allowProviderSteps ?? true);
      if (!gate.allowed) {
        // A paid pass is optional: when the budget or the stop blocks it, record it as
        // skipped and let the free steps behind it run. It never stalls the run.
        const blocked = await prepareNextAgenticStep(runId, {
          pauseExemptOnly: options.pauseExemptOnly,
          expectedStepKey: nextStepKey,
        });
        if (blocked.kind !== "ready") {
          return {
            runId,
            status: blocked.kind === "missing" ? "missing" : blocked.status,
            terminal: blocked.kind === "missing" || blocked.kind === "terminal",
            executedSteps,
            message: blocked.kind === "missing" ? "Agent run not found." : blocked.message,
          };
        }
        lastResult = await finishAgenticStep(runId, blocked.prepared.step, {
          status: "skipped",
          summary: `Paid pass skipped: ${gate.reason}.`,
          detail: { budget_stopped: true, budget_reason: gate.reason, processed: 0 },
        });
        executedSteps += 1;
        if (lastResult.terminal) return { ...lastResult, executedSteps };
        continue;
      }
    }

    // Lanes run side by side take turns at a publish step: they share one database lock
    // (agents.hamilton.publish), and a step waiting on it would hold a connection and tick time.
    let releaseTurn: (() => void) | null = null;
    if (options.stepTurns && nextStepKey && SERIAL_STEP_KEYS.has(nextStepKey)) {
      releaseTurn = await options.stepTurns.take();
      // The wait used tick time: start the step only if it still fits.
      if (options.deadlineAt != null && Date.now() + expectedStepMs(nextStepKey, runSource) > options.deadlineAt) {
        releaseTurn();
        await recordStepDeferral(runId, nextStepKey, expectedStepMs(nextStepKey, runSource), options.deadlineAt - Date.now());
        break;
      }
    }
    try {
      const prepared = await prepareNextAgenticStep(runId, { pauseExemptOnly: options.pauseExemptOnly });
      if (prepared.kind === "missing") {
        return {
          runId,
          status: "missing",
          terminal: true,
          executedSteps,
          message: "Agent run not found.",
        };
      }
      if (prepared.kind === "terminal" || prepared.kind === "busy" || prepared.kind === "held") {
        return {
          runId,
          status: prepared.status,
          terminal: prepared.kind === "terminal",
          executedSteps,
          message: prepared.message,
        };
      }

      const { run, step } = prepared.prepared;
      try {
        const outcome =
          step.stepKey === "discover" ||
          step.stepKey === "rescue" ||
          step.stepKey === "fetch" ||
          step.stepKey === "read" ||
          isProviderStep(step.stepKey) ||
          step.stepKey === "public-discovery" ||
          step.stepKey === "public-audit" ||
          // A blocked report is marked failed and then the step throws; outside a
          // transaction, so the job keeps its failed status and recorded findings.
          step.stepKey === "report-reconcile" ||
          // The lane sync writes through its own statements; a step transaction would sit idle.
          step.stepKey === "lane-sync" ||
          isRegistryStepKey(step.stepKey)
            ? await executeAgenticStep(sql, run, step)
            : await withTransaction((tx) => executeAgenticStep(tx, run, step));
        lastResult = await finishAgenticStep(runId, step, outcome);
        executedSteps += 1;
        if (lastResult.terminal) return { ...lastResult, executedSteps };
      } catch (error) {
        const failed = await failAgenticStep(runId, step, error);
        return { ...failed, executedSteps };
      }
    } finally {
      releaseTurn?.();
    }
  }

  return {
    runId,
    status: lastResult?.status ?? "queued",
    terminal: Boolean(lastResult?.terminal),
    executedSteps,
    message: lastResult?.message ?? "No queued agent step was executed.",
  };
}

export async function executeQueuedAgentRuns({
  runLimit = 2,
  maxStepsPerRun = 1,
  allowProviderSteps = true,
  budgetPolicyId = null,
  maxProviderCallsPerRun = null,
  maxEstimatedCostMicrousd = null,
  providerRunLimit = null,
  deadlineAt,
  paused = { pipeline: false, marketing: false },
  parallelLanes = PARALLEL_STATE_LANES,
  scope = null,
  pauseExemptOnly = false,
}: {
  /** State lanes advanced side by side this tick; 1 runs them one after another. */
  parallelLanes?: number;
  runLimit?: number;
  maxStepsPerRun?: number;
  allowProviderSteps?: boolean;
  budgetPolicyId?: number | null;
  maxProviderCallsPerRun?: number | null;
  maxEstimatedCostMicrousd?: number | null;
  /**
   * Operator pauses in force this tick. A run whose next queued step is held by one
   * (`heldByPause`) is not selected, so held data runs cannot crowd growth's marketing
   * runs out of the run limit while the pipeline is paused, nor the reverse.
   */
  paused?: { pipeline: boolean; marketing: boolean };
  /**
   * Runs that may take paid steps this tick; later runs do only free steps and leave
   * their next paid step queued. Null means every run may.
   */
  providerRunLimit?: number | null;
  /** Step finish deadline; the first-run progress override excludes the daily scoreboard. */
  deadlineAt?: number;
  /** Restrict a continuation drain without widening another workflow's pause exemption. */
  scope?: AgentRunSelectionScope | null;
  /** Keep a narrow pause continuation inside the existing exempt step list, even after control changes. */
  pauseExemptOnly?: boolean;
} = {}): Promise<ExecuteQueuedAgentRunsResult> {
  const safeRunLimit = Math.min(Math.max(Math.floor(runLimit), 1), 10);
  // Keep mandatory paid jobs out of a capped tick's run limit. A state's optional
  // paid pass must still reach executeAgentRun's skip receipt when free work follows;
  // otherwise three lanes waiting at paid steps fill every active lane slot forever.
  const rows = await sql`
    SELECT r.id, r.run_kind, r.params_json->>'source' AS source,
           -- Time since the run last did anything: its last finished step, else when it was queued.
           EXTRACT(EPOCH FROM NOW() - progress.last_work_at) * 1000 AS idle_ms
      FROM agent_runs r
      LEFT JOIN agent_state_lanes lane
        ON r.run_kind = 'workflow_lane' AND lane.state_code = upper(btrim(r.state_code))
      LEFT JOIN LATERAL (
        SELECT COALESCE(MAX(done.completed_at), r.started_at) AS last_work_at
          FROM agent_run_steps done WHERE done.agent_run_id = r.id
      ) progress ON true
     WHERE r.run_kind = ANY(${[...RUN_KINDS_WITH_LEDGER]})
       AND r.status = 'queued'
       AND (${scope === null}::boolean OR (
         r.agent_name = ${scope?.agent ?? null}
         AND r.run_kind = ${scope?.kind ?? null}
         AND r.params_json->>'source' = ${scope?.source ?? null}
       ))
       AND (
         ${allowProviderSteps}
         OR (r.run_kind = 'workflow_lane' AND EXISTS (
           SELECT 1 FROM agent_run_steps optional
            WHERE optional.agent_run_id = r.id
              AND optional.status = 'queued'
              AND optional.step_key = ANY(${[...OPTIONAL_PAID_PASS_STEP_KEYS]}::text[])
              AND optional.sequence = (
                SELECT MIN(first_step.sequence) FROM agent_run_steps first_step
                 WHERE first_step.agent_run_id = r.id AND first_step.status = 'queued'
              )
              AND EXISTS (
                SELECT 1 FROM agent_run_steps later
                 WHERE later.agent_run_id = r.id AND later.status = 'queued'
                   AND later.sequence > optional.sequence
                   AND NOT later.step_key = ANY(${[...PROVIDER_STEP_KEYS]}::text[])
              )
              AND NOT EXISTS (
                SELECT 1 FROM agent_run_steps required
                 WHERE required.agent_run_id = r.id AND required.status = 'queued'
                   AND required.step_key = ANY(${[...PROVIDER_STEP_KEYS]}::text[])
                   AND NOT required.step_key = ANY(${[...OPTIONAL_PAID_PASS_STEP_KEYS]}::text[])
              )
         ))
         OR NOT EXISTS (
           SELECT 1
             FROM agent_run_steps s
            WHERE s.agent_run_id = r.id
              AND s.status = 'queued'
              AND s.step_key = ANY(${[...PROVIDER_STEP_KEYS]}::text[])
              AND s.sequence = (
                SELECT MIN(s2.sequence)
                  FROM agent_run_steps s2
                 WHERE s2.agent_run_id = r.id
                   AND s2.status = 'queued'
              )
         )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM agent_run_steps s
          WHERE s.agent_run_id = r.id
            AND s.status = 'queued'
            AND s.sequence = (
              SELECT MIN(s2.sequence)
                FROM agent_run_steps s2
               WHERE s2.agent_run_id = r.id
                 AND s2.status = 'queued'
            )
            AND (
              (${paused.marketing} AND s.step_key = ANY(${[...MARKETING_STEP_KEYS]}::text[]))
              OR (${paused.pipeline}
                AND NOT s.step_key = ANY(${[...MARKETING_STEP_KEYS]}::text[])
                AND NOT s.step_key = ANY(${[...PAUSE_EXEMPT_STEP_KEYS]}::text[]))
              OR (${pauseExemptOnly} AND NOT s.step_key = ANY(${[...PAUSE_EXEMPT_STEP_KEYS]}::text[]))
              -- A step that cannot finish inside a tick runs only from its own route.
              OR s.step_key = ANY(${[...TICK_EXCLUDED_STEP_KEYS]}::text[])
            )
       )
     -- Report runs go first: someone pressed Generate and is watching the page. An idle
     -- state lane gets the next fresh tick before maintenance can consume its publication room.
     -- Then a guard
     -- catch-up run. Then a
     -- run already under way finishes before a new one starts, then a direct run for one
     -- institution (hand-found schedules go that way, not by promoting their whole state
     -- lane), then a retry of a failed state lane, then a state whose report James is
     -- waiting to review, then any run waiting over an hour,
     -- then state lanes by Atlas's priority score (open work, report requests,
     -- near-ready markets), then launch order.
     ORDER BY (r.run_kind = 'report') DESC,
              (r.run_kind = 'workflow_lane'
                AND progress.last_work_at < NOW() - INTERVAL '15 minutes') DESC,
              CASE WHEN r.run_kind = 'workflow_lane'
                     AND progress.last_work_at < NOW() - INTERVAL '15 minutes'
                   THEN progress.last_work_at END ASC NULLS LAST,
              -- A deployed guard or frequency fix (hamilton/guard-catch-up.ts): two short steps,
              -- once per version. Behind runs under way it waited 10+ minutes (run 3231, Oct 9).
              -- Growth's stale-outreach withdrawal (growth/withdraw.ts) is one short step, at most
              -- once a day, and ranks with it so the tick that queues it also runs it.
              -- The publish-sweeps run (hamilton/publish-sweeps.ts) is one step at most once a tick; it ranks
              -- first so it starts while the tick still has room for its 205 s.
              COALESCE(r.params_json->>'source' IN ('hamilton.guard_catch_up', 'growth.outreach_withdraw', 'hamilton.publish_sweeps'), false) DESC,
              EXISTS (
                SELECT 1 FROM agent_run_steps done
                 WHERE done.agent_run_id = r.id AND done.status <> 'queued'
              ) DESC,
              -- Atlas's direct runs for one institution (atlas/priority-institutions.ts):
              -- a hand-found schedule or a large bank missing its overdraft fee; and its
              -- direct re-search of one state's missed banks (atlas/priority-state-research.ts).
              -- They go ahead of state lanes only while a lane has started a step in the last
              -- ten minutes: three or four direct runs fill a tick, and a lane's first step
              -- needs most of one, so ranking them first every tick starved every lane
              -- (no lane started 08:52-09:25 on 2026-10-07, Tennessee included).
              (COALESCE(r.params_json->>'source' IN ('atlas.priority_institution', 'atlas.priority_state_research'), false)
                AND EXISTS (
                  SELECT 1 FROM agent_run_steps lane_step
                    JOIN agent_runs lane_run ON lane_run.id = lane_step.agent_run_id
                   WHERE lane_run.run_kind = 'workflow_lane'
                     AND lane_step.started_at > NOW() - INTERVAL '10 minutes'
                )) DESC,
              -- A state whose last finished lane run failed retries ahead of routine passes.
              (r.run_kind = 'workflow_lane' AND (
                SELECT prior.status FROM agent_runs prior
                 WHERE prior.run_kind = 'workflow_lane'
                   AND upper(btrim(prior.state_code)) = upper(btrim(r.state_code))
                   AND prior.id < r.id
                   AND prior.status IN ('completed', 'failed')
                 ORDER BY prior.id DESC LIMIT 1
              ) = 'failed') DESC,
              -- A state whose report James is waiting to review (atlas/report-review-states.ts).
              (r.run_kind = 'workflow_lane'
                AND upper(btrim(r.state_code)) = ANY(${reportReviewStates()}::text[])) DESC,
              (r.started_at < NOW() - INTERVAL '1 hour') DESC,
              COALESCE(lane.priority_score, 0) DESC,
              r.started_at ASC, r.id ASC
     LIMIT ${safeRunLimit}
  `;
  // Other runs advance one after another; up to `parallelLanes` state lanes advance side by side.
  // Side by side first held several step transactions open at once, publish steps queued on
  // one advisory lock, and the shared database crawled (Oct 2026). Lanes now take turns at
  // publish (`createStepTurns`), and the reads that held the database are fast (#1793, #1798).
  // The tick deadline still bounds how much work one tick does.
  const results: AgentRunExecutionResult[] = [];
  let providerRuns = 0;
  // A direct run (Read now, a state's re-search) ranks ahead of state lanes, and one that ran its
  // steps until the deadline left the lane behind it no room: on Oct 15 lanes fell to 4-7 an hour
  // while Read-now runs took up to 1,770 s of tick time an hour. Each one now finishes early enough
  // to leave the next lane's first work room in the tick (`laneRoomMs`).
  const firstLaneIndex = rows.findIndex((row) => row.run_kind === "workflow_lane");
  const laneRoomMs = deadlineAt != null && firstLaneIndex >= 0 && rows.slice(0, firstLaneIndex).some((row) => isLaneRoomRun(row.source))
    ? await laneFirstWorkMs(Number(rows[firstLaneIndex].id))
    : 0;
  // The first run may take a progress step, except the daily scoreboard's strict deadline;
  // a direct run that left it to the lane passes the opportunity on.
  let firstRunPending = true;
  // Once a state lane is held because its first real step would not finish this tick,
  // no lane further down the order starts in its place: a lower lane that fits would
  // count as under way and take the next tick ahead of it (Tennessee waited behind WY
  // this way, 2026-10-07). Other runs can still use the rest of the tick.
  let laneHeld = false;
  const lanesSideBySide = Math.min(Math.max(Math.floor(parallelLanes), 1), MAX_PARALLEL_LANES);
  const stepTurns = createStepTurns();
  const done = new Set<number>();
  const runOne = async (index: number, row: (typeof rows)[number], alwaysRunFirstStep: boolean) => {
    const runId = Number(row.id);
    if (budgetPolicyId !== null || maxProviderCallsPerRun !== null || maxEstimatedCostMicrousd !== null) {
      await sql`
        UPDATE agent_runs
           SET budget_policy_id = COALESCE(${budgetPolicyId}, budget_policy_id),
               max_provider_calls = COALESCE(${maxProviderCallsPerRun}, max_provider_calls),
               max_estimated_cost_microusd = COALESCE(${maxEstimatedCostMicrousd}, max_estimated_cost_microusd),
               updated_at = NOW()
         WHERE id = ${runId}
      `;
    }
    const providerSlot = allowProviderSteps && (providerRunLimit === null || providerRuns < providerRunLimit);
    if (providerSlot) providerRuns += 1;
    const laneRoomRun = laneRoomMs > 0 && index < firstLaneIndex && isLaneRoomRun(row.source);
    // A re-search run that has waited out lane room takes one step on the full deadline, then
    // leaves lane room again (`LANE_ROOM_MAX_IDLE_MS`).
    const waitedOut = laneRoomRun && waitedOutLaneRoom(row.source, row.idle_ms);
    const leavesLaneRoom = laneRoomRun && !waitedOut;
    const result = await executeAgentRun(runId, {
      maxSteps: waitedOut ? waitedOutMaxSteps(row.source, maxStepsPerRun) : maxStepsPerRun,
      allowProviderSteps,
      deadlineAt: leavesLaneRoom && deadlineAt != null ? deadlineAt - laneRoomMs : deadlineAt,
      // Offer the first-step progress override unless it takes the lane's room.
      // executeAgentRun still enforces the daily scoreboard's explicit deadline.
      alwaysRunFirstStep: alwaysRunFirstStep && !leavesLaneRoom,
      deferProviderSteps: allowProviderSteps && !providerSlot,
      stepTurns: row.run_kind === "workflow_lane" ? stepTurns : undefined,
      ...(pauseExemptOnly ? { pauseExemptOnly: true } : {}),
    });
    return { result, passesFirstStep: leavesLaneRoom && result.executedSteps === 0 };
  };
  for (const [index, row] of rows.entries()) {
    if (done.has(index)) continue;
    if (laneHeld && row.run_kind === "workflow_lane") continue;
    // Other first runs may use the progress override; scoreboard and later work must
    // fit the deadline, so a larger run limit fills the tick without overrunning it.
    if (results.length > 0 && deadlineAt != null && Date.now() + QUICK_STEP_EXPECTED_MS > deadlineAt) break;
    if (row.run_kind !== "workflow_lane" || lanesSideBySide === 1) {
      const { result, passesFirstStep } = await runOne(index, row, firstRunPending);
      if (!passesFirstStep) firstRunPending = false;
      results.push(result);
      if (result.heldForDeadline && row.run_kind === "workflow_lane") laneHeld = true;
      continue;
    }
    // This lane and the next lanes in the order, side by side; only the first may take the
    // tick's always-run step.
    const group = rows
      .map((candidate, at) => ({ candidate, at }))
      .filter(({ candidate, at }) => at >= index && candidate.run_kind === "workflow_lane" && !done.has(at))
      .slice(0, lanesSideBySide);
    for (const { at } of group) done.add(at);
    const outcomes = await Promise.all(
      group.map(({ candidate, at }, position) => runOne(at, candidate, firstRunPending && position === 0)),
    );
    firstRunPending = false;
    for (const { result } of outcomes) {
      results.push(result);
      if (result.heldForDeadline) laneHeld = true;
    }
  }
  return { selected: rows.length, results };
}

export async function getAgentRunSteps(runId: number): Promise<AgentRunStepSnapshot[]> {
  const rows = await sql`
    SELECT id, agent_run_id, step_key, agent_name, title, input_payload, status, sequence,
           summary, error_summary, queued_at, started_at, completed_at, updated_at
      FROM agent_run_steps
     WHERE agent_run_id = ${runId}
     ORDER BY sequence ASC, id ASC
  `;
  return rows.map(mapStep);
}

export async function getAgentRun(runId: number): Promise<AgentRunSnapshot | null> {
  const [row] = await sql`
    SELECT id, agent_name, run_kind, title, status, started_at, completed_at,
           updated_at, trigger_source, triggered_by, correlation_id, backend,
           progress_current, progress_total, current_stage, error_summary,
           summary, params_json
      FROM agent_runs
     WHERE id = ${runId}
  `;
  return row ? mapRun(row) : null;
}

export async function getAgentRunEvents(
  runId: number,
  limit = 100,
): Promise<AgentRunEventSnapshot[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 500);
  const rows = await sql`
    SELECT id, agent_run_id, step_id, event_type, status, message, detail, created_at
      FROM agent_run_events
     WHERE agent_run_id = ${runId}
     ORDER BY created_at DESC, id DESC
     LIMIT ${safeLimit}
  `;
  return rows.reverse().map(mapEvent);
}

export async function listAgentRuns(limit = 20): Promise<AgentRunSnapshot[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const rows = await sql`
    SELECT id, agent_name, run_kind, title, status, started_at, completed_at,
           updated_at, trigger_source, triggered_by, correlation_id, backend,
           progress_current, progress_total, current_stage, error_summary,
           summary, params_json
      FROM agent_runs
     WHERE run_kind = ANY(${[...RUN_KINDS_WITH_LEDGER]})
     ORDER BY started_at DESC, id DESC
     LIMIT ${safeLimit}
  `;
  return rows.map(mapRun);
}

export async function listActiveAgentRuns(): Promise<AgentRunSnapshot[]> {
  const rows = await sql`
    SELECT id, agent_name, run_kind, title, status, started_at, completed_at,
           updated_at, trigger_source, triggered_by, correlation_id, backend,
           progress_current, progress_total, current_stage, error_summary,
           summary, params_json
      FROM agent_runs
     WHERE run_kind = ANY(${[...RUN_KINDS_WITH_LEDGER]})
       AND status = ANY(${ACTIVE_STATUSES})
     ORDER BY started_at DESC, id DESC
     LIMIT 20
  `;
  return rows.map(mapRun);
}

export async function cancelAgentRun(
  runId: number,
  cancelledBy: string,
): Promise<{ success: boolean; error?: string }> {
  const [run] = await sql`
    SELECT id, status
      FROM agent_runs
     WHERE id = ${runId}
  `;
  if (!run) return { success: false, error: "Agent run not found" };
  if (!ACTIVE_STATUSES.includes(String(run.status))) {
    return { success: false, error: `Agent run is already ${run.status}` };
  }

  await withTransaction(async (tx) => {
    const [updated] = await tx`
      UPDATE agent_runs
         SET status = 'cancelled',
             summary = 'Cancelled before worker execution',
             cancel_requested_at = NOW(),
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = ${runId}
       RETURNING id
    `;
    await tx`
      UPDATE agent_run_steps
         SET status = 'cancelled',
             error_summary = COALESCE(error_summary, 'Cancelled before worker execution'),
             completed_at = COALESCE(completed_at, NOW()),
             updated_at = NOW()
       WHERE agent_run_id = ${runId}
         AND status IN ('queued', 'running', 'cancel_requested')
    `;
    if (updated) {
      await tx`
        INSERT INTO agent_run_events
          (agent_run_id, event_type, status, message, detail)
        VALUES
          (${runId}, 'run.cancelled', 'cancelled',
           'Run cancelled before completion.',
           ${JSON.stringify({ cancelled_by: cancelledBy })}::jsonb)
      `;
    }
  });
  return { success: true };
}

export interface CancelAllAgentRunsResult {
  requested: number;
  cancelled: number;
  failed: Array<{ runId: number; error: string }>;
}

export async function cancelAllActiveAgentRuns(
  cancelledBy: string,
): Promise<CancelAllAgentRunsResult> {
  const activeRuns = await sql`
    SELECT id
      FROM agent_runs
     WHERE run_kind = ANY(${[...RUN_KINDS_WITH_LEDGER]})
       AND status IN ('queued', 'running', 'cancel_requested')
     ORDER BY started_at ASC, id ASC
  `;
  const result: CancelAllAgentRunsResult = {
    requested: activeRuns.length,
    cancelled: 0,
    failed: [],
  };

  for (const run of activeRuns) {
    const runId = Number(run.id);
    const cancellation = await cancelAgentRun(runId, cancelledBy);
    if (cancellation.success) {
      result.cancelled += 1;
    } else {
      result.failed.push({ runId, error: cancellation.error ?? "Unknown cancellation failure" });
    }
  }

  return result;
}

export async function startAgentRun(input: StartAgentRunInput): Promise<StartAgentRunResult> {
  const normalizedStateCode = normalizeStateCode(input.stateCode ?? input.params?.state_code);
  const params = normalizedStateCode
    ? { ...(input.params ?? {}), state_code: normalizedStateCode }
    : (input.params ?? {});
  const triggerSource = input.triggerSource ?? "admin";
  const progressTotal = input.steps.length;
  const firstStage = input.steps[0]?.key ?? null;

  if (input.idempotencyKey && !input.reuseTerminal) {
    const [existing] = await sql`
      SELECT id, agent_name, run_kind, title, status, started_at, completed_at,
             updated_at, trigger_source, triggered_by, correlation_id, backend,
             progress_current, progress_total, current_stage, error_summary,
             summary, params_json
        FROM agent_runs
       WHERE idempotency_key = ${input.idempotencyKey}
         AND status = ANY(${ACTIVE_STATUSES})
       ORDER BY started_at DESC
       LIMIT 1
    `;
    if (existing) {
      const run = mapRun(existing);
      return { run, steps: await getAgentRunSteps(run.id), reused: true };
    }
  }

  const created = await withTransaction(async (tx) => {
    if (input.idempotencyKey && input.reuseTerminal) {
      // One short transaction, no step/HTTP work or nested connection: concurrent
      // daily requests reuse the same original run, including failed/cancelled ones.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`agent_run.once:${input.idempotencyKey}`}, 0))`;
      const [existing] = await tx`
        SELECT id, agent_name, run_kind, title, status, started_at, completed_at,
               updated_at, trigger_source, triggered_by, correlation_id, backend,
               progress_current, progress_total, current_stage, error_summary,
               summary, params_json
          FROM agent_runs
         WHERE idempotency_key = ${input.idempotencyKey}
         ORDER BY started_at ASC, id ASC
         LIMIT 1
      `;
      if (existing) {
        // Existing duplicates remain history; the earliest run is the canonical one.
        const rows = await tx`
          SELECT id, agent_run_id, step_key, agent_name, title, input_payload, status, sequence,
                 summary, error_summary, queued_at, started_at, completed_at, updated_at
            FROM agent_run_steps WHERE agent_run_id = ${Number(existing.id)}
           ORDER BY sequence ASC, id ASC
        `;
        return { run: mapRun(existing), steps: rows.map(mapStep), reused: true };
      }
    }
    const [runRow] = await tx`
      INSERT INTO agent_runs
        (agent_name, run_kind, state_code, title, summary, status, params_json,
         trigger_source, triggered_by, idempotency_key, backend,
         progress_current, progress_total, current_stage, started_at, updated_at)
      VALUES
        (${input.agent}, ${input.kind}, ${normalizedStateCode}, ${input.title}, ${input.summary ?? null},
         'queued', ${JSON.stringify(params)}::jsonb, ${triggerSource},
         ${input.triggeredBy}, ${input.idempotencyKey ?? null}, 'agentic_v1',
         0, ${progressTotal}, ${firstStage}, NOW(), NOW())
      RETURNING id, agent_name, run_kind, title, status, started_at, completed_at,
                updated_at, trigger_source, triggered_by, correlation_id, backend,
                progress_current, progress_total, current_stage, error_summary,
                summary, params_json
    `;
    const run = mapRun(runRow);

    for (const [index, step] of input.steps.entries()) {
      await tx`
        INSERT INTO agent_run_steps
          (agent_run_id, step_key, agent_name, title, status, sequence, input_payload)
        VALUES
          (${run.id}, ${step.key}, ${step.agent}, ${step.title},
           'queued', ${index + 1}, ${JSON.stringify(step.input ?? {})}::jsonb)
      `;
    }

    await tx`
      INSERT INTO agent_run_events
        (agent_run_id, event_type, status, message, detail)
      VALUES
        (${run.id}, 'run.created', 'queued',
         'Agentic run accepted by the TypeScript run ledger. No retired external worker process was launched.',
         ${JSON.stringify({
           agent: input.agent,
           kind: input.kind,
           title: input.title,
           steps: input.steps.map((step) => step.key),
         })}::jsonb)
    `;

    const stepRows = await tx`
      SELECT id, agent_run_id, step_key, agent_name, title, input_payload, status, sequence,
             summary, error_summary, queued_at, started_at, completed_at, updated_at
        FROM agent_run_steps
       WHERE agent_run_id = ${run.id}
       ORDER BY sequence ASC, id ASC
    `;

    return {
      run,
      steps: stepRows.map(mapStep),
      reused: false,
    };
  });

  if (created.reused) return created;
  if (getExecutionBackend() !== "agentic_v1") {
    await blockRunForBackend(created.run.id);
    const [run, steps] = await Promise.all([
      getAgentRun(created.run.id),
      getAgentRunSteps(created.run.id),
    ]);
    return { run: run ?? created.run, steps, reused: false };
  }

  // Deterministic runs are always accepted (a pipeline pause leaves them queued).
  // Runs made only of provider steps are blocked at launch while the provider
  // automation stop is active. Mixed runs (a state lane with its paid last passes)
  // are accepted: their paid steps are skipped at execution, the free ones still run.
  try {
    if (input.steps.length > 0 && input.steps.every((step) => isProviderStep(step.key))) {
      await assertAutomationEnabled("agent run launch");
    }
  } catch (error) {
    await blockRunForAutomationStop(
      created.run.id,
      error instanceof Error ? error.message : String(error),
    );
    const [run, steps] = await Promise.all([
      getAgentRun(created.run.id),
      getAgentRunSteps(created.run.id),
    ]);
    return { run: run ?? created.run, steps, reused: false };
  }

  return created;
}

export type ProRequestOperation = "report" | "thesis" | "simulate_interpretation" | "ask" | "upload" | "decision" | "ask_memo";

export interface RecordProRequestInput {
  operation: ProRequestOperation;
  title: string;
  status: "completed" | "failed";
  summary: string;
  userId: number | null;
  institutionId?: number | string | null;
  detail?: Record<string, unknown>;
}

/**
 * Records a finished Pro AI request in the run ledger (run_kind 'pro_request'): one
 * run, one step and one event, written in one transaction after the work is done, so
 * no run is ever left "running". Never throws: the ledger must not fail a paid request
 * that already succeeded. Returns the run id, or null when it could not be written
 * (for example before the pro_request migration is applied).
 */
export async function recordProRequest(input: RecordProRequestInput): Promise<number | null> {
  const detail = {
    operation: input.operation,
    user_id: input.userId,
    institution_id: input.institutionId ?? null,
    ...(input.detail ?? {}),
  };
  try {
    return await withTransaction(async (tx) => {
      const [run] = await tx`
        INSERT INTO agent_runs
          (agent_name, run_kind, title, summary, status, params_json, trigger_source,
           triggered_by, backend, progress_current, progress_total, current_stage,
           error_summary, started_at, completed_at, updated_at)
        VALUES
          ('hamilton', 'pro_request', ${input.title}, ${input.summary}, ${input.status},
           ${JSON.stringify(detail)}::jsonb, 'api', ${input.userId ? `user:${input.userId}` : "system"},
           'agentic_v1', 1, 1, ${`pro.${input.operation}`},
           ${input.status === "failed" ? input.summary : null}, NOW(), NOW(), NOW())
        RETURNING id
      `;
      const runId = Number(run.id);
      await tx`
        INSERT INTO agent_run_steps
          (agent_run_id, step_key, agent_name, title, status, sequence, input_payload,
           summary, error_summary, started_at, completed_at, updated_at)
        VALUES
          (${runId}, ${`pro.${input.operation}`}, 'hamilton', ${input.title}, ${input.status}, 1,
           ${JSON.stringify(detail)}::jsonb, ${input.summary},
           ${input.status === "failed" ? input.summary : null}, NOW(), NOW(), NOW())
      `;
      await tx`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (${runId}, ${`run.${input.status}`}, ${input.status}, ${input.summary}, ${JSON.stringify(detail)}::jsonb)
      `;
      return runId;
    });
  } catch {
    return null;
  }
}


export interface InlineAgentRun {
  runId: number;
  stepId: number;
}

/**
 * Opens a run whose one step a person's request does in place (a hand-supplied document's
 * load, `magellan/hand-supplied.ts`): the run and its step start `running`, so the tick never
 * executes them, and `closeInlineAgentRun` settles both. Like `recordProRequest`, but opened
 * before the work so every row the work writes carries the run id.
 */
export async function openInlineAgentRun(input: {
  db?: SqlTag;
  agent: AdminAgent;
  title: string;
  stepKey: string;
  stepTitle: string;
  params: Record<string, unknown>;
  triggeredBy: string;
}): Promise<InlineAgentRun> {
  const db = input.db ?? sql;
  const [run] = await db`
    INSERT INTO agent_runs
      (agent_name, run_kind, title, status, params_json, trigger_source, triggered_by, backend,
       progress_current, progress_total, current_stage, started_at, updated_at)
    VALUES
      (${input.agent}, 'manual_repair', ${input.title}, 'running', ${JSON.stringify(input.params)}::jsonb, 'admin',
       ${input.triggeredBy}, 'agentic_v1', 0, 1, ${input.stepKey}, NOW(), NOW())
    RETURNING id
  `;
  const runId = Number(run.id);
  const [step] = await db`
    INSERT INTO agent_run_steps
      (agent_run_id, step_key, agent_name, title, status, sequence, input_payload, started_at, updated_at)
    VALUES
      (${runId}, ${input.stepKey}, ${input.agent}, ${input.stepTitle}, 'running', 1,
       ${JSON.stringify(input.params)}::jsonb, NOW(), NOW())
    RETURNING id
  `;
  const stepId = Number(step.id);
  await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${runId}, ${stepId}, 'step.started', 'running', ${input.stepTitle}, ${JSON.stringify(input.params)}::jsonb)
  `;
  return { runId, stepId };
}

/** Settles a run opened by `openInlineAgentRun`: its step, the run and one closing event. */
export async function closeInlineAgentRun(
  handle: InlineAgentRun,
  input: { db?: SqlTag; status: "completed" | "failed"; summary: string; detail?: Record<string, unknown> },
): Promise<void> {
  const db = input.db ?? sql;
  const error = input.status === "failed" ? input.summary : null;
  await db`
    UPDATE agent_run_steps
       SET status = ${input.status}, summary = ${input.summary}, error_summary = ${error},
           completed_at = NOW(), updated_at = NOW()
     WHERE id = ${handle.stepId}
  `;
  await db`
    UPDATE agent_runs
       SET status = ${input.status}, summary = ${input.summary}, error_summary = ${error},
           progress_current = 1, completed_at = NOW(), updated_at = NOW()
     WHERE id = ${handle.runId}
  `;
  await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${handle.runId}, ${handle.stepId}, ${`run.${input.status}`}, ${input.status}, ${input.summary},
            ${JSON.stringify(input.detail ?? {})}::jsonb)
  `;
}
