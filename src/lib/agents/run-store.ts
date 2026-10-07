import { sql, withTransaction } from "@/lib/data-store/connection";
import { safeJsonb, toISO } from "@/lib/pg-helpers";
import { getExecutionBackend } from "@/lib/execution-backend";
import { runDarwinVerify } from "@/lib/agents/darwin/verify";
import { runHamiltonCategoryGuard } from "@/lib/agents/hamilton/category-guard";
import { collapsePublishedDuplicates } from "@/lib/agents/hamilton/duplicate-collapse";
import { restoreFeesNowInTaxonomy, rollBackOffTaxonomyFees } from "@/lib/agents/hamilton/off-taxonomy-rollback";
import { rollBackLimitsPublishedAsFees } from "@/lib/agents/hamilton/limit-guard";
import { retireBusinessScheduleFees } from "@/lib/agents/hamilton/business-schedule";
import { retireArticlePageFees } from "@/lib/agents/hamilton/article-page";
import { recheckUncheckedRestores } from "@/lib/agents/hamilton/restore-recheck";
import { rollBackRetiredCompanionFees } from "@/lib/agents/hamilton/companion-retire";
import { restoreOutliersNowInRange, rollBackPublishedOutliers } from "@/lib/agents/hamilton/outlier-rollback";
import { rollBackUnreproducedFees } from "@/lib/agents/hamilton/rules-recheck";
import { syncPipelineFeedback } from "@/lib/agents/learning/feedback-sync";
import { linkImportedFeesToTwins, takeDownUntraceableFees } from "@/lib/agents/hamilton/source-check";
import { retireFeesDroppedFromNewerCopy } from "@/lib/agents/hamilton/newer-copy-retire";
import { moveRowsToIdenticalCopy, refreshFeesFromCurrentCopy } from "@/lib/agents/hamilton/refresh-copy";
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
import { runGuideDraft } from "@/lib/agents/guides/draft";
import { runKnoxExtract } from "@/lib/agents/knox/extract";
import { recheckHeldRates, recheckHeldRows, recheckPromotedRows } from "@/lib/agents/knox/held-recheck";
import { refreshFeeIndexCache } from "@/lib/data-store/fee-index";
import { runMagellanDiscovery } from "@/lib/agents/magellan/discovery";
import { runMagellanFetch } from "@/lib/agents/magellan/fetch";
import { recordLinkOutcomes } from "@/lib/agents/magellan/outcomes";
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
import { runDarwinAdjudicate } from "@/lib/agents/darwin/adjudicate";
import { runDailyBrief } from "@/lib/agents/daily-brief";
import { runFeeAlertDispatch, summarizeFeeAlertDispatch } from "@/lib/agents/fee-alerts";
import { runProDigest, summarizeProDigest } from "@/lib/agents/pro-digest";
import { runLeadWatch, summarizeLeadWatch } from "@/lib/leads/lead-alerts";
import { runAnswerKeyScore, summarizeAnswerKeyScore } from "@/lib/agents/answer-key-score";
import { runScoreboardSnapshot, summarizeScoreboard } from "@/lib/agents/scoreboard";
import { isStudyStep, runStudyStep, summarizeStudyStep } from "@/lib/agents/hamilton/studies";
import { assertAutomationEnabled, getAutomationControl, getPipelineControl } from "@/lib/automation-control";
import { normalizeStateCode, syncStateLaneProfiles } from "./state-lane-memory";
import { runStateExpertStep } from "./state-expert/step";
import { tallyByInstitution, type Sample } from "./flow-model";
import { runReportCloseStep, runReportRenderStep } from "@/lib/report-engine/render-job";
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
  MAX_STEP_ATTEMPTS,
  PAUSE_EXEMPT_STEP_KEYS,
  PROVIDER_STEP_KEYS,
  STALE_RUNNING_STEP_MINUTES,
} from "./types";

const ACTIVE_STATUSES = ["queued", "running", "cancel_requested"];
/** Category-guard rollbacks per publish step; a larger guard change comes down over several steps. */
const CATEGORY_GUARD_STEP_LIMIT = 100;
const RUN_KINDS_WITH_LEDGER = ["workflow", "workflow_lane", "state_agent", "report", "manual_repair", "dry_run"] as const;
const RUN_SUMMARY_MAX_LENGTH = 2_000;

type SqlTag = typeof sql;

/**
 * Every institution's totals for a fee step, so the live board's counts are the step's real
 * numbers rather than whatever fell into the ten sample rows. Capped to keep events small.
 */
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
  steps: AgentRunStepDefinition[];
  summary?: string;
}

export interface StartAgentRunResult {
  run: AgentRunSnapshot;
  steps: AgentRunStepSnapshot[];
  reused: boolean;
}

function requiredIso(value: unknown): string {
  return toISO(value as string | Date | null | undefined) ?? new Date(0).toISOString();
}

function optionalIso(value: unknown): string | null {
  return toISO(value as string | Date | null | undefined);
}

function safeRecord(value: unknown): Record<string, unknown> {
  const parsed = safeJsonb<Record<string, unknown>>(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function mapRun(row: Record<string, unknown>): AgentRunSnapshot {
  return {
    id: Number(row.id),
    agent: String(row.agent_name ?? "atlas") as AdminAgent,
    runKind: String(row.run_kind ?? "workflow") as AgentRunKind,
    title: String(row.title ?? "Agent run"),
    status: String(row.status ?? "queued") as AgentRunSnapshot["status"],
    startedAt: requiredIso(row.started_at),
    completedAt: optionalIso(row.completed_at),
    updatedAt: requiredIso(row.updated_at ?? row.started_at),
    triggerSource: String(row.trigger_source ?? "admin") as AgentRunTriggerSource,
    triggeredBy: row.triggered_by ? String(row.triggered_by) : null,
    correlationId: String(row.correlation_id ?? ""),
    backend: String(row.backend ?? "agentic_v1"),
    progressCurrent: Number(row.progress_current ?? 0),
    progressTotal: Number(row.progress_total ?? 0),
    currentStage: row.current_stage ? String(row.current_stage) : null,
    error: row.error_summary ? String(row.error_summary) : null,
    summary: row.summary ? String(row.summary) : null,
    params: safeRecord(row.params_json),
  };
}

function mapStep(row: Record<string, unknown>): AgentRunStepSnapshot {
  return {
    id: Number(row.id),
    runId: Number(row.agent_run_id),
    stepKey: String(row.step_key),
    agent: String(row.agent_name) as AdminAgent,
    title: String(row.title),
    input: safeRecord(row.input_payload),
    status: String(row.status) as AgentRunStepSnapshot["status"],
    sequence: Number(row.sequence ?? 0),
    summary: row.summary ? String(row.summary) : null,
    error: row.error_summary ? String(row.error_summary) : null,
    queuedAt: requiredIso(row.queued_at),
    startedAt: optionalIso(row.started_at),
    completedAt: optionalIso(row.completed_at),
    updatedAt: requiredIso(row.updated_at ?? row.queued_at),
  };
}

function mapEvent(row: Record<string, unknown>): AgentRunEventSnapshot {
  return {
    id: Number(row.id),
    runId: Number(row.agent_run_id),
    stepId: row.step_id == null ? null : Number(row.step_id),
    eventType: String(row.event_type),
    status: String(row.status),
    message: String(row.message),
    detail: safeRecord(row.detail),
    createdAt: requiredIso(row.created_at),
  };
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

function numericRunParam(
  params: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = params[key];
    if (value == null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** The lane's re-check mode (`recheck: 'quarterly'`), or null for a normal pass. */
export function laneRecheckParam(params: Record<string, unknown>): "quarterly" | null {
  return params.recheck === "quarterly" ? "quarterly" : null;
}

function stringRunParam(
  params: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
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
        stateCode,
      });
      // Outcome ledger: judge one slot of banks' links by the live fees they produced and
      // write the judgements to the shared learning store.
      const linkOutcomes = await recordLinkOutcomes(tx, {
        runId: run.id,
        stateCode,
        dryRun: run.runKind === "dry_run",
      });
      return {
        status: "completed",
        summary: `Magellan processed ${discovery.processed.toLocaleString()} institutions and discovered ${discovery.discovered.toLocaleString()} fee schedule URLs (${discovery.retryAfter.toLocaleString()} retry later, ${discovery.dead.toLocaleString()} no source, ${discovery.needsHuman.toLocaleString()} need human review).`,
        detail: {
          link_outcomes: linkOutcomes,
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
      });
      return {
        status: "completed",
        summary: `Magellan fetched ${fetched.succeeded.toLocaleString()} new source documents from ${fetched.processed.toLocaleString()} selected institutions (${fetched.unchanged.toLocaleString()} unchanged, ${fetched.failed.toLocaleString()} failed, ${fetched.skipped.toLocaleString()} skipped).`,
        detail: {
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
      return {
        status: "completed",
        summary: paid.budgetStopped && paid.processed === 0
          ? `Paid pass skipped: ${paid.budgetReason ?? "budget cap"}.`
          : `Paid pass: ${paid.succeeded.toLocaleString()} of ${paid.processed.toLocaleString()} succeeded for $${dollars}${paid.budgetStopped ? " (stopped at the budget cap)" : ""}.`,
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
      // Held percentage fees in categories that publish rates go to Darwin as rate fees.
      const rateRecheck = await recheckHeldRates(tx, {
        dryRun: run.runKind === "dry_run",
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
      });
      return {
        status: "completed",
        summary: `Knox extracted ${extraction.insertedFees.toLocaleString()} raw fee observations and ${extraction.freeFees.toLocaleString()} free fees from ${extraction.processedDocuments.toLocaleString()} Rosetta text artifacts (${extraction.extractedFees.toLocaleString()} candidates, ${extraction.skippedFees.toLocaleString()} skipped). Re-read ${heldRecheck.checked.toLocaleString()} held lines with today's rules: ${heldRecheck.promoted.toLocaleString()} categorized and sent to Darwin, ${heldRecheck.setAside.toLocaleString()} set aside (kept, logged), ${promotionRecheck.withdrawn.toLocaleString()} earlier promotions put back on hold. Re-read ${rateRecheck.checked.toLocaleString()} held percentage fees: ${rateRecheck.promoted.toLocaleString()} sent to Darwin as rates.`,
        detail: {
          held_recheck: heldRecheck,
          promotion_recheck: promotionRecheck,
          held_rate_recheck: rateRecheck,
          selected_text_artifacts: extraction.selectedDocuments,
          processed_text_artifacts: extraction.processedDocuments,
          extracted_fee_candidates: extraction.extractedFees,
          inserted_raw_fee_observations: extraction.insertedFees,
          inserted_free_fees: extraction.freeFees,
          skipped_fee_candidates: extraction.skippedFees,
          held_for_review: extraction.heldForReview,
          replaced_older_rows: extraction.retiredOlderRows,
          retired_older_copy_rows: extraction.retiredOlderCopyRows,
          skipped_known_inputs: extraction.skippedKnownInputs,
          outcomes: extraction.outcomes,
          learning_log: extraction.learning,
          lessons_loaded: extraction.lessonsLoaded,
          lesson_refiles: extraction.lessonRefiles,
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
      return {
        status: "completed",
        summary: `Darwin verified ${verification.verifiedFees.toLocaleString()} raw fee observations from ${verification.processedRawFees.toLocaleString()} selected rows (${verification.skippedFees.toLocaleString()} skipped).`,
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
          held_release: {
            selected: release.selected,
            acted: release.acted,
            verdicts: release.verdicts,
            released: release.released,
            feedback_written: release.feedbackWritten,
          },
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
        summary: `Knox decision queue checked: ${decisions.pending.toLocaleString()} pending human verdicts; ${decisions.confirmed.toLocaleString()} confirmed and ${decisions.overridden.toLocaleString()} overridden.`,
        detail: {
          pending_knox_decisions: decisions.pending,
          confirmed_knox_decisions: decisions.confirmed,
          overridden_knox_decisions: decisions.overridden,
          total_knox_decisions: decisions.total,
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
    case "publish":
    case "publish-index":
    case "publish-context": {
      // Lanes run side by side, and the outlier and duplicate sweeps below touch every
      // state's live rows. One publish step at a time keeps two sweeps from locking the
      // same rows in opposite orders; the lock ends with this step's transaction.
      await tx`SELECT pg_advisory_xact_lock(hashtext('agents.hamilton.publish'))`;
      const institutionId = numericRunParam(params, ["institution_id"]);
      // A takedown is never final: fees an earlier sweep took down come back once a range
      // widens or the taxonomy gains their category.
      const outlierRestores = await restoreOutliersNowInRange(tx, {
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        institutionId,
      });
      const offTaxonomyRestores = await restoreFeesNowInTaxonomy(tx, {
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        institutionId,
      });
      const outlierRollbacks = await rollBackPublishedOutliers(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
      });
      const offTaxonomyRollbacks = await rollBackOffTaxonomyFees(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
      });
      // A transfer or deposit limit read as a price ("Zelle® transfer limit | $1,000").
      const limitRollbacks = await rollBackLimitsPublishedAsFees(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
      });
      // A business schedule's fee beside the bank's consumer fee in the same category.
      const businessSchedule = await retireBusinessScheduleFees(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
      });
      // A fee read from an article (a blog post quoting a national average), not a schedule.
      const articlePage = await retireArticlePageFees(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
      });
      // A live fee whose own name contradicts its category (an ATM fee filed as a card's
      // foreign transaction fee, a rate's figure read as dollars) comes down each step, so
      // a guard change takes effect without anyone starting the repair run by hand.
      const categoryGuard = await runHamiltonCategoryGuard({
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        limit: CATEGORY_GUARD_STEP_LIMIT,
        institutionId,
        db: tx,
      });
      const categoryGuardRollbacks = categoryGuard.dryRun
        ? Math.min(categoryGuard.failingFees, categoryGuard.limit)
        : categoryGuard.rolledBackFees;
      // Fees read from companion pages Magellan has since retired (a HELOC PDF, a
      // derivatives notice) come down before anything new publishes.
      const companionRetire = await rollBackRetiredCompanionFees(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
        stateCode,
      });
      const companionRollbacks = companionRetire.rollbacks;
      const duplicateCollapses = await collapsePublishedDuplicates(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
      });
      // A fee line the bank removed from a newer copy of its page comes down (shadow
      // mode until NEWER_COPY_RETIRE_LIVE is turned on: it reports and changes nothing).
      const newerCopy = await retireFeesDroppedFromNewerCopy(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
        stateCode,
      });
      const newerCopyRetired = newerCopy.live ? newerCopy.retired.length : 0;
      const newerCopyRestored = newerCopy.live ? newerCopy.restored : 0;
      // A current copy whose text is identical to the superseded one has no rows of its
      // own (Knox skips text it has read), so the superseded copy's rows move to it.
      const identicalCopy = await moveRowsToIdenticalCopy(tx, {
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        institutionId,
      });
      // A live fee the current copy of its page still states at the same amount moves to
      // that copy, so it no longer points at a superseded copy and its date is current.
      const refreshCopy = await refreshFeesFromCurrentCopy(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
        stateCode,
      });
      // A live fee the current copy does not restate at its price is read against the
      // current copy's text; one it no longer states comes down only on a second look.
      const currentCopy = await secondLookFeesNotOnCurrentCopy(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
        stateCode,
      });
      // State lanes re-check their live Knox fees against today's rules, a batch of
      // documents per step, once per Knox version.
      const rulesRecheck = stateCode || institutionId
        ? await rollBackUnreproducedFees(tx, {
            runId: run.id,
            batchId: `agentic-run-${run.id}`,
            dryRun: run.runKind === "dry_run",
            institutionId,
            stateCode,
          })
        : null;
      const recheckRollbacks = rulesRecheck?.rollbacks.length ?? 0;
      // Fees an older re-check restored with no check at all get the restore bar on a second look.
      const restoreRecheck = await recheckUncheckedRestores(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
      });
      const recheckRestores = rulesRecheck?.restores.length ?? 0;
      const published = await runHamiltonPublish({
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
        db: tx,
      });
      // Every live fee must be stated in the bank's own stored schedule: every publish
      // step source-checks a batch of institutions (its state's or institution's when it
      // has one, any state's otherwise) after publishing, so fees published in this step
      // are checked too.
      const sourceCheck = await takeDownUntraceableFees(tx, {
        runId: run.id,
        batchId: `agentic-run-${run.id}`,
        dryRun: run.runKind === "dry_run",
        institutionId,
        stateCode,
      });
      const sourceTakedowns = sourceCheck?.takedowns.length ?? 0;
      // Imported fees with no document take their schedule through an identical imported
      // row the source check could not relink them past.
      const importedTwins = await linkImportedFeesToTwins(tx, {
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        institutionId,
      });
      // Every agent learns from what happened to its output: this step's takedowns and
      // restores (and a batch of older outcomes) go into the shared learning store.
      const feedbackSync = await syncPipelineFeedback(tx, { runId: run.id, dryRun: run.runKind === "dry_run" });
      const indexRefresh = published.dryRun
        ? null
        : await refreshFeeIndexCache(tx, {
            runId: run.id,
            force:
              published.publishedFees > 0 ||
              outlierRollbacks.length > 0 ||
              offTaxonomyRollbacks.length > 0 ||
              outlierRestores.length > 0 ||
              offTaxonomyRestores.length > 0 ||
              limitRollbacks.length > 0 ||
              businessSchedule.rolledBack.length > 0 ||
              businessSchedule.restored > 0 ||
              articlePage.rolledBack.length > 0 ||
              categoryGuardRollbacks > 0 ||
              companionRollbacks.length > 0 ||
              duplicateCollapses.length > 0 ||
              newerCopyRetired > 0 ||
              newerCopyRestored > 0 ||
              currentCopy.takenDown.length > 0 ||
              recheckRollbacks > 0 ||
              recheckRestores > 0 ||
              restoreRecheck.rolledBack.length > 0 ||
              sourceTakedowns > 0 ||
              (sourceCheck?.restored ?? 0) > 0,
          });
      const outlierNote =
        outlierRollbacks.length > 0
          ? ` ${published.dryRun ? "Would roll back" : "Rolled back"} ${outlierRollbacks.length.toLocaleString()} live fee(s) outside their category range.`
          : "";
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
      const restoreRecheckNote =
        restoreRecheck.failing.length > 0 || restoreRecheck.passing > 0
          ? ` Second look on ${restoreRecheck.unchecked.toLocaleString()} unchecked restore(s): ${restoreRecheck.passing.toLocaleString()} clear the restore bar, ${restoreRecheck.failing.length.toLocaleString()} fail it, ${restoreRecheck.rolledBack.length.toLocaleString()} ${published.dryRun ? "would be archived" : "archived"}.`
          : "";
      const articleNote =
        articlePage.rolledBack.length > 0
          ? ` ${published.dryRun ? "Would archive" : "Archived"} ${articlePage.rolledBack.length.toLocaleString()} fee(s) read from an article page, not a fee schedule.`
          : "";
      const categoryGuardNote =
        categoryGuardRollbacks > 0
          ? ` ${published.dryRun ? "Would roll back" : "Rolled back"} ${categoryGuardRollbacks.toLocaleString()} live fee(s) whose name contradicts their category.`
          : "";
      const companionNote =
        companionRollbacks.length > 0
          ? ` ${published.dryRun ? "Would roll back" : "Rolled back"} ${companionRollbacks.length.toLocaleString()} live fee(s) read from pages that are not consumer fee pages (loan or HELOC documents).`
          : "";
      const recheckNote =
        (recheckRollbacks > 0
          ? ` ${published.dryRun ? "Would roll back" : "Rolled back"} ${recheckRollbacks.toLocaleString()} live fee(s) today's Knox rules no longer read from their document.`
          : "") +
        (recheckRestores > 0
          ? ` ${published.dryRun ? "Would restore" : "Restored"} ${recheckRestores.toLocaleString()} earlier re-check takedown(s) today's Knox rules read again.`
          : "");
      const sourceNote =
        sourceTakedowns > 0 || (sourceCheck?.relinked ?? 0) > 0 || (sourceCheck?.restored ?? 0) > 0
          ? ` Source check: ${published.dryRun ? "would take down" : "took down"} ${sourceTakedowns.toLocaleString()} live fee(s) not stated in the bank's stored schedule${sourceCheck?.relinked ? `, relinked ${sourceCheck.relinked.toLocaleString()} to a stored schedule` : ""}${sourceCheck?.restored ? `, ${published.dryRun ? "would restore" : "restored"} ${sourceCheck.restored.toLocaleString()} earlier takedown(s) that now trace` : ""}.`
          : "";
      const newerCopyNote =
        newerCopyRetired > 0 || newerCopyRestored > 0
          ? ` ${published.dryRun ? "Would retire" : "Retired"} ${newerCopyRetired.toLocaleString()} live fee(s) whose line is gone from a newer copy of the page${newerCopyRestored > 0 ? ` and ${published.dryRun ? "would restore" : "restored"} ${newerCopyRestored.toLocaleString()} a later copy states again` : ""}.`
          : "";
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
      return {
        status: "completed",
        summary: `Hamilton published ${published.publishedFees.toLocaleString()} verified fee observations from ${published.processedVerifiedFees.toLocaleString()} selected rows (${published.skippedFees.toLocaleString()} skipped).${published.heldInstitutions.length > 0 ? ` Held ${published.heldFees.toLocaleString()} rows from ${published.heldInstitutions.length.toLocaleString()} institutions with fewer than ${published.minInstitutionFees} fees.` : ""}${outlierNote}${offTaxonomyNote}${limitNote}${businessNote}${articleNote}${categoryGuardNote}${companionNote}${newerCopyNote}${refreshNote}${currentCopyNote}${recheckNote}${restoreRecheckNote}${sourceNote}${duplicateNote}${indexRefresh?.refreshed ? ` Index refreshed: ${indexRefresh.categories} categories.` : ""}`,
        detail: {
          selected_verified_fees: published.selectedVerifiedFees,
          processed_verified_fees: published.processedVerifiedFees,
          published_fees: published.publishedFees,
          skipped_verified_fees: published.skippedFees,
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
          restore_recheck: {
            unchecked: restoreRecheck.unchecked,
            without_text: restoreRecheck.withoutText,
            passing: restoreRecheck.passing,
            failing: restoreRecheck.failing.length,
            flagged: restoreRecheck.flagged,
            waiting: restoreRecheck.waiting,
            rolled_back: restoreRecheck.rolledBack.length,
          },
          article_page: {
            article_fees: articlePage.articleFees,
            flagged: articlePage.flagged,
            waiting: articlePage.waiting,
            rolled_back: articlePage.rolledBack.length,
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
          category_guard_rollbacks: categoryGuardRollbacks,
          category_guard_failing: categoryGuard.failingFees,
          category_guard_version: categoryGuard.guardVersion,
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
          identical_copy_documents: identicalCopy.documents,
          identical_copy_rows_moved: identicalCopy.rowsMoved,
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
          rules_recheck_restores: recheckRestores,
          rules_recheck_samples: (rulesRecheck?.rollbacks ?? []).slice(0, 10).map((rollback) => ({
            fee_published_id: rollback.feePublishedId,
            institution_id: rollback.institutionId,
            source_document_id: rollback.sourceDocumentId,
            canonical_fee_key: rollback.canonicalFeeKey,
            fee_name: rollback.feeName,
            amount: rollback.amount,
          })),
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
          duplicate_collapses: duplicateCollapses.length,
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
      const indexRefresh = guard.rolledBackFees > 0
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
    case "pro-digest": {
      const result = await runProDigest({ dryRun: run.runKind === "dry_run" });
      return {
        status: "completed",
        summary: summarizeProDigest(result),
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
    case "score-answer-key": {
      const result = await runAnswerKeyScore({ runId: run.id, dryRun: run.runKind === "dry_run", db: tx });
      const score = result.score;
      return {
        status: "completed",
        summary: summarizeAnswerKeyScore(result),
        detail: {
          schema_ready: result.schemaReady,
          score_run_id: result.scoreRunId,
          scorer_version: score?.scorerVersion ?? null,
          banks_scored: score?.banksScored ?? 0,
          fees_expected: score?.feesExpected ?? 0,
          precision: score?.overall.precision ?? null,
          recall: score?.overall.recall ?? null,
          by_stage: score?.byStage ?? {},
          by_document_type: score?.byDocumentType ?? {},
          by_category: score?.byCategory ?? {},
          dry_run: result.dryRun,
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

async function prepareNextAgenticStep(runId: number): Promise<
  | { kind: "ready"; prepared: PreparedAgenticStep }
  | { kind: "missing" }
  | { kind: "terminal"; status: AgentRunStatus; message: string }
  | { kind: "busy"; status: AgentRunStatus; message: string }
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
         ${JSON.stringify({ step_key: step.stepKey, agent: step.agent })}::jsonb)
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
}: { staleAfterMinutes?: number; maxAttempts?: number } = {}): Promise<ReapStaleAgentStepsResult> {
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
             ${JSON.stringify({ step_key: stepKey, attempts: attempt, reaper: true })}::jsonb)
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
 * About the longest each step runs (p99 over 3 days on prod, 2026-10-07, rounded up). A
 * step starts only when it can finish by the caller's deadline, so a short step can use
 * the end of a tick that a long one could not.
 */
const STEP_EXPECTED_MS: Record<string, number> = {
  "discover-paid": 200_000,
  "registry-cfpb": 180_000,
  "read-paid": 165_000,
  read: 110_000,
  discover: 110_000,
  "report-render": 110_000,
  rescue: 110_000,
  "extract-paid": 80_000,
  "verify-paid": 80_000,
  fetch: 60_000,
  extract: 40_000,
  publish: 30_000,
  classify: 25_000,
};
/** Steps not listed above: most run in seconds, so this keeps an unknown long one safe. */
const DEFAULT_STEP_EXPECTED_MS = 120_000;
/** Steps measured at a few seconds at most (state-expert, enhance, public-*, registry-*). */
const QUICK_STEP_EXPECTED_MS = 30_000;
const QUICK_STEP_PREFIXES = ["registry-", "public-", "state-expert", "enhance", "lead-watch", "category-guard"];

export function expectedStepMs(stepKey: string | null): number {
  if (!stepKey) return DEFAULT_STEP_EXPECTED_MS;
  if (stepKey in STEP_EXPECTED_MS) return STEP_EXPECTED_MS[stepKey];
  if (QUICK_STEP_PREFIXES.some((prefix) => stepKey.startsWith(prefix))) return QUICK_STEP_EXPECTED_MS;
  return DEFAULT_STEP_EXPECTED_MS;
}

export async function executeAgentRun(
  runId: number,
  options: {
    maxSteps?: number;
    allowProviderSteps?: boolean;
    /** Epoch ms by which a started step should finish; see STEP_EXPECTED_MS. */
    deadlineAt?: number;
    /** False for later runs in a tick: then even the first step waits for the deadline. */
    alwaysRunFirstStep?: boolean;
    /** Leave a paid step queued for a later tick instead of running or skipping it. */
    deferProviderSteps?: boolean;
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

  // Deterministic work is paused only by the pipeline control. A paused run stays
  // queued (never terminal) so it resumes on its own when the pipeline is re-enabled.
  const pipeline = await getPipelineControl();
  const firstQueuedStep = pipeline.enabled ? null : await peekNextQueuedStepKey(runId);
  if (!pipeline.enabled && !(firstQueuedStep && PAUSE_EXEMPT_STEP_KEYS.includes(firstQueuedStep))) {
    return {
      runId,
      status: existing.status,
      terminal: false,
      executedSteps: 0,
      message: `Pipeline is paused${pipeline.reason ? `: ${pipeline.reason}` : ""}; run left queued.`,
    };
  }

  const maxSteps = Math.min(Math.max(Math.floor(options.maxSteps ?? 1), 1), 10);
  let executedSteps = 0;
  let lastResult: AgentRunExecutionResult | null = null;

  for (let index = 0; index < maxSteps; index += 1) {
    // A step that could not finish by the caller's deadline waits for the next tick; the
    // run stays queued. The tick's first step always runs so a late tick still progresses.
    const nextStepKey = await peekNextQueuedStepKey(runId);
    const firstOfTick = index === 0 && (options.alwaysRunFirstStep ?? true);
    if (!firstOfTick && options.deadlineAt != null
      && Date.now() + expectedStepMs(nextStepKey) > options.deadlineAt) break;
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
        const blocked = await prepareNextAgenticStep(runId);
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

    const prepared = await prepareNextAgenticStep(runId);
    if (prepared.kind === "missing") {
      return {
        runId,
        status: "missing",
        terminal: true,
        executedSteps,
        message: "Agent run not found.",
      };
    }
    if (prepared.kind === "terminal" || prepared.kind === "busy") {
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
}: {
  runLimit?: number;
  maxStepsPerRun?: number;
  allowProviderSteps?: boolean;
  budgetPolicyId?: number | null;
  maxProviderCallsPerRun?: number | null;
  maxEstimatedCostMicrousd?: number | null;
  /**
   * Runs that may take paid steps this tick; later runs do only free steps and leave
   * their next paid step queued. Null means every run may.
   */
  providerRunLimit?: number | null;
  /** Epoch ms by which started steps should finish (the first run still gets its first step). */
  deadlineAt?: number;
} = {}): Promise<ExecuteQueuedAgentRunsResult> {
  const safeRunLimit = Math.min(Math.max(Math.floor(runLimit), 1), 10);
  // When provider steps cannot run this tick, skip runs whose next queued step is a
  // provider step so they do not crowd deterministic work out of the run limit.
  const rows = await sql`
    SELECT r.id
      FROM agent_runs r
      LEFT JOIN agent_state_lanes lane
        ON r.run_kind = 'workflow_lane' AND lane.state_code = upper(btrim(r.state_code))
     WHERE r.run_kind = ANY(${[...RUN_KINDS_WITH_LEDGER]})
       AND r.status = 'queued'
       AND (
         ${allowProviderSteps}
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
     -- Report runs go first: someone pressed Generate and is watching the page. Then a
     -- run already under way finishes before a new one starts, then a retry of a failed
     -- state lane, then a lane with a hand-found schedule to fetch, then any run waiting
     -- over an hour, then state lanes by Atlas's priority score (open work, report
     -- requests, near-ready markets), then launch order.
     ORDER BY (r.run_kind = 'report') DESC,
              EXISTS (
                SELECT 1 FROM agent_run_steps done
                 WHERE done.agent_run_id = r.id AND done.status <> 'queued'
              ) DESC,
              -- A state whose last finished lane run failed retries ahead of routine passes.
              (r.run_kind = 'workflow_lane' AND (
                SELECT prior.status FROM agent_runs prior
                 WHERE prior.run_kind = 'workflow_lane'
                   AND upper(btrim(prior.state_code)) = upper(btrim(r.state_code))
                   AND prior.id < r.id
                   AND prior.status IN ('completed', 'failed')
                 ORDER BY prior.id DESC LIMIT 1
              ) = 'failed') DESC,
              -- A state holding a fee schedule found by hand (Magellan's operator list) that
              -- has not been fetched yet goes next, so those links don't wait behind routine
              -- passes. The lane's own fetch, read and extract steps then pick it up.
              (r.run_kind = 'workflow_lane' AND EXISTS (
                SELECT 1 FROM institution_additional_sources hand
                  JOIN institution_sources inst ON inst.id = hand.institution_id
                 WHERE hand.found_by_strategy = 'discover.operator_schedule'
                   AND hand.status = 'found'
                   AND upper(btrim(inst.state_code)) = upper(btrim(r.state_code))
              )) DESC,
              (r.started_at < NOW() - INTERVAL '1 hour') DESC,
              COALESCE(lane.priority_score, 0) DESC,
              r.started_at ASC, r.id ASC
     LIMIT ${safeRunLimit}
  `;
  // Runs advance one after another. Running state lanes side by side held several
  // step transactions open at once (publish steps queue on one advisory lock while
  // holding theirs), which starved the shared database and slowed the public site and
  // admin to a crawl. The tick deadline still bounds how much work one tick does.
  const results: AgentRunExecutionResult[] = [];
  let providerRuns = 0;
  for (const row of rows) {
    // The first run always gets a step; a later run starts a step only when that step can
    // finish by the deadline, so a larger run limit fills the tick without running past it.
    if (results.length > 0 && deadlineAt != null && Date.now() + QUICK_STEP_EXPECTED_MS > deadlineAt) break;
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
    results.push(
      await executeAgentRun(runId, {
        maxSteps: maxStepsPerRun,
        allowProviderSteps,
        deadlineAt,
        alwaysRunFirstStep: results.length === 0,
        deferProviderSteps: allowProviderSteps && !providerSlot,
      }),
    );
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

  if (input.idempotencyKey) {
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

