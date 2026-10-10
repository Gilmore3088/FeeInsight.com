/**
 * Draws the Hamilton engine's answer the same way on every screen: the headline, the Consultant's
 * sourced claims, the Economist's drivers, the one exhibit and the one clarifying question.
 * The engine returns data only (`HamiltonAnswer`, `Exhibit`); every chart decision lives here.
 */
import { RD } from "@/lib/report-design/tokens";
import type { CSSProperties, ReactNode } from "react";
import { Callout, More, QuestionCard, SERIF, fmtMoney } from "./memo";
import { REPORT_DESIGN_CSS } from "@/lib/report-design/css";
import type { Exhibit, ExhibitMarker, Fact, HamiltonAnswer, SourceRef } from "@/lib/hamilton/workspace/types";

export type ExhibitSpec = Exhibit;
export type AnswerSpec = Pick<HamiltonAnswer, "feeCategory" | "headline" | "claims" | "drivers" | "exhibit" | "question" | "evidenceLevel">;

export const EVIDENCE_LABELS: Record<AnswerSpec["evidenceLevel"], string> = {
  market: "Market data only",
  working_estimate: "Working estimate from institution filings",
  institution: "Your own figures",
};

function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** A source as the reader sees it: name, date and, for a market figure, how many institutions. */
export function SourceChip({ source, n }: { source: SourceRef; n?: number }) {
  const date = shortDate(source.asOf);
  const text = [source.label, date, n != null ? `n=${n.toLocaleString("en-US")}` : null].filter(Boolean).join(" · ");
  const cls = "inline-block rounded border border-warm-200 bg-white px-1.5 py-0.5 text-[11px] leading-tight text-warm-600";
  return source.url ? (
    <a href={source.url} target="_blank" rel="noreferrer" className={`${cls} hover:border-terra hover:text-terra-text`}>
      {text}
    </a>
  ) : (
    <span className={cls}>{text}</span>
  );
}

/** Each source once: the same label and date from several markets is one citation, not five. */
export function uniqueSources(sources: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = `${s.label}|${shortDate(s.asOf) ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceLine(sources: readonly SourceRef[]): ReactNode {
  return uniqueSources(sources).map((s, i) => (
    <span key={`${s.label}-${i}`}>
      {i > 0 ? "; " : ""}
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-warm-300 hover:text-terra-text">
          {s.label}
        </a>
      ) : (
        s.label
      )}
      {s.asOf ? `, ${shortDate(s.asOf)}` : ""}
    </span>
  ));
}

/**
 * One exhibit in the shared report look (src/lib/report-design): label, a headline that says
 * what the data shows, the chart, then the source line. The stylesheet is hoisted once per page
 * however many exhibits render.
 */
export function ExhibitFrame({
  title,
  sources,
  note,
  number,
  topic,
  sub,
  children,
}: {
  title: string;
  sources: readonly SourceRef[];
  note?: string;
  number?: number;
  /** The label's second half: "Exhibit 2 · Fees". */
  topic?: string;
  /** An italic line under the headline. */
  sub?: string;
  children: ReactNode;
}) {
  const label = [number != null ? `Exhibit ${number}` : "Exhibit", topic].filter(Boolean).join(" · ");
  return (
    <div className="rd w-full">
      <style href="report-design" precedence="medium">
        {REPORT_DESIGN_CSS}
      </style>
      <section className="rd-exhibit">
        <div className="rd-label">{label}</div>
        <h2>{title}</h2>
        {sub ? <p className="rd-sub">{sub}</p> : null}
        {children}
        {note ? <p className="rd-source not-italic">{note}</p> : null}
        {sources.length > 0 ? <div className="rd-source">Source: {sourceLine(sources)}</div> : null}
      </section>
    </div>
  );
}

/** One axis for a set of dollar values, padded so the ends never sit on the edge. */
export function axisFor(values: readonly number[]): { lo: number; hi: number; at: (v: number) => number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.12, 1);
  const lo = Math.max(0, Math.floor(min - pad));
  const hi = Math.ceil(max + pad);
  return { lo, hi, at: (v) => ((v - lo) / (hi - lo || 1)) * 100 };
}

/**
 * Places labels centred on their marks, kept inside the track, in as few rows as fit without
 * overlap. Widths are in % of the track (an estimate from the label's length).
 */
export function placeLabels(items: readonly { x: number; width: number }[]): { left: number; row: number }[] {
  const rowEnds: number[] = [];
  return items.map(({ x, width }) => {
    const left = Math.min(Math.max(x - width / 2, 0), Math.max(100 - width, 0));
    let row = rowEnds.findIndex((end) => left >= end + 1.5);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = left + width;
    return { left, row };
  });
}

/** About how wide an 11px label is on a ~900px track, in %. */
const labelWidth = (text: string) => text.length * 0.58 + 1;

function ownLabelStyle(at: number, left: number): CSSProperties {
  if (at >= 70) return { right: `${Math.max(0, 100 - at - 1)}%` };
  if (at <= 30) return { left: `${Math.max(0, at - 1)}%` };
  return { left: `${left}%` };
}

/** "Credit unions, $1B to $10B in assets median" -> "Credit unions, $1B to $10B in assets"; "Fed district 6 (Atlanta)" -> "Fed district 6". */
function shortMarketLabel(label: string): string {
  return label
    .replace(/\s+median$/i, "")
    .replace(/\s*\([^)]*\)/g, "")
    .trim();
}

/** Market medians grouped by value, lowest first, each group named once. */
export function groupMarkers(markers: readonly ExhibitMarker[]): { label: string; value: number }[] {
  const byValue = new Map<number, string[]>();
  for (const m of markers) byValue.set(m.value, [...(byValue.get(m.value) ?? []), shortMarketLabel(m.label)]);
  return [...byValue.entries()].sort((a, b) => a[0] - b[0]).map(([value, labels]) => ({ value, label: labels.join(", ") }));
}

function FeePosition({ x }: { x: Extract<ExhibitSpec, { kind: "fee_position" }> }) {
  const values = [x.band.p25, x.band.p75, x.band.median, ...x.markers.map((m) => m.value), ...(x.own != null ? [x.own] : [])];
  const axis = axisFor(values);
  // The band already draws the peer median; markers add the wider markets.
  // Markets with the same median share one label ("Florida, National: $30"), so equal values never stack.
  const markers = groupMarkers(x.markers.filter((m) => m.scope !== "peer"));
  const markerText = (m: (typeof markers)[number]) => `${m.label}: ${fmtMoney(m.value)}`;
  const placed = placeLabels(markers.map((m) => ({ x: axis.at(m.value), width: labelWidth(markerText(m)) })));
  const rowCount = Math.max(1, ...placed.map((p) => p.row + 1));
  const ownText = x.own != null ? `${x.ownLabel} ${fmtMoney(x.own)}` : "";
  const ownPlaced = x.own != null ? placeLabels([{ x: axis.at(x.own), width: labelWidth(ownText) + 1 }])[0] : null;
  return (
    <div>
      <div className="relative" style={{ height: `${3.6 + rowCount * 1.5}rem` }}>
        {ownPlaced ? (
          <span
            className="absolute top-0 whitespace-nowrap text-xs font-semibold text-terra-text [font-variant-numeric:tabular-nums]"
            // Ends at the mark near the right edge and starts at it near the left, so it never runs off the track.
            style={ownLabelStyle(axis.at(x.own!), ownPlaced.left)}
          >
            {ownText}
          </span>
        ) : null}
        <span className="absolute inset-x-0 top-8 h-2 rounded-full bg-warm-200" />
        <span
          className="absolute top-7 h-4 rounded bg-terra/25 ring-1 ring-terra/40"
          style={{ left: `${axis.at(x.band.p25)}%`, width: `${axis.at(x.band.p75) - axis.at(x.band.p25)}%` }}
          title={`${x.band.label}, middle half: ${fmtMoney(x.band.p25)} to ${fmtMoney(x.band.p75)}`}
        />
        <span className="absolute top-6 h-6 w-0.5 -translate-x-1/2 bg-warm-800" style={{ left: `${axis.at(x.band.median)}%` }} title={`${x.band.label} median ${fmtMoney(x.band.median)}`} />
        {markers.map((m, i) => (
          <span key={m.label}>
            <span
              className="absolute top-[2.4rem] w-px -translate-x-1/2 bg-warm-400"
              style={{ left: `${axis.at(m.value)}%`, height: `${0.85 + placed[i].row * 1.5}rem` }}
            />
            <span
              className="absolute z-10 whitespace-nowrap bg-warm-50 px-1 text-[11px] text-warm-700 [font-variant-numeric:tabular-nums]"
              style={{ left: `${placed[i].left}%`, top: `${3.3 + placed[i].row * 1.5}rem` }}
            >
              {markerText(m)}
            </span>
          </span>
        ))}
        {x.own != null ? (
          <span
            className="absolute top-[1.65rem] h-5 w-5 -translate-x-1/2 rounded-full border-[3px] border-white bg-terra shadow"
            style={{ left: `${axis.at(x.own)}%` }}
            title={`${x.ownLabel} ${fmtMoney(x.own)}`}
          />
        ) : null}
      </div>
      <div className="flex justify-between text-[11px] text-warm-600 [font-variant-numeric:tabular-nums]">
        <span>{fmtMoney(axis.lo)}</span>
        <span>{fmtMoney(axis.hi)}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-warm-700">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-sm bg-terra/25 ring-1 ring-terra/40" />
          {x.band.label}, middle half: {fmtMoney(x.band.p25)} to {fmtMoney(x.band.p75)} ({x.band.n} institutions)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-warm-800" />
          Median {fmtMoney(x.band.median)}
        </span>
        {x.own != null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-terra" />
            {x.ownLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** "$1.2B", "$850M": local deposits, compact. */
function fmtDeposits(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  return `$${Math.round(v / 1e3)}K`;
}

const RANGE_COLS = "grid-cols-[minmax(0,7.5rem)_1fr_3rem] sm:grid-cols-[minmax(0,12rem)_1fr_3.5rem]";

function CompetitorRange({ x }: { x: Extract<ExhibitSpec, { kind: "competitor_range" }> }) {
  const axis = axisFor([...x.items.map((i) => i.amount), ...(x.own != null ? [x.own] : [])]);
  // Local deposits (FDIC Summary of Deposits) size each competitor in the market, when the engine carries them.
  const maxDeposits = Math.max(0, ...x.items.map((i) => i.deposits ?? 0));
  return (
    <div className="flex flex-col gap-1.5">
      {maxDeposits > 0 ? (
        <div className={`grid ${RANGE_COLS} gap-3 text-[11px] text-warm-600`}>
          <span>Local deposits</span>
          <span />
          <span className="text-right">Fee</span>
        </div>
      ) : null}
      {x.items.map((item) => (
        <div key={item.name} className={`grid ${RANGE_COLS} items-center gap-3 text-sm`}>
          <span className="min-w-0">
            <span className="block truncate text-warm-800" title={item.name}>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-terra-text hover:underline">
                  {item.name}
                </a>
              ) : (
                item.name
              )}
            </span>
            {maxDeposits > 0 ? (
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-warm-600 [font-variant-numeric:tabular-nums]">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-warm-100">
                  <span className="block h-full rounded-full bg-warm-500" style={{ width: `${((item.deposits ?? 0) / maxDeposits) * 100}%` }} />
                </span>
                <span className="w-10 shrink-0 text-right">{item.deposits != null ? fmtDeposits(item.deposits) : "n/a"}</span>
              </span>
            ) : null}
          </span>
          <span className="relative h-7">
            <span className="absolute inset-x-0 top-1/2 h-px bg-warm-200" />
            {x.own != null ? (
              // A bar from your fee to theirs: the distance reads at a glance, and the side says more or less.
              <span
                className={`absolute top-1 h-5 ${item.amount > x.own ? "rounded-r-md bg-warm-700" : "rounded-l-md bg-warm-400"}`}
                style={{ left: `${Math.min(axis.at(item.amount), axis.at(x.own))}%`, width: `${Math.max(Math.abs(axis.at(item.amount) - axis.at(x.own)), 0.8)}%` }}
              />
            ) : (
              <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warm-700" style={{ left: `${axis.at(item.amount)}%` }} />
            )}
            {x.own != null ? <span className="absolute -inset-y-1 w-[3px] -translate-x-1/2 rounded bg-terra" style={{ left: `${axis.at(x.own)}%` }} /> : null}
          </span>
          <span className="text-right font-semibold text-warm-900 [font-variant-numeric:tabular-nums]">{fmtMoney(item.amount)}</span>
        </div>
      ))}
      <div className={`grid ${RANGE_COLS} gap-3 text-[11px] text-warm-600 [font-variant-numeric:tabular-nums]`}>
        <span />
        <span className="flex justify-between">
          <span>{fmtMoney(axis.lo)}</span>
          <span>{fmtMoney(axis.hi)}</span>
        </span>
        <span />
      </div>
      {x.own != null ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-warm-700">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3.5 w-[3px] rounded bg-terra" />
            {x.ownLabel}: {fmtMoney(x.own)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-warm-400" />
            Charges less
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-warm-700" />
            Charges more
          </span>
        </p>
      ) : null}
    </div>
  );
}

function fmtTrendValue(v: number, unit: "dollars" | "percent"): string {
  if (unit === "percent") return `${v.toFixed(1)}%`;
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  // Small figures (service charges per $1,000 of deposits) keep their cents.
  if (a < 100) return `$${v.toFixed(2)}`;
  return `$${Math.round(v)}`;
}

function Trend({ x }: { x: Extract<ExhibitSpec, { kind: "trend" }> }) {
  const W = 640;
  const H = 230;
  const pad = { l: 44, r: 128, t: 16, b: 28 };
  const dates = [...new Set(x.series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const vals = x.series.flatMap((s) => s.points.map((p) => p.value));
  if (dates.length < 2 || vals.length === 0) return <p className="text-sm text-warm-700">Not enough points on file to draw a trend.</p>;
  // Zoom to the data rather than to zero, so a gap of cents between two lines is visible.
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals);
  const span = vMax - vMin || Math.abs(vMax) * 0.1 || 1;
  const lo = vMin < 0 ? vMin - span * 0.2 : Math.max(0, vMin - span * 0.6);
  const hi = vMax + span * 0.3;
  const px = (d: string) => pad.l + (dates.indexOf(d) / (dates.length - 1)) * (W - pad.l - pad.r);
  const py = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const strokes = [RD.terra, RD.inkSoft, RD.muted];
  const label = (d: string) => shortDate(d) ?? d;
  const [own, peer] = x.series;
  const paired = own && peer && own.points.length > 1 && peer.points.length > 1;
  // The gap at each end, where both series have a point on the same date.
  const gapAt = (d: string | undefined) => {
    if (!paired || !d) return null;
    const a = own.points.find((p) => p.date === d);
    const b = peer.points.find((p) => p.date === d);
    return a && b ? { d, a: a.value, b: b.value } : null;
  };
  const ends = [gapAt(own?.points[0]?.date), gapAt(own?.points[own.points.length - 1]?.date)].filter((g): g is NonNullable<typeof g> => g != null);
  // End labels sit beside the last point, nudged apart when the lines finish close together.
  const endLabels = x.series
    .map((s, i) => ({ s, i, last: s.points[s.points.length - 1] }))
    .filter((e) => e.last)
    .map((e) => ({ ...e, y: py(e.last!.value) }))
    .sort((m, n) => m.y - n.y);
  for (let k = 1; k < endLabels.length; k++) {
    if (endLabels[k].y - endLabels[k - 1].y < 30) endLabels[k].y = endLabels[k - 1].y + 30;
  }
  const gradId = `trend-fill-${x.title.length}-${dates.length}`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl" role="img" aria-label={x.title}>
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={RD.terra} stopOpacity={0.28} />
            <stop offset="100%" stopColor={RD.terra} stopOpacity={0.06} />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => {
          const v = lo + (hi - lo) * f;
          return (
            <g key={f}>
              <line x1={pad.l} x2={W - pad.r} y1={py(v)} y2={py(v)} stroke={RD.rule2} strokeDasharray={f === 0 ? undefined : "2 4"} />
              <text x={pad.l - 6} y={py(v) + 4} fontSize="11" fill={RD.inkSoft} textAnchor="end">
                {fmtTrendValue(v, x.unit)}
              </text>
            </g>
          );
        })}
        {/* The space between the bank and its peers is filled, so the gap reads as a shape. */}
        {paired ? (
          <polygon
            fill={`url(#${gradId})`}
            points={[
              ...own.points.map((p) => `${px(p.date)},${py(p.value)}`),
              ...[...peer.points].reverse().map((p) => `${px(p.date)},${py(p.value)}`),
            ].join(" ")}
          />
        ) : null}
        {ends.map((g, k) => {
          const xg = px(g.d) + (k === 0 ? 10 : -10);
          const y1 = py(Math.max(g.a, g.b));
          const y2 = py(Math.min(g.a, g.b));
          return (
            <g key={g.d}>
              <path d={`M ${xg - (k === 0 ? 4 : -4)} ${y1} H ${xg} V ${y2} H ${xg - (k === 0 ? 4 : -4)}`} fill="none" stroke={RD.ink} strokeWidth={1} />
              {y2 - y1 > 14 ? (
                <text x={xg + (k === 0 ? 5 : -5)} y={(y1 + y2) / 2 + 4} fontSize="11" fontWeight={600} fill={RD.ink} textAnchor={k === 0 ? "start" : "end"}>
                  gap {fmtTrendValue(Math.abs(g.a - g.b), x.unit)}
                </text>
              ) : null}
            </g>
          );
        })}
        {x.series.map((s, i) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={strokes[i % strokes.length]}
            strokeWidth={i === 0 ? 3 : 1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={i === 0 ? undefined : "5 4"}
            points={s.points.map((p) => `${px(p.date)},${py(p.value)}`).join(" ")}
          />
        ))}
        {x.series.map((s, i) =>
          s.points.map((p, k) =>
            i === 0 || k === s.points.length - 1 ? (
              <circle
                key={`${s.label}-${p.date}`}
                cx={px(p.date)}
                cy={py(p.value)}
                r={k === s.points.length - 1 ? (i === 0 ? 5 : 3.5) : 2.5}
                fill={strokes[i % strokes.length]}
                stroke={RD.paper}
                strokeWidth={1.5}
              />
            ) : null,
          ),
        )}
        {endLabels.map((e) => (
          <g key={`label-${e.s.label}`}>
            <text x={W - pad.r + 12} y={e.y} fontSize="15" fontWeight={600} fill={e.i === 0 ? RD.terraText : RD.ink}>
              {fmtTrendValue(e.last!.value, x.unit)}
            </text>
            <text x={W - pad.r + 12} y={e.y + 13} fontSize="10.5" fill={RD.inkSoft}>
              {e.i === 0 ? e.s.label : e.s.label.length > 20 ? "Peer median" : e.s.label}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 6} fontSize="11" fill={RD.inkSoft}>
          {label(dates[0])}
        </text>
        <text x={W - pad.r} y={H - 6} fontSize="11" fill={RD.inkSoft} textAnchor="end">
          {label(dates[dates.length - 1])}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-warm-700">
        {x.series.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5" style={{ background: strokes[i % strokes.length] }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The engine's one exhibit, drawn the same on Research, Model, Reports and Ask. Storyline-only kinds are drawn by StoryExhibitView. */
export function ExhibitView({ exhibit, number, title }: { exhibit: ExhibitSpec; number?: number; title?: string }) {
  return (
    <ExhibitFrame title={title ?? exhibit.title} sources={exhibit.sources} note={exhibit.note} number={number}>
      {exhibit.kind === "fee_position" ? (
        <FeePosition x={exhibit} />
      ) : exhibit.kind === "competitor_range" ? (
        exhibit.items.length > 0 ? (
          <CompetitorRange x={exhibit} />
        ) : (
          <p className="text-sm text-warm-700">No named competitor publishes this fee yet.</p>
        )
      ) : exhibit.kind === "trend" ? (
        <Trend x={exhibit} />
      ) : null}
    </ExhibitFrame>
  );
}

export function FactList({ facts }: { facts: readonly Fact[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {facts.map((f, i) => (
        <li key={i} className="text-[15px] leading-relaxed text-warm-800">
          {f.text} <SourceChip source={f.source} n={f.sampleSize} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One Hamilton answer in the four roles: the Writer's headline, the Consultant's claims, the
 * Economist's drivers and question, and the Data Engineer's exhibit, with its evidence level.
 */
const LEAD_CLAIMS = 2;

export function AnswerView({
  answer,
  questionAction,
  questionName,
  questionWhy = "Hamilton uses your answer in place of a market assumption.",
  questionKeep = {},
}: {
  answer: AnswerSpec;
  /** Where the question card submits; omit to show the question without a form. */
  questionAction?: string;
  /** The form field the answer is sent as; the question's memory key by default. */
  questionName?: string;
  questionWhy?: string;
  questionKeep?: Record<string, string | null | undefined>;
}) {
  const q = answer.question;
  // The chart and two lines carry the answer; the rest of the reasoning opens on request.
  const lead = answer.claims.slice(0, LEAD_CLAIMS);
  const rest = answer.claims.slice(LEAD_CLAIMS);
  return (
    <article className="flex flex-col gap-5">
      <p className="text-xl leading-snug text-warm-900 sm:text-2xl" style={SERIF}>
        {answer.headline}
      </p>
      {answer.exhibit ? <ExhibitView exhibit={answer.exhibit} /> : null}
      {lead.length > 0 ? <FactList facts={lead} /> : null}
      {rest.length > 0 || answer.drivers.length > 0 ? (
        <More label={answer.drivers.length > 0 ? "Why, and what moves this" : "The rest of the reasoning"}>
          {rest.length > 0 ? <FactList facts={rest} /> : null}
          {answer.drivers.length > 0 ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-warm-600">What moves this</h3>
              <FactList facts={answer.drivers} />
            </section>
          ) : null}
        </More>
      ) : null}
      {q && q.inputKind !== "file" ? (
        questionAction ? (
          <QuestionCard
            prompt={q.prompt}
            why={questionWhy}
            name={questionName ?? q.fieldKey}
            inputKind={q.inputKind}
            action={questionAction}
            keep={questionKeep}
          />
        ) : (
          <Callout>
            <span className="font-medium text-warm-900">Hamilton has one question: </span>
            {q.prompt}
          </Callout>
        )
      ) : null}
      <p className="text-xs text-warm-600">
        Evidence: <span className="font-medium text-warm-800">{EVIDENCE_LABELS[answer.evidenceLevel]}</span>
      </p>
    </article>
  );
}
