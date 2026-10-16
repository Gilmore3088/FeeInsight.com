"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { triggerAgentRunExecution } from "@/lib/agents/client-execution";
import { runSourceLinkRepair } from "./atlas-actions";

export function SourceLinkRepairControl({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function start(dryRun: boolean) {
    if (
      !dryRun &&
      !window.confirm("Link every live fee with no source link to its own document, and take down those with none? Run the dry run first.")
    ) {
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await runSourceLinkRepair(dryRun);
      if (!result.success || typeof result.runId !== "number") {
        setError(result.error ?? "Gutenberg could not start the source link run");
        return;
      }
      setMessage(`${result.reused ? "Already running" : "Started"}: run #${result.runId}.`);
      window.dispatchEvent(new CustomEvent("atlas:started", {
        detail: {
          runId: result.runId,
          title: result.title,
          label: result.title,
          agent: "gutenberg",
          reused: result.reused,
          startedAt: new Date().toISOString(),
        },
      }));
      triggerAgentRunExecution(result.runId);
      router.refresh();
    });
  }

  const buttonClass =
    "inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--brand-primary)] px-3 text-xs font-semibold text-[var(--brand-primary)] transition-colors hover:bg-[var(--brand-primary-soft)] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section aria-labelledby="source-link-heading">
      <div className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Catalog repair</p>
          <h2 id="source-link-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Fees with no source link
          </h2>
        </div>
        <p className="admin-meta">
          Gutenberg gives each live fee with no source link its own document’s URL, and takes down any fee that has no document to trace it to. Each change is logged and can be reversed.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => start(true)} disabled={disabled || pending} className={buttonClass}>
          <Link2 className="h-3.5 w-3.5" />
          Dry run
        </button>
        <button type="button" onClick={() => start(false)} disabled={disabled || pending} className={buttonClass}>
          Link or take down
        </button>
        {message && (
          <p role="status" className="text-xs text-gray-500">
            {message} <a href="#atlas-live-status" className="underline underline-offset-2">Live status</a>
          </p>
        )}
        {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      </div>
    </section>
  );
}
