"use client";

import { useState, useTransition } from "react";
import { CircleStop, Play, ShieldAlert, X } from "lucide-react";
import {
  markProviderBillingResolved,
  resumeAllAutomation,
  setMarketingPaused,
  setPipelinePaused,
  stopAllAutomation,
} from "./atlas-actions";
import { providerStopLabel } from "@/lib/console/control-labels";

interface Props {
  enabled: boolean;
  /** The provider stop could not be read; work is held but no operator set it. */
  unreadable?: boolean;
  reason: string | null;
  changedBy: string;
  changedAtLabel: string;
  activeJobCount: number;
  pipelineEnabled: boolean;
  pipelineReason: string | null;
  pipelineChangedBy: string;
  pipelineChangedAtLabel: string;
  marketingEnabled: boolean;
  marketingReason: string | null;
  marketingChangedBy: string;
  marketingChangedAtLabel: string;
}

export function AtlasEmergencyControl({
  enabled,
  unreadable = false,
  reason,
  changedBy,
  changedAtLabel,
  activeJobCount,
  pipelineEnabled,
  pipelineReason,
  pipelineChangedBy,
  pipelineChangedAtLabel,
  marketingEnabled,
  marketingReason,
  marketingChangedBy,
  marketingChangedAtLabel,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [stopReason, setStopReason] = useState("Potential runaway API activity");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const billingStop = /credit balance is too low|insufficient credits|purchase credits/i.test(reason ?? "");
  const [billingResolved, setBillingResolved] = useState(false);
  const resumeBlockedReason = billingStop && !billingResolved
    ? "Fix provider billing, then mark billing resolved before resuming."
    : null;

  function resolveBilling() {
    startTransition(async () => {
      const result = await markProviderBillingResolved("Operator confirmed provider billing is fixed");
      if (result.success) setBillingResolved(true);
      setMessage(result.success ? "Billing marked resolved. You can resume automation." : result.error ?? "Could not record billing resolution");
    });
  }

  function togglePipeline() {
    startTransition(async () => {
      const result = await setPipelinePaused(
        pipelineEnabled,
        pipelineEnabled ? "Operator paused deterministic pipeline" : "Operator resumed deterministic pipeline",
      );
      setMessage(
        result.success
          ? pipelineEnabled ? "Pipeline paused. Queued runs stay queued." : "Pipeline resumed."
          : result.error ?? "Pipeline control failed",
      );
    });
  }

  function toggleMarketing() {
    startTransition(async () => {
      const result = await setMarketingPaused(
        marketingEnabled,
        marketingEnabled ? "Operator paused marketing" : "Operator resumed marketing",
      );
      setMessage(
        result.success
          ? marketingEnabled ? "Marketing paused. Queued marketing runs stay queued; the pipeline keeps going." : "Marketing resumed."
          : result.error ?? "Marketing control failed",
      );
    });
  }

  const pipelineRow = (
    <div className="mt-3 flex flex-col justify-between gap-3 border-t border-black/[0.06] pt-3 sm:flex-row sm:items-center dark:border-white/[0.06]">
      <div>
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">
          Pipeline {pipelineEnabled ? "running" : "paused"}
        </p>
        <p className="admin-meta mt-1">
          {pipelineEnabled
            ? "Discover, fetch, read, extract, verify, and publish run on schedule. They never call paid providers."
            : `Deterministic steps are paused. ${pipelineReason ?? ""}`}
          {" "}Changed by {pipelineChangedBy} · {pipelineChangedAtLabel}
        </p>
      </div>
      <button
        type="button"
        onClick={togglePipeline}
        disabled={pending}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 px-4 text-xs font-bold text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        {pipelineEnabled ? <CircleStop className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        {pipelineEnabled ? "Pause pipeline" : "Resume pipeline"}
      </button>
    </div>
  );

  const marketingRow = (
    <div className="mt-3 flex flex-col justify-between gap-3 border-t border-black/[0.06] pt-3 sm:flex-row sm:items-center dark:border-white/[0.06]">
      <div>
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">
          Marketing {marketingEnabled ? "running" : "paused"}
        </p>
        <p className="admin-meta mt-1">
          {marketingEnabled
            ? "Growth drafts posts and emails for your approval. Pausing it leaves the pipeline running."
            : `Growth's marketing steps are paused; the pipeline keeps running. ${marketingReason ?? ""}`}
          {" "}Changed by {marketingChangedBy} · {marketingChangedAtLabel}
        </p>
      </div>
      <button
        type="button"
        onClick={toggleMarketing}
        disabled={pending}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 px-4 text-xs font-bold text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        {marketingEnabled ? <CircleStop className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        {marketingEnabled ? "Pause marketing" : "Resume marketing"}
      </button>
    </div>
  );

  function engage() {
    startTransition(async () => {
      const result = await stopAllAutomation(stopReason);
      if (!result.success) {
        setMessage(result.error ?? "Emergency stop failed");
        return;
      }
      const failureCount = result.cancellationFailures?.length ?? 0;
      setMessage(
        failureCount > 0
          ? `Stop engaged. ${result.cancelled ?? 0} runs cancelled; ${failureCount} need operator attention.`
          : `Stop engaged. ${result.cancelled ?? 0} of ${result.requested ?? 0} active runs cancelled.`,
      );
      setConfirming(false);
    });
  }

  function resume() {
    startTransition(async () => {
      const result = await resumeAllAutomation("Operator reviewed usage and resumed automation");
      setMessage(result.success ? "Automation resumed." : result.error ?? "Resume failed");
    });
  }

  if (!enabled) {
    return (
      <section id="atlas-safety" className="border-y border-red-300 bg-red-50/70 px-4 py-4 dark:border-red-900/70 dark:bg-red-950/20" aria-label="Emergency stop status">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
            <div>
              <p className="text-sm font-bold text-red-900 dark:text-red-200">
                {unreadable
                  ? `${providerStopLabel(null)}: provider steps are held until it reads again`
                  : `${providerStopLabel(false)}: provider automation stop is active`}
              </p>
              {unreadable && (
                <p className="mt-1 text-xs text-red-800/80 dark:text-red-300/80">
                  This is not a confirmed switch setting. <button type="button" onClick={() => window.location.reload()} className="font-semibold underline underline-offset-2">Retry the read</button>
                </p>
              )}
              <p className="mt-1 text-xs text-red-800/80 dark:text-red-300/80">
                Paid AI provider calls and provider steps are blocked. Deterministic pipeline steps follow the pipeline control below. {reason ?? "No reason recorded."}
              </p>
              <p className="mt-1 text-[10px] text-red-700/70 dark:text-red-400/70">
                Changed by {changedBy} · {changedAtLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resume}
            disabled={pending || Boolean(resumeBlockedReason)}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-red-800 px-4 text-xs font-bold text-white transition-colors hover:bg-red-900 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {pending ? "Resuming..." : resumeBlockedReason ? "Resume blocked" : "Resume automation"}
          </button>
        </div>
        {resumeBlockedReason && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-xs font-medium text-red-800 dark:text-red-300" role="status">{resumeBlockedReason}</p>
            <button
              type="button"
              onClick={resolveBilling}
              disabled={pending}
              className="rounded-md border border-red-400 px-3 py-1.5 text-xs font-bold text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              Mark billing resolved
            </button>
          </div>
        )}
        {pipelineRow}
        {marketingRow}
        {message && <p className="mt-3 text-xs font-medium text-red-800 dark:text-red-300" role="status">{message}</p>}
      </section>
    );
  }

  return (
    <section id="atlas-safety" className="border-y border-black/[0.06] py-3 dark:border-white/[0.06]" aria-label="Emergency stop control">
      {!confirming ? (
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">Automation safety</p>
            <p className="admin-meta mt-1">{providerStopLabel(true)}: paid provider steps may run when the budget policy allows. {activeJobCount} run{activeJobCount === 1 ? "" : "s"} active.</p>
          </div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-red-300 px-4 text-xs font-bold text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/20"
          >
            <CircleStop className="h-4 w-4" />
            Emergency stop
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(260px,0.7fr)_auto] lg:items-end">
          <div>
            <p className="text-sm font-bold text-red-800 dark:text-red-300">Stop all automation?</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              The gate closes first, then Atlas cancels {activeJobCount} active agent run{activeJobCount === 1 ? "" : "s"}.
            </p>
          </div>
          <label className="block">
            <span className="admin-label">Incident reason</span>
            <input
              value={stopReason}
              onChange={(event) => setStopReason(event.target.value)}
              maxLength={500}
              className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-xs text-gray-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              aria-label="Cancel emergency stop confirmation"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={engage}
              disabled={pending || stopReason.trim().length < 3}
              className="h-10 rounded-md bg-red-700 px-4 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {pending ? "Stopping..." : "Stop all now"}
            </button>
          </div>
        </div>
      )}
      {pipelineRow}
      {marketingRow}
      {message && <p className="mt-3 text-xs font-medium text-gray-700 dark:text-gray-300" role="status">{message}</p>}
    </section>
  );
}
