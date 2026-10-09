"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Map,
  Play,
  RotateCw,
} from "lucide-react";
import { JobLaunchReceipt } from "@/components/agent-console/job-launch-receipt";
import { formatAdminDateTime } from "@/lib/admin-time";
import { triggerAgentRunExecution } from "@/lib/agents/client-execution";
import type { AtlasStateLaneDispatch, AtlasStateLaneDispatchRow, AtlasStateLaneStatus } from "@/lib/agents/state-lane-memory";
import { runAtlasDueStateLanes, runAtlasStateLane } from "./atlas-actions";
import { ATLAS_RUN_STATUSES_EVENT, finishedLaneRunLabel, type AtlasRunStatusesDetail } from "./atlas-run-statuses";

const DUE_BATCH_SIZE = 2;
const ACTIVE_JOB_LIMIT = 3;

function number(value: number): string {
  return value.toLocaleString("en-US");
}

function statusCopy(status: AtlasStateLaneStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "due":
      return "Due";
    case "attention":
      return "Attention";
    default:
      return "Scheduled";
  }
}

function statusClass(status: AtlasStateLaneStatus): string {
  switch (status) {
    case "running":
      return "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300";
    case "due":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300";
    case "attention":
      return "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400";
  }
}

/** "4 min old" for a cached snapshot, from its read time. */
export function snapshotAge(generatedAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(generatedAt).getTime()) / 60_000));
  if (minutes < 1) return "under a minute old";
  if (minutes < 60) return `${minutes} min old`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} old`;
}

function backlogTotal(row: AtlasStateLaneDispatchRow): number {
  return row.backlogMissingUrls
    + row.backlogStaleSources
    + row.backlogOcr
    + row.backlogManualReview
    + row.failures
    + row.publicFindings;
}

function laneReason(row: AtlasStateLaneDispatchRow): string {
  if (row.criticalPublicFindings > 0) {
    return `${number(row.criticalPublicFindings)} critical public page${row.criticalPublicFindings === 1 ? "" : "s"}`;
  }
  if (row.failures > 0) {
    return `${number(row.failures)} failed source/profile task${row.failures === 1 ? "" : "s"}`;
  }
  const readBacklog = row.backlogOcr + row.backlogManualReview;
  if (readBacklog > 0) {
    return `${number(readBacklog)} OCR/manual source${readBacklog === 1 ? "" : "s"}`;
  }
  if (row.publicFindings > 0) {
    return `${number(row.publicFindings)} public discovery finding${row.publicFindings === 1 ? "" : "s"}`;
  }
  if (row.backlogMissingUrls > 0) {
    return `${number(row.backlogMissingUrls)} missing fee URL${row.backlogMissingUrls === 1 ? "" : "s"}`;
  }
  if (row.backlogStaleSources > 0) {
    return `${number(row.backlogStaleSources)} stale source${row.backlogStaleSources === 1 ? "" : "s"}`;
  }
  if (row.status === "running" && row.activeRunId) return `Run #${row.activeRunId} is active`;
  if (row.status === "due") return "Scheduled lane is due";
  return "No open lane blockers";
}

function publicFindingCopy(row: AtlasStateLaneDispatchRow): string {
  if (row.publicFindings === 0) return "0";
  if (row.criticalPublicFindings > 0) {
    return `${number(row.criticalPublicFindings)} / ${number(row.publicFindings)}`;
  }
  return number(row.publicFindings);
}

function repairTarget(row: AtlasStateLaneDispatchRow): { href: string; label: string } {
  const stateHref = `/admin/states/${row.stateCode}`;
  if (row.criticalPublicFindings > 0) {
    return { href: `${stateHref}#public-discovery-findings`, label: "Review pages" };
  }
  if (row.publicFindings > 0) {
    return { href: `${stateHref}#public-discovery-findings`, label: "Review findings" };
  }
  if (row.backlogMissingUrls > 0) {
    return { href: `${stateHref}#url-resolution`, label: "Resolve URLs" };
  }
  if (row.failures > 0 || row.backlogOcr > 0 || row.backlogManualReview > 0 || row.backlogStaleSources > 0) {
    return { href: `${stateHref}#source-memory`, label: "Fix sources" };
  }
  if (row.status === "running" && row.activeRunId) {
    return { href: `${stateHref}/runs/${row.activeRunId}`, label: "Open run" };
  }
  return { href: `${stateHref}#state-lane-health`, label: "Open lane" };
}

function runDetail(runId: number, stateCode: string, reused: boolean): CustomEvent {
  return new CustomEvent("atlas:started", {
    detail: {
      runId,
      title: `Atlas ${stateCode} state lane`,
      label: `Atlas ${stateCode} state lane`,
      agent: "atlas",
      reused,
      startedAt: new Date().toISOString(),
    },
  });
}

export function AtlasStateLaneDispatchPanel({
  dispatch,
  automationEnabled,
  executionEnabled,
  executionBlockedReason,
  activeJobCount,
}: {
  dispatch: AtlasStateLaneDispatch;
  automationEnabled: boolean;
  executionEnabled: boolean;
  executionBlockedReason?: string;
  activeJobCount: number;
}) {
  const router = useRouter();
  const [selectedState, setSelectedState] = useState(
    dispatch.rows[0]?.stateCode ?? dispatch.stateOptions[0]?.stateCode ?? "",
  );
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    runId: number;
    stateCode: string;
    reused: boolean;
    batchCount?: number;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [liveStatuses, setLiveStatuses] = useState<ReadonlyMap<number, string>>(() => new globalThis.Map<number, string>());
  // Set after mount so the server render and hydration agree.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    function handleStatuses(event: Event) {
      const detail = (event as CustomEvent<AtlasRunStatusesDetail>).detail;
      if (!detail?.runs) return;
      setLiveStatuses(new globalThis.Map<number, string>(detail.runs.map((run) => [run.id, run.status])));
    }
    window.addEventListener(ATLAS_RUN_STATUSES_EVENT, handleStatuses);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(tick);
      window.removeEventListener(ATLAS_RUN_STATUSES_EVENT, handleStatuses);
    };
  }, []);

  const disabledReason = useMemo(() => {
    if (!dispatch.schemaReady) return "State lane schema is not ready";
    if (!automationEnabled) return "Automation is stopped";
    if (!executionEnabled) return executionBlockedReason ?? "Agentic backend is off";
    if (activeJobCount >= ACTIVE_JOB_LIMIT) return "Active run limit reached";
    return null;
  }, [activeJobCount, automationEnabled, dispatch.schemaReady, executionBlockedReason, executionEnabled]);

  // Lanes whose run the live ledger already shows as finished no longer count as running.
  const runningLanes = Math.max(
    0,
    dispatch.runningLanes - dispatch.rows.filter((row) => finishedLaneRunLabel(row, liveStatuses) !== null).length,
  );
  const controlsDisabled = Boolean(disabledReason) || isPending;
  const dueDisabled = controlsDisabled || dispatch.dueLanes === 0;
  const stateDisabled = controlsDisabled || !selectedState;

  function announceRun(runId: number, stateCode: string, reused: boolean) {
    window.dispatchEvent(runDetail(runId, stateCode, reused));
    triggerAgentRunExecution(runId);
    setReceipt({ runId, stateCode, reused });
  }

  function runDue() {
    setPendingCommand("due");
    setMessage(`Scheduling up to ${DUE_BATCH_SIZE} due state lanes...`);
    setError(null);
    setReceipt(null);
    startTransition(async () => {
      const result = await runAtlasDueStateLanes(DUE_BATCH_SIZE);
      setPendingCommand(null);
      if (!result.success) {
        setMessage(null);
        setError(result.error ?? "Due state lanes could not be scheduled.");
        return;
      }

      for (const run of result.runs ?? []) {
        window.dispatchEvent(runDetail(run.runId, run.stateCode, run.reused));
        triggerAgentRunExecution(run.runId);
      }

      const firstRun = result.runs?.[0];
      if (firstRun) {
        setReceipt({
          runId: firstRun.runId,
          stateCode: firstRun.stateCode,
          reused: firstRun.reused,
          batchCount: result.runs?.length,
        });
      }
      const failureText = result.failed?.length
        ? ` ${result.failed.length} lane${result.failed.length === 1 ? "" : "s"} failed to schedule.`
        : "";
      setMessage(`${result.scheduled ?? 0} lane${result.scheduled === 1 ? "" : "s"} scheduled; ${result.reused ?? 0} reused.${failureText}`);
      router.refresh();
    });
  }

  function runSelectedState(stateCode: string) {
    if (!stateCode) return;
    setPendingCommand(stateCode);
    setMessage(`Scheduling Atlas ${stateCode} state lane...`);
    setError(null);
    setReceipt(null);
    startTransition(async () => {
      const result = await runAtlasStateLane(stateCode);
      setPendingCommand(null);
      if (!result.success || !result.runId || !result.stateCode) {
        setMessage(null);
        setError(result.error ?? `Atlas ${stateCode} state lane could not be scheduled.`);
        return;
      }
      announceRun(result.runId, result.stateCode, Boolean(result.reused));
      setMessage(`Atlas ${result.stateCode} lane #${result.runId} ${result.reused ? "selected" : "created"}.`);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="state-lane-dispatch-heading">
      <div className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Atlas state lanes</p>
          <h2 id="state-lane-dispatch-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Dispatch state-sized work
          </h2>
        </div>
        <Link
          href="/admin/states"
          className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          Open map<ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid gap-4 border-y border-black/[0.06] py-5 lg:grid-cols-[1.15fr_0.85fr] dark:border-white/[0.06]">
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DispatchMetric label="Total lanes" value={number(dispatch.totalLanes)} icon={Map} />
            <DispatchMetric label="Due now" value={number(dispatch.dueLanes)} icon={Clock3} tone={dispatch.dueLanes > 0 ? "warning" : "default"} />
            <DispatchMetric label="Running" value={number(runningLanes)} icon={Activity} tone={runningLanes > 0 ? "active" : "default"} />
            <DispatchMetric label="Need attention" value={number(dispatch.attentionLanes)} icon={AlertTriangle} tone={dispatch.attentionLanes > 0 ? "danger" : "default"} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <SmallMetric label="Missing URLs" value={number(dispatch.totalMissingUrls)} />
            <SmallMetric label="Stale sources" value={number(dispatch.totalStaleSources)} />
            <SmallMetric label="OCR/manual" value={number(dispatch.totalOcrBacklog + dispatch.totalManualBacklog)} />
            <SmallMetric label="Corrections" value={number(dispatch.totalCorrections)} />
            <SmallMetric label="Public findings" value={number(dispatch.totalPublicFindings)} />
            <SmallMetric label="Critical pages" value={number(dispatch.totalCriticalPublicFindings)} />
          </div>
          <p className="admin-meta mt-3">
            Next due {formatAdminDateTime(dispatch.nextDueAfter)} · latest lane run {formatAdminDateTime(dispatch.latestRunAt)}
          </p>
          <p className="admin-meta mt-1">
            Lane snapshot read {formatAdminDateTime(dispatch.generatedAt)}
            {now !== null ? ` (${snapshotAge(dispatch.generatedAt, now)})` : ""}. A run the live ledger shows as finished is marked here.
          </p>
        </div>

        <div className="rounded-md border border-black/[0.06] bg-gray-50/60 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={runDue}
              disabled={dueDisabled}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-gray-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200 dark:disabled:bg-white/[0.08] dark:disabled:text-gray-500"
            >
              {pendingCommand === "due" ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {dispatch.dueLanes > 0 ? `Run ${Math.min(dispatch.dueLanes, DUE_BATCH_SIZE)} due lane${Math.min(dispatch.dueLanes, DUE_BATCH_SIZE) === 1 ? "" : "s"}` : "No due lanes"}
            </button>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <label className="sr-only" htmlFor="atlas-state-lane-select">State lane</label>
              <select
                id="atlas-state-lane-select"
                value={selectedState}
                onChange={(event) => setSelectedState(event.target.value)}
                disabled={controlsDisabled || dispatch.stateOptions.length === 0}
                className="min-h-10 rounded-md border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-800 outline-none transition-colors focus:border-blue-400 dark:border-white/[0.08] dark:bg-[oklch(0.18_0_0)] dark:text-gray-100"
              >
                {dispatch.stateOptions.map((state) => (
                  <option key={state.stateCode} value={state.stateCode}>
                    {state.stateCode} · {state.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => runSelectedState(selectedState)}
                disabled={stateDisabled}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--brand-primary)] px-3 text-xs font-semibold text-[var(--brand-primary)] transition-colors hover:bg-[var(--brand-primary-soft)] disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:border-gray-700"
              >
                {pendingCommand === selectedState ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Run state
              </button>
            </div>

            <p className={`text-xs ${disabledReason ? "text-amber-700 dark:text-amber-300" : "text-gray-500 dark:text-gray-400"}`}>
              {disabledReason ?? "Manual dispatch uses the same lane scheduler, idempotency key, run ledger, and live status as cron."}
            </p>
            {message && <p role="status" className="text-xs font-medium text-blue-700 dark:text-blue-300">{message}</p>}
            {error && <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-300">{error}</p>}
          </div>
        </div>
      </div>

      {receipt && (
        <div className="mt-4">
          <JobLaunchReceipt
            jobId={receipt.runId}
            title={`Atlas ${receipt.stateCode} state lane`}
            owner="atlas"
            command={receipt.batchCount && receipt.batchCount > 1 ? `state-lane batch · ${receipt.batchCount}` : "state-lane"}
            scope={receipt.batchCount && receipt.batchCount > 1 ? "due state lanes" : receipt.stateCode}
            reused={receipt.reused}
            detail="Atlas created the lane run and the live status feed will show each specialist handoff."
          />
        </div>
      )}

      <div className="mt-5 overflow-x-auto border-y border-black/[0.06] dark:border-white/[0.06]">
        <table className="admin-table w-full text-xs">
          <thead>
            <tr>
              <th>State</th>
              <th>Status</th>
              <th className="text-right">Backlog</th>
              <th className="text-right">Failures</th>
              <th className="text-right">Public</th>
              <th>Last success</th>
              <th>Next run</th>
              <th className="text-right">Next action</th>
            </tr>
          </thead>
          <tbody>
            {dispatch.rows.map((row) => {
              const target = repairTarget(row);
              const finished = finishedLaneRunLabel(row, liveStatuses);
              return (
                <tr key={row.stateCode}>
                  <td>
                    <Link href={`/admin/states/${row.stateCode}`} className="font-semibold text-gray-900 transition-colors hover:text-blue-600 dark:text-gray-100">
                      {row.stateCode}
                    </Link>
                    <span className="ml-2 text-gray-500">{row.name}</span>
                  </td>
                  <td>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${finished ? statusClass("scheduled") : statusClass(row.status)}`}>
                      {finished ?? statusCopy(row.status)}
                    </span>
                    {row.activeRunId && (
                      <span className="ml-2 font-mono text-[10px] text-gray-400">#{row.activeRunId}</span>
                    )}
                    <span className="mt-1 block text-[10px] text-gray-400">
                      {laneReason(row)}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    {number(backlogTotal(row))}
                    <span className="ml-1 text-gray-400">items</span>
                  </td>
                  <td className={`text-right tabular-nums ${row.failures > 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-gray-500"}`}>
                    {number(row.failures)}
                  </td>
                  <td className={`text-right tabular-nums ${row.criticalPublicFindings > 0 ? "font-semibold text-red-700 dark:text-red-400" : row.publicFindings > 0 ? "font-semibold text-amber-700 dark:text-amber-400" : "text-gray-500"}`}>
                    {publicFindingCopy(row)}
                    {row.criticalPublicFindings > 0 && (
                      <span className="ml-1 text-[10px] text-gray-400">critical/open</span>
                    )}
                  </td>
                  <td className="tabular-nums text-gray-500">{formatAdminDateTime(row.lastSuccessAt)}</td>
                  <td className="tabular-nums text-gray-500">{formatAdminDateTime(row.nextRunAfter)}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={target.href}
                        className="inline-flex min-h-8 items-center justify-center rounded-md border border-blue-200 px-2.5 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-50 dark:border-blue-900/60 dark:text-blue-300 dark:hover:bg-blue-950/30"
                      >
                        {target.label}
                      </Link>
                      <button
                        type="button"
                        onClick={() => runSelectedState(row.stateCode)}
                        disabled={controlsDisabled || pendingCommand === row.stateCode}
                        className="inline-flex min-h-8 items-center justify-center rounded-md border border-gray-200 px-2.5 text-[11px] font-semibold text-gray-600 transition-colors hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:border-blue-900/60 dark:hover:text-blue-300"
                      >
                        {pendingCommand === row.stateCode ? "Queueing" : "Run"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {dispatch.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-gray-400">
                  {dispatch.schemaReady ? "No state lanes available." : "State lane schema is not available in this database."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DispatchMetric({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: typeof Map;
  tone?: "default" | "warning" | "danger" | "active";
}) {
  const toneClass = tone === "warning"
    ? "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/30"
    : tone === "danger"
      ? "text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/30"
      : tone === "active"
        ? "text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/30"
        : "text-gray-600 bg-gray-100 dark:text-gray-300 dark:bg-white/[0.06]";
  return (
    <div className="rounded-md border border-black/[0.06] p-3 dark:border-white/[0.06]">
      <div className="flex items-center justify-between gap-3">
        <p className="admin-label">{label}</p>
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-gray-900 dark:text-gray-100">
        {value}
      </p>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="admin-label">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {value}
      </p>
    </div>
  );
}
