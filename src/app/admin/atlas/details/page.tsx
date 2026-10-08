export const dynamic = "force-dynamic";

import Link from "next/link";
import { unstable_cache } from "next/cache";
import {
  ArrowRight,
  BookOpenText,
  Check,
  CircleAlert,
  Clock3,
  Compass,
  Dna,
  FileText,
  Orbit,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { anthropicKeySources } from "@/lib/ai-provider";
import { formatAdminDateTime } from "@/lib/admin-time";
import {
  ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG,
  ADMIN_ATLAS_DASHBOARD_REVALIDATE_SECONDS,
  ADMIN_ATLAS_STATE_LANE_DISPATCH_CACHE_TAG,
} from "@/lib/admin-dashboard-cache";
import { getAtlasCommandCenter, type AttentionItem, type CommandCenterJob } from "@/lib/admin-command-center";
import { getAtlasStateLaneDispatch } from "@/lib/agents/state-lane-memory";
import { getExecutionBackendStatus, type ExecutionBackendStatus } from "@/lib/execution-backend";
import type { JobFreshness } from "@/lib/admin-queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AtlasCommandMap } from "../../atlas-command-map";
import { AtlasEmergencyControl } from "../../atlas-emergency-control";
import { AtlasLiveStatus } from "../../atlas-live-status";
import { AtlasResumeControl } from "../../atlas-resume-control";
import { AtlasRunControl } from "../../atlas-run-control";
import { AtlasStateLaneDispatchPanel } from "../../atlas-state-lane-dispatch";
import { AtlasTickControl } from "../../atlas-tick-control";
import { AtlasWorkflowLauncher } from "../../atlas-workflow-launcher";
import { CategoryGuardRepairControl } from "../../category-guard-repair-control";

function number(value: number): string {
  return value.toLocaleString("en-US");
}

const dateTime = formatAdminDateTime;

const getCachedAtlasCommandCenter = unstable_cache(
  getAtlasCommandCenter,
  ["admin", "atlas-command-center"],
  {
    revalidate: ADMIN_ATLAS_DASHBOARD_REVALIDATE_SECONDS,
    tags: [ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG],
  },
);

const getCachedAtlasStateLaneDispatch = unstable_cache(
  () => getAtlasStateLaneDispatch(),
  ["admin", "atlas-state-lane-dispatch"],
  {
    revalidate: ADMIN_ATLAS_DASHBOARD_REVALIDATE_SECONDS,
    tags: [ADMIN_ATLAS_STATE_LANE_DISPATCH_CACHE_TAG],
  },
);

function estimatedUsd(microusd: number): string {
  const dollars = microusd / 1_000_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dollars > 0 && dollars < 1 ? 4 : 2,
    maximumFractionDigits: dollars > 0 && dollars < 1 ? 4 : 2,
  }).format(dollars);
}

function statusTone(status: string): string {
  if (status === "ok" || status === "completed") return "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/30";
  if (status === "running") return "text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30";
  if (status === "queued" || status === "cancel_requested") return "text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30";
  return "text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950/30";
}

function commandLine(job: CommandCenterJob): string {
  return [job.command, ...job.args].join(" ");
}

function jobResult(job: CommandCenterJob): string {
  return job.error
    ?? job.progress
    ?? (job.completedAt ? `Completed ${dateTime(job.completedAt)}` : "No terminal summary recorded");
}

function initialLiveJob(job: CommandCenterJob) {
  return {
    id: job.id,
    command: job.command,
    agent: job.agent,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    heartbeatAt: job.heartbeatAt,
    updatedAt: job.updatedAt,
    backendReceipt: job.backendReceipt,
    error: job.error,
    resultSummary: job.progress,
    stdoutTail: job.stdoutTail,
    pipelineRunId: job.pipelineRunId,
    pipelineStatus: null,
    lastCompletedJob: null,
    stagesDone: null,
    stagesTotal: null,
    pipelineError: null,
  };
}

function operatorMode({
  center,
  stateLaneDispatch,
  execution,
}: {
  center: Awaited<ReturnType<typeof getAtlasCommandCenter>>;
  stateLaneDispatch: Awaited<ReturnType<typeof getAtlasStateLaneDispatch>>;
  execution: ExecutionBackendStatus;
}) {
  if (!stateLaneDispatch.schemaReady) {
    return {
      tone: "danger" as const,
      label: "Schema",
      title: "Atlas state-lane memory is unavailable",
      detail: "Apply the state-lane memory migration before scheduled or manual state work can run.",
      action: "Inspect state lanes",
      href: "/admin/states",
    };
  }

  if (!center.provider.apiKeyConfigured) {
    return {
      tone: "danger" as const,
      label: "Provider",
      title: "Provider key is missing",
      detail: "Set ANTHROPIC_API_KEY in production, redeploy, then return here to resume agent work.",
      action: "Provider readiness",
      href: "#provider-readiness",
    };
  }

  if (center.provider.status === "circuit_open") {
    return {
      tone: "danger" as const,
      label: "Provider",
      title: "Provider access needs attention",
      detail: center.provider.detail,
      action: "Provider readiness",
      href: "#provider-readiness",
    };
  }

  if (!center.pipeline.enabled) {
    return {
      tone: "warning" as const,
      label: "Paused",
      title: "Pipeline is paused",
      detail: center.pipeline.reason ?? "Deterministic pipeline steps are held by the operator pause.",
      action: "Review pause",
      href: "#atlas-safety",
    };
  }

  if (!center.automation.enabled) {
    return {
      tone: "warning" as const,
      label: "Provider stop",
      title: "Provider automation is stopped",
      detail: center.automation.reason ?? "Paid AI provider calls are held by the global safety control; deterministic steps continue.",
      action: "Review stop",
      href: "#atlas-safety",
    };
  }

  if (!execution.enabled) {
    return {
      tone: "warning" as const,
      label: "Backend",
      title: "Agent execution backend is off",
      detail: execution.detail,
      action: "Backend status",
      href: "#atlas-execution",
    };
  }

  if (center.activeJobs.length > 0) {
    return {
      tone: "active" as const,
      label: "Running",
      title: `${center.activeJobs.length.toLocaleString()} Atlas run${center.activeJobs.length === 1 ? "" : "s"} active`,
      detail: "Let the active run finish; failures and repair actions will surface in the live status and attention queue.",
      action: "Live status",
      href: "#atlas-live-status",
    };
  }

  if (stateLaneDispatch.dueLanes > 0) {
    return {
      tone: "warning" as const,
      label: "Due",
      title: `${stateLaneDispatch.dueLanes.toLocaleString()} state lane${stateLaneDispatch.dueLanes === 1 ? "" : "s"} due`,
      detail: "Run due lanes from Atlas; each state run writes the shared run ledger and specialist step events.",
      action: "Run lanes",
      href: "#state-lane-dispatch-heading",
    };
  }

  if (stateLaneDispatch.totalCriticalPublicFindings > 0) {
    return {
      tone: "danger" as const,
      label: "Public",
      title: `${stateLaneDispatch.totalCriticalPublicFindings.toLocaleString()} critical public page finding${stateLaneDispatch.totalCriticalPublicFindings === 1 ? "" : "s"}`,
      detail: "Darwin has not cleared these public discovery findings yet. Review the affected state lanes before treating public coverage as healthy.",
      action: "Review lanes",
      href: "/admin/states",
    };
  }

  if (stateLaneDispatch.totalPublicFindings > 0) {
    return {
      tone: "warning" as const,
      label: "Public",
      title: `${stateLaneDispatch.totalPublicFindings.toLocaleString()} public discovery finding${stateLaneDispatch.totalPublicFindings === 1 ? "" : "s"} open`,
      detail: "Public page audit findings are recorded and waiting for verification or diagnosis.",
      action: "Review lanes",
      href: "/admin/states",
    };
  }

  if (center.attention[0]) {
    return {
      tone: center.attention[0].severity === "critical" ? "danger" as const : "warning" as const,
      label: center.attention[0].owner,
      title: center.attention[0].title,
      detail: center.attention[0].detail,
      action: center.attention[0].action,
      href: center.attention[0].href,
    };
  }

  return {
    tone: "ready" as const,
    label: "Ready",
    title: "Atlas is ready",
    detail: "Scheduled state lanes can run on cron, and manual state refreshes use the same ledger.",
    action: "State lanes",
    href: "/admin/states",
  };
}

function workflowLanes(
  center: Awaited<ReturnType<typeof getAtlasCommandCenter>>,
  stateLaneDispatch: Awaited<ReturnType<typeof getAtlasStateLaneDispatch>>,
) {
  const missingUrls = Math.max(0, center.metrics.url.denominator - center.metrics.url.numerator);
  const staleOrMissingSources = Math.max(0, center.metrics.fresh.denominator - center.metrics.fresh.numerator);
  const unverified = Math.max(0, center.metrics.verified.denominator - center.metrics.verified.numerator);
  const reviewWork = center.attention.find((item) => item.id.startsWith("review:"));
  const publicFindingMetric = stateLaneDispatch.totalCriticalPublicFindings > 0
    ? `${number(stateLaneDispatch.totalCriticalPublicFindings)} critical / ${number(stateLaneDispatch.totalPublicFindings)} open`
    : `${number(stateLaneDispatch.totalPublicFindings)} open findings`;

  return [
    {
      id: "enhance" as const,
      title: "Enhance institution data",
      owner: "atlas",
      metric: `${number(center.metrics.eligible)} eligible institutions`,
      detail: "Refresh source attributes before discovery, extraction, and benchmarks.",
      commandLabel: "enrich",
      href: "/admin/states",
    },
    {
      id: "discover" as const,
      title: "Find missing fee URLs",
      owner: "magellan",
      metric: `${number(missingUrls)} missing URLs`,
      detail: "Resolve active institutions that do not have a usable fee schedule URL.",
      commandLabel: "discover",
      href: "/admin/magellan",
    },
    {
      id: "fetch" as const,
      title: "Fetch source documents",
      owner: "magellan",
      metric: `${number(staleOrMissingSources)} stale or uncollected`,
      detail: "Collect fresh source PDFs and HTML for institutions with usable fee URLs.",
      commandLabel: "fetch",
      href: "/admin/magellan",
    },
    {
      id: "read" as const,
      title: "Read source documents",
      owner: "rosetta",
      metric: "PDF + HTML text queue",
      detail: "Normalize fetched source documents into text artifacts Knox can trust.",
      commandLabel: "read",
      href: "/admin/rosetta",
    },
    {
      id: "extract" as const,
      title: "Extract raw fee observations",
      owner: "knox",
      metric: "Rosetta text artifacts",
      detail: "Extract conservative source-grounded fee observations from normalized text.",
      commandLabel: "extract",
      href: "/admin/knox",
    },
    {
      id: "classify" as const,
      title: "Verify raw fees",
      owner: "darwin",
      metric: `${number(unverified)} without verified fees`,
      detail: "Promote raw fee rows into the canonical verified fee table.",
      commandLabel: "verify",
      href: "/admin/darwin",
    },
    {
      id: "publish" as const,
      title: "Publish verified fee intelligence",
      owner: "hamilton",
      metric: "Verified rows ready",
      detail: "Publish eligible verified rows into product read models.",
      commandLabel: "publish",
      href: "/admin/data",
    },
    {
      id: "review" as const,
      title: "Review exceptions",
      owner: "knox",
      metric: reviewWork?.title ?? "Knox queue ready",
      detail: "Review anomaly-only Knox decisions and maintain the gold standard.",
      commandLabel: "review decisions",
      href: "/admin/knox",
    },
    {
      id: "public-discovery" as const,
      title: "Audit public discovery pages",
      owner: "atlas",
      metric: publicFindingMetric,
      detail: "Check public routes for not-found pages, visible errors, and accessible form issues; browser screenshots remain a follow-up renderer.",
      commandLabel: "audit public pages",
      href: "/admin/states",
    },
  ];
}

export default async function AtlasCommandPage() {
  await requireAuth("view");
  const [center, stateLaneDispatch] = await Promise.all([
    getCachedAtlasCommandCenter(),
    getCachedAtlasStateLaneDispatch(),
  ]);
  const execution = getExecutionBackendStatus();
  const problemSchedules = center.schedules.failed_count
    + center.schedules.stale_count
    + center.schedules.never_ran_count;
  const healthy = problemSchedules === 0
    && center.agentHealth.errors24h === 0
    && stateLaneDispatch.totalCriticalPublicFindings === 0
    && center.automation.enabled
    && center.pipeline.enabled
    && center.provider.status === "ready";
  const healthStatusText = healthy
    ? "Automation and scheduled systems are healthy"
    : !center.pipeline.enabled
      ? "Pipeline is paused"
      : !center.automation.enabled
      ? "Provider automation is stopped"
      : center.agentHealth.errors24h > 0
        ? `${center.agentHealth.errors24h.toLocaleString()} agent failures need attention`
        : stateLaneDispatch.totalCriticalPublicFindings > 0
          ? `${stateLaneDispatch.totalCriticalPublicFindings.toLocaleString()} critical public discovery findings need attention`
          : `${problemSchedules} scheduled checks need attention`;

  return (
    <div className="space-y-9 pb-10">
      <header>
        <Breadcrumbs items={[{ label: "Crew", href: "/admin" }, { label: "Atlas details" }]} />
        <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="admin-eyebrow">Command · Atlas</p>
            <h1 className="admin-display-title mt-1">Atlas details</h1>
            <p className="admin-lede mt-2">
              Every run control, lane, usage meter and history panel. The crew page at /admin is the everyday view.
            </p>
          </div>
          <AtlasRunControl
            disabled={!center.pipeline.enabled || !execution.enabled || center.activeJobs.some((job) => job.agent === "atlas")}
            disabledReason={
              !center.pipeline.enabled
                ? "Pipeline is paused."
                : !execution.enabled
                  ? execution.detail
                  : center.activeJobs.some((job) => job.agent === "atlas")
                    ? "Atlas already has an active run."
                    : undefined
            }
          />
        </div>
      </header>

      {!execution.enabled && <ExecutionBackendBanner status={execution} />}

      <AtlasEmergencyControl
        enabled={center.automation.enabled}
        reason={center.automation.reason}
        changedBy={center.automation.changedBy}
        changedAtLabel={dateTime(center.automation.changedAt)}
        activeJobCount={center.activeJobs.length}
        pipelineEnabled={center.pipeline.enabled}
        pipelineReason={center.pipeline.reason}
        pipelineChangedBy={center.pipeline.changedBy}
        pipelineChangedAtLabel={dateTime(center.pipeline.changedAt)}
        marketingEnabled={center.marketing.enabled}
        marketingReason={center.marketing.reason}
        marketingChangedBy={center.marketing.changedBy}
        marketingChangedAtLabel={dateTime(center.marketing.changedAt)}
      />

      <details id="atlas-runs" className="group border-t border-black/[0.06] pt-4 dark:border-white/[0.06]">
        <summary className="cursor-pointer list-none select-none">
          <span className="text-sm font-semibold text-gray-900 group-open:text-[var(--brand-primary)] dark:text-gray-100">Run controls and live runs</span>
          <span className="admin-meta ml-2">Tick, live runs, state lanes, workflow launcher</span>
        </summary>
        <div className="mt-6 space-y-9">
        <AtlasTickControl
          disabled={!center.pipeline.enabled || !execution.enabled}
          disabledReason={
            !center.pipeline.enabled
              ? "Pipeline is paused."
              : !execution.enabled
                ? execution.detail
                : undefined
          }
        />
        <AtlasLiveStatus
          initialActiveJobs={center.activeJobs.map(initialLiveJob)}
          initialGeneratedAt={center.generatedAt}
        />
        <AtlasStateLaneDispatchPanel
          dispatch={stateLaneDispatch}
          automationEnabled={center.automation.enabled}
          activeJobCount={center.activeJobs.length}
          executionEnabled={execution.enabled}
          executionBlockedReason={execution.detail}
        />
        <AtlasWorkflowLauncher
          lanes={workflowLanes(center, stateLaneDispatch)}
          automationEnabled={center.automation.enabled}
          activeJobCount={center.activeJobs.length}
          executionEnabled={execution.enabled}
          executionBlockedReason={execution.detail}
        />
        <CategoryGuardRepairControl
          disabled={!center.automation.enabled || !execution.enabled}
        />
        </div>
      </details>

      <details id="atlas-coverage" className="group border-t border-black/[0.06] pt-4 dark:border-white/[0.06]">
        <summary className="cursor-pointer list-none select-none">
          <span className="text-sm font-semibold text-gray-900 group-open:text-[var(--brand-primary)] dark:text-gray-100">Coverage, attention and next actions</span>
          <span className="admin-meta ml-2">Operator path, command map, all attention items</span>
        </summary>
        <div className="mt-6 space-y-9">
        <section aria-labelledby="attention-heading">
          <div className="admin-section-header">
            <div>
              <p className="admin-eyebrow">Priority queue</p>
              <h2 id="attention-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                What needs my attention?
              </h2>
            </div>
            <span className="admin-meta">{center.attention.length} actionable items</span>
          </div>
          {center.attention.length === 0 ? (
            <div className="flex items-center gap-3 border-y border-emerald-200 py-5 text-emerald-800 dark:border-emerald-900/50 dark:text-emerald-300">
              <Check className="h-5 w-5" />
              <p className="text-sm font-medium">No exceptions need operator attention.</p>
            </div>
          ) : (
            <div className="divide-y divide-black/[0.06] border-y border-black/[0.06] dark:divide-white/[0.06] dark:border-white/[0.06]">
              {center.attention.map((item) => <AttentionRow key={item.id} item={item} />)}
            </div>
          )}
        </section>
        {center.agentHealth.errors24h > 0 && (
          <section id="agent-failures" aria-labelledby="agent-failures-heading">
            <div className="admin-section-header">
              <div>
                <p className="admin-eyebrow">Failure ledger</p>
                <h2 id="agent-failures-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                  Agent errors · last 24 hours
                </h2>
              </div>
              <span className="admin-meta">{center.agentHealth.affectedAgents24h} affected agents</span>
            </div>
            <div className="divide-y divide-black/[0.06] border-y border-black/[0.06] dark:divide-white/[0.06] dark:border-white/[0.06]">
              {center.agentHealth.groups.map((group) => (
                <div key={`${group.agent}:${group.tool}:${group.error}`} className="grid gap-2 py-3 sm:grid-cols-[180px_1fr_auto] sm:items-center">
                  <div className="flex items-center gap-2">
                    <TriangleAlert className="h-4 w-4 text-red-600" />
                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">{group.agent} · {group.tool}</p>
                  </div>
                  <p className="truncate text-xs text-gray-600 dark:text-gray-400">{group.error}</p>
                  <p className="text-xs tabular-nums text-red-700 dark:text-red-400">{group.occurrences} · {dateTime(group.lastSeenAt)}</p>
                </div>
              ))}
            </div>
          </section>
        )}
        <section aria-labelledby="next-heading">
          <div className="admin-section-header">
            <div>
              <p className="admin-eyebrow">Operator guidance</p>
              <h2 id="next-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                What should I do next?
              </h2>
            </div>
          </div>
          <div className="flex flex-col justify-between gap-4 border-y border-black/[0.06] py-5 sm:flex-row sm:items-center dark:border-white/[0.06]">
            {center.activeJobs.length > 0 ? (
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Let Atlas finish the active run.</p>
                <p className="admin-meta mt-1">If it stops, the failing agent and its repair action will appear above.</p>
              </div>
            ) : center.attention[0] ? (
              <>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{center.attention[0].title}</p>
                  <p className="admin-meta mt-1">{center.attention[0].detail}</p>
                </div>
                {center.attention[0].repairRunId ? (
                  <AtlasResumeControl runId={center.attention[0].repairRunId} />
                ) : (
                  <Link href={center.attention[0].href} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-primary)] hover:text-[var(--brand-primary-hover)]">
                    {center.attention[0].action}<ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </>
            ) : (
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">No operator action is required.</p>
                <p className="admin-meta mt-1">Atlas will run on schedule. Use the command action only for an intentional out-of-cycle refresh.</p>
              </div>
            )}
          </div>
        </section>
        <AtlasOperatorPath
          center={center}
          stateLaneDispatch={stateLaneDispatch}
          execution={execution}
        />
        <AtlasCommandMap
          center={center}
          stateLaneDispatch={stateLaneDispatch}
        />
        <section aria-labelledby="health-heading" className="border-y border-black/[0.06] py-5 dark:border-white/[0.06]">
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-5">
            <div className="xl:col-span-2">
              <p id="health-heading" className="admin-section-title">Is the system healthy?</p>
              <div className="mt-2 flex items-center gap-3">
                <span className={`relative flex h-3 w-3 rounded-full ${healthy ? "bg-emerald-500" : "bg-red-500"}`}>
                  {healthy && <span className="live-pulse absolute inset-0 rounded-full bg-emerald-400" />}
                </span>
                <p className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                  {healthStatusText}
                </p>
              </div>
              <p className="admin-meta mt-2">Checked {dateTime(center.generatedAt)}</p>
            </div>
            <Metric label="URL Coverage" value={center.metrics.url.value} metric={center.metrics.url} />
            <Metric label="Verified Coverage" value={center.metrics.verified.value} metric={center.metrics.verified} />
            <Metric label="Fresh Coverage" value={center.metrics.fresh.value} metric={center.metrics.fresh} />
          </div>
        </section>
        </div>
      </details>

      <details id="atlas-usage" className="group border-t border-black/[0.06] pt-4 dark:border-white/[0.06]">
        <summary className="cursor-pointer list-none select-none">
          <span className="text-sm font-semibold text-gray-900 group-open:text-[var(--brand-primary)] dark:text-gray-100">AI usage and provider</span>
          <span className="admin-meta ml-2">Provider readiness, metered calls and spend</span>
        </summary>
        <div className="mt-6 space-y-9">
        <ProviderReadinessBanner readiness={center.provider} />
        <section aria-labelledby="usage-heading">
          <div className="admin-section-header">
            <div>
              <p className="admin-eyebrow">Cost control</p>
              <h2 id="usage-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                API usage
              </h2>
            </div>
            <p className="admin-meta">
              {center.apiUsage.firstTrackedAt
                ? `Metered since ${dateTime(center.apiUsage.firstTrackedAt)}`
                : "Provider metering begins with this release"}
            </p>
          </div>
          <div className="grid gap-x-6 gap-y-5 border-y border-black/[0.06] py-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 dark:border-white/[0.06]">
            <UsageMetric label="AI calls today" value={number(center.apiUsage.callsToday)} />
            <UsageMetric label="AI calls · 30d" value={number(center.apiUsage.calls30d)} />
            <UsageMetric label="Tokens · 30d" value={number(center.apiUsage.inputTokens30d + center.apiUsage.outputTokens30d)} />
            <UsageMetric label="Est. AI spend · 30d" value={estimatedUsd(center.apiUsage.estimatedCostMicrousd30d)} />
            <UsageMetric label="Provider failures · 30d" value={number(center.apiUsage.failures30d)} tone={center.apiUsage.failures30d > 0 ? "danger" : "default"} />
            <UsageMetric label="Provider blocked · 30d" value={number(center.apiUsage.blocked30d)} tone={center.apiUsage.blocked30d > 0 ? "danger" : "default"} />
            <UsageMetric label="Client API requests · 30d" value={number(center.apiUsage.clientApiRequests30d)} />
          </div>
          <p className="admin-meta mt-2">
            Spend is estimated from recorded model tokens and configured Anthropic model-family rates. Provider invoices remain authoritative.
          </p>

          <div className="mt-5 overflow-x-auto border-y border-black/[0.06] dark:border-white/[0.06]">
            <table className="admin-table w-full text-xs">
              <thead><tr><th>Provider / model</th><th>Agent / operation</th><th>Calls</th><th>Tokens</th><th>Failed / blocked</th><th>Last event</th><th>Est. spend</th></tr></thead>
              <tbody>
                {center.apiUsage.breakdown.map((row) => (
                  <tr key={`${row.provider}:${row.model}:${row.agent}`}>
                    <td><span className="font-semibold capitalize text-gray-800 dark:text-gray-200">{row.provider}</span><span className="ml-2 text-gray-500">{row.model}</span></td>
                    <td>
                      <span className="capitalize text-gray-700 dark:text-gray-300">{row.agent}</span>
                      <span className="mt-1 block font-mono text-[10px] text-gray-500">{row.lastOperation ?? "No operation recorded"}</span>
                    </td>
                    <td className="tabular-nums">{number(row.calls)}</td>
                    <td className="tabular-nums">{number(row.tokens)}</td>
                    <td className={row.failures > 0 || row.blocked > 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-gray-500"}>
                      {number(row.failures)} / {number(row.blocked)}
                    </td>
                    <td>
                      <span className="tabular-nums text-gray-600 dark:text-gray-400">{dateTime(row.lastSeenAt)}</span>
                      {row.lastStatus && (
                        <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-semibold capitalize ${statusTone(row.lastStatus)}`}>
                          {row.lastStatus}
                        </span>
                      )}
                    </td>
                    <td className="tabular-nums">{estimatedUsd(row.estimatedCostMicrousd)}</td>
                  </tr>
                ))}
                {center.apiUsage.breakdown.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-gray-400">No metered provider calls yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {center.apiUsage.recentFailures.length > 0 && (
            <div className="mt-4 divide-y divide-red-100 border-y border-red-100 dark:divide-red-950 dark:border-red-950">
              {center.apiUsage.recentFailures.slice(0, 4).map((failure) => (
                <div key={failure.id} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr_auto] sm:items-center">
                  <p className="text-xs font-semibold capitalize text-red-800 dark:text-red-300">{failure.agent} · {failure.operation} · {failure.status}</p>
                  <p className="truncate text-xs text-gray-600 dark:text-gray-400" title={failure.error}>{failure.error}</p>
                  <p className="admin-meta">{dateTime(failure.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </section>
        </div>
      </details>

      <details id="atlas-history" className="group border-t border-black/[0.06] pt-4 dark:border-white/[0.06]">
        <summary className="cursor-pointer list-none select-none">
          <span className="text-sm font-semibold text-gray-900 group-open:text-[var(--brand-primary)] dark:text-gray-100">History and agent ownership</span>
          <span className="admin-meta ml-2">Recent runs and who owns each step</span>
        </summary>
        <div className="mt-6 space-y-9">
        <section aria-labelledby="pipeline-heading">
          <div className="admin-section-header">
            <div>
              <p className="admin-eyebrow">Agent handoff</p>
              <h2 id="pipeline-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                Who owns each step?
              </h2>
            </div>
            <p className="admin-meta">Atlas coordinates; specialists own remediation.</p>
          </div>
          <AgentRail schedules={center.schedules.jobs} />
        </section>
        <section aria-labelledby="history-heading">
          <div className="admin-section-header">
            <div>
              <p className="admin-eyebrow">Run history</p>
              <h2 id="history-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                Recent terminal jobs
              </h2>
            </div>
          </div>
          <div className="overflow-x-auto border-y border-black/[0.06] dark:border-white/[0.06]">
            <table className="admin-table w-full text-xs">
              <thead><tr><th>Run</th><th>Owner</th><th>Status</th><th>Started</th><th>Backend</th><th>Result</th></tr></thead>
              <tbody>
                {center.recentJobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <span className="font-semibold text-gray-800 dark:text-gray-200">#{job.id}</span>
                      <span className="mt-1 block truncate font-mono text-[10px] text-gray-500">{commandLine(job)}</span>
                    </td>
                    <td className="capitalize text-gray-600 dark:text-gray-400">{job.agent}</td>
                    <td><span className={`rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${statusTone(job.status)}`}>{job.status}</span></td>
                    <td className="tabular-nums text-gray-500">{dateTime(job.startedAt ?? job.createdAt)}</td>
                    <td className="max-w-[180px] truncate font-mono text-[10px] text-gray-500">{job.backendReceipt ?? "agentic_v1"}</td>
                    <td className="max-w-xl truncate text-gray-500" title={jobResult(job)}>{jobResult(job)}</td>
                  </tr>
                ))}
                {center.recentJobs.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-gray-400">No terminal jobs recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        </div>
      </details>
    </div>
  );
}

function ExecutionBackendBanner({ status }: { status: ExecutionBackendStatus }) {
  const tone = status.enabled
    ? "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-950 dark:bg-blue-950/25 dark:text-blue-100"
    : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-950 dark:bg-amber-950/25 dark:text-amber-100";

  return (
    <section id="atlas-execution" aria-label="Execution backend" className={`rounded-md border px-4 py-3 ${tone}`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide">{status.label}</p>
          <p className="mt-1 text-sm">{status.detail}</p>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-wide">
          EXECUTION_BACKEND={status.backend}
        </span>
      </div>
    </section>
  );
}

function AtlasOperatorPath({
  center,
  stateLaneDispatch,
  execution,
}: {
  center: Awaited<ReturnType<typeof getAtlasCommandCenter>>;
  stateLaneDispatch: Awaited<ReturnType<typeof getAtlasStateLaneDispatch>>;
  execution: ExecutionBackendStatus;
}) {
  const mode = operatorMode({ center, stateLaneDispatch, execution });
  const toneClass = mode.tone === "danger"
    ? "border-red-200 bg-red-50 text-red-950 dark:border-red-950 dark:bg-red-950/25 dark:text-red-100"
    : mode.tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-950 dark:bg-amber-950/25 dark:text-amber-100"
      : mode.tone === "active"
        ? "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-950 dark:bg-blue-950/25 dark:text-blue-100"
        : "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-950 dark:bg-emerald-950/25 dark:text-emerald-100";
  const steps = [
    {
      title: "Readiness",
      detail: center.provider.apiKeyConfigured
        ? center.automation.enabled ? "Provider and automation are open" : "Provider key present; automation paused"
        : "Provider key missing",
      state: center.provider.apiKeyConfigured && center.automation.enabled ? "ready" : "attention",
      href: "#provider-readiness",
    },
    {
      title: "State lanes",
      detail: `${number(stateLaneDispatch.dueLanes)} due · ${number(stateLaneDispatch.attentionLanes)} attention`,
      state: stateLaneDispatch.dueLanes > 0 || stateLaneDispatch.attentionLanes > 0 ? "attention" : "ready",
      href: "#state-lane-dispatch-heading",
    },
    {
      title: "Specialists",
      detail: "Magellan, Rosetta, Knox, Darwin",
      state: center.agentHealth.errors24h > 0 ? "attention" : "ready",
      href: "#pipeline-heading",
    },
    {
      title: "Output",
      detail: "Hamilton publish and data reads",
      state: center.metrics.verified.value > 0 ? "ready" : "attention",
      href: "/admin/data",
    },
  ];

  return (
    <section aria-labelledby="atlas-operator-path-heading" className="border-y border-black/[0.06] py-5 dark:border-white/[0.06]">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
        <div className={`rounded-md border px-4 py-3 ${toneClass}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide">{mode.label}</p>
              <h2 id="atlas-operator-path-heading" className="mt-1 text-base font-semibold tracking-tight">
                {mode.title}
              </h2>
              <p className="mt-1 text-sm opacity-90">{mode.detail}</p>
            </div>
            <Link
              href={mode.href}
              className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md bg-white/75 px-3 text-xs font-semibold text-gray-900 transition-colors hover:bg-white dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
            >
              {mode.action}<ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          {steps.map((step, index) => (
            <Link
              key={step.title}
              href={step.href}
              className="group rounded-md border border-black/[0.06] px-3 py-3 transition-colors hover:border-blue-200 hover:bg-blue-50/50 dark:border-white/[0.06] dark:hover:border-blue-950 dark:hover:bg-blue-950/20"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="admin-label">{index + 1}</span>
                <span className={`h-2 w-2 rounded-full ${step.state === "ready" ? "bg-emerald-500" : "bg-amber-500"}`} />
              </div>
              <p className="mt-3 text-xs font-semibold text-gray-900 dark:text-gray-100">{step.title}</p>
              <p className="mt-1 text-[11px] leading-4 text-gray-500 dark:text-gray-400">{step.detail}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProviderReadinessBanner({
  readiness,
}: {
  readiness: Awaited<ReturnType<typeof getAtlasCommandCenter>>["provider"];
}) {
  const tone = readiness.status === "ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-950 dark:bg-emerald-950/25 dark:text-emerald-100"
    : readiness.status === "automation_stopped"
      ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-950 dark:bg-amber-950/25 dark:text-amber-100"
      : "border-red-200 bg-red-50 text-red-950 dark:border-red-950 dark:bg-red-950/25 dark:text-red-100";

  return (
    <section id="provider-readiness" aria-label="Provider readiness" className={`rounded-md border px-4 py-3 ${tone}`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide">{readiness.label}</p>
          <p className="mt-1 text-sm">{readiness.detail}</p>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-wide">
          ANTHROPIC_API_KEY={readiness.apiKeyConfigured ? "configured" : "missing"}
        </span>
      </div>
      <p className="mt-2 font-mono text-[11px] tracking-wide" aria-label="Key each agent bills to">
        {anthropicKeySources()
          .map(({ agent, source }) => `${agent}: ${source === "own" ? "own key" : source === "shared" ? "shared key" : "no key"}`)
          .join(" · ")}
      </p>
      {readiness.lastCreditFailureAt && (
        <p className="mt-2 text-xs">
          Last provider credit failure: {dateTime(readiness.lastCreditFailureAt)}
        </p>
      )}
    </section>
  );
}

function Metric({ label, value, metric }: { label: string; value: number; metric: { numerator: number; denominator: number; definition: string } }) {
  return (
    <div title={metric.definition}>
      <p className="admin-label">{label}</p>
      <p className="admin-value-xl mt-2">{value}%</p>
      <p className="admin-meta mt-1">{number(metric.numerator)} / {number(metric.denominator)}</p>
    </div>
  );
}

function UsageMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div>
      <p className="admin-label">{label}</p>
      <p className={`mt-2 text-xl font-semibold tabular-nums tracking-tight ${tone === "danger" ? "text-red-700 dark:text-red-400" : "text-gray-900 dark:text-gray-100"}`}>
        {value}
      </p>
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const Icon = item.severity === "critical" ? CircleAlert : item.severity === "warning" ? Clock3 : ShieldCheck;
  const iconTone = item.severity === "critical" ? "text-red-600" : item.severity === "warning" ? "text-amber-600" : "text-blue-600";
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex min-w-0 gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTone}`} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.title}</p>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-600 dark:bg-white/[0.06] dark:text-gray-400">{item.owner}</span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{item.detail}</p>
        </div>
      </div>
      {item.repairRunId ? (
        <AtlasResumeControl runId={item.repairRunId} />
      ) : (
        <Link href={item.href} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-primary)] hover:text-[var(--brand-primary-hover)]">
          {item.action}<ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

function AgentRail({ schedules }: { schedules: JobFreshness[] }) {
  const stages = [
    { name: "Atlas", role: "Schedule + observe", href: "/admin", icon: Orbit, jobs: ["atlas_state_lanes", "agent_executor"] },
    { name: "Magellan", role: "Discover + fetch", href: "/admin/magellan", icon: Compass, jobs: ["registry_sync"] },
    { name: "Rosetta", role: "Read sources", href: "/admin/rosetta", icon: FileText, jobs: [] },
    { name: "Knox", role: "Extract + exceptions", href: "/admin/knox", icon: ShieldCheck, jobs: [] },
    { name: "Darwin", role: "Verify", href: "/admin/darwin", icon: Dna, jobs: [] },
    { name: "Hamilton", role: "Publish", href: "/admin/data", icon: BookOpenText, jobs: ["monthly_pulse"] },
  ];
  return (
    <div className="grid overflow-hidden rounded-lg border border-black/[0.06] bg-white sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 dark:border-white/[0.06] dark:bg-[oklch(0.19_0_0)]">
      {stages.map((stage, index) => {
        const related = schedules.filter((job) => stage.jobs.includes(job.job_name));
        const state = related.some((job) => job.status !== "ok") ? "attention" : "ready";
        const Icon = stage.icon;
        return (
          <Link key={stage.name} href={stage.href} className="group relative flex min-h-32 flex-col justify-between border-b border-black/[0.06] p-4 transition-colors hover:bg-gray-50 sm:border-r xl:border-b-0 xl:last:border-r-0 dark:border-white/[0.06] dark:hover:bg-white/[0.03]">
            <div className="flex items-center justify-between">
              <Icon className="h-5 w-5 text-gray-500 transition-colors group-hover:text-[var(--brand-primary)]" />
              <span className={`h-2 w-2 rounded-full ${state === "ready" ? "bg-emerald-500" : "bg-amber-500"}`} />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{index + 1}. {stage.name}</p>
              <p className="admin-meta mt-1">{stage.role}</p>
            </div>
          </Link>
        );
      })}
      <div className="sm:col-span-2 lg:col-span-3 xl:col-span-6 flex items-center gap-3 border-t border-black/[0.06] px-4 py-3 dark:border-white/[0.06]">
        <BookOpenText className="h-4 w-4 text-gray-400" />
        <p className="text-xs text-gray-600 dark:text-gray-400"><strong className="text-gray-800 dark:text-gray-200">Hamilton</strong> publishes eligible verified rows and powers the analysis surfaces from published/read-model data.</p>
      </div>
    </div>
  );
}
