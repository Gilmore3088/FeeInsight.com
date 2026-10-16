import Link from "next/link";
import type { ReactNode } from "react";
import type { HubBranches } from "@/lib/data-store/district-hub";
import { formatCompactDollars, formatFeeAmount } from "@/lib/format";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { TrendChart } from "../../state/[code]/trend-chart";
import { PhoneCollapse } from "./phone-collapse";
import {
  hubFeeName,
  monthYear,
  quarterLabel,
  type ComplaintView,
  type FeeChangeSummary,
  type RevenueQuarter,
  type StateHubRow,
  type TierRow,
} from "./district-hub-view";

/**
 * The district hub's exhibits, drawn on the server: each one a heading, at most one short line,
 * the picture, and a small source footer. An exhibit with no data is not rendered by the page.
 */

const COUNT = new Intl.NumberFormat("en-US");
export const count = (n: number) => COUNT.format(n);
export const money = (n: number | null | undefined) => (n == null ? "-" : (formatFeeAmount(n) ?? "-"));
export const compact = (n: number | null | undefined) => (n == null ? "-" : formatCompactDollars(n));
export const pct = (n: number | null | undefined, digits = 1) => (n == null ? "-" : `${n.toFixed(digits)}%`);
export const signedPct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;

/** Story headings state the finding; the small kicker above names the subject. */
export const STORY_H2 = "text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[36px]";
export const KICKER = "text-[12px] font-semibold uppercase tracking-[0.14em] text-brick";

export function HubSection({
  id,
  kicker,
  title,
  line,
  source,
  children,
  collapse,
}: {
  id: string;
  kicker?: string;
  title: string;
  line?: ReactNode;
  source: ReactNode;
  children: ReactNode;
  /** Context below the fee findings: closed on phones behind a "View {collapse}" button, open on wider screens. */
  collapse?: string;
}) {
  const head = (
    <div className="max-w-3xl">
      {kicker && <p className={`${KICKER} mb-2`}>{kicker}</p>}
      <h2 id={`${id}-heading`} className={STORY_H2}>
        {title}
      </h2>
      {line && <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{line}</p>}
    </div>
  );
  const body = (
    <>
      {children}
      <p className="text-[11px] leading-snug text-ink-muted">
        <span className="font-semibold">Source:</span> {source}
      </p>
    </>
  );
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20 space-y-8">
      {collapse ? (
        <PhoneCollapse summary={head} label={collapse}>
          {body}
        </PhoneCollapse>
      ) : (
        <>
          {head}
          {body}
        </>
      )}
    </section>
  );
}

/** A row of figures, each under a hairline: no box, and no empty filler cell when the count is odd. */
export function Tiles({ items }: { items: { value: string; label: string }[] }) {
  if (items.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((t) => (
        <div key={t.label} className="flex flex-col-reverse border-t border-border pt-2">
          <dt className="mt-0.5 text-[11px] leading-tight text-ink-muted">{t.label}</dt>
          <dd className="font-mono text-[20px] font-semibold leading-tight tabular-nums text-ink">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A horizontal bar with an optional reference tick, for one value against another. */
function Bar({ value, max, tick, tone = "ink" }: { value: number; max: number; tick?: number | null; tone?: "ink" | "brick" | "muted" }) {
  const width = max > 0 ? Math.max((value / max) * 100, 1.5) : 0;
  const fill = tone === "brick" ? "bg-brick" : tone === "muted" ? "bg-ink/35" : "bg-ink";
  return (
    <div className="relative h-3 rounded-full bg-surface-200" aria-hidden="true">
      <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${Math.min(width, 100)}%` }} />
      {tick != null && max > 0 && (
        <div className="absolute -inset-y-1 w-0.5 rounded bg-brick" style={{ left: `${Math.min((tick / max) * 100, 100)}%` }} />
      )}
    </div>
  );
}

/** One state's panel in the state picker. */
export function StatePanel({
  row,
  feeKeys,
  districtMedians,
  districtName,
}: {
  row: StateHubRow;
  feeKeys: string[];
  districtMedians: Record<string, number | null>;
  districtName: string;
}) {
  const tiles = [
    { value: count(row.institutions), label: `Banks\u00a0${count(row.banks)} · Credit\u00a0unions\u00a0${count(row.creditUnions)}` },
    ...(row.coveragePct != null ? [{ value: pct(row.coveragePct, 0), label: "With verified fees" }] : []),
    ...(row.bankServiceCharges != null ? [{ value: compact(row.bankServiceCharges), label: "Bank deposit service charges, latest quarter" }] : []),
    ...(row.cuFeeIncome != null ? [{ value: compact(row.cuFeeIncome), label: "Credit union fee income, latest quarter" }] : []),
    ...(row.bankBranches != null ? [{ value: count(row.bankBranches + (row.cuBranches ?? 0)), label: "Branches" }] : []),
    ...(row.unemployment ? [{ value: pct(row.unemployment.rate), label: `Unemployment, ${monthYear(row.unemployment.date)}` }] : []),
    ...(row.medianIncome != null ? [{ value: compact(row.medianIncome), label: "Median household income" }] : []),
  ];
  const fees = feeKeys
    .map((k) => ({ key: k, own: row.fees[k] ?? null, district: districtMedians[k] ?? null }))
    .filter((f) => f.own && f.own.institutions > 0);
  const max = Math.max(...fees.flatMap((f) => [f.own?.median ?? 0, f.district ?? 0]), 1);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[18px] font-semibold text-ink">{row.name}</h3>
        <Link href={`/research/state/${row.code}`} className="text-[13px] font-semibold text-brick hover:text-brick-ink">
          {row.name} fee report &rarr;
        </Link>
      </div>
      <Tiles items={tiles} />
      {fees.length > 0 && (
        <div>
          <p className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-full bg-ink" aria-hidden="true" /> {row.name} median
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-0.5 rounded bg-brick" aria-hidden="true" /> {districtName}
            </span>
          </p>
          <ul className="space-y-2.5">
            {fees.map((f) => (
              <li key={f.key} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3">
                <span className="truncate text-[13px] font-medium text-ink">{hubFeeName(f.key)}</span>
                {f.own!.median != null ? <Bar value={f.own!.median} max={max} tick={f.district} /> : <span className="h-3" />}
                <span className="whitespace-nowrap text-right text-[12px] tabular-nums text-ink-soft">
                  {f.own!.median != null ? (
                    <>
                      <span className="font-semibold text-ink">{money(f.own!.median)}</span>
                      {f.district != null && <span className="text-ink-muted"> vs {money(f.district)}</span>}
                    </>
                  ) : (
                    <span className="text-ink-muted">{count(f.own!.institutions)} so far</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface IncomeTrend {
  latest: { quarter: string; value: number };
  /** Change from the same quarter a year earlier, in percent; null without four earlier quarters. */
  yoyPct: number | null;
  yearAgoQuarter: string | null;
  /** The quarter with the largest move from the one before it, when that move is worth a note. */
  biggestMove: { quarter: string; pct: number } | null;
}

/** Smallest quarter-to-quarter move, in percent, worth an annotation. */
const NOTABLE_MOVE_PCT = 3;

/** One charter's quarterly trend: the latest value, the change on a year earlier and the biggest move. */
export function incomeTrend(quarters: RevenueQuarter[], series: "banks" | "creditUnions"): IncomeTrend | null {
  const points = quarters.filter((q) => q[series] > 0).map((q) => ({ quarter: q.quarter, value: q[series] }));
  if (points.length === 0) return null;
  const latest = points[points.length - 1];
  const yearAgo = points.length >= 5 ? points[points.length - 5] : null;
  let biggestMove: IncomeTrend["biggestMove"] = null;
  for (let i = 1; i < points.length; i++) {
    const pct = ((points[i].value - points[i - 1].value) / points[i - 1].value) * 100;
    if (Math.abs(pct) >= NOTABLE_MOVE_PCT && (!biggestMove || Math.abs(pct) > Math.abs(biggestMove.pct))) {
      biggestMove = { quarter: points[i].quarter, pct };
    }
  }
  return {
    latest,
    yoyPct: yearAgo ? ((latest.value - yearAgo.value) / yearAgo.value) * 100 : null,
    yearAgoQuarter: yearAgo?.quarter ?? null,
    biggestMove,
  };
}

/**
 * One charter's income by quarter as an open line chart: the latest value large, its change on a
 * year earlier, and a note at the biggest quarter-to-quarter move. Banks report service charges on
 * deposit accounts and credit unions report all fee income, a wider measure, so the two are drawn
 * apart and never summed. The line spans the quarters' own range, marked at its high and low.
 */
export function IncomeLine({ quarters, series, title }: { quarters: RevenueQuarter[]; series: "banks" | "creditUnions"; title: string }) {
  const points = quarters.filter((q) => q[series] > 0).map((q) => ({ quarter: q.quarter, value: q[series] }));
  const trend = incomeTrend(quarters, series);
  if (!trend || points.length === 0) return null;
  const values = points.map((p) => p.value);
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const pad = Math.max((hi - lo) * 0.2, hi * 0.02);
  const top = hi + pad;
  const bottom = Math.max(lo - pad, 0);
  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);
  const y = (v: number) => (top === bottom ? 50 : ((top - v) / (top - bottom)) * 100);
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const tone = series === "banks" ? "text-ink" : "text-ink-soft";
  const moveAt = trend.biggestMove ? points.findIndex((p) => p.quarter === trend.biggestMove!.quarter) : -1;
  return (
    <figure>
      <figcaption className="text-[14px] font-semibold text-ink">{title}</figcaption>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[36px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-ink sm:text-[44px]">
          {compact(trend.latest.value)}
        </span>
        <span className="text-[13px] text-ink-muted">{quarterLabel(trend.latest.quarter)}</span>
      </p>
      {trend.yoyPct != null && trend.yearAgoQuarter && (
        <p className="mt-1 text-[13px] text-ink-soft">
          <span className="font-semibold tabular-nums text-ink">{signedPct(trend.yoyPct)}</span> from {quarterLabel(trend.yearAgoQuarter)}
        </p>
      )}
      <div
        className={`relative mt-6 h-40 sm:h-48 ${tone}`}
        role="img"
        aria-label={`${title} by quarter, ${quarterLabel(points[0].quarter)} to ${quarterLabel(trend.latest.quarter)}: ${points.map((p) => compact(p.value)).join(", ")}`}
      >
        <span className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${y(hi)}%` }} aria-hidden="true" />
        <span className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${y(lo)}%` }} aria-hidden="true" />
        <span className="absolute left-0 -translate-y-full pb-0.5 text-[10px] tabular-nums text-ink-muted" style={{ top: `${y(hi)}%` }} aria-hidden="true">
          High {compact(hi)}
        </span>
        <span className="absolute left-0 pt-0.5 text-[10px] tabular-nums text-ink-muted" style={{ top: `${y(lo)}%` }} aria-hidden="true">
          Low {compact(lo)}
        </span>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <polyline points={line} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((p, i) => (
          <span
            key={p.quarter}
            aria-hidden="true"
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-paper ${i === points.length - 1 || i === moveAt ? "h-3 w-3" : "h-1.5 w-1.5"}`}
            style={{ left: `${x(i)}%`, top: `${y(p.value)}%` }}
          />
        ))}
        {trend.biggestMove && moveAt > 0 && moveAt < points.length - 1 && (
          <span
            aria-hidden="true"
            className="absolute -translate-x-1/2 whitespace-nowrap rounded bg-paper px-1.5 text-[11px] font-semibold tabular-nums text-ink"
            style={{ left: `${x(moveAt)}%`, top: `calc(${y(points[moveAt].value)}% ${trend.biggestMove.pct >= 0 ? "- 1.75rem" : "+ 0.75rem"})` }}
          >
            {signedPct(trend.biggestMove.pct)} in {quarterLabel(trend.biggestMove.quarter)}
          </span>
        )}
      </div>
      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-ink-muted" aria-hidden="true">
        <span>{quarterLabel(points[0].quarter)}</span>
        <span>{quarterLabel(trend.latest.quarter)}</span>
      </div>
    </figure>
  );
}

/** Horizontal bars, one per row, labeled and valued. */
export function RankBars({ rows, format, tick, tickLabel }: { rows: { key: string; label: string; value: number; note?: string }[]; format: (n: number) => string; tick?: number | null; tickLabel?: string }) {
  const max = Math.max(...rows.map((r) => r.value), tick ?? 0, 1) * 1.05;
  return (
    <div>
      {tick != null && tickLabel && (
        <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span className="h-3 w-0.5 rounded bg-brick" aria-hidden="true" /> {tickLabel}
        </p>
      )}
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]">
            <span className="truncate text-[13px] font-medium text-ink">{r.label}</span>
            <Bar value={r.value} max={max} tick={tick} />
            <span className="whitespace-nowrap text-right text-[12px] font-semibold tabular-nums text-ink">
              {format(r.value)}
              {r.note && <span className="ml-1 font-normal text-ink-muted">{r.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Institutions by asset size as stacked columns, one per size: banks at the base, credit unions
 * above, each part labeled with its count.
 */
export function SizeColumns({ tiers }: { tiers: TierRow[] }) {
  const max = Math.max(...tiers.map((t) => t.banks + t.creditUnions), 1);
  return (
    <figure>
      <p className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ink" /> Banks
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ink/30" /> Credit unions
        </span>
      </p>
      <ol
        className="flex h-52 items-end gap-2 sm:gap-4"
        aria-label={`Institutions by asset size: ${tiers.map((t) => `${t.label}, ${count(t.banks)} banks and ${count(t.creditUnions)} credit unions`).join("; ")}`}
      >
        {tiers.map((t) => {
          const total = t.banks + t.creditUnions;
          return (
            <li key={t.tier} className="flex h-full min-w-0 flex-1 flex-col justify-end" aria-hidden="true">
              <span className="mb-1 text-center font-mono text-[13px] font-semibold tabular-nums text-ink">{count(total)}</span>
              <span className="flex flex-col overflow-hidden rounded-t-md" style={{ height: `${(total / max) * 82}%` }}>
                <span className="bg-ink/30" style={{ flexGrow: t.creditUnions }} />
                <span className="bg-ink" style={{ flexGrow: t.banks }} />
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex gap-2 sm:gap-4" aria-hidden="true">
        {tiers.map((t) => (
          <span key={t.tier} className="min-w-0 flex-1 text-center text-[11px] leading-tight text-ink-muted">
            {t.label}
            <span className="mt-0.5 block tabular-nums">
              {count(t.banks)} banks · {count(t.creditUnions)} credit unions
            </span>
          </span>
        ))}
      </div>
    </figure>
  );
}

/** The leading banks' combined share of the district's bank deposits, in percent; null with no deposits. */
export function leadersShare(branches: HubBranches, top = 5): { banks: number; pct: number } | null {
  if (branches.total_deposits <= 0 || branches.leaders.length === 0) return null;
  const leaders = branches.leaders.slice(0, top);
  return { banks: leaders.length, pct: (leaders.reduce((s, l) => s + l.deposits, 0) / branches.total_deposits) * 100 };
}

const STRIP_TONES = ["bg-ink", "bg-ink/80", "bg-ink/65", "bg-ink/50", "bg-ink/38"];

/**
 * Deposits as one strip: the leading banks' shares, then everyone else as "Other", named in a
 * ranked list beneath with each bank's share and deposits.
 */
export function DepositStrip({ branches, top = 5 }: { branches: HubBranches; top?: number }) {
  if (branches.total_deposits <= 0 || branches.leaders.length === 0) return null;
  const leaders = branches.leaders.slice(0, top);
  const share = (n: number) => (n / branches.total_deposits) * 100;
  const other = Math.max(branches.total_deposits - leaders.reduce((s, l) => s + l.deposits, 0), 0);
  return (
    <figure>
      <div className="flex h-12 overflow-hidden rounded-lg" aria-hidden="true">
        {leaders.map((l, i) => (
          <span
            key={l.institution_id}
            className={`flex items-center justify-center border-r-2 border-paper text-[12px] font-semibold tabular-nums text-on-ink ${STRIP_TONES[i] ?? "bg-ink/30"}`}
            style={{ width: `${share(l.deposits)}%` }}
          >
            {share(l.deposits) >= 9 ? `${Math.round(share(l.deposits))}%` : ""}
          </span>
        ))}
        <span className="flex min-w-0 flex-1 items-center justify-center overflow-hidden whitespace-nowrap bg-surface-200 px-2 text-[12px] font-semibold tabular-nums text-ink-soft">
          Other {Math.round(share(other))}%
        </span>
      </div>
      <ol className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {leaders.map((l, i) => (
          <li key={l.institution_id} className="flex items-start gap-3">
            <span className={`mt-1 h-3 w-3 shrink-0 rounded-sm ${STRIP_TONES[i] ?? "bg-ink/30"}`} aria-hidden="true" />
            <span className="min-w-0">
              <Link href={`/institution/${l.institution_id}`} className="block text-[14px] font-medium text-ink underline-offset-4 hover:underline">
                {l.name}
              </Link>
              <span className="block text-[12px] tabular-nums text-ink-muted">
                {pct(share(l.deposits))} · {compact(l.deposits)} across {count(l.branches)} branches
              </span>
            </span>
          </li>
        ))}
        <li className="flex items-start gap-3">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-surface-200 ring-1 ring-border" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[14px] font-medium text-ink">Every other bank</span>
            <span className="block text-[12px] tabular-nums text-ink-muted">
              {pct(share(other))} · {compact(other)}
            </span>
          </span>
        </li>
      </ol>
    </figure>
  );
}

/** Fee complaints per $1B of deposits: the district against the U.S., then each state. */
export function ComplaintChart({ view, minPeers }: { view: ComplaintView; minPeers: number }) {
  const rated = view.states.filter((s) => s.rate != null);
  const thin = view.states.filter((s) => s.rate == null);
  const rows = [
    ...(view.district.rate != null ? [{ key: "district", label: "District", value: view.district.rate }] : []),
    ...(view.us.rate != null ? [{ key: "us", label: "U.S.", value: view.us.rate }] : []),
    ...rated.map((s) => ({ key: s.code, label: s.name, value: s.rate!, note: `${count(s.matched)}` })),
  ];
  return (
    <div className="space-y-2">
      {rows.length > 0 && <RankBars rows={rows} format={(n) => n.toFixed(1)} />}
      {(view.district.rate == null || thin.length > 0) && (
        <p className="text-[12px] text-ink-muted">
          {view.district.rate == null
            ? `${count(view.district.matched)} district institutions are matched to CFPB records, under the ${minPeers} a rate needs.`
            : `Too few matched institutions for a rate: ${thin.map((s) => `${s.name} (${count(s.matched)})`).join(", ")}.`}
        </p>
      )}
    </div>
  );
}

export function PriceMoves({ summary, showAll }: { summary: FeeChangeSummary; showAll: boolean }) {
  const plus = summary.capped ? "+" : "";
  return (
    <div className="space-y-3">
      <Tiles
        items={[
          { value: `${count(summary.up)}${plus}`, label: "Prices raised" },
          { value: `${count(summary.down)}${plus}`, label: "Prices cut" },
          { value: `${count(summary.added)}${plus}`, label: "New fees" },
          { value: `${count(summary.removed)}${plus}`, label: "Fees dropped" },
        ]}
      />
      {summary.recent.length > 0 && (
        <ul className="divide-y divide-surface-200 border-y border-border">
          {summary.recent.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <Link href={`/institution/${c.institution_id}`} className="block truncate text-[13px] font-medium text-ink underline-offset-4 hover:underline">
                  {c.institution_name}
                </Link>
                <span className="block truncate text-[11px] text-ink-muted">
                  {showAll ? getDisplayName(c.fee_category) : hubFeeName(c.fee_category)} · {monthYear(c.changed_at)}
                </span>
              </span>
              <span className={`whitespace-nowrap text-[13px] font-semibold tabular-nums text-ink`}>
                {money(c.old_amount)} &rarr; {money(c.new_amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CpiChart({ history, label }: { history: { date: string; value: number }[]; label: string }) {
  // A national series: drawn in ink, since brick on this page marks the district.
  return (
    <div className="text-ink">
      <TrendChart lines={[{ label, points: history, tone: "primary" }]} format={(v) => `${v.toFixed(0)}%`} label={label} color="currentColor" />
    </div>
  );
}
