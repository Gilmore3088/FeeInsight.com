import Link from "next/link";
import type { ReactNode } from "react";
import type { HubBranches } from "@/lib/data-store/district-hub";
import { formatCompactDollars, formatFeeAmount } from "@/lib/format";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { TrendChart } from "../../state/[code]/trend-chart";
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

const H2 = "text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]";
const CARD = "rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6";

export function HubSection({ id, title, line, source, children }: { id: string; title: string; line?: ReactNode; source: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20 space-y-3">
      <div>
        <h2 id={`${id}-heading`} className={H2}>
          {title}
        </h2>
        {line && <p className="mt-1 text-[14px] text-ink-muted">{line}</p>}
      </div>
      {children}
      <p className="text-[11px] leading-snug text-ink-muted">
        <span className="font-semibold">Source:</span> {source}
      </p>
    </section>
  );
}

/** Tile columns by count, so a row never ends in an empty cell. */
const TILE_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

/** A row of figure tiles. */
export function Tiles({ items, tone = "light" }: { items: { value: string; label: string }[]; tone?: "light" | "card" }) {
  if (items.length === 0) return null;
  return (
    <dl className={`grid gap-px overflow-hidden rounded-xl bg-border ${TILE_COLUMNS[items.length] ?? "grid-cols-2 sm:grid-cols-3"}`}>
      {items.map((t) => (
        <div key={t.label} className={`${tone === "card" ? "bg-surface-0" : "bg-paper"} px-3 py-2.5`}>
          <dt className="text-[11px] leading-tight text-ink-muted">{t.label}</dt>
          <dd className="mt-0.5 font-mono text-[20px] font-semibold leading-tight tabular-nums text-ink">{t.value}</dd>
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
    { value: count(row.institutions), label: `Banks ${count(row.banks)} · Credit unions ${count(row.creditUnions)}` },
    ...(row.coveragePct != null ? [{ value: pct(row.coveragePct, 0), label: "With verified fees" }] : []),
    ...(row.serviceCharges != null ? [{ value: compact(row.serviceCharges), label: "Fee income, latest quarter" }] : []),
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

/** Stacked columns: each quarter's fee income, banks under credit unions. */
export function RevenueChart({ quarters }: { quarters: RevenueQuarter[] }) {
  const max = Math.max(...quarters.map((q) => q.total), 1);
  return (
    <figure className={CARD}>
      <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ink" /> Banks
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brick" /> Credit unions
        </span>
      </p>
      <div className="flex h-44 items-end gap-1.5 sm:gap-3" role="img" aria-label={`Fee income by quarter, ${quarterLabel(quarters[0].quarter)} to ${quarterLabel(quarters[quarters.length - 1].quarter)}: ${quarters.map((q) => compact(q.total)).join(", ")}`}>
        {quarters.map((q, i) => (
          <div key={q.quarter} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            {/* Phones label only the newest bar; eight values don't fit side by side. */}
            <span
              className={`mb-1 whitespace-nowrap text-center text-[10px] font-semibold tabular-nums text-ink ${i === quarters.length - 1 ? "" : "hidden sm:block"}`}
            >
              {compact(q.total)}
            </span>
            <div className="flex flex-col overflow-hidden rounded-t-md" style={{ height: `${(q.total / max) * 82}%` }}>
              <div className="bg-brick" style={{ flexGrow: q.creditUnions }} />
              <div className="bg-ink" style={{ flexGrow: q.banks }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 sm:gap-3" aria-hidden="true">
        {quarters.map((q) => (
          <span key={q.quarter} className="min-w-0 flex-1 text-center text-[10px] leading-tight tabular-nums text-ink-muted">
            {quarterLabel(q.quarter).split(" ")[0]}
            <span className="block sm:inline">{quarterLabel(q.quarter).replace(/^Q\d 20/, " ’")}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Horizontal bars, one per row, labeled and valued. */
export function RankBars({ rows, format, tick, tickLabel }: { rows: { key: string; label: string; value: number; note?: string }[]; format: (n: number) => string; tick?: number | null; tickLabel?: string }) {
  const max = Math.max(...rows.map((r) => r.value), tick ?? 0, 1) * 1.05;
  return (
    <div className={CARD}>
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

/** Institutions by asset size: banks and credit unions side by side in one bar per size. */
export function TierChart({ tiers }: { tiers: TierRow[] }) {
  const max = Math.max(...tiers.map((t) => t.banks + t.creditUnions), 1);
  return (
    <div className={CARD}>
      <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ink" /> Banks
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brick" /> Credit unions
        </span>
      </p>
      <ul className="space-y-3">
        {tiers.map((t) => (
          <li key={t.tier}>
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="font-medium text-ink">{t.label}</span>
              <span className="tabular-nums text-ink-muted">
                {count(t.banks)} · {count(t.creditUnions)}
              </span>
            </div>
            <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-surface-200" aria-hidden="true">
              <div className="bg-ink" style={{ width: `${(t.banks / max) * 100}%` }} />
              <div className="bg-brick" style={{ width: `${(t.creditUnions / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The largest banks by deposits in the district's states, each with its share. */
export function LeadersTable({ branches }: { branches: HubBranches }) {
  if (branches.leaders.length === 0) return null;
  const top = branches.leaders[0].deposits;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface-0 shadow-fi-1">
      <ol className="divide-y divide-surface-200">
        {branches.leaders.map((l, i) => {
          const share = branches.total_deposits > 0 ? (l.deposits / branches.total_deposits) * 100 : null;
          return (
            <li key={l.institution_id}>
              <details className="group">
                <summary className="grid cursor-pointer list-none grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-paper/60 [&::-webkit-details-marker]:hidden">
                  <span className="text-[12px] tabular-nums text-ink-muted">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">{l.name}</span>
                    <span className="mt-1 block h-1.5 rounded-full bg-surface-200" aria-hidden="true">
                      <span className="block h-full rounded-full bg-ink" style={{ width: `${(l.deposits / top) * 100}%` }} />
                    </span>
                  </span>
                  <span className="text-right text-[12px] font-semibold tabular-nums text-ink">{share != null ? pct(share) : compact(l.deposits)}</span>
                </summary>
                <p className="px-4 pb-3 pl-[3.25rem] text-[12px] text-ink-muted">
                  {compact(l.deposits)} in deposits across {count(l.branches)} branches.{" "}
                  <Link href={`/institution/${l.institution_id}`} className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
                    Fees
                  </Link>
                </p>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
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
        tone="card"
        items={[
          { value: `${count(summary.up)}${plus}`, label: "Prices raised" },
          { value: `${count(summary.down)}${plus}`, label: "Prices cut" },
          { value: `${count(summary.added)}${plus}`, label: "New fees" },
          { value: `${count(summary.removed)}${plus}`, label: "Fees dropped" },
        ]}
      />
      {summary.recent.length > 0 && (
        <ul className="divide-y divide-surface-200 overflow-hidden rounded-2xl border border-border bg-surface-0 shadow-fi-1">
          {summary.recent.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <Link href={`/institution/${c.institution_id}`} className="block truncate text-[13px] font-medium text-ink hover:text-brick">
                  {c.institution_name}
                </Link>
                <span className="block truncate text-[11px] text-ink-muted">
                  {showAll ? getDisplayName(c.fee_category) : hubFeeName(c.fee_category)} · {monthYear(c.changed_at)}
                </span>
              </span>
              <span className={`whitespace-nowrap text-[13px] font-semibold tabular-nums ${c.change_type === "increase" ? "text-brick" : "text-below-market"}`}>
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
  return (
    <div className={CARD}>
      <TrendChart lines={[{ label, points: history, tone: "primary" }]} format={(v) => `${v.toFixed(0)}%`} label={label} />
    </div>
  );
}
