export const dynamic = "force-dynamic";

import Link from "next/link";
import { hasPermission, requireAuth } from "@/lib/auth";
import { getAutomationControl } from "@/lib/automation-control";
import { getExecutionBackendStatus } from "@/lib/execution-backend";
import { Breadcrumbs } from "@/components/breadcrumbs";
import {
  getStateInstitutions,
  getStateSummary,
  getStateAgentRuns,
  getStateUrlResolutionQueue,
} from "@/lib/data-store/states";
import {
  getStateLaneHealth,
  getStatePublicDiscoveryFindings,
  getStateSourceMemoryProfiles,
  type StatePublicDiscoveryFinding,
  type StateSourceMemoryProfile,
} from "@/lib/agents/state-lane-memory";
import { PublicFindingDecisionForm } from "./public-finding-decision-form";
import { SourceMemoryCorrectionForm } from "./source-memory-correction-form";
import { StateLaneRunControl } from "./state-lane-run-control";
import { UrlResolutionRow } from "./url-resolution-row";
import { SortableInstitutionTable } from "./sortable-institution-table";

// ---------------------------------------------------------------------------
// State name lookup
// ---------------------------------------------------------------------------

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
  PR: "Puerto Rico", GU: "Guam", VI: "Virgin Islands", AS: "American Samoa",
  MP: "Northern Mariana Islands",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatIssueCode(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatToken(value: string | null): string {
  if (!value) return "Unknown";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function StateDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const user = await requireAuth("view");
  const { code } = await params;
  const stateCode = code.toUpperCase();
  const stateName = STATE_NAMES[stateCode] ?? stateCode;
  const canReviewPublicFindings = hasPermission(user, "approve");
  const canCorrectSourceMemory = hasPermission(user, "approve");
  const canRunStateLane = hasPermission(user, "trigger_jobs");

  const [summary, institutions, agentRuns, urlResolutionQueue, laneHealth, sourceMemory, publicFindings, automation, execution] = await Promise.all([
    getStateSummary(stateCode),
    getStateInstitutions(stateCode),
    getStateAgentRuns(stateCode),
    getStateUrlResolutionQueue(stateCode),
    getStateLaneHealth(stateCode),
    getStateSourceMemoryProfiles(stateCode),
    getStatePublicDiscoveryFindings(stateCode),
    getAutomationControl(),
    Promise.resolve(getExecutionBackendStatus()),
  ]);
  const activeLaneRun = agentRuns.find((run) => run.status === "queued" || run.status === "running");
  const stateLaneBlockedReason = !canRunStateLane
    ? "You need trigger_jobs permission to schedule Atlas lanes."
    : !automation.enabled
      ? automation.reason ?? "Automation safety stop is active."
      : !execution.enabled
        ? execution.detail
        : null;

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/admin" },
              { label: "States", href: "/admin/states" },
              { label: stateCode },
            ]}
          />
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {stateName} ({stateCode})
          </h1>
          <p className="text-[11px] text-gray-400 mt-0.5">
            State coverage, source memory, and lane health
          </p>
        </div>
        <StateLaneRunControl
          stateCode={stateCode}
          blockedReason={stateLaneBlockedReason}
          activeRun={activeLaneRun ? { id: activeLaneRun.id, status: activeLaneRun.status, startedAt: activeLaneRun.started_at || null } : null}
        />
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-8">
        <StatCard label="Total Institutions" value={formatNumber(summary.total)} />
        <StatCard label="With Fee URL" value={formatNumber(summary.withUrl)} />
        <StatCard label="With Published Fees" value={formatNumber(summary.withFees)} />
        <StatCard label="Coverage" value={`${summary.coveragePct}%`} highlight />
      </div>

      {/* State Lane Health */}
      <section id="state-lane-health" className="mb-8 scroll-mt-24">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em]">
            Atlas State Lane
          </h2>
          {laneHealth?.lastAgentRunId && (
            <Link
              href={`/admin/states/${stateCode}/runs/${laneHealth.lastAgentRunId}`}
              className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              Run #{laneHealth.lastAgentRunId}
            </Link>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          <StatCard label="Missing URLs" value={formatNumber(laneHealth?.backlogMissingUrls ?? 0)} />
          <StatCard label="Stale Sources" value={formatNumber(laneHealth?.backlogStaleSources ?? 0)} />
          <StatCard label="OCR Backlog" value={formatNumber(laneHealth?.backlogOcr ?? 0)} />
          <StatCard label="Manual Review" value={formatNumber(laneHealth?.backlogManualReview ?? 0)} />
          <StatCard label="Failures" value={formatNumber(laneHealth?.failures ?? 0)} />
          <StatCard label="Corrections" value={formatNumber(laneHealth?.corrections ?? 0)} />
          <StatCard label="Public Findings" value={formatNumber(laneHealth?.publicFindings.unverified ?? 0)} />
          <StatCard label="Critical Pages" value={formatNumber(laneHealth?.publicFindings.critical ?? 0)} />
          <StatCard label="Last Success" value={formatDateTime(laneHealth?.lastSuccessAt ?? null)} />
          <StatCard label="Next Run" value={formatDateTime(laneHealth?.nextRunAfter ?? null)} />
        </div>
        {laneHealth && (
          <div className="mt-3 grid gap-2.5 md:grid-cols-3">
            <LaneMiniSummary
              title="Source Kinds"
              items={[
                ["PDF", laneHealth.sourceKinds.pdf],
                ["HTML", laneHealth.sourceKinds.html],
                ["Scanned", laneHealth.sourceKinds.scannedPdf],
                ["Unknown", laneHealth.sourceKinds.unknown],
                ["Offline", laneHealth.sourceKinds.offline],
              ]}
            />
            <LaneMiniSummary
              title="Read Strategies"
              items={[
                ["PDF text", laneHealth.readStrategies.pdfText],
                ["HTML DOM", laneHealth.readStrategies.htmlDom],
                ["Browser", laneHealth.readStrategies.browserRender],
                ["OCR", laneHealth.readStrategies.ocr],
                ["Manual", laneHealth.readStrategies.manualReview],
              ]}
            />
            <LaneMiniSummary
              title="Public Discovery"
              items={[
                ["Open", laneHealth.publicFindings.unverified],
                ["Verified", laneHealth.publicFindings.verified],
                ["Critical", laneHealth.publicFindings.critical],
              ]}
            />
          </div>
        )}
      </section>

      {/* Source Memory */}
      <SourceMemoryTable
        stateCode={stateCode}
        rows={sourceMemory}
        totalProfiles={laneHealth?.profileCount ?? sourceMemory.length}
        canCorrect={canCorrectSourceMemory}
      />

      {/* Public Discovery Findings */}
      <PublicDiscoveryFindingsTable
        stateCode={stateCode}
        findings={publicFindings}
        totalOpen={laneHealth?.publicFindings.unverified ?? publicFindings.length}
        canReview={canReviewPublicFindings}
      />

      {/* Institution Table */}
      <SortableInstitutionTable
        institutions={institutions}
      />

      {/* Agent Run History */}
      <section id="agent-run-history" className="admin-card mb-8 scroll-mt-24 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.04]">
          <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em]">
            Agent Run History
          </h2>
        </div>
        {agentRuns.length > 0 ? (
          <table className="admin-table w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>Date</th>
                <th className="text-center">Status</th>
                <th className="text-right">Discovered</th>
                <th className="text-right">Classified</th>
                <th className="text-right">Extracted</th>
                <th className="text-right">Validated</th>
                <th className="text-right">Failed</th>
              </tr>
            </thead>
            <tbody>
              {agentRuns.map((run) => (
                <tr
                  key={run.id}
                  className="hover:bg-gray-50/50 dark:hover:bg-white/[0.04] transition-colors"
                >
                  <td className="text-gray-700 dark:text-gray-300 tabular-nums">
                    <Link
                      href={`/admin/states/${stateCode}/runs/${run.id}`}
                      className="hover:text-blue-600 transition-colors"
                    >
                      {run.started_at}
                    </Link>
                  </td>
                  <td className="text-center">
                    <AgentStatusBadge status={run.status} />
                  </td>
                  <td className="text-right tabular-nums text-gray-500">
                    {run.discovered}
                  </td>
                  <td className="text-right tabular-nums text-gray-500">
                    {run.classified}
                  </td>
                  <td className="text-right tabular-nums text-gray-500">
                    {run.extracted}
                  </td>
                  <td className="text-right tabular-nums text-gray-500">
                    {run.validated}
                  </td>
                  <td className="text-right tabular-nums text-gray-500">
                    {run.failed > 0 ? (
                      <span className="text-red-600 dark:text-red-400 font-medium">
                        {run.failed}
                      </span>
                    ) : (
                      run.failed
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-6 text-xs text-gray-400 text-center">
            No agent runs yet. Use Run State Lane to create the first Atlas-led state run.
          </div>
        )}
      </section>

      {/* URL Resolution */}
      {urlResolutionQueue.length > 0 && (
        <section id="url-resolution" className="admin-card scroll-mt-24 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.04]">
            <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em]">
              Magellan URL Resolution ({urlResolutionQueue.length} institutions)
            </h2>
          </div>
          <table className="admin-table w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>Name</th>
                <th>Website</th>
                <th>Failure Reason</th>
              </tr>
            </thead>
            <tbody>
              {urlResolutionQueue.map((inst) => (
                <UrlResolutionRow
                  key={inst.id}
                  institutionId={inst.id}
                  institutionName={inst.institution_name}
                  websiteUrl={inst.website_url}
                  failureReason={inst.latest_failure_reason}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helper Components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`admin-card p-4 ${highlight ? "ring-1 ring-blue-200/60 dark:ring-blue-800/40" : ""}`}>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {value}
      </p>
    </div>
  );
}

function AgentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    running: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    failed: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  const cls = styles[status] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>
      {status}
    </span>
  );
}

function LaneMiniSummary({
  title,
  items,
}: {
  title: string;
  items: Array<[string, number]>;
}) {
  return (
    <div className="admin-card p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </p>
      <div className="grid grid-cols-5 gap-2 text-[11px]">
        {items.map(([label, value]) => (
          <div key={label}>
            <p className="text-gray-400">{label}</p>
            <p className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">
              {formatNumber(value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceMemoryTable({
  stateCode,
  rows,
  totalProfiles,
  canCorrect,
}: {
  stateCode: string;
  rows: StateSourceMemoryProfile[];
  totalProfiles: number;
  canCorrect: boolean;
}) {
  return (
    <section id="source-memory" className="admin-card mb-8 scroll-mt-24 overflow-hidden">
      <div className="flex flex-col gap-1 border-b border-gray-100 px-4 py-2.5 dark:border-white/[0.04] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-gray-400">
            Source Memory
          </h2>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            Institution source profiles prioritized by corrections, read backlog, failures, and unknown sources
          </p>
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
          Showing {formatNumber(rows.length)} of {formatNumber(totalProfiles)}
        </span>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="admin-table w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>Institution</th>
                <th>Source</th>
                <th>Kind</th>
                <th>Read</th>
                <th>Memory</th>
                <th>Last Activity</th>
                {canCorrect && <th>Correction</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.institutionId}>
                  <td className="min-w-[220px]">
                    <Link
                      href={`/admin/institution/${row.institutionId}`}
                      className="font-semibold text-gray-900 transition-colors hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-300"
                    >
                      {row.institutionName}
                    </Link>
                    <span className="mt-1 block text-[11px] text-gray-400">
                      {row.city ?? "No city"} · #{row.institutionId}
                    </span>
                  </td>
                  <td className="min-w-[260px]">
                    {row.canonicalSourceUrl || row.feeScheduleUrl ? (
                      <a
                        href={row.canonicalSourceUrl ?? row.feeScheduleUrl ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="block max-w-sm truncate font-mono text-[10px] font-medium text-blue-700 hover:text-blue-800 dark:text-blue-300"
                      >
                        {row.canonicalSourceUrl ?? row.feeScheduleUrl}
                      </a>
                    ) : (
                      <span className="text-gray-400">No fee source</span>
                    )}
                    {row.websiteUrl && (
                      <a
                        href={row.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block max-w-sm truncate font-mono text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        {row.websiteUrl}
                      </a>
                    )}
                  </td>
                  <td>
                    <SourceMemoryBadge value={formatToken(row.sourceKind)} tone={sourceKindTone(row.sourceKind)} />
                  </td>
                  <td>
                    <SourceMemoryBadge value={formatToken(row.readStrategy)} tone={readStrategyTone(row.readStrategy)} />
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {row.lockedByCorrection && <SourceMemoryBadge value="Locked" tone="blue" />}
                      {row.correctionCount > 0 && (
                        <SourceMemoryBadge value={`${formatNumber(row.correctionCount)} corrections`} tone="gray" />
                      )}
                      {row.consecutiveFailures > 0 && (
                        <SourceMemoryBadge value={`${formatNumber(row.consecutiveFailures)} failures`} tone="red" />
                      )}
                    </div>
                    {row.latestCorrectionType && (
                      <span className="mt-1 block text-[10px] text-gray-400">
                        Latest: {formatToken(row.latestCorrectionType)}
                      </span>
                    )}
                    {row.lastFailureReason && (
                      <span className="mt-1 block max-w-xs truncate text-[10px] text-red-600 dark:text-red-300">
                        {row.lastFailureReason}
                      </span>
                    )}
                  </td>
                  <td className="tabular-nums text-gray-500">
                    <span className="block">Success {formatDateTime(row.lastSuccessAt)}</span>
                    <span className="mt-1 block text-[10px] text-gray-400">
                      Updated {formatDateTime(row.updatedAt)}
                    </span>
                  </td>
                  {canCorrect && (
                    <td className="min-w-[340px]">
                      <SourceMemoryCorrectionForm stateCode={stateCode} row={row} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-5 text-xs text-gray-400">
          No source memory profiles are available for this state lane.
        </div>
      )}
    </section>
  );
}

type SourceMemoryTone = "gray" | "blue" | "green" | "amber" | "red";

function sourceKindTone(value: StateSourceMemoryProfile["sourceKind"]): SourceMemoryTone {
  if (value === "pdf" || value === "html") return "green";
  if (value === "scanned_pdf") return "amber";
  if (value === "offline") return "red";
  return "gray";
}

function readStrategyTone(value: StateSourceMemoryProfile["readStrategy"]): SourceMemoryTone {
  if (value === "pdf_text" || value === "html_dom") return "green";
  if (value === "browser_render") return "blue";
  if (value === "ocr" || value === "manual_review") return "amber";
  return "gray";
}

function SourceMemoryBadge({
  value,
  tone,
}: {
  value: string;
  tone: SourceMemoryTone;
}) {
  const cls = tone === "green"
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
    : tone === "blue"
      ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
        : tone === "red"
          ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
          : "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400";

  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${cls}`}>
      {value}
    </span>
  );
}

function PublicDiscoveryFindingsTable({
  stateCode,
  findings,
  totalOpen,
  canReview,
}: {
  stateCode: string;
  findings: StatePublicDiscoveryFinding[];
  totalOpen: number;
  canReview: boolean;
}) {
  return (
    <section id="public-discovery-findings" className="admin-card mb-8 scroll-mt-24 overflow-hidden">
      <div className="flex flex-col gap-1 border-b border-gray-100 px-4 py-2.5 dark:border-white/[0.04] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-gray-400">
            Public Discovery Findings
          </h2>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            Open deterministic page findings for this Atlas lane
          </p>
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
          Showing {formatNumber(findings.length)} of {formatNumber(totalOpen)}
        </span>
      </div>

      {findings.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="admin-table w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>Route</th>
                <th>Issue</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Cluster</th>
                <th>Observed</th>
                <th className="text-right">Run</th>
                {canReview && <th className="text-right">Decision</th>}
              </tr>
            </thead>
            <tbody>
              {findings.map((finding) => (
                <tr key={finding.id}>
                  <td className="min-w-[280px]">
                    <a
                      href={finding.finalUrl ?? finding.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-gray-900 transition-colors hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-300"
                    >
                      {finding.routeTemplate ?? "Public route"}
                    </a>
                    <span className="mt-1 block max-w-md truncate font-mono text-[10px] text-gray-400">
                      {finding.url}
                    </span>
                  </td>
                  <td>
                    <span className="font-semibold text-gray-800 dark:text-gray-200">
                      {formatIssueCode(finding.issueCode)}
                    </span>
                    <span className="mt-1 block max-w-sm text-[11px] text-gray-500 dark:text-gray-400">
                      {finding.message}
                    </span>
                  </td>
                  <td>
                    <SeverityBadge severity={finding.severity} />
                  </td>
                  <td className="tabular-nums text-gray-600 dark:text-gray-300">
                    {finding.statusCode ?? "n/a"}
                    {finding.viewport && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                        {finding.viewport}
                      </span>
                    )}
                  </td>
                  <td>
                    {finding.systemicCandidate || finding.clusterSize > 1 ? (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                        {finding.clusterSize} in template
                      </span>
                    ) : (
                      <span className="text-gray-400">Single</span>
                    )}
                  </td>
                  <td className="tabular-nums text-gray-500">
                    {formatDateTime(finding.observedAt ?? finding.createdAt)}
                  </td>
                  <td className="text-right">
                    {finding.agentRunId ? (
                      <Link
                        href={`/admin/states/${stateCode}/runs/${finding.agentRunId}`}
                        className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      >
                        #{finding.agentRunId}
                      </Link>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  {canReview && (
                    <td className="text-right">
                      <PublicFindingDecisionForm findingId={finding.id} stateCode={stateCode} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-5 text-xs text-gray-400">
          No open public discovery findings for this state lane.
        </div>
      )}
    </section>
  );
}

function SeverityBadge({ severity }: { severity: StatePublicDiscoveryFinding["severity"] }) {
  const cls = severity === "critical"
    ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
    : severity === "warning"
      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
      : "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400";

  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${cls}`}>
      {severity}
    </span>
  );
}
