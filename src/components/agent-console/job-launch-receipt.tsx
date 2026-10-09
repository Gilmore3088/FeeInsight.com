"use client";

import Link from "next/link";
import { CheckCircle2, ExternalLink } from "lucide-react";

export function JobLaunchReceipt({
  jobId,
  title,
  owner,
  command,
  scope,
  reused = false,
  compact = false,
  detail = "Atlas records the run immediately, then the agentic backend attaches steps, events, and worker output.",
}: {
  jobId: number;
  title: string;
  owner: string;
  command: string;
  scope: string;
  reused?: boolean;
  compact?: boolean;
  detail?: string;
}) {
  const rootClassName = compact
    ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-950 dark:border-emerald-950 dark:bg-emerald-950/25 dark:text-emerald-100"
    : "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950 dark:border-emerald-950 dark:bg-emerald-950/25 dark:text-emerald-100";

  return (
    <div role="status" className={rootClassName}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
            <p className="text-sm font-semibold">
              {reused ? "Existing run selected" : "Run created"} · #{jobId}
            </p>
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-white/[0.08] dark:text-emerald-200">
              {owner}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium">{title}</p>
          <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">{detail}</p>
        </div>
        <Link
          href="/admin/live"
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md bg-emerald-900 px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-800 dark:bg-emerald-100 dark:text-emerald-950 dark:hover:bg-white"
        >
          Track live<ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      <dl className={`${compact ? "mt-2 gap-2 pt-2" : "mt-3 gap-3 pt-3"} grid border-t border-emerald-200 text-xs sm:grid-cols-3 dark:border-emerald-900`}>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Scope</dt>
          <dd className="mt-1 font-medium">{scope}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Plan</dt>
          <dd className="mt-1 truncate font-mono text-[11px]">{command}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Next status</dt>
          <dd className="mt-1 font-medium">{reused ? "Resume watching active run" : "Waiting for run events"}</dd>
        </div>
      </dl>
    </div>
  );
}
