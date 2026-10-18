"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatCompactDollars } from "@/lib/format";
import type { CohortPoint, CohortStripData } from "./fee-share-cohort";

/**
 * Financial performance B: where the institution's service-charge share of revenue sits in its
 * asset-size cohort. A box (quartiles, from the real cohort) over a histogram of the cohort's
 * shares, the subject in the one accent. The page ships bins and the nearest few peers, never
 * the whole cohort; a search or "Show all" reads members from /api/institutions/[id]/cohort.
 * Peers past the axis are counted at its edge, never dropped silently.
 */
export interface CohortStripProps {
  institutionId: number;
  subjectName: string;
  data: CohortStripData;
  quarter: string;
  /** "FDIC BankFind Suite (call report data)". */
  sourceName: string;
  /** "Service charges" or "Fee income". */
  measureName: string;
  yearToDate: boolean;
}

const H = 132;
const PAD = { left: 12, right: 12 };
const BOX_Y = 18;
const BOX_H = 22;
const STRIP_Y = 56;
const STRIP_H = 52;


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
  const { institutionId, data, quarter, sourceName, measureName, yearToDate, subjectName } = props;
  const { subject, p25, median, p75, ticks, axisMax, counts, beyond } = data;
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
  const [hoverBin, setHoverBin] = useState<number | null>(null);
  const [picked, setPicked] = useState<CohortPoint | null>(null);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<{ key: string; total: number; members: CohortPoint[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const plotW = width - PAD.left - PAD.right;
  const x = (v: number) => PAD.left + (Math.min(v, axisMax) / axisMax) * plotW;
  const binW = plotW / counts.length;
  const tallest = Math.max(1, ...counts);

  // Search and "Show all" read the members from the route; the page itself ships only the nearest.
  const load = useCallback(
    async (key: string, params: string) => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/institutions/${institutionId}/cohort?${params}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { total: number; members: CohortPoint[] };
        setRemote({ key, total: body.total, members: body.members });
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [institutionId],
  );
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(() => void load(`q:${q}`, `q=${encodeURIComponent(q)}`), 250);
    return () => clearTimeout(timer);
  }, [query, load]);

  const q = query.trim();
  const showingAll = remote?.key === "all" && !q;
  const rows = q ? (remote?.key === `q:${q}` ? remote.members : []) : showingAll ? remote!.members : data.nearest;
  const binLabel = (i: number) => {
    const lo = (i / counts.length) * axisMax;
    const hi = ((i + 1) / counts.length) * axisMax;
    return `${counts[i].toLocaleString("en-US")} ${counts[i] === 1 ? "peer" : "peers"} from ${pct(lo)} to ${i === counts.length - 1 && beyond > 0 ? `${pct(hi)} and above` : pct(hi)}`;
  };

  return (
    <div className="min-w-0" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${width} ${H}`}
        width={width}
        height={H}
        className="block h-auto max-w-full touch-pan-y"
        role="img"
        aria-label={`${subjectName} ${subject ? pct(subject.sharePct) : "not reported"}; cohort quartiles ${pct(p25)}, ${pct(median)}, ${pct(p75)}.`}
        onPointerLeave={() => setHoverBin(null)}
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
        {counts.map((n, i) => {
          const h = n === 0 ? 0 : Math.max(2, (n / tallest) * STRIP_H);
          return (
            <g key={i} onPointerEnter={() => setHoverBin(i)}>
              <rect x={PAD.left + i * binW} y={STRIP_Y} width={binW} height={STRIP_H} fill="transparent" />
              {n > 0 && (
                <rect
                  x={PAD.left + i * binW + 0.5}
                  y={STRIP_Y + STRIP_H - h}
                  width={Math.max(1, binW - 1)}
                  height={h}
                  fill={hoverBin === i ? "var(--color-ink)" : "var(--fi-peer)"}
                  opacity={0.85}
                />
              )}
            </g>
          );
        })}
        {subject && (
          <g>
            <line x1={x(subject.sharePct)} x2={x(subject.sharePct)} y1={BOX_Y - 8} y2={STRIP_Y + STRIP_H + 4} stroke="var(--fi-subject)" strokeWidth={2} />
            <circle cx={x(subject.sharePct)} cy={BOX_Y + BOX_H / 2} r={6} fill="var(--fi-subject)" stroke="var(--color-surface-0)" strokeWidth={2} />
          </g>
        )}
      </svg>
      <p className="min-h-[1.25rem] text-[12px] text-ink-muted" aria-live="polite">
        {hoverBin !== null ? binLabel(hoverBin) : ""}
      </p>
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
          <span aria-hidden="true" className="inline-block h-2.5 w-1.5 bg-[var(--fi-peer)]" />
          Peers at each share
        </span>
        {beyond > 0 && <span>{beyond} above {`${Number(axisMax.toFixed(1))}%`}, counted in the last bar</span>}
      </div>

      <div className="mt-3 min-h-[1px]" aria-live="polite">
        {picked && (
          <Detail
            point={picked}
            quarter={quarter}
            sourceName={sourceName}
            measureName={measureName}
            yearToDate={yearToDate}
            isSubject={false}
            onClear={() => setPicked(null)}
          />
        )}
      </div>

      <div className="mt-4">
        <label className="block text-[12px] font-medium text-ink-muted" htmlFor="cohort-search">
          Find a peer ({data.listed.toLocaleString("en-US")})
        </label>
        <input
          id="cohort-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, city or state"
          className="mt-1 min-h-11 w-full rounded-lg border border-control-border bg-surface-0 px-3 text-[15px] text-ink placeholder:text-ink-muted"
        />
        {!q && !showingAll && <p className="mt-2 text-[12px] text-ink-muted">The {data.nearest.length} closest to {subjectName} by share.</p>}
        <ul className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-0" aria-label="Cohort members" aria-busy={loading}>
          {rows.length === 0 && <li className="px-3 py-3 text-[13px] text-ink-muted">{loading ? "Searching." : failed ? "The list could not load. Try again." : "No match."}</li>}
          {rows.map((p) => (
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
        {!q && !showingAll && data.listed > data.nearest.length && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void load("all", "all=1")}
            className="mt-1 inline-flex min-h-11 items-center text-[13px] font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
          >
            {loading ? "Loading." : `Show all ${data.listed.toLocaleString("en-US")}`}
          </button>
        )}
      </div>
    </div>
  );
}
