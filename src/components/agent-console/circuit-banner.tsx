"use client";

import { useState } from "react";
import { RotateCw, ShieldAlert } from "lucide-react";
import type { AgentStatus } from "./types";

export function CircuitBanner({
  status,
  onReset,
}: {
  status: Omit<AgentStatus, "pending"> & { pending?: number | null };
  onReset: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (!status.circuit.halted) return null;

  async function reset() {
    setBusy(true);
    try {
      await onReset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col justify-between gap-3 border-y border-red-200 bg-red-50/70 px-4 py-3 dark:border-red-900/70 dark:bg-red-950/20 sm:flex-row sm:items-center">
      <div className="flex gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
        <div>
          <p className="text-sm font-bold text-red-900 dark:text-red-200">Work is paused for this agent</p>
          <p className="mt-1 text-xs text-red-800/80 dark:text-red-300/80">
            {status.circuit.reason ?? "The circuit breaker did not record a reason."}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={reset}
        disabled={busy}
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-red-300 bg-white px-3 text-xs font-semibold text-red-800 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
      >
        {busy && <RotateCw className="h-3.5 w-3.5 animate-spin" />}
        {busy ? "Resetting" : "Reset agent"}
      </button>
    </div>
  );
}
