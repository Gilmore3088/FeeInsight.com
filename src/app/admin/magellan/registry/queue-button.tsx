"use client";

import { useState } from "react";

export function QueueRegistryButton({ source }: { source: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function queue() {
    setState("busy");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/registry/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const body = (await response.json().catch(() => ({}))) as { runId?: number; partitionKey?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setState("done");
      setMessage(`Run #${body.runId} queued for ${body.partitionKey}`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={queue}
        disabled={state === "busy"}
        className="rounded-md border border-[var(--admin-border,#E0D7C9)] px-2 py-1 text-xs font-medium hover:bg-black/5 disabled:opacity-50"
      >
        {state === "busy" ? "Queuing…" : "Queue newest"}
      </button>
      {message && <span className={`text-xs ${state === "error" ? "text-red-700" : "text-[#5A5347]"}`}>{message}</span>}
    </div>
  );
}
