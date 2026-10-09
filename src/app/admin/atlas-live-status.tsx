"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, Clock3, RotateCw, TerminalSquare, XCircle } from "lucide-react";
import { triggerAgentRunExecution } from "@/lib/agents/client-execution";
import { formatAdminDateTime } from "@/lib/admin-time";
import { AtlasCancelButton } from "./atlas-cancel-button";
import { ATLAS_RUN_STATUSES_EVENT, type AtlasRunStatusesDetail } from "./atlas-run-statuses";

type LiveJob = {
  id: number;
  command: string;
  title?: string;
  agent: string;
  status: string;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  heartbeatAt: string | null;
  updatedAt: string | null;
  backendReceipt: string | null;
  error: string | null;
  resultSummary: string | null;
  stdoutTail: string | null;
  pipelineRunId: number | null;
  pipelineStatus: string | null;
  lastCompletedJob: string | null;
  stagesDone: number | null;
  stagesTotal: number | null;
  pipelineError: string | null;
  pickupState?: "waiting_for_pickup" | "stale_queued" | "running" | "stale_running" | "blocked" | "terminal";
  pickupMessage?: string;
  pickupStale?: boolean;
  nextPickupAt?: string | null;
  pickupAgeSeconds?: number | null;
  steps?: LiveRunStep[];
  events?: LiveRunEvent[];
};

type LiveRunStep = {
  id: number;
  key: string;
  title: string;
  agent: string;
  status: string;
  sequence: number;
  summary: string | null;
  error: string | null;
  updatedAt: string;
};

type LiveRunEvent = {
  id: number;
  eventType: string;
  status: string;
  message: string;
  createdAt: string;
};

type Snapshot = {
  generatedAt: string;
  activeJobs: LiveJob[];
  recentJobs: LiveJob[];
};

type AtlasStartedDetail = {
  runId?: number;
  title?: string;
  label?: string;
  agent?: string;
  reused?: boolean;
  startedAt?: string;
};

type PendingLaunch = {
  runId: number;
  title: string;
  label: string;
  agent: string;
  reused: boolean;
  startedAt: string;
};

const ACTIVE_STATUSES = ["queued", "running", "cancel_requested"];

function dateTime(value: string | null): string {
  return formatAdminDateTime(value, { seconds: true });
}

function duration(start: string | null, end: string | null): string {
  if (!start) return "Waiting";
  const elapsedMs = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (elapsedMs < 1000) return "<1s";
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function statusTone(status: string): string {
  if (status === "completed") return "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/30";
  if (status === "running") return "text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30";
  if (status === "queued" || status === "cancel_requested") return "text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30";
  if (status === "cancelled") return "text-gray-700 bg-gray-100 dark:text-gray-300 dark:bg-white/[0.08]";
  return "text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950/30";
}

function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.includes(status);
}

function pendingLaunchJob(launch: PendingLaunch): LiveJob {
  return {
    id: launch.runId,
    command: launch.title,
    title: launch.title,
    agent: launch.agent,
    status: "queued",
    createdAt: launch.startedAt,
    startedAt: null,
    completedAt: null,
    heartbeatAt: null,
    updatedAt: launch.startedAt,
    backendReceipt: "agentic_v1",
    error: null,
    resultSummary: launch.reused
      ? "Existing run found. Waiting for the live status refresh."
      : "Run record accepted. Waiting for the agentic status snapshot.",
    stdoutTail: null,
    pipelineRunId: null,
    pipelineStatus: null,
    lastCompletedJob: null,
    stagesDone: null,
    stagesTotal: null,
    pipelineError: null,
    pickupState: "waiting_for_pickup",
    pickupMessage: "Run is queued and waiting for client execution or the next Vercel cron pickup.",
    pickupStale: false,
    nextPickupAt: null,
    pickupAgeSeconds: 0,
    steps: [],
    events: [],
  };
}

function relativeAge(seconds: number | null | undefined): string {
  if (seconds == null) return "unknown age";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function pickupTone(job: LiveJob): string {
  if (job.pickupStale || job.pickupState === "blocked") {
    return "border-red-200 bg-red-50 text-red-900 dark:border-red-950 dark:bg-red-950/30 dark:text-red-200";
  }
  if (job.pickupState === "running") {
    return "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-950 dark:bg-blue-950/30 dark:text-blue-200";
  }
  if (job.pickupState === "terminal") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200";
  }
  return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-950 dark:bg-amber-950/30 dark:text-amber-200";
}

export function AtlasLiveStatus({
  initialActiveJobs,
  initialGeneratedAt,
}: {
  initialActiveJobs: LiveJob[];
  initialGeneratedAt: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    generatedAt: initialGeneratedAt,
    activeJobs: initialActiveJobs,
    recentJobs: [],
  });
  const [pendingLaunch, setPendingLaunch] = useState<PendingLaunch | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [, setNowTick] = useState(0);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/admin/atlas/status", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Snapshot;
      setSnapshot(data);
      setPollError(null);
    } catch (error) {
      setPollError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    function handleStarted(event: Event) {
      const detail = (event as CustomEvent<AtlasStartedDetail>).detail;
      if (typeof detail?.runId === "number") {
        setPendingLaunch({
          runId: detail.runId,
          title: detail.title ?? detail.label ?? "Atlas run",
          label: detail.label ?? "Atlas run",
          agent: detail.agent ?? "atlas",
          reused: Boolean(detail.reused),
          startedAt: detail.startedAt ?? new Date().toISOString(),
        });
      }
      const statusElement = document.getElementById("atlas-live-status");
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      statusElement?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      void refresh();
    }

    window.addEventListener("atlas:started", handleStarted);
    return () => window.removeEventListener("atlas:started", handleStarted);
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Share each live read of the run ledger, so the state-lane table on this page
  // shows the same terminal status as Recent outcomes instead of its cached snapshot.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(ATLAS_RUN_STATUSES_EVENT, {
      detail: {
        generatedAt: snapshot.generatedAt,
        runs: [...snapshot.activeJobs, ...snapshot.recentJobs].map((job) => ({ id: job.id, status: job.status })),
      } satisfies AtlasRunStatusesDetail,
    }));
  }, [snapshot]);

  useEffect(() => {
    if (snapshot.activeJobs.length === 0 && pendingLaunch === null) return;
    const interval = window.setInterval(refresh, 3000);
    return () => window.clearInterval(interval);
  }, [pendingLaunch, refresh, snapshot.activeJobs.length]);

  useEffect(() => {
    if (pendingLaunch === null) return;
    if (snapshot.activeJobs.some((job) => job.id === pendingLaunch.runId)) return;
    const terminalJob = snapshot.recentJobs.find((job) => job.id === pendingLaunch.runId);
    if (!terminalJob || isActiveStatus(terminalJob.status)) return;
    const timeout = window.setTimeout(() => setPendingLaunch(null), 15000);
    return () => window.clearTimeout(timeout);
  }, [pendingLaunch, snapshot.activeJobs, snapshot.recentJobs]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const watchedJob = useMemo(() => {
    if (pendingLaunch) {
      const matchingJob = snapshot.activeJobs.find((job) => job.id === pendingLaunch.runId)
        ?? snapshot.recentJobs.find((job) => job.id === pendingLaunch.runId);
      return matchingJob ?? pendingLaunchJob(pendingLaunch);
    }
    if (snapshot.activeJobs.length > 0) return snapshot.activeJobs[0];
    return null;
  }, [pendingLaunch, snapshot.activeJobs, snapshot.recentJobs]);

  const isActive = watchedJob ? isActiveStatus(watchedJob.status) : false;
  const showingPendingLaunch = Boolean(
    pendingLaunch
      && watchedJob?.id === pendingLaunch.runId
      && !snapshot.activeJobs.some((job) => job.id === pendingLaunch.runId)
      && !snapshot.recentJobs.some((job) => job.id === pendingLaunch.runId),
  );

  useEffect(() => {
    if (watchedJob?.status === "queued") {
      triggerAgentRunExecution(watchedJob.id);
    }
  }, [watchedJob?.id, watchedJob?.status]);

  return (
    <section id="atlas-live-status" aria-labelledby="active-heading" className="scroll-mt-6 grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
      <div>
        <div className="admin-section-header">
          <div>
            <p className="admin-eyebrow">Execution</p>
            <h2 id="active-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              What is visible now?
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-black/10 px-2.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/[0.04]"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {!watchedJob ? (
          <div className="border-y border-black/[0.06] py-7 dark:border-white/[0.06]">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No active agent run</p>
            <p className="admin-meta mt-1">A started workflow appears here with its owner, backend, step ledger, and event stream.</p>
          </div>
        ) : (
          <div className="border-y border-black/[0.06] py-5 dark:border-white/[0.06]">
            {showingPendingLaunch && pendingLaunch && (
              <div role="status" className="mb-5 rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-blue-900 dark:border-blue-950 dark:bg-blue-950/30 dark:text-blue-200">
                <p className="text-xs font-semibold">
                  {pendingLaunch.reused ? "Existing run selected" : "Run accepted"}
                </p>
                <p className="mt-1 text-xs">
                  {pendingLaunch.label} #{pendingLaunch.runId} is visible locally. This panel is polling for steps and events.
                </p>
              </div>
            )}
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {isActive ? <Activity className="h-4 w-4 text-blue-600" /> : watchedJob.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Run #{watchedJob.id} · {watchedJob.title ?? watchedJob.command}</p>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${statusTone(watchedJob.status)}`}>
                    {watchedJob.status.replace("_", " ")}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold capitalize text-gray-600 dark:bg-white/[0.06] dark:text-gray-400">
                    {watchedJob.agent}
                  </span>
                </div>
                <p className="admin-meta mt-1">
                  Backend {watchedJob.backendReceipt ?? "agentic_v1"}
                </p>
              </div>
              {isActive && <AtlasCancelButton runId={watchedJob.id} />}
            </div>

            <div className="mt-5 grid gap-4 text-xs sm:grid-cols-4">
              <LiveDatum label="Started" value={dateTime(watchedJob.startedAt ?? watchedJob.createdAt)} />
              <LiveDatum label="Elapsed" value={duration(watchedJob.startedAt ?? watchedJob.createdAt, watchedJob.completedAt)} />
              <LiveDatum label="Heartbeat" value={dateTime(watchedJob.heartbeatAt ?? watchedJob.updatedAt)} />
              <LiveDatum label="Progress" value={watchedJob.stagesTotal ? `${watchedJob.stagesDone ?? 0} / ${watchedJob.stagesTotal}` : "Pending"} />
            </div>

            {isActive && watchedJob.pickupMessage && (
              <div role={watchedJob.pickupStale ? "alert" : "status"} className={`mt-5 rounded-md border px-3 py-3 ${pickupTone(watchedJob)}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold">
                      {watchedJob.pickupStale ? "Pickup needs attention" : "Pickup status"}
                    </p>
                    <p className="mt-1 text-xs">{watchedJob.pickupMessage}</p>
                  </div>
                  <p className="shrink-0 text-[11px] font-semibold tabular-nums">
                    {relativeAge(watchedJob.pickupAgeSeconds)} old
                  </p>
                </div>
                {watchedJob.nextPickupAt && (
                  <p className="mt-2 text-[11px] opacity-80">Expected cron pickup by {dateTime(watchedJob.nextPickupAt)}.</p>
                )}
              </div>
            )}

            {watchedJob.steps && watchedJob.steps.length > 0 ? (
              <StageRail job={watchedJob} />
            ) : (
              <JobLifecycleRail job={watchedJob} />
            )}

            {watchedJob.events && watchedJob.events.length > 0 && (
              <div className="mt-5 rounded-md border border-black/[0.06] bg-white dark:border-white/[0.06] dark:bg-white/[0.02]">
                <div className="border-b border-black/[0.06] px-3 py-2 dark:border-white/[0.06]">
                  <p className="admin-label">Event stream</p>
                </div>
                <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
                  {watchedJob.events.slice(-5).map((event) => (
                    <div key={event.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium text-gray-800 dark:text-gray-200">{event.message}</p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${statusTone(event.status)}`}>
                          {event.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="admin-meta mt-1">{event.eventType} · {dateTime(event.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(watchedJob.resultSummary || watchedJob.error || watchedJob.pipelineError) && (
              <div className="mt-5 rounded-md border border-black/[0.06] bg-gray-50 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <p className="admin-label">{watchedJob.error || watchedJob.pipelineError ? "Current issue" : "Latest result"}</p>
                <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">
                  {watchedJob.error ?? watchedJob.pipelineError ?? watchedJob.resultSummary}
                </p>
              </div>
            )}

            {watchedJob.stdoutTail ? (
              <div className="mt-5 overflow-hidden rounded-md border border-black/[0.08] bg-gray-950 dark:border-white/[0.08]">
                <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
                  <TerminalSquare className="h-3.5 w-3.5 text-gray-400" />
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Output tail</p>
                </div>
                <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300">
                  {watchedJob.stdoutTail}
                </pre>
              </div>
            ) : isActive ? (
              <div className="mt-5 rounded-md border border-dashed border-black/[0.12] px-3 py-3 dark:border-white/[0.12]">
                <p className="font-mono text-[11px] text-gray-500">Agentic runs report through the step ledger and event stream above. Raw stdout is not used for this backend.</p>
              </div>
            ) : null}

            {pollError && <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-400">Live refresh failed: {pollError}</p>}
            <p className="admin-meta mt-3">Last checked {dateTime(snapshot.generatedAt)}</p>
          </div>
        )}
      </div>

      <div>
        <div className="admin-section-header">
          <div>
            <p className="admin-eyebrow">Recent runs</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              Last outcomes
            </h2>
          </div>
        </div>
        <div className="divide-y divide-black/[0.06] border-y border-black/[0.06] dark:divide-white/[0.06] dark:border-white/[0.06]">
          {snapshot.recentJobs.slice(0, 5).map((job) => (
            <div key={job.id} className="grid gap-1 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-xs font-semibold text-gray-900 dark:text-gray-100">#{job.id} · {job.title ?? job.command}</p>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${statusTone(job.status)}`}>
                  {job.status.replace("_", " ")}
                </span>
              </div>
              <p className="admin-meta capitalize">{job.agent} · {dateTime(job.completedAt ?? job.startedAt ?? job.createdAt)}</p>
              {(job.error || job.resultSummary) && (
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">{job.error ?? job.resultSummary}</p>
              )}
            </div>
          ))}
          {snapshot.recentJobs.length === 0 && (
            <div className="py-6">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No terminal agent runs yet.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function LiveDatum({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="admin-label">{label}</p>
      <p className="mt-1 font-medium text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}

function StageRail({ job }: { job: LiveJob }) {
  const steps = job.steps ?? [];
  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((step) => {
        const completed = step.status === "completed" || step.status === "skipped";
        const active = step.status === "running" || step.status === "queued";
        const blocked = step.status === "blocked" || step.status === "failed";
        return (
          <div
            key={step.id}
            className={`min-h-16 rounded-md border px-3 py-2 ${
              completed
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-300"
                : active
                  ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-950 dark:bg-blue-950/20 dark:text-blue-300"
                  : blocked
                    ? "border-red-200 bg-red-50 text-red-800 dark:border-red-950 dark:bg-red-950/20 dark:text-red-300"
                    : "border-black/[0.06] bg-white text-gray-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-gray-400"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wide">{step.agent}</p>
              {active && <Clock3 className="h-3.5 w-3.5" />}
            </div>
            <p className="mt-2 truncate text-[11px] font-semibold">{step.title}</p>
            <p className="mt-1 truncate font-mono text-[10px]">{step.key} · {step.status.replace("_", " ")}</p>
            {(step.error || step.summary) && (
              <p className="mt-1 truncate text-[10px] opacity-80">{step.error ?? step.summary}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function JobLifecycleRail({ job }: { job: LiveJob }) {
  const steps = [
    {
      key: "queued",
      label: "Queued",
      detail: "Job record",
      complete: Boolean(job.createdAt),
      active: job.status === "queued",
    },
    {
      key: "backend",
      label: "Backend",
      detail: job.backendReceipt ?? "agentic_v1",
      complete: Boolean(job.backendReceipt),
      active: false,
    },
    {
      key: "worker",
      label: "Worker",
      detail: job.heartbeatAt ? "Heartbeat seen" : "No heartbeat",
      complete: Boolean(job.startedAt || job.heartbeatAt),
      active: job.status === "running",
    },
    {
      key: "result",
      label: "Result",
      detail: job.completedAt ? "Terminal" : "Pending",
      complete: Boolean(job.completedAt),
      active: job.status === "cancel_requested",
    },
  ];

  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-4">
      {steps.map((step) => (
        <div
          key={step.key}
          className={`min-h-16 rounded-md border px-3 py-2 ${
            step.complete
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-300"
              : step.active
                ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-950 dark:bg-blue-950/20 dark:text-blue-300"
                : "border-black/[0.06] bg-white text-gray-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-gray-400"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wide">{step.label}</p>
            {step.active && <Clock3 className="h-3.5 w-3.5" />}
          </div>
          <p className="mt-2 truncate font-mono text-[10px]">{step.detail}</p>
        </div>
      ))}
    </div>
  );
}
