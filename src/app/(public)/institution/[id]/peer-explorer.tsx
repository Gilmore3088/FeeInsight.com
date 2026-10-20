"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, ChevronUp, Grid3x3, MapPin, ScatterChart, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useSessionChrome } from "@/components/use-session-chrome";
import { TrackLink } from "@/components/track-link";
import { displayCity } from "@/lib/format";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import { estimateTextWidth, labelBox, placePointLabel } from "@/lib/chart-label-placement";
import { MEDIAN_TONE, MEDIAN_TONE_NOTE } from "@/components/public/peer-gap-chip";
import {
  EXPLORER_FEE_KEYS,
  EXPLORER_FEE_LABELS,
  EXPLORER_FEE_SHORT,
  LANDSCAPE_AXIS_LABELS,
  assetDifference,
  assetRadius,
  assetScale,
  assetsLabel,
  cellShade,
  comparisonLabel,
  comparisonTag,
  isComparisonProxy,
  PROXY_NOTE,
  rosterOrder,
  rosterPricing,
  PEER_EXPLORER_STATE_EVENT,
  ABOUT_SAME_RULE,
  feeCoverage,
  feeFindings,
  gapText,
  hamiltonPeerSetHref,
  isExplorerFeeKey,
  isExplorerView,
  landscapeAxes,
  landscapeValue,
  linearScale,
  locationGroups,
  matrixSummary,
  publishingPeers,
  peerSnapshot,
  briefingSet,
  formatIsoDate,
  money,
  scalePosition,
  signedMoney,
  sortMatrixRows,
  splitOutliers,
  type AxisScale,
  type ExplorerFeeKey,
  type ExplorerInstitution,
  type ExplorerView,
  type LandscapeAxis,
  type MatrixBand,
  type MatrixSortKey,
  type PeerExplorerSet,
} from "@/lib/peer-explorer";

/**
 * The subject is ink: the above and below tones mean a side of the median, so the subject
 * never takes either. A selected peer is dark slate, the rest neutral slate.
 */
export const SUBJECT = "var(--fi-ink)";
const PEER = "var(--fi-viz-inside)";
const SELECTED = "var(--fi-viz-bar)";
/** Above and below the peer median: the shared, non-judgemental pair (peer-gap-chip.tsx). */
const BELOW_TONE = MEDIAN_TONE.below;
const ABOVE_TONE = MEDIAN_TONE.above;

const VIEWS: { key: ExplorerView; label: string; icon: ReactNode }[] = [
  { key: "distribution", label: "Distribution", icon: <SlidersHorizontal aria-hidden="true" className="size-4" /> },
  { key: "landscape", label: "Landscape", icon: <ScatterChart aria-hidden="true" className="size-4" /> },
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

const feeOf = (inst: ExplorerInstitution, fee: ExplorerFeeKey): number | undefined => inst.fees[fee]?.amount;

/** Peers outside a highlighted finding fade back; the subject and the selection never do. */
function dimmed(inst: ExplorerInstitution, highlight: Highlight | null, keepIds: number[]): boolean {
  return Boolean(highlight && !highlight.ids.has(inst.id) && !keepIds.includes(inst.id));
}

/** A name short enough for a chart label. */
function short(name: string): string {
  return name.length > 26 ? `${name.slice(0, 25).trimEnd()}…` : name;
}

/**
 * One peer set, four linked views (James, Oct 18: "One peer set, three views", then the fee
 * distribution as the lead pricing chart). The selected institution, the fee and the view are one
 * state, kept across views and in the address (?peer=, ?pfee=, ?pview=). A finding's peers stay
 * highlighted in every view until cleared.
 */
export function PeerExplorer({
  set,
  setKey,
  setName,
  initial,
}: {
  set: PeerExplorerSet;
  setKey: string;
  setName: string;
  initial: { peer?: string | null; fee?: string | null; view?: string | null };
}) {
  // Read after hydration: the page is cached for every visitor, so it never knows who is looking.
  const isPro = Boolean(useSessionChrome()?.isPro);
  const everyone = useMemo(() => [set.subject, ...set.peers], [set]);
  const byId = useMemo(() => new Map(everyone.map((inst) => [inst.id, inst])), [everyone]);
  const firstFee = EXPLORER_FEE_KEYS.find((key) => set.medians[key]) ?? EXPLORER_FEE_KEYS[0];
  const [fee, setFee] = useState<ExplorerFeeKey>(isExplorerFeeKey(initial.fee) ? initial.fee : firstFee);
  const [view, setView] = useState<ExplorerView>(isExplorerView(initial.view) ? initial.view : "distribution");
  const initialPeer = Number(initial.peer);
  const [selectedId, setSelectedId] = useState<number>(byId.has(initialPeer) ? initialPeer : set.subject.id);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [preview, setPreview] = useState(false);
  // View settings that outlive a switch of view: the outlier toggle and Landscape's axis.
  const [includeOutliers, setIncludeOutliers] = useState(false);
  const [axis, setAxis] = useState<LandscapeAxis>("assets");

  // The peer-set links carry the fee and view to the next set (peer-set-links.tsx listens).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(PEER_EXPLORER_STATE_EVENT, { detail: { fee, view } }));
  }, [fee, view]);

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
    writeUrl({ pview: key === "distribution" ? null : key });
  };

  const selected = byId.get(selectedId) ?? set.subject;
  const findings = feeFindings(set, fee, selected.id);
  const median = set.medians[fee];
  const href = hamiltonPeerSetHref(set.subject.id, set.peers.map((peer) => peer.id), setName, fee, set.asOf);
  const snapshot = peerSnapshot(set, setKey, fee);
  const viewProps = { set, fee, selectedId: selected.id, highlight, onSelect: select };

  return (
    <div className="mt-3">
      <Roster set={set} fee={fee} />
      <div className="mt-5">
        <Coverage set={set} fee={fee} />
      </div>

      {/* Views and the fee: tabs first on a phone, the fee below them. */}
      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 xl:flex-row xl:items-center xl:justify-between">
        <div role="tablist" aria-label="View" className="grid grid-cols-2 gap-1 rounded-[14px] border border-border bg-paper p-1 sm:grid-cols-4 xl:inline-grid xl:w-auto">
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
            className="min-h-11 min-w-0 flex-1 rounded-full border border-border bg-surface-0 px-4 text-[14px] font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink xl:flex-none"
          >
            {EXPLORER_FEE_KEYS.map((key) => (
              <option key={key} value={key}>
                {EXPLORER_FEE_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section aria-labelledby="peer-snapshot-heading" className="mt-4 rounded-lg border border-border bg-paper px-4 py-3 sm:px-5 sm:py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Peer pricing snapshot</p>
        <h3 id="peer-snapshot-heading" className="mt-1 text-[20px] leading-snug text-ink sm:text-[22px]" style={{ fontFamily: "var(--fi-home-serif, Georgia), Georgia, serif" }}>
          {snapshot.headline}
        </h3>
        <div className="mt-1.5 space-y-0.5 text-[14px] leading-relaxed text-ink-soft tabular-nums">
          {snapshot.facts.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-ink-muted">{snapshot.caveat}</p>
        <p data-source="snapshot" className="mt-1 text-[12px] text-ink-muted">
          Source: {PRODUCT_NAME}, published fee schedules{set.asOf ? `, as of ${formatIsoDate(set.asOf)}` : ""}.
        </p>
      </section>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-8">
        <div id="peer-view-panel" role="tabpanel" aria-labelledby={`peer-view-${view}`} className="min-w-0">
          <div key={view} className="fi-home-fade">
            {view === "distribution" && <Distribution {...viewProps} include={includeOutliers} onInclude={setIncludeOutliers} />}
            {view === "landscape" && <Landscape {...viewProps} axis={axis} onAxis={setAxis} />}
            {view === "locations" && <Locations {...viewProps} />}
            {view === "matrix" && <Matrix {...viewProps} onFee={chooseFee} />}
          </div>
          {findings.length > 0 && (
            <div className="mt-4">
              <p className="text-[12px] font-medium text-ink-muted">
                Against {selected.id === set.subject.id ? "this institution" : selected.name}&apos;s {EXPLORER_FEE_LABELS[fee].toLowerCase()} fee
                {set.whole ? `, among the ${set.peers.length} peers shown` : ""}
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

      {/*
        Hamilton actions for this set. Hamilton's settings page reads only instId today, so the button
        and the preview claim only that it opens for the institution; the link still carries peers,
        name, fee and asof for when Hamilton reads them. Hamilton routes a visitor who is not signed in.
      */}
      <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
        <button
          type="button"
          aria-expanded={preview}
          aria-controls="peer-briefing-preview"
          onClick={() => setPreview((open) => !open)}
          className="fi-btn fi-btn-brick min-h-12 w-full gap-2 px-6 text-[15px] sm:w-auto"
        >
          Open {set.subject.name} in Hamilton
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
        <p className="text-[13px] text-ink-muted sm:order-last sm:basis-full">Hamilton is the {SITE_NAME} workspace for pricing teams.</p>
        {setKey === "metro" && (
          <HamiltonLink isPro={isPro} href={href} placement="institution_peer_local_competitors">
            Compare local deposit competitors in Hamilton
          </HamiltonLink>
        )}
      </div>
      {preview && (
        <div id="peer-briefing-preview" role="region" aria-label="Before you open Hamilton" className="mt-3 max-w-xl rounded-lg border border-border bg-paper p-4 text-[13px]">
          <p className="text-[14px] font-semibold text-ink">Hamilton opens for {set.subject.name}. Add this set under Peer sets:</p>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            {briefingSet(set, setName, fee, `Published prices against the peer median${median ? ` of ${median.peers.toLocaleString("en-US")} publishing peers` : ""}`).map((row) => (
              <Fragment key={row.label}>
                <dt className="text-ink-muted">{row.label}</dt>
                <dd className="min-w-0 text-ink">{row.value}</dd>
              </Fragment>
            ))}
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <HamiltonLink isPro={isPro} href={href} placement="institution_peer_briefing" primary>
              Continue to Hamilton
              <ArrowRight aria-hidden="true" className="size-4" />
            </HamiltonLink>
            <button type="button" onClick={() => setPreview(false)} className="min-h-11 text-[13px] font-medium text-ink underline underline-offset-2">
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HamiltonLink({ isPro, href, placement, primary = false, children }: { isPro: boolean; href: string; placement: string; primary?: boolean; children: ReactNode }) {
  const className = primary
    ? "fi-btn fi-btn-brick min-h-12 w-full gap-2 px-6 text-[15px] sm:w-auto"
    : "inline-flex min-h-11 items-center justify-center rounded-[22px] border border-ink px-5 py-2 text-center text-[14px] font-semibold leading-snug text-ink transition-colors hover:bg-ink hover:text-on-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2";
  return isPro ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <TrackLink event="upgrade_click" eventProps={{ placement }} href={href} className={className}>
      {children}
    </TrackLink>
  );
}

/**
 * "See the 25 institutions": exactly who is in the set, so a reader can check the cohort. Coverage
 * shows which fees each publishes; Pricing shows the selected fee's amount, its difference from the
 * peer median and the schedule it was read from, for the same institutions in the same order.
 */
function Roster({ set, fee }: { set: PeerExplorerSet; fee: ExplorerFeeKey }) {
  const [mode, setMode] = useState<"coverage" | "pricing">("coverage");
  if (set.peers.length === 0) return null;
  const rows = rosterOrder(set);
  const pricing = rosterPricing(set, fee);
  const median = set.medians[fee]?.median;
  const anyProxy = pricing.some((row) => row.proxy);
  const head = "px-3 py-2 font-medium";
  const label = EXPLORER_FEE_LABELS[fee].toLowerCase();
  return (
    <details className="text-[13px]" data-peer-list>
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-ink">
        See the {set.peers.length} {set.peers.length === 1 ? "institution" : "institutions"}
        {set.whole ? " shown" : ""}
      </summary>
      <div role="radiogroup" aria-label="Roster shows" className="mt-1 inline-flex rounded-full border border-border bg-paper p-0.5 text-[13px]">
        {(["coverage", "pricing"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            onClick={() => setMode(option)}
            className={`min-h-9 rounded-full px-3.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${mode === option ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"}`}
          >
            {option === "coverage" ? "Coverage" : "Pricing"}
          </button>
        ))}
      </div>
      {mode === "pricing" && <p className="mt-1 text-[12px] text-ink-muted">{EXPLORER_FEE_LABELS[fee]}, the fee chosen below. Change it with Fee type.</p>}
      <div className="relative mt-2 max-h-[28rem] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <caption className="sr-only">
            {mode === "coverage"
              ? "The institutions in this peer set, with the fees each publishes"
              : `The institutions in this peer set, with each one's ${label} fee, its difference from the peer median and its source`}
          </caption>
          <thead className="sticky top-0 bg-surface-0 text-[12px] text-ink-muted">
            <tr>
              <th scope="col" className={`${head} text-left`}>Institution</th>
              <th scope="col" className={`${head} text-left`}>City, state</th>
              <th scope="col" className={`${head} text-right`}>Assets</th>
              {mode === "coverage" ? (
                EXPLORER_FEE_KEYS.map((key) => (
                  <th key={key} scope="col" className={`${head} text-center`}>
                    {EXPLORER_FEE_SHORT[key]}
                  </th>
                ))
              ) : (
                <>
                  <th scope="col" className={`${head} text-right`}>{EXPLORER_FEE_SHORT[fee]}</th>
                  <th scope="col" className={`${head} text-right`}>Difference from median{median !== undefined ? ` ${money(median)}` : ""}</th>
                  <th scope="col" className={`${head} text-left`}>Source</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((inst, i) => {
              const subject = inst.id === set.subject.id;
              const place = [inst.city ? displayCity(inst.city) : null, inst.state].filter(Boolean).join(", ");
              const price = pricing[i];
              return (
                <tr key={inst.id} className={subject ? "bg-paper" : "border-t border-border"}>
                  <th scope="row" className={`px-3 py-2 text-left text-ink ${subject ? "font-semibold" : "font-medium"}`}>
                    {inst.name}
                    {subject && <span className="ml-1 font-normal text-ink-muted">(this institution)</span>}
                  </th>
                  <td className="px-3 py-2 text-ink-soft">{place || "Not on record"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{assetsLabel(inst.assets) ?? "Not on record"}</td>
                  {mode === "coverage" ? (
                    EXPLORER_FEE_KEYS.map((key) => {
                      const published = inst.fees[key] !== undefined;
                      return (
                        <td key={key} className={`px-3 py-2 text-center ${published ? "text-ink" : "text-ink-muted"}`}>
                          <span aria-hidden="true">{published ? "✓" : "–"}</span>
                          <span className="sr-only">{published ? `Publishes ${EXPLORER_FEE_LABELS[key]}` : `${EXPLORER_FEE_LABELS[key]} not published`}</span>
                        </td>
                      );
                    })
                  ) : (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">
                        {price.amount === null ? (
                          <span className="text-ink-muted">Not published</span>
                        ) : (
                          <>
                            {money(price.amount)}
                            {price.proxy && <ProxyMark />}
                            {price.prices.length > 0 && (
                              <span className="block text-[11px] text-ink-muted">Prices {price.prices.map((v) => money(v)).join(", ")}</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {price.gap ? <GapCell gap={price.gap} /> : <span className="text-ink-muted">–</span>}
                      </td>
                      <td className="px-3 py-2 text-ink-soft">
                        {price.source?.url ? (
                          <a href={price.source.url} target="_blank" rel="noopener noreferrer nofollow" className="text-ink underline underline-offset-2">
                            Fee schedule
                          </a>
                        ) : price.amount !== null ? (
                          "Link not on record"
                        ) : (
                          "–"
                        )}
                        {price.source?.published ? <span className="text-ink-muted"> · in the index since {formatIsoDate(price.source.published)}</span> : null}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[12px] text-ink-muted">
        {mode === "coverage"
          ? "✓ publishes the fee. – not published."
          : median !== undefined
            ? `Difference from median: the published value minus the peer median. ▲ above, ▼ below, ≈ within 1%. Not published is never counted as zero.`
            : "Too few peers publish this fee for a median. Not published is never counted as zero."}
        {mode === "pricing" && anyProxy ? ` ${PROXY_FOOTNOTE}` : ""}
      </p>
    </details>
  );
}

/** The footnote for the † beside a comparison price, wherever one is listed. */
const PROXY_FOOTNOTE = `† Comparison price: the middle of an institution's account prices, ${PROXY_NOTE}.`;

/** The † beside a constructed comparison price, with its words for a screen reader. */
function ProxyMark() {
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 text-ink-muted">
        †
      </span>
      <span className="sr-only">, comparison price, {PROXY_NOTE}</span>
    </>
  );
}

/** "▲ +$6.20 (+62%)": a difference from the median in the shared above/below tone, always with its mark. */
function GapCell({ gap }: { gap: { dollars: string; percent: string | null; band: MatrixBand } }) {
  const mark = gap.band === "above" ? "▲" : gap.band === "below" ? "▼" : "≈";
  const color = gap.band === "above" ? ABOVE_TONE : gap.band === "below" ? BELOW_TONE : undefined;
  return (
    <span className="font-medium" style={{ color }}>
      <span aria-hidden="true">{mark} </span>
      {gap.dollars}
      {gap.percent ? ` (${gap.percent})` : ""}
      <span className="sr-only">, {gap.band === "same" ? "about the same as the median" : `${gap.band} the median`}</span>
    </span>
  );
}

/** How many of the set publish the fee, as a meter, and what happens to the rest. */
function Coverage({ set, fee }: { set: PeerExplorerSet; fee: ExplorerFeeKey }) {
  const { selected, publish } = feeCoverage(set, fee);
  const missing = selected - publish;
  const share = selected > 0 ? (publish / selected) * 100 : 0;
  return (
    <div className="rounded-lg bg-paper px-4 py-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] text-ink">
        <span className="font-semibold tabular-nums">
          {selected.toLocaleString("en-US")} {selected === 1 ? "peer" : "peers"} selected · {publish.toLocaleString("en-US")} publish this fee
        </span>
        <span className="text-[13px] text-ink-muted">({EXPLORER_FEE_LABELS[fee].toLowerCase()})</span>
      </p>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={selected}
        aria-valuenow={publish}
        aria-label={`${publish} of ${selected} peers publish this fee`}
        className="mt-2 h-2 w-full max-w-md overflow-hidden rounded-full bg-border"
      >
        <span className="block h-full rounded-full bg-ink" style={{ width: `${share}%` }} />
      </div>
      {missing > 0 && (
        <p className="mt-1.5 text-[13px] text-ink-soft">
          {missing.toLocaleString("en-US")} {missing === 1 ? "doesn't" : "don't"} publish it: shown as not published, never as zero.
        </p>
      )}
    </div>
  );
}

interface ViewProps {
  set: PeerExplorerSet;
  fee: ExplorerFeeKey;
  selectedId: number;
  highlight: Highlight | null;
  onSelect: (id: number) => void;
}

function Tooltip({ inst, fee, left, top, extra }: { inst: ExplorerInstitution; fee: ExplorerFeeKey; left: string; top: string; extra?: string }) {
  const value = feeOf(inst, fee);
  const proxy = comparisonLabel(fee, inst.fees[fee]);
  return (
    <div
      className="pointer-events-none absolute z-20 w-max max-w-[16rem] -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface-0 px-2.5 py-1.5 text-[12px] leading-snug shadow-fi-1"
      style={{ left, top }}
    >
      <p className="font-semibold text-ink">{inst.name}</p>
      <p className="tabular-nums text-ink-muted">
        {value !== undefined ? money(value) : "Not published"}
        {proxy ? ` · ${proxy.replace("Comparison price: ", "comparison price, ")}` : ""}
      </p>
      <p className="text-ink-muted">{extra ?? `${assetsLabel(inst.assets) ?? "Assets not on record"}${inst.assets ? " in assets" : ""}`}</p>
    </div>
  );
}

/** Below this chart width the account-price labels are dropped; the side panel lists each price in full. */
const PRICE_LABELS_MIN_WIDTH = 480;

const DIST_MARGIN = { left: 16, right: 16 };
const BREAK_WIDTH = 64;

/** "Summit Bank does not publish this fee, so it is not on this chart.": the selection is never silently missing. */
function NotOnChart({ set, fee, selectedId }: { set: PeerExplorerSet; fee: ExplorerFeeKey; selectedId: number }) {
  const selected = [set.subject, ...set.peers].find((inst) => inst.id === selectedId);
  if (!selected || feeOf(selected, fee) !== undefined) return null;
  return (
    <p className="mt-2 text-[12px] font-medium text-ink-soft">
      {selected.name} does not publish {/^[aeiou]/i.test(EXPLORER_FEE_LABELS[fee]) ? "an" : "a"} {EXPLORER_FEE_LABELS[fee].toLowerCase()} fee, so it is not on this chart.
    </p>
  );
}

/**
 * The lead pricing chart: every institution's fee on one horizontal axis, the peer median as a
 * line, the institution as a diamond. When its value is built from several account prices, each
 * price is a filled diamond on its own row, joined by a line, and the comparison price a hollow
 * diamond named as such. Far outliers are drawn past an axis break with their amounts until
 * included, so no value is dropped.
 */
function Distribution({ set, fee, selectedId, highlight, onSelect, include, onInclude }: ViewProps & { include: boolean; onInclude: (value: boolean) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const everyone = [set.subject, ...set.peers];
  const publishing = everyone.filter((inst) => feeOf(inst, fee) !== undefined);
  const ownFee = set.subject.fees[fee];
  // The institution's own account prices, when its value is built from several.
  const ownPrices = ownFee?.prices ?? [];
  const several = ownPrices.length >= 2;
  const proxy = isComparisonProxy(ownFee);
  const median = set.medians[fee]?.median;
  // The account-price row needs its labels to be read, so a narrow chart leaves it out; the side
  // panel lists every price in full (James's Oct 20 review: an unlabelled row on a phone).
  const priceRowShown = several && width >= PRICE_LABELS_MIN_WIDTH;
  if (publishing.length === 0) {
    return (
      <>
        <p className="rounded-lg border border-dashed border-border p-6 text-[14px] text-ink-muted">Not published by any institution in this set.</p>
        <NotOnChart set={set} fee={fee} selectedId={selectedId} />
      </>
    );
  }
  const values = publishing.map((inst) => feeOf(inst, fee) as number);
  const split = splitOutliers(values, include);
  const outlierAll = splitOutliers(values, false).outliers;
  const broken = split.outliers.length > 0;
  const plotRight = width - DIST_MARGIN.right - (broken ? BREAK_WIDTH : 0);
  const scale = linearScale([...split.shown, ...ownPrices.map((price) => price.amount).filter((v) => !split.outliers.includes(v)), median ?? 0], width < 480 ? 3 : 5);
  const px = (v: number) => DIST_MARGIN.left + scalePosition(scale, v) * (plotRight - DIST_MARGIN.left);
  const outlierSorted = [...split.outliers].sort((a, b) => a - b);
  const breakX = (v: number) => plotRight + 24 + (outlierSorted.length > 1 ? (outlierSorted.indexOf(v) / (outlierSorted.length - 1)) * (BREAK_WIDTH - 32) : 0);
  const xOf = (v: number) => (split.outliers.includes(v) ? breakX(v) : px(v));

  // Stack dots that would overlap, so equal prices read as a column, not one dot.
  const stacks = new Map<number, number>();
  const placed = [...publishing]
    .sort((a, b) => (feeOf(a, fee) as number) - (feeOf(b, fee) as number))
    .map((inst) => {
      const x = xOf(feeOf(inst, fee) as number);
      const slot = Math.round(x / 10);
      const level = stacks.get(slot) ?? 0;
      stacks.set(slot, level + 1);
      return { inst, x, level };
    });
  const maxLevel = Math.max(0, ...placed.map((p) => p.level));
  const base = 44 + Math.min(maxLevel, 12) * 11;
  // The subject's label takes two lines when its value is a comparison price; the price row sits below.
  const labelRows = several ? 2 : 1;
  const priceRow = base + 40 + labelRows * 14 + 30;
  const height = priceRowShown ? priceRow + 34 : base + 40 + labelRows * 14;
  const yOf = (level: number) => base - Math.min(level, 12) * 11;
  const hovered = hover !== null ? placed.find((p) => p.inst.id === hover) : null;
  const subjectValue = feeOf(set.subject, fee);
  const outlierWords = outlierAll.map((v) => money(v)).join(", ");
  const subjectX = subjectValue !== undefined ? xOf(subjectValue) : 0;
  const subjectAnchor = subjectX > width - 120 ? "end" : subjectX < 120 ? "start" : "middle";
  const countWord = ["zero", "one", "two", "three", "four", "five", "six"][ownPrices.length] ?? String(ownPrices.length);
  const which = fee === "overdraft" ? "the highest" : "the middle";

  return (
    <figure className="m-0">
      <p className="mb-1 text-[12px] text-ink-muted">
        {EXPLORER_FEE_LABELS[fee]} fee in dollars, one mark per institution
      </p>
      <div ref={ref} className="relative w-full">
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${EXPLORER_FEE_LABELS[fee]} fees of ${publishing.length} institutions on one axis`} className="block overflow-visible">
          <line x1={DIST_MARGIN.left} x2={plotRight} y1={base + 8} y2={base + 8} stroke="var(--color-border)" strokeWidth={1} />
          {scale.ticks.map((tick) => (
            <text key={tick} x={px(tick)} y={base + 26} textAnchor="middle" className="fill-ink-muted text-[12px] tabular-nums">
              {money(tick)}
            </text>
          ))}
          {broken && (
            <g aria-hidden="true">
              <path d={`M ${plotRight + 6} ${base + 14} l 6 -12 M ${plotRight + 12} ${base + 14} l 6 -12`} stroke="var(--fi-ink)" strokeWidth={1.25} fill="none" />
              <line x1={plotRight + 20} x2={width - DIST_MARGIN.right} y1={base + 8} y2={base + 8} stroke="var(--color-border)" strokeWidth={1} strokeDasharray="2 3" />
            </g>
          )}
          {median !== undefined && (
            <g data-mark="median">
              <line x1={px(median)} x2={px(median)} y1={8} y2={base + 12} stroke="var(--fi-ink)" strokeWidth={1.25} strokeDasharray="4 3" />
              <text x={px(median)} y={4} textAnchor={px(median) > plotRight - 80 ? "end" : "middle"} className="fill-ink text-[12px] font-semibold tabular-nums">
                Peer median {money(median)}
              </text>
            </g>
          )}
          {placed
            .sort((a, b) => Number(a.inst.id === set.subject.id || a.inst.id === selectedId) - Number(b.inst.id === set.subject.id || b.inst.id === selectedId))
            .map(({ inst, x, level }) => {
              const cy = yOf(level);
              const isSubject = inst.id === set.subject.id;
              const isSelected = inst.id === selectedId;
              return (
                <g
                  key={inst.id}
                  className="cursor-pointer"
                  data-mark={isSubject ? (several ? "comparison-price" : "subject-price") : "peer"}
                  opacity={dimmed(inst, highlight, [set.subject.id, selectedId]) ? 0.2 : 1}
                  onClick={() => {
                    onSelect(inst.id);
                    setHover(inst.id);
                  }}
                  onMouseEnter={() => setHover(inst.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  <circle cx={x} cy={cy} r={10} fill="transparent" />
                  {isSubject ? (
                    <rect
                      x={x - 6}
                      y={cy - 6}
                      width={12}
                      height={12}
                      transform={`rotate(45 ${x} ${cy})`}
                      fill={several ? "var(--fi-surface-0)" : SUBJECT}
                      stroke={several ? SUBJECT : "var(--fi-surface-0)"}
                      strokeWidth={2}
                    />
                  ) : (
                    <circle cx={x} cy={cy} r={isSelected ? 6 : 4.5} fill={isSelected || highlight?.ids.has(inst.id) ? SELECTED : PEER} stroke="var(--fi-surface-0)" strokeWidth={2} />
                  )}
                  {isSelected && !isSubject && <circle cx={x} cy={cy} r={10} fill="none" stroke={SELECTED} strokeWidth={1.5} />}
                </g>
              );
            })}
          {split.outliers.map((v) => (
            <text key={`o${v}`} x={breakX(v)} y={base + 26} textAnchor="middle" className="fill-ink text-[12px] font-semibold tabular-nums">
              {money(v)}
            </text>
          ))}
          {subjectValue !== undefined && (
            <text x={subjectX} y={base + 44} textAnchor={subjectAnchor} className="pointer-events-none fill-ink text-[12px] font-semibold tabular-nums">
              {several ? `${short(set.subject.name)}: comparison price ${money(subjectValue)}` : `${short(set.subject.name)} ${money(subjectValue)}`}
              {several && (
                <tspan x={subjectX} dy="1.25em" className="fill-ink-soft font-normal">
                  {proxy ? (width < 480 ? PROXY_NOTE : `${which} of its ${countWord} prices, ${PROXY_NOTE}`) : `${which} of its ${countWord} prices`}
                </tspan>
              )}
            </text>
          )}
          {priceRowShown && (
            <g aria-label={`${set.subject.name}'s account prices`}>
              <text x={DIST_MARGIN.left} y={priceRow - 18} className="fill-ink-muted text-[12px] font-medium">
                {short(set.subject.name)}&apos;s account prices
              </text>
              {/* The span the comparison price is taken from: lowest to highest price. */}
              <line
                x1={xOf(ownPrices[0].amount)}
                x2={xOf(ownPrices[ownPrices.length - 1].amount)}
                y1={priceRow}
                y2={priceRow}
                stroke={SUBJECT}
                strokeWidth={1.25}
                opacity={0.5}
              />
              {proxy && subjectValue !== undefined && (
                <g data-mark="comparison-price-on-span" aria-hidden="true">
                  <line x1={subjectX} x2={subjectX} y1={priceRow - 7} y2={priceRow + 7} stroke={SUBJECT} strokeWidth={1.25} strokeDasharray="2 2" />
                </g>
              )}
              {ownPrices.map((price, i) => {
                const x = xOf(price.amount);
                // The lowest price is labelled to its left and the highest to its right, beside the
                // marker, so two close prices never share a line; any between sit below, alternating.
                const first = i === 0;
                const last = i === ownPrices.length - 1;
                const side = (first && x > 200) || (last && x < width - 200);
                const anchor = side ? (first ? "end" : "start") : x > width - 120 ? "end" : x < 120 ? "start" : "middle";
                const lx = side ? x + (first ? -10 : 10) : x;
                const ly = side ? priceRow + 4 : priceRow + (i % 2 === 0 ? 20 : 31);
                return (
                  <g key={i} data-mark="account-price" data-amount={price.amount} className="cursor-default" onMouseEnter={() => setHoverPrice(i)} onMouseLeave={() => setHoverPrice(null)}>
                    <circle cx={x} cy={priceRow} r={10} fill="transparent" />
                    <rect x={x - 5} y={priceRow - 5} width={10} height={10} transform={`rotate(45 ${x} ${priceRow})`} fill={SUBJECT} stroke="var(--fi-surface-0)" strokeWidth={1.5} />
                    {/* The account's short name ("Carefree Checking $7.95"); dropped on a narrow chart. */}
                    <text x={lx} y={ly} textAnchor={anchor} className="fill-ink text-[12px] tabular-nums">
                      {price.account ?? short(price.name ?? `Price ${i + 1}`)} {money(price.amount)}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
        </svg>
        {hovered && (
          <Tooltip inst={hovered.inst} fee={fee} left={`${(hovered.x / width) * 100}%`} top={`calc(${(yOf(hovered.level) / height) * 100}% - 10px)`} />
        )}
        {hoverPrice !== null && ownPrices[hoverPrice] && (
          <div
            className="pointer-events-none absolute z-20 w-max max-w-[18rem] -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface-0 px-2.5 py-1.5 text-[12px] leading-snug shadow-fi-1"
            style={{ left: `${(xOf(ownPrices[hoverPrice].amount) / width) * 100}%`, top: `calc(${(priceRow / height) * 100}% - 10px)` }}
          >
            <p className="font-semibold text-ink">{ownPrices[hoverPrice].name ?? "Account not named"}</p>
            <p className="tabular-nums text-ink-muted">{money(ownPrices[hoverPrice].amount)}, a price on the schedule</p>
            {ownPrices[hoverPrice].conditions && <p className="mt-0.5 text-ink-muted">{ownPrices[hoverPrice].conditions}</p>}
          </div>
        )}
      </div>
      <NotOnChart set={set} fee={fee} selectedId={selectedId} />
      <figcaption className="mt-2 space-y-1.5 text-[12px] text-ink-muted">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {several ? (
            <>
              {priceRowShown && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="inline-block size-2.5 rotate-45" style={{ background: SUBJECT }} />
                  {short(set.subject.name)}: an account price on its schedule
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-2.5 rotate-45 border-2" style={{ borderColor: SUBJECT }} />
                {proxy ? `Its comparison price, the middle of its prices: ${PROXY_NOTE}` : `Its comparison price, ${which} of its prices`}
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block size-2.5 rotate-45" style={{ background: SUBJECT }} />
              {short(set.subject.name)}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: PEER }} />
            Peer (equal prices stack)
          </span>
          {median !== undefined ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block w-4 border-t-[1.5px] border-dashed border-ink" />
              Peer median
            </span>
          ) : (
            <span>Peer median: too few to compare.</span>
          )}
        </span>
        {outlierAll.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
              <input type="checkbox" checked={include} onChange={(e) => onInclude(e.target.checked)} className="size-4 accent-[var(--fi-ink)]" />
              Include {outlierAll.length === 1 ? `${outlierWords} outlier` : `${outlierAll.length} outliers (${outlierWords})`}
            </label>
            {!include && <span>Shown past the axis break, not to scale, so the rest of the set has room.</span>}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

const MARGIN = { top: 20, right: 16, bottom: 44, left: 52 };

function axisTick(axis: LandscapeAxis, value: number): string {
  if (axis === "assets") return assetsLabel(value) ?? "$0";
  if (axis === "share") return `${+(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
  return String(value);
}

/** The chosen fee up, total assets (or, for a metro set, branches or deposit share) across. */
function Landscape({ set, fee, selectedId, highlight, onSelect, axis: chosenAxis, onAxis: setAxis }: ViewProps & { axis: LandscapeAxis; onAxis: (axis: LandscapeAxis) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const [hover, setHover] = useState<number | null>(null);
  const axes = landscapeAxes(set);
  const axis = axes.includes(chosenAxis) ? chosenAxis : "assets";
  const height = width < 480 ? 320 : 440;
  const everyone = [set.subject, ...set.peers];
  const plotted = everyone.filter((inst) => feeOf(inst, fee) !== undefined && landscapeValue(set, inst, axis) !== null);
  const notPublished = everyone.filter((inst) => feeOf(inst, fee) === undefined).length;
  const noX = everyone.filter((inst) => feeOf(inst, fee) !== undefined && landscapeValue(set, inst, axis) === null).length;
  const median = set.medians[fee]?.median;
  const xValues = plotted.map((inst) => landscapeValue(set, inst, axis) as number);
  const x: AxisScale = axis === "assets" ? assetScale(xValues) : linearScale(xValues, 4);
  const y = linearScale([...plotted.map((inst) => feeOf(inst, fee) as number), median ?? 0], width < 480 ? 4 : 5);
  const innerW = Math.max(10, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const px = (v: number) => MARGIN.left + scalePosition(x, v) * innerW;
  const py = (amount: number) => MARGIN.top + (1 - scalePosition(y, amount)) * innerH;
  const hovered = hover !== null ? plotted.find((inst) => inst.id === hover) : null;
  const named = plotted.filter((inst) => (inst.id === set.subject.id || inst.id === selectedId) && inst.id !== hover);
  const order = [...plotted].sort((a, b) => Number(a.id === selectedId || a.id === set.subject.id) - Number(b.id === selectedId || b.id === set.subject.id));
  const pointOf = (inst: ExplorerInstitution) => ({ x: px(landscapeValue(set, inst, axis) as number), y: py(feeOf(inst, fee) as number) });
  const medianText = median !== undefined ? `Peer median ${money(median)}` : "";
  // Each name label stays inside the plot and off the median line, its label, the other points
  // and the label placed before it (James's Oct 20 review: it ran off a phone and over the median).
  const taken =
    median !== undefined ? [labelBox(width - MARGIN.right, py(median) - 6, "end", [estimateTextWidth(medianText)])] : [];
  const labels = named.map((inst) => {
    const point = pointOf(inst);
    const text = `${short(inst.name)} · ${money(feeOf(inst, fee) as number)}`;
    const proxy = comparisonTag(fee, inst.fees[fee]);
    const widths = [estimateTextWidth(text), ...(proxy ? [estimateTextWidth(proxy)] : [])];
    const place = placePointLabel({
      ...point,
      widths,
      bounds: { left: MARGIN.left, right: width - 2, top: 0, bottom: height - MARGIN.bottom },
      avoidBoxes: [...taken],
      avoidLines: median !== undefined ? [py(median)] : [],
      avoidPoints: plotted.filter((other) => other.id !== inst.id).map(pointOf),
    });
    taken.push(place.box);
    return { inst, text, proxy, place };
  });

  return (
    <figure className="m-0">
      {axes.length > 1 && (
        <div role="radiogroup" aria-label="Across" className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-ink-muted">Across:</span>
          {axes.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={axis === option}
              onClick={() => setAxis(option)}
              className={`min-h-10 rounded-full border px-3.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${axis === option ? "border-ink bg-ink text-on-ink" : "border-border text-ink hover:border-ink"}`}
            >
              {LANDSCAPE_AXIS_LABELS[option]}
            </button>
          ))}
        </div>
      )}
      {plotted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-[14px] text-ink-muted">Not published by any institution in this set.</p>
      ) : (
        <div ref={ref} className="relative w-full">
          <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${EXPLORER_FEE_LABELS[fee]} fee by ${LANDSCAPE_AXIS_LABELS[axis].toLowerCase()} for ${plotted.length} institutions`} className="block overflow-visible">
            {y.ticks.map((tick) => (
              <g key={`y${tick}`}>
                <line x1={MARGIN.left} x2={width - MARGIN.right} y1={py(tick)} y2={py(tick)} stroke="var(--color-border)" strokeWidth={1} />
                <text x={MARGIN.left - 8} y={py(tick)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-[12px] tabular-nums">
                  {money(tick)}
                </text>
              </g>
            ))}
            {x.ticks.map((tick) => (
              <text key={`x${tick}`} x={px(tick)} y={height - MARGIN.bottom + 18} textAnchor="middle" className="fill-ink-muted text-[12px] tabular-nums">
                {axisTick(axis, tick)}
              </text>
            ))}
            <text x={MARGIN.left + innerW / 2} y={height - 6} textAnchor="middle" className="fill-ink-muted text-[12px]">
              {LANDSCAPE_AXIS_LABELS[axis]}
              {x.kind === "log" ? " (log scale)" : ""}
            </text>
            {median !== undefined && (
              <g>
                <line x1={MARGIN.left} x2={width - MARGIN.right} y1={py(median)} y2={py(median)} stroke="var(--fi-ink)" strokeWidth={1.25} strokeDasharray="5 4" />
                <text x={width - MARGIN.right} y={py(median) - 6} textAnchor="end" data-mark="median-label" className="fill-ink text-[12px] font-semibold tabular-nums">
                  {medianText}
                </text>
              </g>
            )}
            {order.map((inst) => {
              const cx = px(landscapeValue(set, inst, axis) as number);
              const cy = py(feeOf(inst, fee) as number);
              const isSubject = inst.id === set.subject.id;
              const isSelected = inst.id === selectedId;
              return (
                <g
                  key={inst.id}
                  className="cursor-pointer"
                  opacity={dimmed(inst, highlight, [set.subject.id, selectedId]) ? 0.2 : 1}
                  onClick={() => {
                    onSelect(inst.id);
                    setHover(inst.id);
                  }}
                  onMouseEnter={() => setHover(inst.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  <circle cx={cx} cy={cy} r={12} fill="transparent" />
                  {isSubject ? (
                    <rect x={cx - 6} y={cy - 6} width={12} height={12} transform={`rotate(45 ${cx} ${cy})`} fill={SUBJECT} stroke="var(--fi-surface-0)" strokeWidth={2} />
                  ) : (
                    <circle cx={cx} cy={cy} r={isSelected ? 6 : 4.5} fill={isSelected || highlight?.ids.has(inst.id) ? SELECTED : PEER} stroke="var(--fi-surface-0)" strokeWidth={2} />
                  )}
                  {isSelected && !isSubject && <circle cx={cx} cy={cy} r={10} fill="none" stroke={SELECTED} strokeWidth={1.5} />}
                </g>
              );
            })}
            {labels.map(({ inst, text, proxy, place }) => (
              <text
                key={`l${inst.id}`}
                x={place.x}
                y={place.y}
                textAnchor={place.anchor}
                data-mark="point-label"
                className={`pointer-events-none text-[12px] tabular-nums ${inst.id === set.subject.id ? "fill-ink font-semibold" : "fill-ink-soft font-semibold"}`}
                style={{ paintOrder: "stroke", stroke: "var(--fi-surface-0)", strokeWidth: 3 }}
              >
                {text}
                {proxy && (
                  <tspan x={place.x} dy="1.25em" className="fill-ink-soft font-normal">
                    {proxy}
                  </tspan>
                )}
              </text>
            ))}
          </svg>
          {hovered && (
            <Tooltip
              inst={hovered}
              fee={fee}
              left={`${(px(landscapeValue(set, hovered, axis) as number) / width) * 100}%`}
              top={`calc(${(py(feeOf(hovered, fee) as number) / height) * 100}% - 10px)`}
              extra={axis === "assets" ? undefined : `${LANDSCAPE_AXIS_LABELS[axis]}: ${axisTick(axis, landscapeValue(set, hovered, axis) as number)}`}
            />
          )}
        </div>
      )}
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rotate-45" style={{ background: SUBJECT }} />
          {short(set.subject.name)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: PEER }} />
          Peer (tap or hover for its name)
        </span>
        {median !== undefined ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block w-4 border-t-[1.5px] border-dashed border-ink" />
            Peer median
          </span>
        ) : (
          <span>Peer median: too few to compare.</span>
        )}
        {notPublished > 0 && <span>{notPublished.toLocaleString("en-US")} not shown: fee not published.</span>}
        {noX > 0 && <span>{noX.toLocaleString("en-US")} not shown: no {LANDSCAPE_AXIS_LABELS[axis].toLowerCase()} on record.</span>}
        {plotted.some((inst) => isComparisonProxy(inst.fees[fee])) && <span>A comparison price is the middle of an institution&apos;s account prices, {PROXY_NOTE}.</span>}
      </figcaption>
      <NotOnChart set={set} fee={fee} selectedId={selectedId} />
    </figure>
  );
}

const GROUPS_SHOWN = 12;
const CIRCLES_PER_GROUP = 40;

/** Where the set is: one cluster per city (or state), circles sized by total assets. */
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
            <li key={group.key} className={`min-w-0 rounded-[18px] border p-3 ${hasSubject && by !== "branch" ? "border-ink/30 bg-ink/[0.04]" : "border-border bg-paper"}`}>
              <p className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[14px] font-semibold text-ink">{group.name}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-muted">{group.members.length.toLocaleString("en-US")}</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {visible.map((inst) => {
                  const r = assetRadius(inst.assets, maxAssets, 5, 20);
                  const isSubject = inst.id === set.subject.id;
                  const isSelected = inst.id === selectedId;
                  const value = feeOf(inst, fee);
                  return (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => onSelect(inst.id)}
                      title={`${inst.name}: ${assetsLabel(inst.assets) ?? "assets not on record"}, ${EXPLORER_FEE_LABELS[fee].toLowerCase()} ${value !== undefined ? money(value) : "not published"}`}
                      aria-label={`${inst.name}, ${value !== undefined ? money(value) : "not published"}`}
                      aria-pressed={isSelected}
                      className="grid place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      style={{ width: Math.max(24, r * 2), height: Math.max(24, r * 2), opacity: dimmed(inst, highlight, [set.subject.id, selectedId]) ? 0.2 : 1 }}
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

const BAND_WORDS: Record<MatrixBand, { mark: string; label: string }> = {
  below: { mark: "▼", label: "Below the median" },
  same: { mark: "≈", label: ABOUT_SAME_RULE },
  above: { mark: "▲", label: "Above the median" },
  none: { mark: "", label: "Not published" },
};

/** The cell fill: the shared below and above tones, deeper toward the cohort's tails; neutral when about the same; hatched when not published. */
function cellBackground(band: MatrixBand, step: number): string {
  if (band === "none") return "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--fi-ink) 8%, transparent) 5px 6px)";
  if (band === "same") return "color-mix(in srgb, var(--fi-ink) 6%, var(--fi-surface-0))";
  const tone = band === "below" ? BELOW_TONE : ABOVE_TONE;
  return `color-mix(in srgb, ${tone} ${[12, 12, 22, 34][step]}%, var(--fi-surface-0))`;
}

const ROWS_SHOWN = 30;

/** Pixels of slack before the table counts as scrolled to its right edge. */
const SCROLL_EDGE_SLACK = 4;

/**
 * Whether a wide table has columns past its right edge, for the "scroll for more" cue and edge
 * shade (James's Oct 20 review: on a phone the fee columns sat off-screen with no sign of them).
 */
function useMoreToTheRight() {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    setMore(node.scrollWidth - node.clientWidth - node.scrollLeft > SCROLL_EDGE_SLACK);
  }, []);
  useEffect(() => {
    measure();
    const node = scroller.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);
  return { scroller, more, measure };
}

/**
 * Every institution against each fee's peer median, as an investigation table: sortable, the
 * subject pinned, amounts or differences, a row's evidence on click, and side-by-side compare.
 */
function Matrix({ set, fee, selectedId, highlight, onSelect, onFee }: ViewProps & { onFee: (key: ExplorerFeeKey) => void }) {
  const [sort, setSort] = useState<{ key: MatrixSortKey; dir: "asc" | "desc" }>({ key: "assets", dir: "desc" });
  const [mode, setMode] = useState<"amount" | "difference">("amount");
  const [all, setAll] = useState(false);
  const [evidence, setEvidence] = useState<{ id: number; fee: ExplorerFeeKey } | null>(null);
  const [checked, setChecked] = useState<number[]>([]);
  const rows = sortMatrixRows(set, sort.key, sort.dir);
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  if (!all && shown.every((row) => row.id !== selectedId)) {
    const sel = rows.find((row) => row.id === selectedId);
    if (sel) shown.push(sel);
  }
  const columnValues = useMemo(
    () => Object.fromEntries(EXPLORER_FEE_KEYS.map((key) => [key, [set.subject, ...set.peers].map((inst) => inst.fees[key]?.amount).filter((v): v is number => v !== undefined)])) as Record<ExplorerFeeKey, number[]>,
    [set],
  );
  const sortBy = (key: MatrixSortKey) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "state" ? "asc" : "desc" }));
  const ariaSort = (key: MatrixSortKey) => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
  const sortIcon = (k: MatrixSortKey) =>
    sort.key === k ? (sort.dir === "asc" ? <ChevronUp aria-hidden="true" className="inline size-3.5" /> : <ChevronDown aria-hidden="true" className="inline size-3.5" />) : null;
  const toggleCheck = (id: number) => setChecked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const compare = checked.map((id) => rows.find((row) => row.id === id)).filter((row): row is ExplorerInstitution => row !== undefined);
  const headBtn = "inline-flex min-h-9 items-center gap-0.5 rounded px-1 font-medium hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";
  const subjectStickyTop = "sticky top-[41px] z-[5]";
  const { scroller, more, measure } = useMoreToTheRight();

  return (
    <div>
      <p className="text-[14px] font-medium leading-snug text-ink">{matrixSummary(set)}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Cells show" className="inline-flex rounded-full border border-border bg-paper p-0.5 text-[13px]">
          {(["amount", "difference"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              onClick={() => setMode(option)}
              className={`min-h-9 rounded-full px-3.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${mode === option ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"}`}
            >
              {option === "amount" ? "Amounts" : "Difference from median"}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-ink-muted">Select a cell for its evidence. Tick two or more rows to compare.</p>
      </div>
      <div className="mt-3">
        <p className="text-[12px] font-medium text-ink-muted">{EXPLORER_FEE_LABELS[fee]} across the set</p>
        <DotStrip set={set} fee={fee} selectedId={selectedId} median={set.medians[fee]?.median} onSelect={onSelect} />
      </div>
      {more && (
        <p data-scroll-cue className="mt-3 text-right text-[12px] font-medium text-ink-soft">
          Scroll sideways for more fees&nbsp;<span aria-hidden="true">→</span>
        </p>
      )}
      <div className={`relative ${more ? "mt-1" : "mt-3"}`}>
        <div ref={scroller} onScroll={measure} className="max-h-[36rem] max-w-full overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-[13px]">
          <caption className="sr-only">Each institution&apos;s fees against the peer median</caption>
          <thead className="sticky top-0 z-10 bg-surface-0">
            <tr className="text-left text-[12px] text-ink-muted">
              <th scope="col" className="w-8 border-b border-border bg-surface-0 px-2">
                <span className="sr-only">Compare</span>
              </th>
              <th scope="col" aria-sort={ariaSort("name")} className="sticky left-0 z-10 border-b border-border bg-surface-0 px-2 py-1">
                <button type="button" onClick={() => sortBy("name")} className={headBtn}>
                  Institution {sortIcon("name")}
                </button>
              </th>
              {EXPLORER_FEE_KEYS.map((key) => (
                <th key={key} scope="col" aria-sort={ariaSort(key)} className="border-b border-border px-1 py-1 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      onFee(key);
                      sortBy(key);
                    }}
                    className={`${headBtn} ${key === fee ? "font-semibold text-ink underline decoration-2 underline-offset-4" : ""}`}
                  >
                    {EXPLORER_FEE_SHORT[key]} {sortIcon(key)}
                  </button>
                  <span className="block text-[11px] font-normal tabular-nums">
                    {set.medians[key] ? `median ${money(set.medians[key]!.median)}` : "too few to compare"}
                  </span>
                </th>
              ))}
              <th scope="col" aria-sort={ariaSort("state")} className="border-b border-border px-1 py-1">
                <button type="button" onClick={() => sortBy("state")} className={headBtn}>
                  State {sortIcon("state")}
                </button>
              </th>
              <th scope="col" aria-sort={ariaSort("assets")} className="border-b border-border px-1 py-1 text-right">
                <button type="button" onClick={() => sortBy("assets")} className={headBtn}>
                  Assets {sortIcon("assets")}
                </button>
              </th>
              <th scope="col" className="border-b border-border px-2 py-1 text-right font-medium">Assets vs. this bank</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((inst) => {
              const isSubject = inst.id === set.subject.id;
              const isSelected = inst.id === selectedId;
              const faded = dimmed(inst, highlight, [set.subject.id, selectedId]);
              const rowBg = isSubject ? "bg-paper" : isSelected ? "bg-paper" : "bg-surface-0";
              const sticky = isSubject ? subjectStickyTop : "";
              const open = evidence?.id === inst.id;
              return (
                <Fragment key={inst.id}>
                  <tr style={{ opacity: faded ? 0.3 : 1 }}>
                    <td className={`border-t border-border px-2 text-center ${rowBg} ${sticky}`}>
                      {!isSubject && (
                        <input
                          type="checkbox"
                          checked={checked.includes(inst.id)}
                          onChange={() => toggleCheck(inst.id)}
                          aria-label={`Compare ${inst.name}`}
                          className="size-4 accent-[var(--fi-ink)]"
                        />
                      )}
                    </td>
                    <th scope="row" className={`sticky left-0 z-[6] w-[8.5rem] min-w-[8.5rem] border-t border-border p-0 text-left font-normal shadow-[1px_0_0_var(--color-border)] sm:w-[13rem] sm:min-w-[13rem] ${rowBg} ${isSubject ? "top-[41px]" : ""}`}>
                      <button
                        type="button"
                        onClick={() => onSelect(inst.id)}
                        aria-pressed={isSelected}
                        className={`flex min-h-11 w-full items-center gap-2 border-l-[3px] px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink ${
                          isSubject ? "border-ink font-semibold text-ink" : isSelected ? "border-[var(--fi-viz-bar)] font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink"
                        }`}
                      >
                        <span className="line-clamp-2 min-w-0 break-words py-1 leading-snug" title={inst.name}>
                          {inst.name}
                        </span>
                      </button>
                    </th>
                    {EXPLORER_FEE_KEYS.map((key) => {
                      const value = inst.fees[key]?.amount;
                      const median = set.medians[key]?.median;
                      const { band, step } = cellShade(value, columnValues[key], median);
                      const words = median === undefined && value !== undefined ? "no median: too few to compare" : BAND_WORDS[band].label.toLowerCase();
                      const proxy = comparisonLabel(key, inst.fees[key]);
                      const text =
                        value === undefined ? "Not published" : mode === "difference" && median !== undefined ? signedMoney(value - median) : money(value);
                      return (
                        <td key={key} className={`border-t border-border p-[2px] ${rowBg} ${sticky}`}>
                          <button
                            type="button"
                            onClick={() => setEvidence(open && evidence?.fee === key ? null : { id: inst.id, fee: key })}
                            title={`${inst.name}, ${EXPLORER_FEE_LABELS[key]}: ${value !== undefined ? money(value) : "not published"}${proxy ? ` (${proxy.toLowerCase()})` : ""}${value !== undefined ? `, ${words}` : ""}`}
                            aria-expanded={open && evidence?.fee === key}
                            className={`flex min-h-10 w-full items-center justify-center gap-1 rounded-[4px] px-1.5 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${key === fee ? "ring-1 ring-inset ring-ink/20" : ""}`}
                            style={{ background: cellBackground(median === undefined && value !== undefined ? "same" : band, step) }}
                          >
                            {value === undefined ? (
                              <span className="text-[11px] text-ink-muted">Not published</span>
                            ) : (
                              <>
                                <span className={isSubject ? "font-semibold text-ink" : "text-ink"}>
                                  {text}
                                  {isComparisonProxy(inst.fees[key]) && <ProxyMark />}
                                </span>
                                {median !== undefined && (
                                  <span aria-hidden="true" className="text-[10px] text-ink-soft">
                                    {BAND_WORDS[band].mark}
                                  </span>
                                )}
                                <span className="sr-only">, {words}</span>
                              </>
                            )}
                          </button>
                        </td>
                      );
                    })}
                    <td className={`border-t border-border px-2 text-ink-muted ${rowBg} ${sticky}`}>{inst.state ?? "Not on record"}</td>
                    <td className={`border-t border-border px-2 text-right tabular-nums text-ink-muted ${rowBg} ${sticky}`}>{assetsLabel(inst.assets) ?? "Not on record"}</td>
                    <td className={`border-t border-border px-2 text-right tabular-nums text-ink-muted ${rowBg} ${sticky}`}>{isSubject ? "This bank" : assetDifference(inst.assets, set.subject.assets)}</td>
                  </tr>
                  {open && evidence && (
                    <tr>
                      <td colSpan={5 + EXPLORER_FEE_KEYS.length} className="border-t border-border bg-paper p-0">
                        <Evidence inst={inst} focus={evidence.fee} set={set} onClose={() => setEvidence(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
        {more && (
          <span
            aria-hidden="true"
            data-scroll-shadow
            className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-[color-mix(in_srgb,var(--fi-ink)_14%,transparent)] to-transparent"
          />
        )}
      </div>
      {rows.length > ROWS_SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="mt-3 inline-flex min-h-11 items-center text-[13px] font-semibold text-ink underline underline-offset-2">
          {all ? "Show fewer" : `Show all ${rows.length.toLocaleString("en-US")} institutions`}
        </button>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink-muted">
        {(["below", "same", "above", "none"] as const).map((band) => (
          <li key={band} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-flex h-4 w-6 items-center justify-center rounded-[3px] border border-border text-[9px] text-ink-soft" style={{ background: cellBackground(band, 2) }}>
              {BAND_WORDS[band].mark}
            </span>
            {BAND_WORDS[band].label}
          </li>
        ))}
        <li>Deeper colour: further from the middle of the set. {MEDIAN_TONE_NOTE}</li>
        {rows.some((row) => EXPLORER_FEE_KEYS.some((key) => isComparisonProxy(row.fees[key]))) && <li>{PROXY_FOOTNOTE}</li>}
      </ul>
      {compare.length >= 2 && <Compare set={set} rows={[set.subject, ...compare]} onClear={() => setChecked([])} />}
      {compare.length === 1 && <p className="mt-3 text-[13px] text-ink-muted">Tick one more institution to compare side by side.</p>}
    </div>
  );
}

/** One institution's evidence for every fee, the clicked fee first: amounts, account prices, conditions, the schedule and its date. */
function Evidence({ inst, focus, set, onClose }: { inst: ExplorerInstitution; focus: ExplorerFeeKey; set: PeerExplorerSet; onClose: () => void }) {
  const keys = [focus, ...EXPLORER_FEE_KEYS.filter((key) => key !== focus)];
  return (
    <div className="sticky left-0 max-w-[min(100vw-4rem,52rem)] px-3 py-3 text-[13px]">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-ink">{inst.name}: evidence</p>
        <button type="button" onClick={onClose} className="inline-flex min-h-9 items-center gap-1 text-[12px] text-ink-muted hover:text-ink">
          <X aria-hidden="true" className="size-3.5" />
          Close
        </button>
      </div>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {keys.map((key) => {
          const f = inst.fees[key];
          const median = set.medians[key]?.median;
          const proxy = comparisonLabel(key, f);
          return (
            <li key={key} className={`rounded-md border bg-surface-0 px-3 py-2 ${key === focus ? "border-ink" : "border-border"}`}>
              <p className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-ink">{EXPLORER_FEE_LABELS[key]}</span>
                <span className="tabular-nums font-semibold text-ink">{f ? money(f.amount) : <span className="font-normal text-ink-muted">Not published</span>}</span>
              </p>
              {f && (
                <p className="text-[12px] text-ink-muted">
                  {proxy ? `${proxy}. ` : ""}
                  {median !== undefined ? `${signedMoney(f.amount - median)} against the peer median of ${money(median)}.` : "Peer median: too few to compare."}
                </p>
              )}
              {f?.prices && (
                <ul className="mt-1 space-y-1">
                  {f.prices.map((price, i) => (
                    <li key={i} className="text-[12px]">
                      <span className="tabular-nums font-medium text-ink">{money(price.amount)}</span> <span className="text-ink-soft">{price.name ?? "Account not named"}</span>
                      {price.conditions && <span className="block text-ink-muted">{price.conditions}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {f?.source && (
                <p className="mt-1 text-[12px] text-ink-muted">
                  {f.source.url ? (
                    <a href={f.source.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline underline-offset-2">
                      The bank&apos;s fee schedule
                    </a>
                  ) : (
                    "Schedule link not on record"
                  )}
                  {f.source.published ? ` · in the index since ${formatDate(f.source.published)}` : ""}
                </p>
              )}
              {f && !f.source && <p className="mt-1 text-[12px] text-ink-muted">Schedule link and date not on record.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The ticked institutions side by side with this one: each fee's amount and its difference from the median. */
function Compare({ set, rows, onClear }: { set: PeerExplorerSet; rows: ExplorerInstitution[]; onClear: () => void }) {
  return (
    <section aria-label="Side-by-side comparison" className="mt-4 rounded-lg border border-ink/20 bg-paper p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[14px] font-semibold text-ink">Side by side</p>
        <button type="button" onClick={onClear} className="inline-flex min-h-9 items-center gap-1 text-[12px] text-ink-muted hover:text-ink">
          <X aria-hidden="true" className="size-3.5" />
          Clear
        </button>
      </div>
      <div className="relative mt-2 max-w-full overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-muted">
              <th scope="col" className="px-2 py-1 font-medium">Fee</th>
              {rows.map((inst) => (
                <th key={inst.id} scope="col" className={`px-2 py-1 text-right font-semibold ${inst.id === set.subject.id ? "text-ink underline decoration-ink underline-offset-4" : "text-ink-soft"}`}>
                  {short(inst.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="border-t border-border px-2 py-1.5 text-left font-normal text-ink-soft">Assets</th>
              {rows.map((inst) => (
                <td key={inst.id} className="border-t border-border px-2 text-right tabular-nums text-ink">{assetsLabel(inst.assets) ?? "Not on record"}</td>
              ))}
            </tr>
            {EXPLORER_FEE_KEYS.map((key) => {
              const median = set.medians[key]?.median;
              return (
                <tr key={key}>
                  <th scope="row" className="border-t border-border px-2 py-1.5 text-left font-normal text-ink-soft">
                    {EXPLORER_FEE_LABELS[key]}
                    <span className="block text-[11px] tabular-nums text-ink-muted">{median !== undefined ? `median ${money(median)}` : "too few to compare"}</span>
                  </th>
                  {rows.map((inst) => {
                    const value = inst.fees[key]?.amount;
                    return (
                      <td key={inst.id} className="border-t border-border px-2 text-right tabular-nums">
                        {value === undefined ? (
                          <span className="text-[12px] text-ink-muted">Not published</span>
                        ) : (
                          <>
                            <span className="text-ink">
                              {money(value)}
                              {isComparisonProxy(inst.fees[key]) && <ProxyMark />}
                            </span>
                            {median !== undefined && <span className="block text-[11px] text-ink-muted">{signedMoney(value - median)}</span>}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.some((inst) => EXPLORER_FEE_KEYS.some((key) => isComparisonProxy(inst.fees[key]))) && <p className="mt-2 text-[12px] text-ink-muted">{PROXY_FOOTNOTE}</p>}
    </section>
  );
}

/** The selected institution's fee, led by its account prices, then the peer median and the gap. */
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
  const proxy = comparisonLabel(fee, own);
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
        {own?.prices && proxy ? (
          <>
            <p className="mt-1 text-[12px] font-medium text-ink-muted">Account prices</p>
            <ul className="mt-1 space-y-1.5">
              {own.prices.map((price, i) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2 text-[13px]">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-ink">{price.name ?? "Account not named"}</span>
                    <span className="shrink-0 text-[16px] font-semibold tabular-nums text-ink">{money(price.amount)}</span>
                  </p>
                  {price.conditions && <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">{price.conditions}</p>}
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-2">
              <span className="text-[12px] text-ink-muted">{proxy}</span>
              <span className="text-[24px] font-semibold tabular-nums text-ink">{money(own.amount)}</span>
            </p>
          </>
        ) : (
          <p className="mt-1 text-[36px] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums">
            {own ? money(own.amount) : <span className="text-[15px] font-medium text-ink-muted">Not published</span>}
          </p>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-[12px] text-ink-muted">Peer median</dt>
            <dd className="mt-0.5 text-[20px] font-semibold tabular-nums text-ink">{median !== undefined ? money(median) : <span className="text-[13px] font-medium text-ink-muted">Too few to compare</span>}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">Peers publishing</dt>
            <dd className="mt-0.5 text-[20px] font-semibold tabular-nums text-ink">{publishingPeers(set, fee).toLocaleString("en-US")}</dd>
          </div>
        </dl>
        {gap && (
          <p className="mt-2 text-[14px] font-semibold" style={{ color: gap.direction === "above" ? ABOVE_TONE : gap.direction === "below" ? BELOW_TONE : undefined }}>
            {gap.direction === "above" ? "▲ " : gap.direction === "below" ? "▼ " : "≈ "}
            {gap.text}
          </p>
        )}
        <DotStrip set={set} fee={fee} selectedId={selected.id} median={median} onSelect={onSelect} />
      </div>
    </aside>
  );
}

/** Every institution's fee on one track: the subject a diamond, the selection a ringed dot, the median a tick. */
function DotStrip({ set, fee, selectedId, median, onSelect }: { set: PeerExplorerSet; fee: ExplorerFeeKey; selectedId: number; median: number | undefined; onSelect: (id: number) => void }) {
  const everyone = [set.subject, ...set.peers].filter((inst) => feeOf(inst, fee) !== undefined);
  if (everyone.length < 2) return <p className="mt-3 text-[12px] text-ink-muted">Too few to compare.</p>;
  const values = everyone.map((inst) => feeOf(inst, fee) as number);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const at = (v: number) => (high === low ? 50 : ((v - low) / (high - low)) * 100);
  const front = (inst: ExplorerInstitution) => (inst.id === selectedId || inst.id === set.subject.id ? 1 : 0);
  return (
    <div className="mt-4">
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
              title={`${inst.name}: ${money(v)}${isComparisonProxy(inst.fees[fee]) ? `, comparison price, ${PROXY_NOTE}` : ""}`}
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
      <p className="mt-1 flex max-w-none justify-between text-[11px] tabular-nums text-ink-muted">
        <span>Lowest {money(low)}</span>
        {median !== undefined && <span>median {money(median)}</span>}
        <span>Highest {money(high)}</span>
      </p>
    </div>
  );
}
