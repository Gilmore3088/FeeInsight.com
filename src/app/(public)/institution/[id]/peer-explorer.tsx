"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, BarChart3, Grid3x3, MapPin, X } from "lucide-react";
import Link from "next/link";
import { TrackLink } from "@/components/track-link";
import {
  EXPLORER_FEE_KEYS,
  EXPLORER_FEE_LABELS,
  EXPLORER_FEE_SHORT,
  NEAR_MEDIAN_SHARE,
  assetRadius,
  assetScale,
  assetsLabel,
  coverageLine,
  feeFindings,
  gapText,
  isExplorerFeeKey,
  isExplorerView,
  linearScale,
  locationGroups,
  matrixBand,
  matrixRows,
  money,
  pricesSummary,
  scalePosition,
  type ExplorerFeeKey,
  type ExplorerInstitution,
  type ExplorerView,
  type MatrixBand,
  type PeerExplorerSet,
} from "@/lib/peer-explorer";

/** The subject is brick (the site's accent); a selected peer is ink; the rest are a quiet gray. */
const SUBJECT = "var(--fi-brick)";
const PEER = "var(--fi-viz-inside)";
const SELECTED = "var(--fi-ink)";
/**
 * Against the peer median, below is blue and above is red, as in James's Oct 18 peer-set mockups
 * (the site tokens are named for the market pages, where the pair runs the other way).
 */
const BELOW_TONE = "var(--fi-viz-above)";
const ABOVE_TONE = "var(--fi-viz-below)";

const VIEWS: { key: ExplorerView; label: string; icon: ReactNode }[] = [
  { key: "landscape", label: "Landscape", icon: <BarChart3 aria-hidden="true" className="size-4" /> },
  { key: "locations", label: "Locations", icon: <MapPin aria-hidden="true" className="size-4" /> },
  { key: "matrix", label: "Fee matrix", icon: <Grid3x3 aria-hidden="true" className="size-4" /> },
];

interface Highlight {
  label: string;
  ids: Set<number>;
}

/** Writes the explorer's selection into the address without a navigation, keeping every other value. */
function writeUrl(values: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [name, value] of Object.entries(values)) {
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash || "#peers"}`);
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? fallback);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

/**
 * One peer set, three linked views (James, Oct 18: "One peer set, three views"). The selected
 * institution, the fee and the view are one state, kept across views and in the address
 * (?peer=, ?pfee=, ?pview=). A finding's peers stay highlighted in every view until cleared.
 */
export function PeerExplorer({
  set,
  initial,
  hamiltonHref,
  isPro,
}: {
  set: PeerExplorerSet;
  initial: { peer?: string | null; fee?: string | null; view?: string | null };
  hamiltonHref: string;
  isPro: boolean;
}) {
  const everyone = useMemo(() => [set.subject, ...set.peers], [set]);
  const byId = useMemo(() => new Map(everyone.map((inst) => [inst.id, inst])), [everyone]);
  const firstFee = EXPLORER_FEE_KEYS.find((key) => set.medians[key]) ?? EXPLORER_FEE_KEYS[0];
  const [fee, setFee] = useState<ExplorerFeeKey>(isExplorerFeeKey(initial.fee) ? initial.fee : firstFee);
  const [view, setView] = useState<ExplorerView>(isExplorerView(initial.view) ? initial.view : "landscape");
  const initialPeer = Number(initial.peer);
  const [selectedId, setSelectedId] = useState<number>(byId.has(initialPeer) ? initialPeer : set.subject.id);
  const [highlight, setHighlight] = useState<Highlight | null>(null);

  const select = useCallback(
    (id: number) => {
      setSelectedId(id);
      setHighlight(null);
      writeUrl({ peer: id === set.subject.id ? null : String(id) });
    },
    [set.subject.id],
  );
  const chooseFee = (key: ExplorerFeeKey) => {
    setFee(key);
    setHighlight(null);
    writeUrl({ pfee: key === firstFee ? null : key });
  };
  const chooseView = (key: ExplorerView) => {
    setView(key);
    writeUrl({ pview: key === "landscape" ? null : key });
  };

  const selected = byId.get(selectedId) ?? set.subject;
  const findings = feeFindings(set, fee, selected.id);
  const median = set.medians[fee];
  const ctaProps = { className: "fi-btn fi-btn-brick min-h-12 w-full gap-2 px-6 text-[15px] sm:w-auto", href: hamiltonHref };

  return (
    <div className="mt-5">
      <p className="text-[13px] font-medium text-ink">{coverageLine(set, fee)}</p>

      {/* Views and the fee: tabs first on a phone, the fee below them. */}
      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="View" className="grid grid-cols-3 gap-1 rounded-[14px] border border-border bg-paper p-1 lg:inline-grid lg:w-auto">
          {VIEWS.map((option) => {
            const active = option.key === view;
            return (
              <button
                key={option.key}
                type="button"
                role="tab"
                id={`peer-view-${option.key}`}
                aria-selected={active}
                aria-controls="peer-view-panel"
                onClick={() => chooseView(option.key)}
                className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] px-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink sm:px-4 sm:text-[14px] ${
                  active ? "bg-ink text-on-ink shadow-fi-1" : "text-ink-soft hover:bg-surface-0 hover:text-ink"
                }`}
              >
                {option.icon}
                {option.label}
              </button>
            );
          })}
        </div>
        <label className="flex min-w-0 items-center gap-3 text-[13px] font-medium text-ink-muted">
          <span className="shrink-0">Fee type</span>
          <select
            value={fee}
            onChange={(e) => isExplorerFeeKey(e.target.value) && chooseFee(e.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-full border border-border bg-surface-0 px-4 text-[14px] font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink lg:flex-none"
          >
            {EXPLORER_FEE_KEYS.map((key) => (
              <option key={key} value={key}>
                {EXPLORER_FEE_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-8">
        <div id="peer-view-panel" role="tabpanel" aria-labelledby={`peer-view-${view}`} className="min-w-0">
          <div key={view} className="fi-home-fade">
            {view === "landscape" && <Landscape set={set} fee={fee} selectedId={selected.id} highlight={highlight} onSelect={select} />}
            {view === "locations" && <Locations set={set} fee={fee} selectedId={selected.id} highlight={highlight} onSelect={select} />}
            {view === "matrix" && <Matrix set={set} fee={fee} selectedId={selected.id} highlight={highlight} onSelect={select} onFee={chooseFee} />}
          </div>
          {findings.length > 0 && (
            <div className="mt-4">
              <p className="text-[12px] font-medium text-ink-muted">
                Against {selected.id === set.subject.id ? "this institution" : selected.name}&apos;s {EXPLORER_FEE_LABELS[fee].toLowerCase()} fee
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {findings.map((finding) => {
                  const active = highlight?.label === finding.label;
                  return (
                    <li key={finding.kind}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setHighlight(active ? null : { label: finding.label, ids: new Set(finding.ids) })}
                        className={`inline-flex min-h-10 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                          active ? "border-ink bg-ink text-on-ink" : "border-border bg-surface-0 text-ink hover:border-ink"
                        }`}
                      >
                        {finding.label}
                      </button>
                    </li>
                  );
                })}
                {highlight && (
                  <li>
                    <button
                      type="button"
                      onClick={() => setHighlight(null)}
                      className="inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                      Clear
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
        <SidePanel set={set} fee={fee} selected={selected} median={median?.median} onSelect={select} />
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        {isPro ? (
          <Link {...ctaProps}>
            Explore this peer set in Hamilton
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        ) : (
          <TrackLink event="upgrade_click" eventProps={{ placement: "institution_peer_explorer" }} {...ctaProps}>
            Explore this peer set in Hamilton
            <ArrowRight aria-hidden="true" className="size-4" />
          </TrackLink>
        )}
        <Link
          href={hamiltonHref}
          className="inline-flex min-h-11 items-center justify-center rounded-[22px] border border-ink px-5 py-2 text-center text-[14px] leading-snug font-semibold text-ink transition-colors hover:bg-ink hover:text-on-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        >
          Create a committee brief from this peer set
        </Link>
      </div>
    </div>
  );
}

function feeOf(inst: ExplorerInstitution, fee: ExplorerFeeKey): number | undefined {
  return inst.fees[fee]?.amount;
}

/** Peers outside a highlighted finding fade back; the subject and the selection never do. */
function dimmed(inst: ExplorerInstitution, highlight: Highlight | null, keepIds: number[]): boolean {
  return Boolean(highlight && !highlight.ids.has(inst.id) && !keepIds.includes(inst.id));
}

interface ViewProps {
  set: PeerExplorerSet;
  fee: ExplorerFeeKey;
  selectedId: number;
  highlight: Highlight | null;
  onSelect: (id: number) => void;
}

const MARGIN = { top: 16, right: 16, bottom: 44, left: 52 };

/** Total assets across, the chosen fee up: one dot per institution that publishes it. */
function Landscape({ set, fee, selectedId, highlight, onSelect }: ViewProps) {
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const [hover, setHover] = useState<number | null>(null);
  const height = width < 480 ? 280 : 360;
  const everyone = [set.subject, ...set.peers];
  const plotted = everyone.filter((inst) => feeOf(inst, fee) !== undefined && inst.assets !== null);
  const missing = everyone.length - plotted.length;
  const median = set.medians[fee]?.median;
  const x = assetScale(plotted.map((inst) => inst.assets as number));
  const y = linearScale([...plotted.map((inst) => feeOf(inst, fee) as number), median ?? 0], width < 480 ? 3 : 4);
  const innerW = Math.max(10, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const px = (assets: number) => MARGIN.left + scalePosition(x, assets) * innerW;
  const py = (amount: number) => MARGIN.top + (1 - scalePosition(y, amount)) * innerH;

  if (plotted.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-6 text-[14px] text-ink-muted">No institution in this set publishes this fee.</p>;
  }

  // A few named points: the subject, the selection, and the lowest and highest fees.
  const sortedByFee = [...plotted].filter((inst) => inst.id !== set.subject.id).sort((a, b) => (feeOf(a, fee) as number) - (feeOf(b, fee) as number));
  const named = new Set<number>([set.subject.id, selectedId]);
  if (sortedByFee[0]) named.add(sortedByFee[0].id);
  if (sortedByFee.length > 1) named.add(sortedByFee[sortedByFee.length - 1].id);
  if (hover !== null) named.add(hover);
  const order = [...plotted].sort((a, b) => Number(a.id === selectedId || a.id === set.subject.id) - Number(b.id === selectedId || b.id === set.subject.id));
  const hovered = hover !== null ? plotted.find((inst) => inst.id === hover) : null;

  return (
    <figure className="m-0">
      <div ref={ref} className="relative w-full">
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${EXPLORER_FEE_LABELS[fee]} fee by total assets for ${plotted.length} institutions`} className="block overflow-visible">
          {y.ticks.map((tick) => (
            <g key={`y${tick}`}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={py(tick)} y2={py(tick)} stroke="var(--color-border)" strokeWidth={1} />
              <text x={MARGIN.left - 8} y={py(tick)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-[11px] tabular-nums">
                {money(tick)}
              </text>
            </g>
          ))}
          {x.ticks.map((tick) => (
            <text key={`x${tick}`} x={px(tick)} y={height - MARGIN.bottom + 18} textAnchor="middle" className="fill-ink-muted text-[11px] tabular-nums">
              {assetsLabel(tick) ?? "$0"}
            </text>
          ))}
          <text x={MARGIN.left + innerW / 2} y={height - 6} textAnchor="middle" className="fill-ink-muted text-[11px]">
            Total assets{x.kind === "log" ? " (log scale)" : ""}
          </text>
          {median !== undefined && (
            <g>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={py(median)} y2={py(median)} stroke="var(--fi-ink)" strokeWidth={1.25} strokeDasharray="5 4" />
              <text x={width - MARGIN.right} y={py(median) - 6} textAnchor="end" className="fill-ink text-[12px] font-semibold">
                Peer median {money(median)}
              </text>
            </g>
          )}
          {order.map((inst) => {
            const cx = px(inst.assets as number);
            const cy = py(feeOf(inst, fee) as number);
            const isSubject = inst.id === set.subject.id;
            const isSelected = inst.id === selectedId;
            const faded = dimmed(inst, highlight, [set.subject.id, selectedId]);
            return (
              <g
                key={inst.id}
                className="cursor-pointer"
                opacity={faded ? 0.2 : 1}
                onClick={() => onSelect(inst.id)}
                onMouseEnter={() => setHover(inst.id)}
                onMouseLeave={() => setHover(null)}
              >
                <circle cx={cx} cy={cy} r={12} fill="transparent" />
                {isSubject ? (
                  <rect x={cx - 6} y={cy - 6} width={12} height={12} transform={`rotate(45 ${cx} ${cy})`} fill={SUBJECT} stroke="var(--fi-surface-0)" strokeWidth={2} />
                ) : (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 6 : highlight?.ids.has(inst.id) ? 5 : 4.5}
                    fill={isSelected || highlight?.ids.has(inst.id) ? SELECTED : PEER}
                    stroke="var(--fi-surface-0)"
                    strokeWidth={2}
                  />
                )}
                {isSelected && !isSubject && <circle cx={cx} cy={cy} r={10} fill="none" stroke={SELECTED} strokeWidth={1.5} />}
              </g>
            );
          })}
          {plotted
            .filter((inst) => named.has(inst.id) && inst.id !== hover)
            .map((inst) => {
              const cx = px(inst.assets as number);
              const cy = py(feeOf(inst, fee) as number);
              const right = cx < MARGIN.left + innerW * 0.7;
              const isSubject = inst.id === set.subject.id;
              return (
                <text
                  key={`l${inst.id}`}
                  x={cx + (right ? 10 : -10)}
                  y={cy - 9}
                  textAnchor={right ? "start" : "end"}
                  className={`pointer-events-none text-[11px] ${isSubject ? "fill-brick font-semibold" : "fill-ink-soft"}`}
                  style={{ paintOrder: "stroke", stroke: "var(--fi-surface-0)", strokeWidth: 3 }}
                >
                  {short(inst.name)} · {money(feeOf(inst, fee) as number)}
                </text>
              );
            })}
        </svg>
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 w-max max-w-[15rem] -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface-0 px-2.5 py-1.5 text-[12px] leading-snug shadow-fi-1"
            style={{ left: `${(px(hovered.assets as number) / width) * 100}%`, top: `calc(${(py(feeOf(hovered, fee) as number) / height) * 100}% - 10px)` }}
          >
            <p className="font-semibold text-ink">{hovered.name}</p>
            <p className="text-ink-muted">
              {money(feeOf(hovered, fee) as number)} · {assetsLabel(hovered.assets)} in assets
            </p>
          </div>
        )}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rotate-45" style={{ background: SUBJECT }} />
          {short(set.subject.name)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: PEER }} />
          Peer
        </span>
        {median !== undefined && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block w-4 border-t-[1.5px] border-dashed border-ink" />
            Peer median
          </span>
        )}
        {missing > 0 && <span>{missing.toLocaleString("en-US")} not shown: no {EXPLORER_FEE_LABELS[fee].toLowerCase()} fee published.</span>}
      </figcaption>
    </figure>
  );
}

/** A name short enough for a chart label. */
function short(name: string): string {
  return name.length > 26 ? `${name.slice(0, 25).trimEnd()}…` : name;
}

const GROUPS_SHOWN = 12;
const CIRCLES_PER_GROUP = 40;

/** Where the set is headquartered: one cluster per city (or state), circles sized by total assets. */
function Locations({ set, fee, selectedId, highlight, onSelect }: ViewProps) {
  const { by, groups } = locationGroups(set);
  const [all, setAll] = useState(false);
  const shown = all ? groups : groups.slice(0, GROUPS_SHOWN);
  const maxAssets = Math.max(1, ...[set.subject, ...set.peers].map((inst) => inst.assets ?? 0));
  // The legend uses the set's own largest, middle and smallest total assets.
  const sizes = [set.subject, ...set.peers].map((inst) => inst.assets ?? 0).filter((v) => v > 0).sort((a, b) => b - a);
  const legend = [...new Set([sizes[0], sizes[Math.floor(sizes.length / 2)], sizes[sizes.length - 1]])].filter((v): v is number => v !== undefined);
  return (
    <div>
      <p className="text-[12px] text-ink-muted">
        {by === "branch"
          ? `Grouped by the cities in the ${set.market?.name ?? "home"} metro where each institution has a branch, so one can appear in several. Circle area shows total assets.`
          : `Grouped by headquarters ${by}. Circle area shows total assets.`}
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((group) => {
          const hasSubject = group.members.some((m) => m.id === set.subject.id);
          const visible = group.members.slice(0, CIRCLES_PER_GROUP);
          return (
            <li
              key={group.key}
              className={`min-w-0 rounded-[18px] border p-3 ${hasSubject ? "border-brick/30 bg-brick-tint/40" : "border-border bg-paper"}`}
            >
              <p className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[14px] font-semibold text-ink">{group.name}</span>
                <span className="shrink-0 text-[12px] text-ink-muted">{group.members.length.toLocaleString("en-US")}</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {visible.map((inst) => {
                  const r = assetRadius(inst.assets, maxAssets, 5, 20);
                  const isSubject = inst.id === set.subject.id;
                  const isSelected = inst.id === selectedId;
                  const value = feeOf(inst, fee);
                  const faded = dimmed(inst, highlight, [set.subject.id, selectedId]);
                  return (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => onSelect(inst.id)}
                      title={`${inst.name}: ${assetsLabel(inst.assets) ?? "assets not on record"}, ${EXPLORER_FEE_LABELS[fee].toLowerCase()} ${value !== undefined ? money(value) : "not published"}`}
                      aria-label={`${inst.name}, ${value !== undefined ? money(value) : "not published"}`}
                      aria-pressed={isSelected}
                      className="grid place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      style={{ width: Math.max(24, r * 2), height: Math.max(24, r * 2), opacity: faded ? 0.2 : 1 }}
                    >
                      {isSubject ? (
                        <span className="block rotate-45" style={{ width: Math.max(10, r * 1.3), height: Math.max(10, r * 1.3), background: SUBJECT }} />
                      ) : (
                        <span
                          className="block rounded-full"
                          style={{
                            width: r * 2,
                            height: r * 2,
                            background: isSelected || highlight?.ids.has(inst.id) ? SELECTED : PEER,
                            boxShadow: isSelected ? `0 0 0 2px var(--fi-surface-0), 0 0 0 3.5px ${SELECTED}` : undefined,
                          }}
                        />
                      )}
                    </button>
                  );
                })}
                {group.members.length > visible.length && (
                  <span className="text-[12px] text-ink-muted">+{(group.members.length - visible.length).toLocaleString("en-US")} more</span>
                )}
              </div>
              {(hasSubject || group.members.some((m) => m.id === selectedId)) && (
                <p className="mt-2 truncate text-[12px] text-ink-soft">
                  {[set.subject, ...set.peers]
                    .filter((m) => (m.id === set.subject.id || m.id === selectedId) && group.members.includes(m))
                    .map((m) => m.name)
                    .join(", ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {groups.length > GROUPS_SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="mt-3 inline-flex min-h-11 items-center text-[13px] font-semibold text-ink underline underline-offset-2">
          {all ? "Show fewer places" : `Show all ${groups.length.toLocaleString("en-US")} places`}
        </button>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-4 text-[11px] text-ink-muted" aria-hidden="true">
        {legend.map((assets) => {
          const r = assetRadius(assets, maxAssets, 5, 20);
          return (
            <span key={assets} className="inline-flex items-center gap-1.5">
              <span className="inline-block rounded-full" style={{ width: r * 2, height: r * 2, background: PEER }} />
              {assetsLabel(assets)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const BAND_STYLE: Record<MatrixBand, { background: string; label: string }> = {
  below: { background: `color-mix(in srgb, ${BELOW_TONE} 22%, var(--fi-surface-0))`, label: "Below median" },
  near: { background: "color-mix(in srgb, var(--fi-ink) 7%, var(--fi-surface-0))", label: "Near median" },
  above: { background: `color-mix(in srgb, ${ABOVE_TONE} 22%, var(--fi-surface-0))`, label: "Above median" },
  none: {
    background: "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--fi-ink) 8%, transparent) 5px 6px)",
    label: "Not available",
  },
};

const ROWS_SHOWN = 30;

/** Every institution against each fee's peer median: rows by total assets, the subject first. */
function Matrix({ set, fee, selectedId, highlight, onSelect, onFee }: ViewProps & { onFee: (key: ExplorerFeeKey) => void }) {
  const rows = matrixRows(set);
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  if (shown.every((row) => row.id !== selectedId)) {
    const sel = rows.find((row) => row.id === selectedId);
    if (sel) shown.push(sel);
  }
  return (
    <div>
      <div className="relative max-w-full overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13px]">
          <caption className="sr-only">Each institution&apos;s fees against the peer median</caption>
          <thead>
            <tr className="text-left text-[12px] font-medium text-ink-muted">
              <th scope="col" className="sticky left-0 z-10 bg-surface-0 px-3 py-2 font-medium">Institution</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Assets</th>
              {EXPLORER_FEE_KEYS.map((key) => (
                <th key={key} scope="col" className="px-1 py-2 text-center font-medium">
                  <button
                    type="button"
                    onClick={() => onFee(key)}
                    aria-pressed={key === fee}
                    className={`rounded px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${key === fee ? "font-semibold text-ink underline decoration-2 underline-offset-4" : "hover:text-ink"}`}
                  >
                    {EXPLORER_FEE_SHORT[key]}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((inst) => {
              const isSubject = inst.id === set.subject.id;
              const isSelected = inst.id === selectedId;
              const faded = dimmed(inst, highlight, [set.subject.id, selectedId]);
              const always = isSubject || isSelected;
              return (
                <tr key={inst.id} className="group" style={{ opacity: faded ? 0.3 : 1 }}>
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 max-w-[8.5rem] border-t sm:max-w-[11rem] border-border px-0 py-0 text-left font-normal ${isSelected ? "bg-paper" : "bg-surface-0"}`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(inst.id)}
                      aria-pressed={isSelected}
                      className={`flex min-h-10 w-full items-center gap-2 border-l-[3px] px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink ${
                        isSubject ? "border-brick font-semibold text-ink" : isSelected ? "border-ink font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink"
                      }`}
                    >
                      <span className="min-w-0 truncate">{inst.name}</span>
                    </button>
                  </th>
                  <td className="border-t border-border px-2 text-right tabular-nums text-ink-muted">{assetsLabel(inst.assets) ?? "Not on record"}</td>
                  {EXPLORER_FEE_KEYS.map((key) => {
                    const value = feeOf(inst, key);
                    const band = matrixBand(value, set.medians[key]?.median);
                    return (
                      <td key={key} className="border-t border-border p-[2px]">
                        <span
                          className={`flex min-h-9 items-center justify-center rounded-[4px] px-1 tabular-nums ${key === fee ? "ring-1 ring-inset ring-ink/15" : ""}`}
                          style={{ background: BAND_STYLE[band].background }}
                          title={`${inst.name}, ${EXPLORER_FEE_LABELS[key]}: ${value !== undefined ? money(value) : "not available"}`}
                        >
                          {value === undefined ? (
                            <span className="text-ink-muted">
                              <span aria-hidden="true">–</span>
                              <span className="sr-only">Not available</span>
                            </span>
                          ) : (
                            <span className={`${always ? "font-semibold text-ink" : "text-ink opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
                              {money(value)}
                              <span className="sr-only">, {BAND_STYLE[band].label.toLowerCase()}</span>
                            </span>
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > ROWS_SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="mt-3 inline-flex min-h-11 items-center text-[13px] font-semibold text-ink underline underline-offset-2">
          {all ? "Show fewer" : `Show all ${rows.length.toLocaleString("en-US")} institutions`}
        </button>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink-muted">
        {(["below", "near", "above", "none"] as const).map((band) => (
          <li key={band} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3 w-5 rounded-[3px] border border-border" style={{ background: BAND_STYLE[band].background }} />
            {band === "near" ? `Within ${Math.round(NEAR_MEDIAN_SHARE * 100)}% of the median` : BAND_STYLE[band].label}
          </li>
        ))}
        <li>Hover or focus a row for its values.</li>
      </ul>
    </div>
  );
}

/** The selected institution's fee, the peer median and the gap, then where every peer sits. */
function SidePanel({
  set,
  fee,
  selected,
  median,
  onSelect,
}: {
  set: PeerExplorerSet;
  fee: ExplorerFeeKey;
  selected: ExplorerInstitution;
  median: number | undefined;
  onSelect: (id: number) => void;
}) {
  const own = selected.fees[fee];
  const isSubject = selected.id === set.subject.id;
  const gap = own && median !== undefined ? gapText(own.amount, median) : null;
  const summary = pricesSummary(fee, own);
  return (
    <aside aria-live="polite" className="min-w-0 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{isSubject ? "This institution" : "Selected peer"}</p>
      <p className="mt-1 text-[22px] leading-tight text-ink" style={{ fontFamily: "var(--fi-home-serif, Georgia), Georgia, serif" }}>
        {selected.name}
      </p>
      <p className="mt-0.5 text-[13px] text-ink-muted">
        {[assetsLabel(selected.assets) ? `${assetsLabel(selected.assets)} in assets` : null, [selected.city, selected.state].filter(Boolean).join(", ") || null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {!isSubject && (
        <button type="button" onClick={() => onSelect(set.subject.id)} className="mt-1 min-h-10 text-[13px] font-medium text-ink underline underline-offset-2">
          Back to {set.subject.name}
        </button>
      )}
      <div className="mt-4 border-t border-border pt-4">
        <p className="text-[13px] font-semibold text-ink">{EXPLORER_FEE_LABELS[fee]}</p>
        <p className="mt-1 text-[36px] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums">{own ? money(own.amount) : <span className="text-[15px] font-medium text-ink-muted">Not published</span>}</p>
        {summary && own?.prices && (
          <details className="mt-2 text-[13px]">
            <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium text-ink">{summary}: see each account</summary>
            <ul className="mt-1 space-y-2">
              {own.prices.map((price, i) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-ink">{price.name ?? "Name not printed"}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-ink">{money(price.amount)}</span>
                  </p>
                  {price.conditions && <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">{price.conditions}</p>}
                </li>
              ))}
            </ul>
          </details>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-[12px] text-ink-muted">Peer median</dt>
            <dd className="mt-0.5 text-[20px] font-semibold tabular-nums text-ink">{median !== undefined ? money(median) : <span className="text-[13px] font-medium text-ink-muted">Too few to compare</span>}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">Peers publishing</dt>
            <dd className="mt-0.5 text-[20px] font-semibold tabular-nums text-ink">{set.medians[fee]?.peers ?? set.peers.filter((p) => p.fees[fee]).length}</dd>
          </div>
        </dl>
        {gap && (
          <p className="mt-2 text-[14px] font-semibold" style={{ color: gap.direction === "above" ? ABOVE_TONE : gap.direction === "below" ? BELOW_TONE : undefined }}>
            {gap.text}
          </p>
        )}
        <DotStrip set={set} fee={fee} selectedId={selected.id} median={median} onSelect={onSelect} />
      </div>
    </aside>
  );
}

/** Every institution's fee on one track: the selection a diamond (subject) or ringed dot, the median a tick. */
function DotStrip({ set, fee, selectedId, median, onSelect }: { set: PeerExplorerSet; fee: ExplorerFeeKey; selectedId: number; median: number | undefined; onSelect: (id: number) => void }) {
  const everyone = [set.subject, ...set.peers].filter((inst) => feeOf(inst, fee) !== undefined);
  if (everyone.length < 2) return null;
  const values = everyone.map((inst) => feeOf(inst, fee) as number);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const at = (v: number) => (high === low ? 50 : ((v - low) / (high - low)) * 100);
  const front = (inst: ExplorerInstitution) => (inst.id === selectedId || inst.id === set.subject.id ? 1 : 0);
  return (
    <div className="mt-5">
      <div className="relative mx-2 h-6" role="group" aria-label={`${EXPLORER_FEE_LABELS[fee]} fees from ${money(low)} to ${money(high)}`}>
        <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        {median !== undefined && <span aria-hidden="true" className="absolute top-0 h-6 w-[2px] -translate-x-1/2 bg-ink" style={{ left: `${at(median)}%` }} />}
        {[...everyone].sort((a, b) => front(a) - front(b)).map((inst) => {
          const v = feeOf(inst, fee) as number;
          const isSubject = inst.id === set.subject.id;
          const isSelected = inst.id === selectedId;
          return (
            <button
              key={inst.id}
              type="button"
              tabIndex={-1}
              onClick={() => onSelect(inst.id)}
              title={`${inst.name}: ${money(v)}`}
              className="absolute top-1/2 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center"
              style={{ left: `${at(v)}%` }}
            >
              {isSubject ? (
                <span className="block size-2.5 rotate-45" style={{ background: SUBJECT, boxShadow: "0 0 0 2px var(--fi-surface-0)" }} />
              ) : (
                <span className="block size-2 rounded-full" style={{ background: isSelected ? SELECTED : PEER, boxShadow: isSelected ? `0 0 0 2px var(--fi-surface-0), 0 0 0 3.5px ${SELECTED}` : "0 0 0 1.5px var(--fi-surface-0)" }} />
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-muted">
        <span>{money(low)}</span>
        <span>{money(high)}</span>
      </p>
    </div>
  );
}
