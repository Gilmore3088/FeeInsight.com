"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowRight, DatabaseZap, RotateCw } from "lucide-react";
import { JobLaunchReceipt } from "@/components/agent-console/job-launch-receipt";
import { triggerAgentRunExecution } from "@/lib/agents/client-execution";
import { runAtlasWorkflow } from "../atlas-actions";

type QueuedJob = {
  id: number;
  reused: boolean;
};

const NEXT_STEPS = [
  {
    href: "/admin/magellan",
    label: "Discover + fetch",
    detail: "Open Magellan when source URLs or stale collection attempts need rescue.",
  },
  {
    href: "/admin/rosetta",
    label: "Read sources",
    detail: "Open Rosetta when fetched PDFs or HTML need normalized text artifacts.",
  },
  {
    href: "/admin/knox",
    label: "Extract raw fees",
    detail: "Open Knox when Rosetta text is ready for fee observation extraction or exception review.",
  },
  {
    href: "/admin/darwin",
    label: "Verify raw fees",
    detail: "Open Darwin when raw observations need verified categories, lineage checks, and amount checks.",
  },
  {
    href: "/admin/fees/catalog",
    label: "Inspect published fees",
    detail: "Check national medians and maturity by fee type after publish jobs finish.",
  },
] as const;

export function DataOperations() {
  const [pending, startTransition] = useTransition();
  const [queuedJob, setQueuedJob] = useState<QueuedJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startEnhancement() {
    setQueuedJob(null);
    setError(null);
    startTransition(async () => {
      const result = await runAtlasWorkflow("enhance");
      if (!result.success || typeof result.runId !== "number") {
        setError(result.error ?? "Enhancement could not be queued");
        return;
      }
      setQueuedJob({ id: result.runId, reused: Boolean(result.reused) });
      window.dispatchEvent(new CustomEvent("atlas:started", {
        detail: {
          runId: result.runId,
          title: result.title ?? "Enhance institution data",
          label: "Institution data enhancement",
          agent: "atlas",
          reused: result.reused,
          startedAt: new Date().toISOString(),
        },
      }));
      triggerAgentRunExecution(result.runId);
    });
  }

  return (
    <section aria-labelledby="data-ops-heading" className="space-y-4">
      <div className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Data operations</p>
          <h2 id="data-ops-heading" className="mt-1 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Enhance, then move data forward
          </h2>
        </div>
      </div>

      <div className="grid gap-5 border-y border-black/[0.06] py-5 lg:grid-cols-[minmax(260px,0.9fr)_1.2fr] dark:border-white/[0.06]">
        <div>
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]">
              <DatabaseZap className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Enhance institution attributes</p>
              <p className="admin-meta mt-1">Refreshes institution attributes before discovery, extraction, classification, and benchmark review.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={startEnhancement}
            disabled={pending}
            className="admin-bg-brand mt-4 inline-flex min-h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold shadow-sm transition-[transform,background-color] hover:-translate-y-px hover:bg-[var(--brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {pending ? <RotateCw className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
            {pending ? "Queueing enhancement" : "Start enhancement"}
          </button>
        </div>

        <div className="divide-y divide-black/[0.06] border-y border-black/[0.06] lg:border-y-0 dark:divide-white/[0.06] dark:border-white/[0.06]">
          {NEXT_STEPS.map((step, index) => (
            <Link key={step.href} href={step.href} className="group grid gap-2 py-3 transition-colors hover:bg-black/[0.015] sm:grid-cols-[140px_1fr_auto] sm:items-center dark:hover:bg-white/[0.02]">
              <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">{index + 2}. {step.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{step.detail}</p>
              <ArrowRight className="h-3.5 w-3.5 text-gray-300 transition-colors group-hover:text-[var(--brand-primary)]" />
            </Link>
          ))}
        </div>
      </div>

      {queuedJob && (
        <JobLaunchReceipt
          jobId={queuedJob.id}
          title="Institution data enhancement"
          owner="atlas"
          command="enrich"
          scope="Eligible institutions"
          reused={queuedJob.reused}
          detail="Atlas will refresh institution attributes used by discovery, extraction, classification, and benchmark views."
        />
      )}
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
    </section>
  );
}
