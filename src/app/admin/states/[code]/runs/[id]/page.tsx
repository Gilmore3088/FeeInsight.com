export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { formatAdminDateTime } from "@/lib/admin-time";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { getAgentRunDetail } from "@/lib/data-store/states";
import type { AgentRunResult } from "@/lib/data-store/states";
import { getAgentRun, getAgentRunEvents, getAgentRunSteps } from "@/lib/agents/run-store";
import type { AgentRunEventSnapshot, AgentRunSnapshot, AgentRunStepSnapshot } from "@/lib/agents/types";
import { buildRunSummaryStats, isLedgerOnlyRun } from "./run-detail-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InstitutionRow {
  institution_id: number;
  institution_name: string;
  discover: AgentRunResult | null;
  classify: AgentRunResult | null;
  extract: AgentRunResult | null;
  validate: AgentRunResult | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGES = ["discover", "classify", "extract", "validate"] as const;

function buildInstitutionRows(results: AgentRunResult[]): InstitutionRow[] {
  const map = new Map<number, InstitutionRow>();
  for (const r of results) {
    if (!map.has(r.institution_id)) {
      map.set(r.institution_id, {
        institution_id: r.institution_id,
        institution_name: r.institution_name,
        discover: null,
        classify: null,
        extract: null,
        validate: null,
      });
    }
    const row = map.get(r.institution_id)!;
    const stage = r.stage as (typeof STAGES)[number];
    if (STAGES.includes(stage)) {
      row[stage] = r;
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.institution_name.localeCompare(b.institution_name),
  );
}

function failuresByStage(results: AgentRunResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) {
    if (r.status === "failed") {
      counts[r.stage] = (counts[r.stage] ?? 0) + 1;
    }
  }
  return counts;
}

function commonFailureReasons(
  results: AgentRunResult[],
): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of results) {
    if (r.status !== "failed") continue;
    const reason =
      (r.detail?.reason as string) ??
      (r.detail?.error as string) ??
      "Unknown";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function dateTime(value: string | null | undefined): string {
  return formatAdminDateTime(value ?? null, { seconds: true });
}

function duration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end || start === "-" || end === "-") return "-";
  const ms =
    new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms) || ms < 0) return "-";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AgentRunDetailPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  await requireAuth("operate");
  const { code, id } = await params;
  const stateCode = code.toUpperCase();
  const runId = Number(id);

  if (isNaN(runId)) notFound();

  const [{ run, results }, ledgerRun, ledgerSteps, ledgerEvents] = await Promise.all([
    getAgentRunDetail(runId),
    getAgentRun(runId),
    getAgentRunSteps(runId),
    getAgentRunEvents(runId, 50),
  ]);
  if (!run || run.state_code !== stateCode) notFound();

  const rows = buildInstitutionRows(results);
  const stageFailures = failuresByStage(results);
  const reasons = commonFailureReasons(results);
  const summaryStats = buildRunSummaryStats({ legacyRun: run, steps: ledgerSteps });
  const ledgerOnly = isLedgerOnlyRun({ results, steps: ledgerSteps });
  const title = ledgerRun?.title ?? `Agent Run #${run.id}`;
  const status = ledgerRun?.status ?? run.status;
  const startedAt = ledgerRun?.startedAt ?? (run.started_at === "-" ? null : run.started_at);
  const completedAt = ledgerRun?.completedAt ?? (run.completed_at === "-" ? null : run.completed_at);

  return (
    <>
      {/* Header */}
      <div className="mb-5">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/admin" },
            { label: "States", href: "/admin/states" },
            { label: stateCode, href: `/admin/states/${stateCode}` },
            { label: `Run #${run.id}` },
          ]}
        />
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {title}
          </h1>
          <StatusBadge status={status} />
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Run #{run.id} · {dateTime(startedAt)}
          {completedAt && (
            <span>
              {" "}&mdash; {dateTime(completedAt)} ({duration(startedAt, completedAt)})
            </span>
          )}
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-8">
        {summaryStats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            alert={stat.alert}
          />
        ))}
      </div>

      <AgentRunLedger
        run={ledgerRun}
        steps={ledgerSteps}
        events={ledgerEvents}
      />

      {/* Per-institution Results */}
      <div className="admin-card overflow-hidden mb-8">
        <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.04]">
          <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em]">
            Per-Institution Results ({rows.length})
          </h2>
        </div>
        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="admin-table w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th>Institution</th>
                  <th className="text-center">Discover</th>
                  <th className="text-center">Classify</th>
                  <th className="text-center">Extract</th>
                  <th className="text-center">Validate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.institution_id}
                    className="hover:bg-gray-50/50 dark:hover:bg-white/[0.04] transition-colors"
                  >
                    <td className="text-gray-900 dark:text-gray-100 font-medium">
                      <Link
                        href={`/admin/institution/${row.institution_id}`}
                        className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        {row.institution_name}
                      </Link>
                    </td>
                    <td className="text-center">
                      <StageCell result={row.discover} stage="discover" />
                    </td>
                    <td className="text-center">
                      <StageCell result={row.classify} stage="classify" />
                    </td>
                    <td className="text-center">
                      <StageCell result={row.extract} stage="extract" />
                    </td>
                    <td className="text-center">
                      <StageCell result={row.validate} stage="validate" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-xs text-gray-400 text-center">
            {ledgerOnly
              ? "This Atlas run uses the shared step ledger. No per-institution legacy result rows were recorded."
              : "No results recorded for this run"}
          </div>
        )}
      </div>

      {/* Summaries */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Failures by Stage */}
        <div className="admin-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.04]">
            <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em]">
              Failures by Stage
            </h2>
          </div>
          {Object.keys(stageFailures).length > 0 ? (
            <div className="p-4 space-y-2">
              {STAGES.map((stage) =>
                stageFailures[stage] ? (
                  <div key={stage} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700 dark:text-gray-300 capitalize">
                      {stage}
                    </span>
                    <span className="text-red-600 dark:text-red-400 font-bold tabular-nums">
                      {stageFailures[stage]}
                    </span>
                  </div>
                ) : null,
              )}
            </div>
          ) : (
            <div className="p-4 text-xs text-gray-400 text-center">
              No failures
            </div>
          )}
        </div>

        {/* Common Failure Reasons */}
        <div className="admin-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.04]">
            <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em]">
              Common Failure Reasons
            </h2>
          </div>
          {reasons.length > 0 ? (
            <div className="p-4 space-y-2">
              {reasons.map((entry, i) => (
                <div key={i} className="flex items-start justify-between gap-4 text-xs">
                  <span
                    className="text-gray-600 dark:text-gray-400 break-words min-w-0"
                    title={entry.reason}
                  >
                    {truncate(entry.reason)}
                  </span>
                  <span className="text-red-600 dark:text-red-400 font-bold tabular-nums shrink-0">
                    {entry.count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-xs text-gray-400 text-center">
              No failures
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helper Components
// ---------------------------------------------------------------------------

function AgentRunLedger({
  run,
  steps,
  events,
}: {
  run: AgentRunSnapshot | null;
  steps: AgentRunStepSnapshot[];
  events: AgentRunEventSnapshot[];
}) {
  if (!run && steps.length === 0 && events.length === 0) return null;

  return (
    <section aria-labelledby="agent-ledger-heading" className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="agent-ledger-heading" className="text-[11px] font-bold uppercase tracking-[0.08em] text-gray-400">
          Atlas Run Ledger
        </h2>
        {run && (
          <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold capitalize text-gray-600 dark:bg-white/[0.06] dark:text-gray-400">
            {run.runKind.replace("_", " ")}
          </span>
        )}
      </div>

      {run && (
        <div className="mb-4 grid gap-3 border-y border-black/[0.06] py-4 text-xs sm:grid-cols-2 lg:grid-cols-5 dark:border-white/[0.06]">
          <LedgerDatum label="Title" value={run.title} />
          <LedgerDatum label="Owner" value={run.agent} capitalize />
          <LedgerDatum label="Backend" value={run.backend} />
          <LedgerDatum label="Progress" value={`${run.progressCurrent} / ${run.progressTotal}`} />
          <LedgerDatum label="Current step" value={run.currentStage ?? "Terminal"} />
          <LedgerDatum label="Trigger" value={run.triggerSource} capitalize />
          <LedgerDatum label="Started" value={dateTime(run.startedAt)} />
          <LedgerDatum label="Updated" value={dateTime(run.updatedAt)} />
          <LedgerDatum label="Completed" value={dateTime(run.completedAt)} />
          <LedgerDatum label="Correlation" value={run.correlationId || "-"} mono />
        </div>
      )}

      {steps.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {steps.map((step) => (
            <LedgerStepCard key={step.id} step={step} />
          ))}
        </div>
      ) : (
        <div className="border-y border-black/[0.06] py-5 text-xs text-gray-400 dark:border-white/[0.06]">
          No step ledger rows are attached to this run.
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-md border border-black/[0.06] dark:border-white/[0.06]">
        <div className="border-b border-black/[0.06] px-3 py-2 dark:border-white/[0.06]">
          <p className="admin-label">Event stream</p>
        </div>
        {events.length > 0 ? (
          <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {events.map((event) => (
              <div key={event.id} className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[160px_1fr_auto] sm:items-center">
                <div>
                  <p className="font-mono text-[10px] text-gray-500">{event.eventType}</p>
                  <p className="mt-1 tabular-nums text-[10px] text-gray-400">{dateTime(event.createdAt)}</p>
                </div>
                <p className="text-gray-700 dark:text-gray-300">{event.message}</p>
                <LedgerStatusBadge status={event.status} />
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 py-5 text-xs text-gray-400">
            No events are attached to this run.
          </div>
        )}
      </div>

      {run?.summary && (
        <div className="mt-4 rounded-md border border-black/[0.06] bg-gray-50 px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <p className="admin-label">Run summary</p>
          <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">{run.summary}</p>
        </div>
      )}

      {run?.error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-red-900 dark:border-red-950 dark:bg-red-950/25 dark:text-red-200">
          <p className="text-[10px] font-bold uppercase tracking-wide">Run error</p>
          <p className="mt-1 text-xs">{run.error}</p>
        </div>
      )}
    </section>
  );
}

function LedgerDatum({
  label,
  value,
  capitalize,
  mono,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="admin-label">{label}</p>
      <p className={`mt-1 truncate font-medium text-gray-900 dark:text-gray-100 ${capitalize ? "capitalize" : ""} ${mono ? "font-mono text-[10px]" : ""}`} title={value}>
        {value}
      </p>
    </div>
  );
}

function LedgerStepCard({ step }: { step: AgentRunStepSnapshot }) {
  const completed = step.status === "completed" || step.status === "skipped";
  const active = step.status === "running" || step.status === "queued";
  const blocked = step.status === "blocked" || step.status === "failed";
  const tone = completed
    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-200"
    : active
      ? "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-950 dark:bg-blue-950/20 dark:text-blue-200"
      : blocked
        ? "border-red-200 bg-red-50 text-red-900 dark:border-red-950 dark:bg-red-950/20 dark:text-red-200"
        : "border-black/[0.06] bg-white text-gray-600 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-gray-300";

  return (
    <div className={`min-h-28 rounded-md border px-3 py-3 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide">{step.agent}</p>
          <p className="mt-1 truncate text-xs font-semibold" title={step.title}>{step.title}</p>
        </div>
        <LedgerStatusBadge status={step.status} />
      </div>
      <p className="mt-2 font-mono text-[10px] opacity-80">
        {step.sequence}. {step.stepKey}
      </p>
      {(step.error || step.summary) && (
        <p className="mt-2 line-clamp-2 text-[11px] opacity-90" title={step.error ?? step.summary ?? undefined}>
          {step.error ?? step.summary}
        </p>
      )}
      <p className="mt-2 text-[10px] opacity-70">
        Updated {dateTime(step.updatedAt)}
      </p>
    </div>
  );
}

function LedgerStatusBadge({ status }: { status: string }) {
  const cls = status === "completed" || status === "success" || status === "ok"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
    : status === "queued" || status === "running"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
      : status === "skipped" || status === "cancelled"
        ? "bg-gray-100 text-gray-700 dark:bg-white/[0.08] dark:text-gray-300"
        : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200";

  return (
    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function StatCard({
  label,
  value,
  alert,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div className="admin-card p-4">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p
        className={`text-xl font-bold tabular-nums ${
          alert
            ? "text-red-600 dark:text-red-400"
            : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued:
      "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    completed:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    running:
      "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    blocked:
      "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    failed:
      "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    cancelled:
      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };
  const cls =
    styles[status] ??
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}
    >
      {status}
    </span>
  );
}

function StageCell({
  result,
  stage,
}: {
  result: AgentRunResult | null;
  stage: string;
}) {
  if (!result) {
    return <span className="text-gray-300 dark:text-gray-600">--</span>;
  }

  const { status, detail } = result;

  if (status === "ok" || status === "success" || status === "completed") {
    let extra = "";
    if (stage === "extract" && detail?.fee_count != null) {
      extra = ` (${detail.fee_count})`;
    }
    if (stage === "validate" && detail?.data_quality != null) {
      extra = ` (${detail.data_quality})`;
    }
    return (
      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
        ok{extra}
      </span>
    );
  }

  if (status === "skipped") {
    return (
      <span className="text-gray-400 dark:text-gray-500">skipped</span>
    );
  }

  // Failed
  const reason =
    (detail?.reason as string) ??
    (detail?.error as string) ??
    "";
  return (
    <span
      className="text-red-600 dark:text-red-400 font-medium cursor-help"
      title={reason || "Failed"}
    >
      failed
      {reason && (
        <span className="block text-[10px] text-red-400 dark:text-red-500 font-normal max-w-[160px] truncate mx-auto">
          {truncate(reason, 40)}
        </span>
      )}
    </span>
  );
}
