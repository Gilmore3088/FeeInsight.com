import Link from "next/link";
import { ArrowRight, Check, CircleAlert, PauseCircle } from "lucide-react";
import type { AttentionItem } from "@/lib/admin-command-center";
import type { PipelineFunnel } from "@/lib/data-store/pipeline-funnel";
import type { PipelineHealth } from "@/lib/job-health";

export type PipelineStatus = "running" | "paused" | "attention";

export function pipelineStatus(health: PipelineHealth, problems: string[]): PipelineStatus {
  if (!health.pipeline_enabled) return "paused";
  return problems.length > 0 ? "attention" : "running";
}

const STATUS_COPY: Record<PipelineStatus, { label: string; detail: string; tone: string }> = {
  running: {
    label: "Running",
    detail: "The pipeline is ticking, draining work, and publishing.",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200",
  },
  paused: {
    label: "Paused",
    detail: "An operator paused the pipeline. Queued runs wait until it is resumed.",
    tone: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200",
  },
  attention: {
    label: "Needs attention",
    detail: "The pipeline is not healthy:",
    tone: "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200",
  },
};

function count(value: number): string {
  return value.toLocaleString("en-US");
}

function share(value: number, total: number): string {
  if (total <= 0) return "—";
  const pct = (value / total) * 100;
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

function ago(minutes: number | null): string {
  if (minutes === null) return "never";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** Prefer exact minutes; fall back to whole hours only for payloads that lack them. */
export function publishMinutes(health: PipelineHealth): number | null {
  if (health.minutes_since_last_publish !== undefined) return health.minutes_since_last_publish;
  return health.hours_since_last_publish === null ? null : health.hours_since_last_publish * 60;
}

interface FunnelStep {
  label: string;
  value: number;
  note: string;
}

export function funnelSteps(funnel: PipelineFunnel): FunnelStep[] {
  const universe = funnel.institutions;
  return [
    { label: "Institutions", value: funnel.institutions, note: "institutions · universe" },
    { label: "Fee URL found", value: funnel.withFeeUrl, note: `institutions · ${share(funnel.withFeeUrl, universe)} of universe` },
    { label: "Documents fetched", value: funnel.documentsFetched, note: "documents · successful fetches" },
    { label: "Documents read", value: funnel.textsRead, note: "documents · normalized text" },
    { label: "Fees extracted", value: funnel.rawExtracted, note: "fee rows · raw (Knox)" },
    { label: "Fees verified", value: funnel.verified, note: "fee rows · verified" },
    {
      label: "Institutions published",
      value: funnel.sourcedInstitutions,
      note: `institutions · ${share(funnel.sourcedInstitutions, universe)} sourced · ${count(funnel.publishedInstitutions)} any`,
    },
  ];
}

export function AtlasOverview({
  health,
  problems,
  funnel,
  attention,
}: {
  health: PipelineHealth;
  problems: string[];
  funnel: PipelineFunnel;
  attention: AttentionItem[];
}) {
  const status = pipelineStatus(health, problems);
  const copy = STATUS_COPY[status];
  const topAttention = attention.slice(0, 3);
  const minutesSincePublish = publishMinutes(health);

  return (
    <section aria-label="Pipeline overview" className="space-y-5">
      <div className={`rounded-lg border px-4 py-4 ${copy.tone}`} role="status">
        <div className="flex items-center gap-2">
          {status === "running" ? (
            <Check className="h-5 w-5" />
          ) : status === "paused" ? (
            <PauseCircle className="h-5 w-5" />
          ) : (
            <CircleAlert className="h-5 w-5" />
          )}
          <p className="text-lg font-semibold tracking-tight">Pipeline: {copy.label}</p>
        </div>
        <p className="mt-1 text-sm">{copy.detail}</p>
        {status !== "running" && problems.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-6 text-sm">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        )}
      </div>

      <div>
        <p className="admin-section-title">Is the database growing?</p>
        <ol className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {funnelSteps(funnel).map((step, index) => (
            <li
              key={step.label}
              className="relative rounded-md border border-black/[0.06] px-3 py-2 dark:border-white/[0.08]"
            >
              <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                {index + 1}. {step.label}
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {count(step.value)}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{step.note}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <OverviewStat label="Runs completed · 24h" value={count(health.runs_completed_24h ?? 0)} />
        <OverviewStat
          label="Runs failed · 24h"
          value={count(health.runs_failed_24h ?? 0)}
          danger={(health.runs_failed_24h ?? 0) > 0}
        />
        <OverviewStat label="Last successful tick" value={ago(health.minutes_since_successful_tick)} />
        <OverviewStat label="Last publish" value={ago(minutesSincePublish)} />
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <p className="admin-section-title">Needs you</p>
          {attention.length > topAttention.length && (
            <a href="#atlas-coverage" className="text-xs font-semibold text-[var(--brand-primary)]">
              All {attention.length} items
            </a>
          )}
        </div>
        {topAttention.length === 0 ? (
          <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-300">Nothing needs you right now.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/[0.06] border-y border-black/[0.06] dark:divide-white/[0.06] dark:border-white/[0.06]">
            {topAttention.map((item) => (
              <li key={item.id} className="flex flex-col justify-between gap-1 py-2 sm:flex-row sm:items-center">
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.title}</p>
                  <p className="admin-meta">{item.detail}</p>
                </div>
                <Link
                  href={item.href}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--brand-primary)]"
                >
                  {item.action}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function OverviewStat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-md border border-black/[0.06] px-3 py-2 dark:border-white/[0.08]">
      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${danger ? "text-red-700 dark:text-red-400" : "text-gray-900 dark:text-gray-100"}`}>
        {value}
      </p>
    </div>
  );
}
