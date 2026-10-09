"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  runStateLaneFormAction,
  type StateLaneRunActionState,
} from "./actions";
import { formatAdminTime } from "@/lib/admin-time";

const INITIAL_STATE: StateLaneRunActionState | null = null;

/** After this long, a pending click explains that the run may already exist. */
export const SLOW_SCHEDULING_MS = 15_000;

export type ActiveStateLaneRun = {
  id: number;
  status: string;
  startedAt: string | null;
};

function startedLabel(startedAt: string | null): string {
  if (!startedAt) return "";
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  return ` since ${formatAdminTime(startedAt)}`;
}

export function StateLaneRunControl({
  stateCode,
  blockedReason,
  activeRun = null,
}: {
  stateCode: string;
  blockedReason: string | null;
  activeRun?: ActiveStateLaneRun | null;
}) {
  const [state, formAction, isPending] = useActionState(runStateLaneFormAction, INITIAL_STATE);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!isPending) return;
    const timer = setTimeout(() => setSlow(true), SLOW_SCHEDULING_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [isPending]);
  const disabled = Boolean(blockedReason) || isPending;

  if (activeRun && !isPending && !state) {
    return (
      <div className="grid justify-items-end gap-1.5">
        <p role="status" className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:border-blue-400/30 dark:bg-blue-950/30 dark:text-blue-300">
          Run #{activeRun.id} {activeRun.status}{startedLabel(activeRun.startedAt)}
          <Link
            href={`/admin/states/${stateCode}/runs/${activeRun.id}`}
            className="ml-2 underline underline-offset-2"
          >
            Open run
          </Link>
        </p>
        <p className="max-w-xs text-right text-[10px] font-medium text-gray-500 dark:text-gray-400">
          Steps advance on each scheduler tick. Refresh to see the latest.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid justify-items-end gap-1.5">
      <input type="hidden" name="state_code" value={stateCode} />
      <button
        type="submit"
        disabled={disabled}
        title={blockedReason ?? "Schedule this state lane"}
        className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:text-gray-700 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
      >
        {isPending ? "Scheduling Lane" : blockedReason ? "State Lane Paused" : "Run State Lane"}
      </button>
      {isPending && slow && (
        <p role="status" className="max-w-xs text-right text-[10px] font-medium text-amber-700 dark:text-amber-300">
          Still waiting for the server. The run may already exist; refresh this page to check.
        </p>
      )}
      {blockedReason && (
        <p className="max-w-xs text-right text-[10px] font-medium text-amber-700 dark:text-amber-300">
          {blockedReason}
        </p>
      )}
      {state?.message && (
        <p role="status" className="max-w-xs rounded bg-emerald-50 px-2 py-1 text-right text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          {state.message}
          {state.runId && state.stateCode && (
            <Link
              href={`/admin/states/${state.stateCode}/runs/${state.runId}`}
              className="ml-1 font-semibold underline underline-offset-2"
            >
              Open run
            </Link>
          )}
        </p>
      )}
      {state?.error && (
        <p role="alert" className="max-w-xs rounded bg-red-50 px-2 py-1 text-right text-[10px] font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
