import { sql } from "./data-store/connection";
import {
  findOpenProviderCreditFailure,
  getAutomationControl,
  getPipelineControl,
  type AutomationControlState,
} from "./automation-control";
import { getJobFreshness, getSourceSubmissionCounts } from "./admin-queries";
import { getKnoxReviewCounts } from "./data-store/knox-reviews";
import type { AdminAgent, AgentRunStatus } from "./agents/types";
import { toISO } from "./pg-helpers";
import { hasAnthropicApiKey } from "./ai-provider";
import { formatAdminDateTime } from "./admin-time";

export interface CoverageMetric {
  value: number;
  numerator: number;
  denominator: number;
  definition: string;
}

export interface CommandCenterJob {
  id: number;
  agent: AdminAgent;
  command: string;
  args: string[];
  status: AgentRunStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  heartbeatAt: string | null;
  updatedAt: string | null;
  backendReceipt: string | null;
  error: string | null;
  progress: string | null;
  stdoutTail: string | null;
  pipelineRunId: number | null;
}

export interface AttentionItem {
  id: string;
  severity: "critical" | "warning" | "work";
  owner: AdminAgent;
  title: string;
  detail: string;
  href: string;
  action: string;
  repairRunId?: number;
}

export interface AtlasCommandCenter {
  generatedAt: string;
  metrics: {
    eligible: number;
    url: CoverageMetric;
    verified: CoverageMetric;
    fresh: CoverageMetric;
  };
  schedules: Awaited<ReturnType<typeof getJobFreshness>>;
  activeJobs: CommandCenterJob[];
  recentJobs: CommandCenterJob[];
  attention: AttentionItem[];
  automation: AutomationControlState;
  pipeline: AutomationControlState;
  provider: ProviderReadiness;
  trustReview: TrustReviewOverview;
  apiUsage: ApiUsageOverview;
  agentHealth: AgentFailureOverview;
}

export interface TrustReviewOverview {
  sourceSubmissionsPending: number;
  totalPending: number;
}

export interface ProviderReadiness {
  provider: "anthropic";
  apiKeyConfigured: boolean;
  status: "ready" | "missing_key" | "automation_stopped" | "circuit_open";
  label: string;
  detail: string;
  lastCreditFailureAt: string | null;
}

export interface ApiUsageBreakdown {
  provider: string;
  model: string;
  agent: string;
  calls: number;
  tokens: number;
  failures: number;
  blocked: number;
  lastSeenAt: string | null;
  lastStatus: string | null;
  lastOperation: string | null;
  estimatedCostMicrousd: number;
}

export interface ApiUsageFailure {
  id: number;
  provider: string;
  model: string;
  agent: string;
  operation: string;
  status: string;
  error: string;
  createdAt: string;
}

export interface ApiUsageOverview {
  callsToday: number;
  calls30d: number;
  inputTokens30d: number;
  outputTokens30d: number;
  failures30d: number;
  blocked30d: number;
  estimatedCostMicrousd30d: number;
  clientApiRequests30d: number;
  firstTrackedAt: string | null;
  breakdown: ApiUsageBreakdown[];
  recentFailures: ApiUsageFailure[];
}

export interface AgentFailureGroup {
  agent: string;
  tool: string;
  error: string;
  occurrences: number;
  lastSeenAt: string;
}

export interface AgentFailureOverview {
  errors24h: number;
  affectedAgents24h: number;
  groups: AgentFailureGroup[];
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function requiredISO(value: string | Date | null | undefined): string {
  return toISO(value) ?? new Date(0).toISOString();
}

function operatorError(error: unknown): string {
  const message = String(error ?? "").trim();
  if (!message) return "No error detail recorded.";
  if (/credit balance is too low/i.test(message) && /anthropic/i.test(message)) {
    return "Anthropic credit balance is too low. Automation is stopped until billing is fixed or this route is moved to another provider.";
  }
  if (/credit balance is too low/i.test(message)) {
    return "Provider credit balance is too low. Automation is stopped until billing is fixed or this route is moved to another provider.";
  }
  return message.replace(/\s+/g, " ").slice(0, 500);
}

export function buildProviderReadiness(
  automation: AutomationControlState,
  creditFailure: { createdAt: string } | null,
): ProviderReadiness {
  const apiKeyConfigured = hasAnthropicApiKey();

  if (!apiKeyConfigured) {
    return {
      provider: "anthropic",
      apiKeyConfigured,
      status: "missing_key",
      label: "Anthropic API key missing",
      detail: "Set ANTHROPIC_API_KEY in the server environment, then restart/redeploy before provider-backed agent work can run.",
      lastCreditFailureAt: null,
    };
  }

  if (!automation.enabled) {
    return {
      provider: "anthropic",
      apiKeyConfigured,
      status: "automation_stopped",
      label: "Provider key configured, automation stopped",
      detail: automation.reason ?? "Provider calls are blocked by the global automation safety control.",
      lastCreditFailureAt: creditFailure?.createdAt ?? null,
    };
  }

  if (creditFailure) {
    return {
      provider: "anthropic",
      apiKeyConfigured,
      status: "circuit_open",
      label: "Provider circuit needs attention",
      detail: "A recent Anthropic billing or credit failure is holding provider-backed work. Update billing/API access, then resume automation.",
      lastCreditFailureAt: creditFailure.createdAt,
    };
  }

  return {
    provider: "anthropic",
    apiKeyConfigured,
    status: "ready",
    label: "Provider key configured",
    detail: "ANTHROPIC_API_KEY is present and no recent credit circuit is blocking provider-backed work. The key is validated on the next guarded provider call.",
    lastCreditFailureAt: null,
  };
}

function parseJobArgs(params: unknown): string[] {
  let value = params;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== "object" || !("args" in value)) return [];
  const args = (value as { args?: unknown }).args;
  if (!Array.isArray(args)) return [];
  return args.filter((arg): arg is string | number | boolean => (
    typeof arg === "string" || typeof arg === "number" || typeof arg === "boolean"
  )).map(String);
}

function mapJob(row: Record<string, unknown>): CommandCenterJob {
  const status = String(row.status) === "complete"
    ? "completed"
    : String(row.status ?? "queued");
  const currentStage = row.current_stage ? String(row.current_stage) : null;
  const progressTotal = Number(row.progress_total ?? 0);
  const progressCurrent = Number(row.progress_current ?? 0);
  const progress = row.summary
    ? String(row.summary)
    : currentStage
      ? `Current step: ${currentStage}`
      : progressTotal > 0
        ? `${progressCurrent} / ${progressTotal} steps complete`
        : null;
  return {
    id: Number(row.id),
    agent: String(row.agent_name ?? "atlas") as AdminAgent,
    command: String(row.title ?? row.run_kind ?? "Agent run"),
    args: parseJobArgs(row.params_json),
    status: status as AgentRunStatus,
    createdAt: requiredISO(row.started_at as string | Date),
    startedAt: row.started_at ? toISO(row.started_at as string | Date) : null,
    completedAt: row.completed_at ? toISO(row.completed_at as string | Date) : null,
    heartbeatAt: row.updated_at ? toISO(row.updated_at as string | Date) : null,
    updatedAt: row.updated_at ? toISO(row.updated_at as string | Date) : null,
    backendReceipt: row.backend ? String(row.backend) : null,
    error: row.error_summary ? operatorError(row.error_summary) : null,
    pipelineRunId: row.pipeline_run_id ? Number(row.pipeline_run_id) : null,
    stdoutTail: null,
    progress,
  };
}

async function getApiUsageOverview(): Promise<ApiUsageOverview> {
  const empty: ApiUsageOverview = {
    callsToday: 0,
    calls30d: 0,
    inputTokens30d: 0,
    outputTokens30d: 0,
    failures30d: 0,
    blocked30d: 0,
    estimatedCostMicrousd30d: 0,
    clientApiRequests30d: 0,
    firstTrackedAt: null,
    breakdown: [],
    recentFailures: [],
  };
  try {
    const summaryRows = await sql`
        SELECT
          COALESCE(SUM(request_count) FILTER (
            WHERE created_at >= date_trunc('day', NOW())
          ), 0)::bigint AS calls_today,
          COALESCE(SUM(request_count) FILTER (
            WHERE created_at >= NOW() - INTERVAL '30 days'
          ), 0)::bigint AS calls_30d,
          COALESCE(SUM(input_tokens) FILTER (
            WHERE created_at >= NOW() - INTERVAL '30 days'
          ), 0)::bigint AS input_tokens_30d,
          COALESCE(SUM(output_tokens) FILTER (
            WHERE created_at >= NOW() - INTERVAL '30 days'
          ), 0)::bigint AS output_tokens_30d,
          COUNT(*) FILTER (
            WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '30 days'
          )::int AS failures_30d,
          COUNT(*) FILTER (
            WHERE status = 'blocked' AND created_at >= NOW() - INTERVAL '30 days'
          )::int AS blocked_30d,
          COALESCE(SUM(estimated_cost_microusd) FILTER (
            WHERE created_at >= NOW() - INTERVAL '30 days'
          ), 0)::bigint AS cost_30d,
          MIN(created_at) AS first_tracked_at,
          (SELECT COUNT(*)::int
             FROM usage_events
            WHERE event_type LIKE 'api.%'
              AND created_at >= NOW() - INTERVAL '30 days') AS client_api_requests_30d
        FROM ai_api_usage_events
      `;
    const breakdownRows = await sql`
        SELECT provider, model, agent_name,
               COALESCE(SUM(request_count), 0)::bigint AS calls,
               COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS tokens,
               COUNT(*) FILTER (WHERE status = 'failed')::int AS failures,
               COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked,
               MAX(created_at) AS last_seen_at,
               (ARRAY_AGG(status ORDER BY created_at DESC))[1] AS last_status,
               (ARRAY_AGG(operation ORDER BY created_at DESC))[1] AS last_operation,
               COALESCE(SUM(estimated_cost_microusd), 0)::bigint AS cost
          FROM ai_api_usage_events
         WHERE created_at >= NOW() - INTERVAL '30 days'
         GROUP BY provider, model, agent_name
         ORDER BY calls DESC, tokens DESC
         LIMIT 12
      `;
    const failureRows = await sql`
        SELECT id, provider, model, agent_name, operation, status,
               COALESCE(error_summary, 'No provider error detail recorded') AS error_summary,
               created_at
          FROM ai_api_usage_events
         WHERE status IN ('failed', 'blocked')
         ORDER BY created_at DESC
         LIMIT 8
      `;
    const summary = summaryRows[0] ?? {};
    return {
      callsToday: Number(summary.calls_today ?? 0),
      calls30d: Number(summary.calls_30d ?? 0),
      inputTokens30d: Number(summary.input_tokens_30d ?? 0),
      outputTokens30d: Number(summary.output_tokens_30d ?? 0),
      failures30d: Number(summary.failures_30d ?? 0),
      blocked30d: Number(summary.blocked_30d ?? 0),
      estimatedCostMicrousd30d: Number(summary.cost_30d ?? 0),
      clientApiRequests30d: Number(summary.client_api_requests_30d ?? 0),
      firstTrackedAt: summary.first_tracked_at
        ? toISO(summary.first_tracked_at as string | Date)
        : null,
      breakdown: breakdownRows.map((row) => ({
        provider: String(row.provider),
        model: String(row.model),
        agent: String(row.agent_name),
        calls: Number(row.calls ?? 0),
        tokens: Number(row.tokens ?? 0),
        failures: Number(row.failures ?? 0),
        blocked: Number(row.blocked ?? 0),
        lastSeenAt: row.last_seen_at ? toISO(row.last_seen_at as string | Date) : null,
        lastStatus: row.last_status ? String(row.last_status) : null,
        lastOperation: row.last_operation ? String(row.last_operation) : null,
        estimatedCostMicrousd: Number(row.cost ?? 0),
      })),
      recentFailures: failureRows.map((row) => ({
        id: Number(row.id),
        provider: String(row.provider),
        model: String(row.model),
        agent: String(row.agent_name),
        operation: String(row.operation),
        status: String(row.status),
        error: operatorError(row.error_summary),
        createdAt: requiredISO(row.created_at as string | Date),
      })),
    };
  } catch (error) {
    console.error("Atlas API usage query failed", error);
    return empty;
  }
}

async function getAgentFailureOverview(): Promise<AgentFailureOverview> {
  try {
    const summaryRows = await sql`
        SELECT COUNT(*)::int AS errors,
               COUNT(DISTINCT agent_name)::int AS agents
          FROM agent_events
         WHERE status = 'error'
           AND created_at >= NOW() - INTERVAL '24 hours'
      `;
    const groupRows = await sql`
        SELECT agent_name, tool_name,
               COALESCE(error->>'message', error->>'error',
                        output_payload->>'error', output_payload->>'message',
                        'No agent error detail recorded') AS error,
               COUNT(*)::int AS occurrences,
               MAX(created_at) AS last_seen_at
          FROM agent_events
         WHERE status = 'error'
           AND created_at >= NOW() - INTERVAL '24 hours'
         GROUP BY agent_name, tool_name,
                  COALESCE(error->>'message', error->>'error',
                           output_payload->>'error', output_payload->>'message',
                           'No agent error detail recorded')
         ORDER BY occurrences DESC, last_seen_at DESC
         LIMIT 8
      `;
    const summary = summaryRows[0] ?? {};
    return {
      errors24h: Number(summary.errors ?? 0),
      affectedAgents24h: Number(summary.agents ?? 0),
      groups: groupRows.map((row) => ({
        agent: String(row.agent_name),
        tool: String(row.tool_name),
        error: operatorError(row.error),
        occurrences: Number(row.occurrences ?? 0),
        lastSeenAt: requiredISO(row.last_seen_at as string | Date),
      })),
    };
  } catch (error) {
    console.error("Atlas agent failure query failed", error);
    return { errors24h: 0, affectedAgents24h: 0, groups: [] };
  }
}

export async function getAtlasCommandCenter(): Promise<AtlasCommandCenter> {
  const [
    coverageRows,
    jobRows,
    schedules,
  ] = await Promise.all([
    sql`
      WITH verified AS (
        SELECT DISTINCT institution_id
          FROM published_fee_catalog
         WHERE review_status = 'approved'
      ), fresh AS (
        SELECT DISTINCT institution_id
          FROM source_documents
         WHERE status = 'success'
           AND crawled_at >= NOW() - INTERVAL '90 days'
      )
      SELECT
        COUNT(*)::int AS eligible,
        COUNT(*) FILTER (WHERE ct.fee_schedule_url IS NOT NULL)::int AS with_url,
        COUNT(*) FILTER (WHERE verified.institution_id IS NOT NULL)::int AS with_verified,
        COUNT(*) FILTER (WHERE fresh.institution_id IS NOT NULL)::int AS fresh
      FROM institution_sources ct
      LEFT JOIN verified ON verified.institution_id = ct.id
      LEFT JOIN fresh ON fresh.institution_id = ct.id
      WHERE ct.status = 'active'
        AND COALESCE(ct.document_type, '') NOT IN ('offline', 'no_website')
    `.catch((error) => {
      console.error("Atlas coverage query failed", error);
      return [] as Record<string, unknown>[];
    }),
    sql`
      SELECT id, agent_name, run_kind, title, params_json, status,
             started_at, completed_at, updated_at, backend, error_summary,
             summary, current_stage, progress_current, progress_total,
             NULL::bigint AS pipeline_run_id
        FROM agent_runs
       WHERE run_kind IN ('workflow', 'workflow_lane', 'report', 'manual_repair', 'dry_run')
       ORDER BY started_at DESC, id DESC
       LIMIT 30
    `.catch((error) => {
      console.error("Atlas agent runs query failed", error);
      return [] as Record<string, unknown>[];
    }),
    getJobFreshness(),
  ]);

  const [knoxCounts, sourceSubmissionCounts, automation, pipeline, apiUsage, agentHealth, openCreditFailure] = await Promise.all([
    getKnoxReviewCounts(),
    getSourceSubmissionCounts(),
    getAutomationControl().catch((error) => {
      console.error("Atlas automation control query failed", error);
      return {
        enabled: false,
        reason: "Safety control is unavailable; automation is treated as stopped",
        changedBy: "system",
        changedAt: new Date().toISOString(),
        revision: 0,
      } satisfies AutomationControlState;
    }),
    getPipelineControl().catch((error) => {
      console.error("Atlas pipeline control query failed", error);
      return {
        enabled: false,
        reason: "Pipeline control is unavailable; deterministic work is treated as paused",
        changedBy: "system",
        changedAt: new Date().toISOString(),
        revision: 0,
      } satisfies AutomationControlState;
    }),
    getApiUsageOverview(),
    getAgentFailureOverview(),
    // Same 24h window + "billing resolved" rule the resume guard uses, so the
    // circuit alert and the resume button can never disagree.
    findOpenProviderCreditFailure("anthropic").catch((error) => {
      console.error("Atlas provider credit failure query failed", error);
      return null;
    }),
  ]);

  const coverage = coverageRows[0] ?? {};
  const eligible = Number(coverage.eligible ?? 0);
  const withUrl = Number(coverage.with_url ?? 0);
  const withVerified = Number(coverage.with_verified ?? 0);
  const fresh = Number(coverage.fresh ?? 0);
  const jobs = jobRows.map(mapJob);
  const activeJobs = jobs.filter((job) =>
    ["queued", "running", "cancel_requested"].includes(job.status),
  );
  const provider = buildProviderReadiness(automation, openCreditFailure);
  const trustReview: TrustReviewOverview = {
    sourceSubmissionsPending: sourceSubmissionCounts.pending,
    totalPending: sourceSubmissionCounts.pending,
  };
  const attention: AttentionItem[] = [];

  if (provider.status === "missing_key" || provider.status === "circuit_open") {
    attention.push({
      id: `provider:${provider.status}`,
      severity: "critical",
      owner: "atlas",
      title: provider.label,
      detail: provider.detail,
      href: "/admin#provider-readiness",
      action: "Inspect provider",
    });
  }

  if (!automation.enabled) {
    attention.push({
      id: "automation:stopped",
      severity: "critical",
      owner: "atlas",
      title: "Provider automation stop is active",
      detail: automation.reason ?? "Paid AI provider calls are blocked; deterministic pipeline steps continue.",
      href: "/admin",
      action: "Review safety control",
    });
  }

  if (!pipeline.enabled) {
    attention.push({
      id: "pipeline:paused",
      severity: "critical",
      owner: "atlas",
      title: "Pipeline is paused",
      detail: pipeline.reason ?? "Discovery, fetch, read, extract, verify, and publish are paused.",
      href: "/admin#atlas-safety",
      action: "Review pipeline pause",
    });
  }

  if (agentHealth.errors24h > 0) {
    attention.push({
      id: "agents:failures",
      severity: "critical",
      owner: "atlas",
      title: `${agentHealth.errors24h.toLocaleString()} agent failures in the last 24 hours`,
      detail: `${agentHealth.affectedAgents24h.toLocaleString()} agents are affected. ${agentHealth.groups[0]?.error ?? "Inspect the failure ledger."}`,
      href: "/admin#agent-failures",
      action: "Inspect failures",
    });
  }

  for (const schedule of schedules.jobs) {
    if (schedule.status === "ok") continue;
    const owner: AdminAgent = schedule.job_name.includes("knox")
      ? "knox"
      : schedule.job_name.includes("darwin")
        ? "darwin"
        : schedule.job_name.includes("pulse")
          ? "hamilton"
          : schedule.job_name.includes("registry") || schedule.job_name.includes("magellan")
            ? "magellan"
            : "atlas";
    attention.push({
      id: `schedule:${schedule.job_name}`,
      severity: schedule.status === "failed" ? "critical" : "warning",
      owner,
      title: `${schedule.display_name} ${schedule.status === "failed" ? "failed" : "is overdue"}`,
      detail: schedule.last_completed_at
        ? `Last successful run: ${formatAdminDateTime(schedule.last_completed_at)}`
        : "No successful completion marker has been recorded.",
      href: owner === "atlas" ? "/admin" : `/admin/${owner}`,
      action: `Open ${owner}`,
    });
  }

  const recentFailure = jobs.find((job) => job.status === "failed");
  if (recentFailure) {
    attention.push({
      id: `job:${recentFailure.id}`,
      severity: "critical",
      owner: recentFailure.agent,
      title: `${recentFailure.agent} job #${recentFailure.id} ${recentFailure.status}`,
      detail: recentFailure.error ?? `${recentFailure.command} did not complete.`,
      href: recentFailure.agent === "atlas" ? "/admin" : `/admin/${recentFailure.agent}`,
      action: "Inspect failure",
      repairRunId: recentFailure.agent === "atlas"
        ? recentFailure.pipelineRunId ?? undefined
        : undefined,
    });
  }

  if (knoxCounts.pending > 0) {
    attention.push({
      id: "review:knox",
      severity: "work",
      owner: "knox",
      title: `${knoxCounts.pending.toLocaleString()} Knox decisions need a human verdict`,
      detail: "Confirm correct rejections or override false positives.",
      href: "/admin/knox?queue=decisions",
      action: "Review Knox decisions",
    });
  }
  if (sourceSubmissionCounts.pending > 0) {
    attention.push({
      id: "trust:source-submissions",
      severity: "work",
      owner: "atlas",
      title: `${sourceSubmissionCounts.pending.toLocaleString()} submitted sources need review`,
      detail: "Accept usable official fee schedules or reject unusable submissions before downstream extraction.",
      href: "/admin/quality?submissions=pending&state=submitted_source_pending_review",
      action: "Review sources",
    });
  }
  if (eligible - withUrl > 0) {
    attention.push({
      id: "coverage:urls",
      severity: "warning",
      owner: "magellan",
      title: `${(eligible - withUrl).toLocaleString()} eligible institutions lack a fee URL`,
      detail: "Magellan can prioritize this discovery and rescue queue.",
      href: "/admin/magellan",
      action: "Open discovery queue",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      eligible,
      url: {
        value: percentage(withUrl, eligible),
        numerator: withUrl,
        denominator: eligible,
        definition: "Eligible institutions with a fee schedule URL",
      },
      verified: {
        value: percentage(withVerified, eligible),
        numerator: withVerified,
        denominator: eligible,
        definition: "Eligible institutions with at least one Darwin-verified fee",
      },
      fresh: {
        value: percentage(fresh, eligible),
        numerator: fresh,
        denominator: eligible,
        definition: "Eligible institutions with a successful crawl in the last 90 days",
      },
    },
    schedules,
    activeJobs,
    recentJobs: jobs.filter((job) => !activeJobs.includes(job)).slice(0, 10),
    attention: attention.slice(0, 8),
    automation,
    pipeline,
    provider,
    trustReview,
    apiUsage,
    agentHealth,
  };
}
