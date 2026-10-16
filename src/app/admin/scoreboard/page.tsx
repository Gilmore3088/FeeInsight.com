export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import {
  listScoreboardSnapshots,
  scoreboardSchemaReady,
  seriesBreaks,
  type ScoreboardSnapshotRow,
} from "@/lib/data-store/answer-key";
import { runScoreboardNowAction } from "../answer-key/actions";
import { GOAL_WINDOW_DAYS, READER_MISS_KINDS, type GoalScorecard } from "@/lib/agents/goal-scorecard";
import { ACCURACY_TARGET_LABEL } from "@/lib/accuracy-target";

interface Metric {
  key: keyof ScoreboardSnapshotRow;
  label: string;
  unit: string;
  format: (value: number) => string;
  detail: (row: ScoreboardSnapshotRow) => string;
  /** True when a lower number is better (freshness, in days). */
  lowerIsBetter?: boolean;
  /** Why this is a diagnostic, not a goal measure (#1040). */
  caveat?: string;
  /** Snapshots compare only when this matches: the trend breaks and the change is hidden where it differs. */
  series?: (row: ScoreboardSnapshotRow) => number | null;
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

const METRICS: Metric[] = [
  {
    key: "coverage_rate",
    label: "Coverage",
    unit: "% of active institutions with a website",
    format: percent,
    detail: (row) => `${(row.coverage_numerator ?? 0).toLocaleString()} of ${(row.coverage_denominator ?? 0).toLocaleString()} have a fee link whose newest text passed the fee-page check`,
    caveat: "Counts a passed text check, not live fees. The goal measure is benchmark-ready groups above.",
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
    caveat: "Can pass 1 and rewards reading more lines as fees. Use Knox's kept fees above.",
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
    detail: (row) => `recall ${row.accuracy_recall == null ? "—" : percent(row.accuracy_recall)}${row.accuracy_scorer_version == null ? "" : `, scorer v${row.accuracy_scorer_version}`}`,
    caveat: "The answer key's newest score, not dated here. The goal measure is Deming's 7-day accuracy above.",
    // A new scorer version rescores the same fees: its numbers start a new line (#1354).
    series: (row) => row.accuracy_scorer_version,
  },
  {
    key: "freshness_median_days",
    label: "Freshness",
    unit: "median age of live fees, days",
    format: (value) => value.toFixed(1),
    detail: (row) => `${(row.freshness_live_fees ?? 0).toLocaleString()} live fees`,
    lowerIsBetter: true,
    caveat: "Resets when an unchanged page is re-checked, so it can improve without new fees.",
  },
];

function Sparkline({ values, series }: { values: Array<number | null>; series?: Array<number | null> }) {
  const points = values
    .map((value, index) => (value == null ? null : { x: index, y: value, key: series?.[index] ?? null }))
    .filter((point): point is { x: number; y: number; key: number | null } => point != null);
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
      const starts = index === 0 || (series != null && point.key !== points[index - 1].key);
      return `${starts ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const breaks = series ? seriesBreaks(series) : [];
  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-9 w-full text-[var(--brand-primary)]" role="img" aria-label="30-day trend">
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
        {breaks.slice(1).map((run) => {
          const x = (run.start / maxX) * width;
          return <line key={run.start} x1={x} x2={x} y1={0} y2={height} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="2 2" />;
        })}
      </svg>
      {breaks.length > 1 ? (
        <p className="text-[10px] text-gray-400">Scorer {breaks.map((run) => `v${run.key}`).join(", then ")}: the line breaks where the scorer changed.</p>
      ) : null}
    </>
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
          <Breadcrumbs items={[{ label: "Crew", href: "/admin" }, { label: "Scorecard" }]} />
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Scorecard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            What Atlas measures against the goal every day{latest ? ` (latest ${latest.snapshot_date})` : ""}. Each number covers the last {GOAL_WINDOW_DAYS} days unless it says otherwise and names its query. No model calls.
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
        <>
        <GoalSection rows={rows} />
        <details className="admin-card p-4">
          <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-300">
            Pipeline diagnostics (older numbers, not goal measures)
          </summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {METRICS.map((metric) => {
            const value = latest[metric.key] as number | null;
            const comparable = previous != null && (!metric.series || metric.series(previous) === metric.series(latest));
            const before = previous && comparable ? (previous[metric.key] as number | null) : null;
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
                <Sparkline values={rows.map((row) => row[metric.key] as number | null)} series={metric.series ? rows.map(metric.series) : undefined} />
                <p className="text-[11px] text-gray-400">{metric.detail(latest)}</p>
                {metric.caveat ? <p className="text-[11px] text-amber-700 dark:text-amber-400">{metric.caveat}</p> : null}
              </div>
            );
          })}
        </div>
        </details>
        </>
      )}
    </div>
  );
}

const money = (value: number | null | undefined) => (value == null ? "—" : `$${value.toFixed(2)}`);
const share = (value: number | null | undefined) => (value == null ? "—" : percent(value));
const n = (value: number | null | undefined) => (value == null ? "—" : value.toLocaleString("en-US"));

interface GoalCardSpec {
  label: string;
  query: string | null;
  value: (goal: GoalScorecard) => number | null | undefined;
  format: (value: number | null | undefined) => string;
  unit: string;
  detail: (goal: GoalScorecard) => React.ReactNode;
  lowerIsBetter?: boolean;
}

const GOAL_CARDS: GoalCardSpec[] = [
  {
    label: "Benchmark-ready groups",
    query: "goal.coverage_cells",
    value: (goal) => goal.coverageCells?.readyCells,
    format: n,
    unit: "state × size groups under $10B at 30 institutions with live fees (75% below 40)",
    detail: (goal) => goal.coverageCells ? (
      <>
        of {n(goal.coverageCells.totalCells)} groups; {n(goal.coverageCells.institutionsShort)} more covered institutions close the gap.
        <span className="block">
          {goal.coverageCells.bySize.map((size) => `${size.label}: ${size.readyCells} of ${size.totalCells}`).join(" · ")}
        </span>
        {goal.coverageCells.byState ? <StateGaps states={goal.coverageCells.byState} /> : null}
      </>
    ) : "Could not be read.",
  },
  {
    label: "Institutions with live fees",
    query: "goal.live_institutions",
    value: (goal) => goal.liveInstitutions?.live,
    format: n,
    unit: "in published_fee_catalog now",
    detail: (goal) => goal.liveInstitutions
      ? `${n(goal.liveInstitutions.addedThisWeek)} added: live now, no live fee 7 days ago (refreshes add nothing).`
      : "Could not be read.",
  },
  {
    label: "Accuracy",
    query: "goal.deming_accuracy_7d",
    value: (goal) => goal.accuracy?.accuracy,
    format: share,
    unit: `of audited live fees right on amount, category, source, line and name (target ${ACCURACY_TARGET_LABEL})`,
    detail: (goal) => goal.accuracy ? <AccuracyDetail accuracy={goal.accuracy} /> : "Could not be read.",
  },
  {
    label: "Wrong after publish",
    query: "goal.wrong_after_publish_7d",
    value: (goal) => goal.wrongAfterPublish?.rate,
    format: share,
    unit: "of fees first published in the window, taken down since as errors",
    lowerIsBetter: true,
    detail: (goal) => goal.wrongAfterPublish ? (
      <>
        {n(goal.wrongAfterPublish.wrong)} of {n(goal.wrongAfterPublish.published)}; {n(goal.wrongAfterPublish.housekeeping)} housekeeping take-downs (refreshes, duplicates, re-checks) not counted.
        {goal.wrongAfterPublish.topErrors.length > 0 ? (
          <span className="block">Errors: {goal.wrongAfterPublish.topErrors.map((row) => `${row.reason} ${n(row.count)}`).join(" · ")}</span>
        ) : null}
      </>
    ) : "Could not be read.",
  },
  {
    label: "Cost per new institution",
    query: "goal.provider_spend_7d",
    value: (goal) => goal.spend?.costPerNewInstitutionUsd,
    format: money,
    unit: "provider spend ÷ institutions added",
    lowerIsBetter: true,
    detail: (goal) => goal.spend ? `${money(goal.spend.weekUsd)} spent across all agents.` : "Could not be read.",
  },
  {
    label: "Knox fees found at $0",
    query: "goal.knox_passes_7d",
    value: (goal) => goal.knoxPasses?.zeroCostShare,
    format: share,
    unit: "of Knox's kept fees (verified or approved) from the free pass",
    detail: (goal) => goal.knoxPasses ? (
      <>
        Free: {n(goal.knoxPasses.free.rowsKept)} fees, {n(goal.knoxPasses.free.documents)} documents, {n(goal.knoxPasses.free.institutions)} institutions.
        <span className="block">
          Paid: {n(goal.knoxPasses.paid.rowsKept)} fees, {n(goal.knoxPasses.paid.documents)} documents, {n(goal.knoxPasses.paid.institutions)} institutions; {money(goal.knoxPasses.paid.spendUsd)} over {n(goal.knoxPasses.paid.calls)} calls{goal.knoxPasses.paid.costPerRowUsd == null ? "" : `, ${(goal.knoxPasses.paid.costPerRowUsd * 100).toFixed(1)}¢ per fee kept`}.
        </span>
      </>
    ) : "Could not be read.",
  },
  {
    label: "Audience not stated",
    query: "goal.unstated_audience",
    value: (goal) => goal.unstatedAudience?.share,
    format: share,
    unit: "of live fees shown with the asterisk (should fall toward 0)",
    lowerIsBetter: true,
    detail: (goal) => goal.unstatedAudience
      ? `${n(goal.unstatedAudience.unknownFees)} of ${n(goal.unstatedAudience.liveFees)} live fees.`
      : "Could not be read.",
  },
  {
    label: "Hamilton answers that tie out",
    query: "goal.hamilton_answer_eval_latest",
    value: (goal) => goal.answerQuality?.paths.find((p) => p.path === "free_ask")?.correctRate,
    format: share,
    unit: "of free Ask answers whose fee figures tie to live catalog rows (latest answer eval)",
    detail: (goal) => goal.answerQuality ? (
      <>
        Eval of {goal.answerQuality.at.slice(0, 16).replace("T", " ")} UTC{goal.answerQuality.timedOut ? ", stopped at its time budget" : ""}
        {goal.answerQuality.paidAt ? `; paid sample of ${goal.answerQuality.paidAt.slice(0, 16).replace("T", " ")} UTC` : ""}.
        {goal.answerQuality.paths.map((p) => (
          <span key={p.path} className="block">
            {p.label}: {p.measured
              ? `form ${share(p.formRate)} (${n(p.formPassed)} of ${n(p.answers)}), tie out ${p.checked == null ? "not checked" : `${share(p.correctRate)} (${n(p.correct)} of ${n(p.checked)})`}`
              : "not measured yet"}
          </span>
        ))}
      </>
    ) : "No answer eval in the last 7 days.",
  },
  {
    label: "Data checks failing",
    query: "goal.deming_data_quality_latest",
    value: (goal) => goal.dataQuality?.failing.length,
    format: n,
    unit: "of Deming's daily checks on live fees over their threshold (duplicates, stale, no category, no source, category share)",
    lowerIsBetter: true,
    detail: (goal) => goal.dataQuality ? <DataQualityDetail quality={goal.dataQuality} /> : "No data check in the last 7 days.",
  },
];

/** The snapshot at least 7 days older than the latest, for the week-over-week change. */
function weekBefore(rows: ScoreboardSnapshotRow[], latest: ScoreboardSnapshotRow): ScoreboardSnapshotRow | null {
  const cutoff = new Date(`${latest.snapshot_date}T00:00:00Z`).getTime() - GOAL_WINDOW_DAYS * 86_400_000;
  return [...rows].reverse().find((row) => row.goal && new Date(`${row.snapshot_date}T00:00:00Z`).getTime() <= cutoff) ?? null;
}

function GoalSection({ rows }: { rows: ScoreboardSnapshotRow[] }) {
  const withGoal = rows.filter((row) => row.goal);
  const latest = withGoal.at(-1) ?? null;
  if (!latest?.goal) {
    return (
      <p className="admin-card p-4 text-sm text-gray-500">
        No goal numbers yet. Atlas stores them with the next daily scoreboard; press Score now to read them today.
      </p>
    );
  }
  const before = weekBefore(withGoal, latest);
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">The goal</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {GOAL_CARDS.map((card) => {
          const value = card.value(latest.goal!);
          const prior = before?.goal ? card.value(before.goal) : null;
          const delta = value != null && prior != null ? value - prior : null;
          const better = delta == null || delta === 0 ? null : card.lowerIsBetter ? delta < 0 : delta > 0;
          return (
            <div key={card.label} className="admin-card space-y-1 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{card.label}</p>
              <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {card.format(value)}
                {delta != null && delta !== 0 ? (
                  <span className={`ml-2 text-xs font-semibold ${better ? "text-emerald-600" : "text-red-600"}`}>
                    {delta > 0 ? "+" : "−"}{card.format(Math.abs(delta))} vs a week before
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-gray-500">{card.unit}</p>
              <Sparkline values={withGoal.map((row) => (row.goal ? card.value(row.goal) ?? null : null))} />
              <p className="text-[11px] text-gray-500">{card.detail(latest.goal!)}</p>
              {card.query ? <p className="font-mono text-[10px] text-gray-400">query: {card.query}</p> : null}
            </div>
          );
        })}
      </div>
      {latest.goal.spend ? <SpendTable goal={latest.goal} /> : null}
      <ReaderMisses goal={latest.goal} />
    </section>
  );
}

function SpendTable({ goal }: { goal: GoalScorecard }) {
  const rows = goal.spend?.byAgent ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="admin-card overflow-x-auto p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Spend per agent against its cap</p>
      <table className="mt-2 w-full text-left text-xs">
        <thead>
          <tr className="text-gray-400">
            <th className="py-1 pr-4 font-semibold">Agent</th>
            <th className="py-1 pr-4 text-right font-semibold">Last {goal.windowDays} days</th>
            <th className="py-1 pr-4 text-right font-semibold">Calls</th>
            <th className="py-1 pr-4 text-right font-semibold">This month</th>
            <th className="py-1 text-right font-semibold">Monthly cap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.agent} className="border-t border-gray-100 dark:border-white/[0.06]">
              <td className="py-1 pr-4 capitalize">{row.agent}</td>
              <td className="py-1 pr-4 text-right tabular-nums">{money(row.weekUsd)}</td>
              <td className="py-1 pr-4 text-right tabular-nums">{n(row.weekCalls)}</td>
              <td className="py-1 pr-4 text-right tabular-nums">{money(row.monthUsd)}</td>
              <td className={`py-1 text-right tabular-nums ${row.monthlyCapUsd != null && row.monthUsd >= row.monthlyCapUsd ? "font-semibold text-red-600" : ""}`}>
                {row.monthlyCapUsd == null ? "no cap" : money(row.monthlyCapUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 font-mono text-[10px] text-gray-400">query: {goal.spend?.query}</p>
    </div>
  );
}

const MISS_KIND_LABELS: Record<(typeof READER_MISS_KINDS)[number], string> = {
  no_fees_found: "No fees found",
  short_text: "Short text",
  missed_fee_page: "Fee page rejected",
  unresolved_fee_page: "Fee page left unread",
  unread: "Unread",
};

/** Rosetta's batch review (#1054): miss rate by kind, week over week, and whether its fixes gave Knox fees. */
function ReaderMisses({ goal }: { goal: GoalScorecard }) {
  if (goal.readerMisses === undefined) {
    return <p className="admin-card p-4 text-xs text-gray-500">Text-reading misses appear with the next daily scoreboard, or press Score now.</p>;
  }
  const misses = goal.readerMisses;
  const remedies = goal.readerRemedies;
  return (
    <div className="admin-card overflow-x-auto p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Text-reading misses, week by week</p>
      <p className="mt-1 text-xs text-gray-500">
        Every 50 reads, Rosetta checks how each one turned out once Knox has had it. A miss is a read that gave no usable text or no fees. Weeks start Monday (UTC) and count batches by the day they were checked.
      </p>
      {!misses ? (
        <p className="mt-2 text-xs text-gray-500">Could not be read.</p>
      ) : (
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-gray-400">
              <th className="py-1 pr-4 font-semibold">Week of</th>
              <th className="py-1 pr-4 text-right font-semibold">Reads</th>
              <th className="py-1 pr-4 text-right font-semibold">Miss rate</th>
              {READER_MISS_KINDS.map((kind) => (
                <th key={kind} className="py-1 pr-4 text-right font-semibold">{MISS_KIND_LABELS[kind]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {misses.weeks.map((week) => (
              <tr key={week.weekStart} className="border-t border-gray-100 dark:border-white/[0.06]">
                <td className="py-1 pr-4 tabular-nums">{week.weekStart}</td>
                <td className="py-1 pr-4 text-right tabular-nums">{week.batches === 0 ? "—" : n(week.reads)}</td>
                <td className="py-1 pr-4 text-right tabular-nums">{share(week.rate)}</td>
                {READER_MISS_KINDS.map((kind) => (
                  <td key={kind} className="py-1 pr-4 text-right tabular-nums">{week.batches === 0 ? "—" : n(week.byKind[kind])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {misses ? <p className="mt-1 font-mono text-[10px] text-gray-400">query: {misses.query}</p> : null}
      <p className="mt-3 text-xs text-gray-700 dark:text-gray-300">
        {remedies === undefined || remedies === null ? (
          "Fix outcomes could not be read."
        ) : remedies.remedied === 0 ? (
          "Sent to a fix, then Knox found fees: no misses were sent to a fix in these weeks."
        ) : (
          <>
            Sent to a fix, then Knox found fees: <span className="font-semibold tabular-nums">{n(remedies.knoxFound)}</span> of {n(remedies.remedied)} ({share(remedies.share)}).
            <span className="block text-gray-500">
              {remedies.byRemedy.map((row) => `${row.remedy} ${n(row.knoxFound)} of ${n(row.remedied)}`).join(" · ")}. Fees count from the same document after the check, or from the same institution for a new link search. A recent miss may not have had its fix yet.
            </span>
          </>
        )}
      </p>
      {remedies ? <p className="font-mono text-[10px] text-gray-400">query: {remedies.query}</p> : null}
    </div>
  );
}

/** States with the largest gaps shown by name; Atlas runs these lanes first (#1117). */
const STATE_GAPS_SHOWN = 12;

function StateGaps({ states }: { states: NonNullable<NonNullable<GoalScorecard["coverageCells"]>["byState"]> }) {
  const short = states.filter((state) => state.institutionsShort > 0);
  const shown = short.slice(0, STATE_GAPS_SHOWN);
  const closing = states.reduce((sum, state) => sum + state.closingThisWeek, 0);
  return (
    <>
      <span className="block">
        Gap by state, institutions short now (7 days ago; closed this week):{" "}
        {shown.length === 0 ? "none." : shown.map((state) => `${state.state} ${n(state.institutionsShort)} (${n(state.institutionsShortWeekAgo)}; ${n(state.closingThisWeek)})`).join(" · ")}
      </span>
      <span className="block">
        {n(short.length)} of {n(states.length)} states short{short.length > shown.length ? `, ${n(short.length - shown.length)} more not listed` : ""}; {n(closing)} newly live institutions closed gaps this week.
      </span>
    </>
  );
}

/** Range, misses per check and one dated line per audit (#1119); older snapshots lack the last three. */
function AccuracyDetail({ accuracy }: { accuracy: NonNullable<GoalScorecard["accuracy"]> }) {
  const misses = accuracy.misses;
  return (
    <>
      {n(accuracy.right)} of {n(accuracy.scorable)} scorable fees over {accuracy.audits} Deming audits
      {accuracy.range ? `; 95% range ${percent(accuracy.range.low)}–${percent(accuracy.range.high)}` : ""}.
      {misses ? (
        <span className="block">
          Misses: amount {n(misses.amount)} · category {n(misses.category)} · not the bank&apos;s schedule {n(misses.evidence)} · not a fee line {n(misses.notAFee)} · bad name {n(misses.name)}
        </span>
      ) : null}
      {accuracy.daily?.length ? (
        <span className="block">
          {accuracy.daily.map((day) => `${day.at.slice(0, 10)}: ${day.right}/${day.scorable}${day.accuracy == null ? "" : ` (${percent(day.accuracy)})`}`).join(" · ")}
        </span>
      ) : accuracy.latestAt ? (
        <span className="block">Latest {accuracy.latestAt.slice(0, 10)}{accuracy.latestAccuracy == null ? "" : ` at ${percent(accuracy.latestAccuracy)}`}.</span>
      ) : (
        <span className="block">No audit in the window.</span>
      )}
    </>
  );
}

const DATA_CHECK_LABELS: Record<NonNullable<GoalScorecard["dataQuality"]>["lines"][number]["check"], string> = {
  duplicates: "Duplicates",
  stale: "Stale (over 90 days)",
  noCategory: "No category",
  noSource: "No source link",
  categoryShare: "Categories off their normal share",
};

/** One line per check and catalog, with its status and query (#1065). */
function DataQualityDetail({ quality }: { quality: NonNullable<GoalScorecard["dataQuality"]> }) {
  return (
    <>
      Checked {quality.at.slice(0, 16).replace("T", " ")} UTC.
      {quality.lines.map((line) => (
        <span key={`${line.catalog}.${line.check}`} className={`block ${line.status === "fail" ? "font-semibold text-red-600" : ""}`}>
          {line.catalog === "rate" ? "Rate fees, " : ""}{DATA_CHECK_LABELS[line.check]}: {n(line.count)}{line.rate == null ? "" : ` (${share(line.rate)})`}, {line.status.replace("_", " ")}{" "}
          <span className="font-mono text-[10px] text-gray-400">{line.query}</span>
        </span>
      ))}
      {quality.drifts.length > 0 ? (
        <span className="block">
          Off their normal share: {quality.drifts.slice(0, 8).map((drift) => `${drift.category} ${share(drift.share)} (normally ${share(drift.normalShare)})`).join(" · ")}
        </span>
      ) : null}
    </>
  );
}
