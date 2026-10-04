import { sql, withTransaction } from "@/lib/data-store/connection";
import { safeJsonb, toISO } from "@/lib/pg-helpers";
import { getExecutionBackend } from "@/lib/execution-backend";
import { runDarwinVerify } from "@/lib/agents/darwin/verify";
import { runHamiltonPublish } from "@/lib/agents/hamilton/publish";
import { runGuideDraft } from "@/lib/agents/guides/draft";
import { runKnoxExtract } from "@/lib/agents/knox/extract";
import { refreshFeeIndexCache } from "@/lib/data-store/fee-index";
import { runMagellanDiscovery } from "@/lib/agents/magellan/discovery";
import { runMagellanFetch } from "@/lib/agents/magellan/fetch";
import { isRegistryStepKey, runRegistryStep } from "@/lib/agents/magellan/registry";
import {
  clusterPublicDiscoveryFindings,
  runPublicDiscoveryAudit,
  summarizePublicDiscoveryDiagnosis,
} from "@/lib/agents/public-discovery";
import { runRosettaRead } from "@/lib/agents/rosetta/read";
import { runDailyBrief } from "@/lib/agents/daily-brief";
import { runFeeAlertDispatch, summarizeFeeAlertDispatch } from "@/lib/agents/fee-alerts";
import { assertAutomationEnabled, getAutomationControl, getPipelineControl } from "@/lib/automation-control";
import { normalizeStateCode, syncStateLaneProfiles } from "./state-lane-memory";
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
const RUN_KINDS_WITH_LEDGER = ["workflow", "workflow_lane", "state_agent", "report", "manual_repair", "dry_run"] as const;
const AGENTIC_SUMMARY =
  "Agentic run advanced through the TypeScript run ledger with committed step events. Magellan can reduce missing fee URLs, fetch source documents, and inventory public discovery routes; Rosetta can normalize HTML/text/PDF source documents and route scanned PDFs to OCR; Knox can extract conservative raw fee observations and classify public page findings; Darwin can verify canonical-hinted raw rows and cluster public findings; Hamilton can publish eligible verified rows into the Tier-3 ledger and summarize public discovery diagnosis. Durable queues, scanned-PDF OCR, provider extraction, browser-render screenshots, and adversarial review depth remain gated until each agent module is implemented.";

type SqlTag = typeof sql;

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
    case "discover":
    case "rescue": {
      const discovery = await runMagellanDiscovery({
        runId: run.id,
        mode: step.stepKey === "rescue" ? "rescue" : "discover",
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["discovery_limit", "rescue_limit", "limit", "size"]),
        stateCode,
      });
      return {
        status: "completed",
        summary: `Magellan processed ${discovery.processed.toLocaleString()} institutions and discovered ${discovery.discovered.toLocaleString()} fee schedule URLs (${discovery.retryAfter.toLocaleString()} retry later, ${discovery.dead.toLocaleString()} no source, ${discovery.needsHuman.toLocaleString()} need human review).`,
        detail: {
          selected_institutions: discovery.selected,
          processed_institutions: discovery.processed,
          discovered_fee_urls: discovery.discovered,
          dead_institutions: discovery.dead,
          needs_human: discovery.needsHuman,
          retry_after: discovery.retryAfter,
          failures: discovery.failures,
          attempted_urls: discovery.attemptedUrls,
          discovery_limit: discovery.limit,
          dry_run: discovery.dryRun,
          sample_results: discovery.results.slice(0, 10).map((result) => ({
            institution_id: result.institutionId,
            outcome: result.outcome,
            url: result.url,
            confidence: result.confidence,
            reason: result.reason,
          })),
        },
      };
    }
    case "fetch": {
      const fetched = await runMagellanFetch({
        runId: run.id,
        stepId: step.id,
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["fetch_limit", "limit", "size"]),
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
      });
      return {
        status: "completed",
        summary: `Magellan fetched ${fetched.succeeded.toLocaleString()} new source documents from ${fetched.processed.toLocaleString()} selected institutions (${fetched.unchanged.toLocaleString()} unchanged, ${fetched.failed.toLocaleString()} failed, ${fetched.skipped.toLocaleString()} skipped).`,
        detail: {
          selected_institutions: fetched.selected,
          processed_institutions: fetched.processed,
          fetched_documents: fetched.succeeded,
          unchanged_documents: fetched.unchanged,
          stored_documents: fetched.storedDocuments,
          vault: fetched.vault,
          failed_fetches: fetched.failed,
          skipped_fetches: fetched.skipped,
          fetched_bytes: fetched.bytes,
          fetch_limit: fetched.limit,
          dry_run: fetched.dryRun,
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
          triaged_texts: read.triagedTexts,
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
      return {
        status: "completed",
        summary: `Knox extracted ${extraction.insertedFees.toLocaleString()} raw fee observations from ${extraction.processedDocuments.toLocaleString()} Rosetta text artifacts (${extraction.extractedFees.toLocaleString()} candidates, ${extraction.skippedFees.toLocaleString()} skipped).`,
        detail: {
          selected_text_artifacts: extraction.selectedDocuments,
          processed_text_artifacts: extraction.processedDocuments,
          extracted_fee_candidates: extraction.extractedFees,
          inserted_raw_fee_observations: extraction.insertedFees,
          skipped_fee_candidates: extraction.skippedFees,
          skipped_known_inputs: extraction.skippedKnownInputs,
          outcomes: extraction.outcomes,
          learning_log: extraction.learning,
          extract_limit: extraction.limit,
          dry_run: extraction.dryRun,
          sample_results: extraction.results.slice(0, 10).map((result) => ({
            document_text_id: result.documentTextId,
            source_document_id: result.sourceDocumentId,
            institution_id: result.institutionId,
            source_url: result.sourceUrl,
            extracted: result.extracted,
            inserted: result.inserted,
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
      return {
        status: "completed",
        summary: `Darwin verified ${verification.verifiedFees.toLocaleString()} raw fee observations from ${verification.processedRawFees.toLocaleString()} selected rows (${verification.skippedFees.toLocaleString()} skipped).`,
        detail: {
          selected_raw_fees: verification.selectedRawFees,
          processed_raw_fees: verification.processedRawFees,
          verified_fee_observations: verification.verifiedFees,
          skipped_raw_fees: verification.skippedFees,
          outcomes: verification.outcomes,
          learning_log: verification.learning,
          verify_limit: verification.limit,
          dry_run: verification.dryRun,
          sample_results: verification.results.slice(0, 10).map((result) => ({
            fee_raw_id: result.feeRawId,
            institution_id: result.institutionId,
            fee_name: result.feeName,
            amount: result.amount,
            canonical_fee_key: result.canonicalFeeKey,
            status: result.status,
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
      const published = await runHamiltonPublish({
        runId: run.id,
        dryRun: run.runKind === "dry_run",
        limit: numericRunParam(params, ["publish_limit", "limit", "size"]),
        institutionId: numericRunParam(params, ["institution_id"]),
        stateCode,
        minConfidence: numericRunParam(params, [
          "publish_min_confidence",
          "min_confidence",
          "confidence_threshold",
        ]),
        db: tx,
      });
      const indexRefresh = published.dryRun
        ? null
        : await refreshFeeIndexCache(tx, { runId: run.id, force: published.publishedFees > 0 });
      return {
        status: "completed",
        summary: `Hamilton published ${published.publishedFees.toLocaleString()} verified fee observations from ${published.processedVerifiedFees.toLocaleString()} selected rows (${published.skippedFees.toLocaleString()} skipped).${indexRefresh?.refreshed ? ` Index refreshed: ${indexRefresh.categories} categories.` : ""}`,
        detail: {
          selected_verified_fees: published.selectedVerifiedFees,
          processed_verified_fees: published.processedVerifiedFees,
          published_fees: published.publishedFees,
          skipped_verified_fees: published.skippedFees,
          publish_limit: published.limit,
          publish_min_confidence: published.minConfidence,
          publish_batch_id: published.batchId,
          dry_run: published.dryRun,
          index_refreshed: indexRefresh?.refreshed ?? false,
          index_categories: indexRefresh?.categories ?? 0,
          sample_results: published.results.slice(0, 10).map((result) => ({
            fee_verified_id: result.feeVerifiedId,
            institution_id: result.institutionId,
            fee_name: result.feeName,
            amount: result.amount,
            canonical_fee_key: result.canonicalFeeKey,
            status: result.status,
            reason: result.reason,
            fee_published_id: result.feePublishedId,
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
          ? `Atlas emailed the daily brief to ${result.recipient}.`
          : `Atlas wrote the daily brief but did not email it: ${result.deliveryReason ?? result.deliveryStatus}.`,
        detail: {
          delivery_status: result.deliveryStatus,
          delivery_reason: result.deliveryReason,
          subject: result.brief.subject,
          lines: result.brief.lines,
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
    case "assemble":
    case "render": {
      return {
        status: "completed",
        summary: `${step.title} acknowledged for run #${run.id}; report rendering worker remains a dedicated follow-up.`,
        detail: { report_worker_pending: true },
      };
    }
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
      await tx`
        UPDATE agent_runs
           SET status = 'completed',
               progress_current = ${steps.filter((candidate) => candidate.status === "completed" || candidate.status === "skipped").length},
               progress_total = ${steps.length},
               current_stage = NULL,
               summary = COALESCE(summary, ${AGENTIC_SUMMARY}),
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

    await tx`
      UPDATE agent_runs
         SET status = 'completed',
             progress_current = ${completed},
             progress_total = ${total},
             current_stage = NULL,
             summary = ${AGENTIC_SUMMARY},
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
         ${AGENTIC_SUMMARY},
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
             next_run_after = CASE
               WHEN ${status} = 'completed' THEN NOW() + (lane.freshness_target_hours * INTERVAL '1 hour')
               ELSE NOW() + INTERVAL '1 hour'
             END,
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

export async function executeAgentRun(
  runId: number,
  options: { maxSteps?: number; allowProviderSteps?: boolean } = {},
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
    // Provider steps (paid model calls) additionally require the global automation
    // stop to be clear and the caller to have provider budget for this tick.
    const nextStepKey = await peekNextQueuedStepKey(runId);
    if (nextStepKey && isProviderStep(nextStepKey)) {
      const gate = await providerStepGate(options.allowProviderSteps ?? true);
      if (!gate.allowed) {
        return {
          runId,
          status: lastResult?.status ?? existing.status,
          terminal: false,
          executedSteps,
          message: `Provider step "${nextStepKey}" is waiting: ${gate.reason}`,
        };
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
}: {
  runLimit?: number;
  maxStepsPerRun?: number;
  allowProviderSteps?: boolean;
  budgetPolicyId?: number | null;
  maxProviderCallsPerRun?: number | null;
  maxEstimatedCostMicrousd?: number | null;
} = {}): Promise<ExecuteQueuedAgentRunsResult> {
  const safeRunLimit = Math.min(Math.max(Math.floor(runLimit), 1), 10);
  // When provider steps cannot run this tick, skip runs whose next queued step is a
  // provider step so they do not crowd deterministic work out of the run limit.
  const rows = await sql`
    SELECT r.id
      FROM agent_runs r
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
     ORDER BY r.started_at ASC, r.id ASC
     LIMIT ${safeRunLimit}
  `;
  const results: AgentRunExecutionResult[] = [];
  for (const row of rows) {
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
    results.push(await executeAgentRun(runId, { maxSteps: maxStepsPerRun, allowProviderSteps }));
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
  // Runs that include a provider step are blocked at launch while the provider
  // automation stop is active, so no paid work is queued behind a stop.
  try {
    if (input.steps.some((step) => isProviderStep(step.key))) {
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

export type ProRequestOperation = "report" | "thesis" | "simulate_interpretation";

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

