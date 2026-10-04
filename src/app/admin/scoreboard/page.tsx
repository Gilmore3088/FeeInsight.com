export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import {
  listScoreboardSnapshots,
  scoreboardSchemaReady,
  type ScoreboardSnapshotRow,
} from "@/lib/data-store/answer-key";
import { runScoreboardNowAction } from "../answer-key/actions";

interface Metric {
  key: keyof ScoreboardSnapshotRow;
  label: string;
  unit: string;
  format: (value: number) => string;
  detail: (row: ScoreboardSnapshotRow) => string;
  /** True when a lower number is better (freshness, in days). */
  lowerIsBetter?: boolean;
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

const METRICS: Metric[] = [
  {
    key: "coverage_rate",
    label: "Coverage",
    unit: "% of active institutions with a website",
    format: percent,
    detail: (row) => `${(row.coverage_numerator ?? 0).toLocaleString()} of ${(row.coverage_denominator ?? 0).toLocaleString()} have a fee link whose newest text passed the fee-page check`,
  },
  {
    key: "right_document_rate",
    label: "Right document",
    unit: "% of reads that passed the fee-page check (30 days)",
    format: percent,
    detail: (row) => `${(row.right_document_numerator ?? 0).toLocaleString()} of ${(row.right_document_denominator ?? 0).toLocaleString()} read attempts`,
  },
  {
    key: "knox_yield",
    label: "Knox yield",
    unit: "fees per priced line (answer-key sample)",
    format: (value) => value.toFixed(2),
    detail: (row) => `${(row.knox_yield_fees ?? 0).toLocaleString()} fees from ${(row.knox_yield_priced_lines ?? 0).toLocaleString()} lines with a $ amount, ${row.knox_yield_sample_size ?? 0} texts`,
  },
  {
    key: "depth_median_categories",
    label: "Depth",
    unit: "median fee categories per live institution",
    format: (value) => value.toFixed(1),
    detail: (row) => `${(row.depth_live_institutions ?? 0).toLocaleString()} institutions with live fees`,
  },
  {
    key: "accuracy_precision",
    label: "Accuracy",
    unit: "% precision against the answer key (end to end)",
    format: percent,
    detail: (row) => `recall ${row.accuracy_recall == null ? "—" : percent(row.accuracy_recall)}`,
  },
  {
    key: "freshness_median_days",
    label: "Freshness",
    unit: "median age of live fees, days",
    format: (value) => value.toFixed(1),
    detail: (row) => `${(row.freshness_live_fees ?? 0).toLocaleString()} live fees`,
    lowerIsBetter: true,
  },
];

function Sparkline({ values }: { values: Array<number | null> }) {
  const points = values
    .map((value, index) => (value == null ? null : { x: index, y: value }))
    .filter((point): point is { x: number; y: number } => point != null);
  if (points.length < 2) return <p className="text-[10px] text-gray-400">Trend appears after two days.</p>;
  const width = 200;
  const height = 36;
  const ys = points.map((point) => point.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const maxX = Math.max(values.length - 1, 1);
  const path = points
    .map((point, index) => {
      const x = (point.x / maxX) * width;
      const y = height - 2 - ((point.y - min) / span) * (height - 4);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-9 w-full text-[var(--brand-primary)]" role="img" aria-label="30-day trend">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

export default async function ScoreboardPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  await requireAuth("view");
  const { message } = await searchParams;
  const ready = await scoreboardSchemaReady().catch(() => false);
  const rows = ready ? await listScoreboardSnapshots(30) : [];
  const latest = rows.at(-1) ?? null;
  const previous = rows.length > 1 ? rows.at(-2) ?? null : null;

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <Breadcrumbs items={[{ label: "Crew", href: "/admin" }, { label: "Scoreboard" }]} />
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Scoreboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Six numbers Atlas records every day{latest ? ` (latest ${latest.snapshot_date})` : ""}. No model calls.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/answer-key" className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:border-white/[0.08] dark:text-gray-300">
            Answer key
          </Link>
          <form action={runScoreboardNowAction}>
            <button type="submit" className="rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
              Score now
            </button>
          </form>
        </div>
      </header>

      {message ? (
        <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-200">{message}</p>
      ) : null}

      {!ready ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
          The scoreboard migration (20270106050000_answer_key_and_scoreboard.sql) is not applied yet.
        </p>
      ) : !latest ? (
        <p className="py-12 text-center text-sm text-gray-400">No snapshots yet. The daily Atlas run records the first one, or press Score now.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {METRICS.map((metric) => {
            const value = latest[metric.key] as number | null;
            const before = previous ? (previous[metric.key] as number | null) : null;
            const delta = value != null && before != null ? value - before : null;
            const better = delta == null || delta === 0 ? null : metric.lowerIsBetter ? delta < 0 : delta > 0;
            return (
              <div key={metric.key} className="admin-card space-y-1 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{metric.label}</p>
                <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                  {value == null ? "—" : metric.format(value)}
                  {delta != null && delta !== 0 ? (
                    <span className={`ml-2 text-xs font-semibold ${better ? "text-emerald-600" : "text-red-600"}`}>
                      {delta > 0 ? "+" : "−"}{metric.format(Math.abs(delta))}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-gray-500">{metric.unit}</p>
                <Sparkline values={rows.map((row) => row[metric.key] as number | null)} />
                <p className="text-[11px] text-gray-400">{metric.detail(latest)}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
