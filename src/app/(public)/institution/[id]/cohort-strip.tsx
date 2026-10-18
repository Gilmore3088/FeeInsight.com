"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatCompactDollars } from "@/lib/format";
import type { CohortPoint } from "./fee-share-cohort";
import { niceTicks } from "./quarter-chart";

/**
 * Financial performance B: where the institution's service-charge share of revenue sits in its
 * asset-size cohort. A box (quartiles, from the real cohort) over a strip of every peer, the
 * subject in the one accent, peers in neutral slate. Hover or tap a dot, or pick a name in the
 * searchable list, to read that peer's quarter, amounts and calculation. Peers past the axis are
 * counted at its edge, never dropped silently.
 */
export interface CohortStripProps {
  subjectName: string;
  subject: CohortPoint | null;
  /** Every peer in the distribution, sorted by share; one the site never names comes without a name. */
  peers: CohortPoint[];
  p25: number;
  median: number;
  p75: number;
  quarter: string;
  /** "FDIC BankFind Suite (call report data)". */
  sourceName: string;
  /** "Service charges" or "Fee income". */
  measureName: string;
  yearToDate: boolean;
}

/** Rows the member list shows before "Show all"; a search always lists every match. */
const LIST_PREVIEW = 15;
const H = 132;
const PAD = { left: 12, right: 12 };
const BOX_Y = 18;
const BOX_H = 22;
const STRIP_Y = 56;
const STRIP_H = 52;

function hash(id: number): number {
  let h = id * 2654435761;
  h ^= h >>> 16;
  return ((h >>> 0) % 1000) / 1000;
}

const pct = (n: number) => `${n.toFixed(1)}%`;

function Detail({ point, quarter, sourceName, measureName, yearToDate, onClear, isSubject }: {
  point: CohortPoint;
  quarter: string;
  sourceName: string;
  measureName: string;
  yearToDate: boolean;
  onClear?: () => void;
  isSubject: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-paper p-3 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-semibold text-ink">
          {isSubject ? (
            point.name
          ) : (
            <Link href={`/institution/${point.id}`} className="underline decoration-border underline-offset-4 hover:decoration-ink">
              {point.name}
            </Link>
          )}
          <span className="block text-[12px] font-normal text-ink-muted">{[point.city, point.state].filter(Boolean).join(", ")}</span>
        </p>
        {onClear && (
          <button type="button" onClick={onClear} className="min-h-9 shrink-0 rounded-md px-2 text-[12px] text-ink-muted hover:text-ink">
            Clear
          </button>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 [font-variant-numeric:tabular-nums]">
        <dt className="text-ink-muted">Assets</dt>
        <dd className="text-ink">{point.assets !== null ? formatCompactDollars(point.assets) : "Not reported"}</dd>
        <dt className="text-ink-muted">{measureName}</dt>
        <dd className="text-ink">{point.serviceCharges !== null ? formatCompactDollars(point.serviceCharges) : "Not reported"}</dd>
        <dt className="text-ink-muted">Revenue</dt>
        <dd className="text-ink">{point.revenue !== null ? formatCompactDollars(point.revenue) : "Not reported"}</dd>
        <dt className="text-ink-muted">Share</dt>
        <dd className="text-ink">
          {point.serviceCharges !== null && point.revenue !== null
            ? `${formatCompactDollars(point.serviceCharges)} / ${formatCompactDollars(point.revenue)} = ${pct(point.sharePct)}`
            : pct(point.sharePct)}
        </dd>
        <dt className="text-ink-muted">Period</dt>
        <dd className="text-ink">{yearToDate ? `Year to date through ${quarter}` : quarter}</dd>
        <dt className="text-ink-muted">Source</dt>
        <dd className="text-ink">{sourceName}</dd>
      </dl>
    </div>
  );
}

export function CohortStrip(props: CohortStripProps) {
  const { subject, peers, p25, median, p75, quarter, sourceName, measureName, yearToDate, subjectName } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [hover, setHover] = useState<CohortPoint | null>(null);
  const [picked, setPicked] = useState<CohortPoint | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const sorted = peers.map((p) => p.sharePct);
  const p98 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] ?? 0;
  const ticks = niceTicks(0, Math.max(p98, subject?.sharePct ?? 0, p75) * 1.05, 4);
  const axisMax = ticks[ticks.length - 1];
  const beyond = peers.filter((p) => p.sharePct > axisMax).length;
  const plotW = width - PAD.left - PAD.right;
  const x = (v: number) => PAD.left + (Math.min(v, axisMax) / axisMax) * plotW;
  const listed = useMemo(() => peers.filter((p) => p.name), [peers]);
  const listedIds = useMemo(() => new Set(listed.map((p) => p.id)), [listed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? listed.filter((p) => `${p.name} ${p.city ?? ""} ${p.state ?? ""}`.toLowerCase().includes(q)) : listed;
    return [...rows].sort((a, b) => b.sharePct - a.sharePct);
  }, [listed, query]);

  const nearest = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    let best: CohortPoint | null = null;
    let bestD = Infinity;
    for (const p of peers) {
      if (!listedIds.has(p.id)) continue;
      const dx = x(p.sharePct) - sx;
      const dy = STRIP_Y + hash(p.id) * STRIP_H - sy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return bestD <= 24 * 24 ? best : null;
  };

  const focus = picked ?? hover;

  return (
    <div className="min-w-0" ref={wrapRef}>
      <svg
        ref={svgRef}
        width={width}
        height={H}
        className="block touch-pan-y"
        role="img"
        aria-label={`${subjectName} ${subject ? pct(subject.sharePct) : "not reported"}; cohort quartiles ${pct(p25)}, ${pct(median)}, ${pct(p75)}.`}
        onPointerMove={(e) => setHover(nearest(e.clientX, e.clientY))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const p = nearest(e.clientX, e.clientY);
          if (p) setPicked(p);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={BOX_Y - 6} y2={STRIP_Y + STRIP_H + 4} stroke="var(--fi-chart-grid)" strokeWidth={1} />
            <text x={x(t)} y={H - 4} textAnchor="middle" className="fill-ink-muted text-[11px] [font-variant-numeric:tabular-nums]">
              {`${Number(t.toFixed(1))}%`}
            </text>
          </g>
        ))}
        <rect x={x(p25)} y={BOX_Y} width={Math.max(1, x(p75) - x(p25))} height={BOX_H} rx={4} fill="var(--fi-peer)" opacity={0.35} />
        <line x1={x(median)} x2={x(median)} y1={BOX_Y - 4} y2={BOX_Y + BOX_H + 4} stroke="var(--color-ink)" strokeWidth={2} />
        {peers.map((p) => (
          <circle
            key={p.id}
            cx={x(p.sharePct)}
            cy={STRIP_Y + hash(p.id) * STRIP_H}
            r={focus?.id === p.id ? 5 : 2.6}
            fill={focus?.id === p.id ? "var(--color-ink)" : "var(--fi-peer)"}
            opacity={focus && focus.id !== p.id ? 0.55 : 0.85}
          />
        ))}
        {subject && (
          <g>
            <line x1={x(subject.sharePct)} x2={x(subject.sharePct)} y1={BOX_Y - 8} y2={STRIP_Y + STRIP_H + 4} stroke="var(--fi-subject)" strokeWidth={2} />
            <circle cx={x(subject.sharePct)} cy={BOX_Y + BOX_H / 2} r={6} fill="var(--fi-subject)" stroke="var(--color-surface-0)" strokeWidth={2} />
          </g>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-ink-muted">
        {subject && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-full bg-[var(--fi-subject)]" />
            {subjectName} {pct(subject.sharePct)}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-3 bg-ink" />
          Median {pct(median)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-sm bg-[var(--fi-peer)] opacity-60" />
          Middle half {pct(p25)} to {pct(p75)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2 rounded-full bg-[var(--fi-peer)]" />
          Each peer
        </span>
        {beyond > 0 && <span>{beyond} above {`${Number(axisMax.toFixed(1))}%`}, drawn at the right edge</span>}
      </div>

      <div className="mt-3 min-h-[1px]" aria-live="polite">
        {focus && (
          <Detail
            point={focus}
            quarter={quarter}
            sourceName={sourceName}
            measureName={measureName}
            yearToDate={yearToDate}
            isSubject={false}
            onClear={picked ? () => setPicked(null) : undefined}
          />
        )}
      </div>

      <div className="mt-4">
        <label className="block text-[12px] font-medium text-ink-muted" htmlFor="cohort-search">
          Find a peer ({listed.length.toLocaleString("en-US")})
        </label>
        <input
          id="cohort-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, city or state"
          className="mt-1 min-h-11 w-full rounded-lg border border-control-border bg-surface-0 px-3 text-[15px] text-ink placeholder:text-ink-muted"
        />
        <ul className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-0" aria-label="Cohort members">
          {filtered.length === 0 && <li className="px-3 py-3 text-[13px] text-ink-muted">No match.</li>}
          {(query.trim() || showAll ? filtered : filtered.slice(0, LIST_PREVIEW)).map((p) => (
            <li key={p.id} className="border-t border-border first:border-t-0">
              <button
                type="button"
                onClick={() => setPicked(p)}
                aria-pressed={picked?.id === p.id}
                className={`flex min-h-11 w-full items-center gap-3 px-3 text-left text-[13px] hover:bg-paper ${picked?.id === p.id ? "bg-paper" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate text-ink">
                  {p.name}
                  <span className="text-ink-muted">{p.state ? `, ${p.state}` : ""}</span>
                </span>
                <span className="shrink-0 text-ink-muted [font-variant-numeric:tabular-nums]">{p.assets !== null ? formatCompactDollars(p.assets) : ""}</span>
                <span className="w-14 shrink-0 text-right font-medium text-ink [font-variant-numeric:tabular-nums]">{pct(p.sharePct)}</span>
              </button>
            </li>
          ))}
        </ul>
        {!query.trim() && !showAll && filtered.length > LIST_PREVIEW && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-1 inline-flex min-h-11 items-center text-[13px] font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
          >
            Show all {filtered.length.toLocaleString("en-US")}
          </button>
        )}
      </div>
    </div>
  );
}
