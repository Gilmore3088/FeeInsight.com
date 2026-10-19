"use client";

import {
  BarChart3,
  Bell,
  FileText,
  Landmark,
  MapPin,
  MessageSquareText,
  Pause,
  Play,
  Scale,
  Search,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { TrackLink } from "@/components/track-link";
import type { EvidenceKey, OneQuestionAsk, OneQuestionFee, OneQuestionView, OutputKey } from "./landing-one-question";
import { useAutoAdvance, useReducedMotion } from "./landing-motion";

export type { OutputKey } from "./landing-one-question";

/**
 * The four kinds of evidence Hamilton reads for one question (James's brief, Oct 19, §3B). Each card
 * is a title, one figure from the live sample (OneQuestionView), a short caption and a small chart
 * (James's preferred structure, Oct 19). `detail` is the caption when the sample is missing.
 * Regulatory context has no record behind it on the homepage, so its card names what Hamilton
 * reads and carries one small Capability tag, never a record.
 */
export const EVIDENCE: { key: EvidenceKey; icon: LucideIcon; name: string; detail: string }[] = [
  { key: "financial", icon: BarChart3, name: "Financial performance", detail: "Fee income from the Call Report" },
  { key: "competitive", icon: Landmark, name: "Competitive position", detail: "Your fees against local competitors" },
  { key: "market", icon: MapPin, name: "Market conditions", detail: "Branches and deposits where you operate" },
  { key: "regulatory", icon: Scale, name: "Regulatory context", detail: "Rules and consumer complaints" },
];

/**
 * The four outputs (brief §4). Each opens on a headline question (James's preferred structure:
 * Benchmark asks "How do we compare?") and lights the evidence it reads when it is picked directly.
 */
export const OUTPUTS: { key: OutputKey; icon: LucideIcon; name: string; detail: string; heading: string; evidence: EvidenceKey[] }[] = [
  { key: "benchmark", icon: BarChart3, name: "Benchmark", detail: "See how you compare", heading: "How do we compare?", evidence: ["financial", "competitive"] },
  { key: "investigate", icon: Search, name: "Investigate", detail: "Find what to examine", heading: "What stands out?", evidence: ["financial", "competitive", "market"] },
  { key: "monitor", icon: Bell, name: "Monitor", detail: "Track what changes", heading: "What changed?", evidence: ["financial", "competitive", "market", "regulatory"] },
  { key: "report", icon: FileText, name: "Report", detail: "Brief your committee", heading: "What goes to committee?", evidence: ["financial", "competitive", "market", "regulatory"] },
];

/** Each question shows this long before the next (James: "that question rotate"). */
export const ASK_MS = 6000;
/** After a new question fades in, its evidence lights one card at a time, then its output opens. */
export const LEAD_MS = 500;
export const STEP_MS = 380;

const LABEL = "text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted";
const SOURCE = "text-[11px] leading-snug text-ink-muted";
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const NUM = "[font-variant-numeric:tabular-nums]";

/** A small tag for what the page describes rather than shows: one per card at most. */
export function CapabilityTag() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-[3px] border border-dashed border-ink-muted/60 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted" data-capability="">
      Capability
    </span>
  );
}

/* ---------- the evidence cards: one figure, one caption, one small chart ---------- */

export interface CardFigure {
  metric: ReactNode | null;
  caption: string;
  /** Where the figure comes from, for screen readers and the tooltip; the strip and details show it too. */
  source: string | null;
  chart: ReactNode | null;
  /** Changes when the figure changes, so it fades in anew. */
  key: string;
}

function Bars({ values, highlight, label, kind }: { values: number[]; highlight: number; label: string; kind: string }) {
  const top = Math.max(...values, 0) || 1;
  return (
    <div className="flex h-8 items-end gap-[3px]" role="img" aria-label={label} data-evidence-chart={kind}>
      {values.map((v, i) => (
        <span key={i} className={`flex-1 rounded-t-[3px] ${i === highlight ? "bg-ink" : "bg-ink/20"}`} style={{ height: `${Math.max(8, (v / top) * 100)}%` }} />
      ))}
    </div>
  );
}

/** The bank's fee (ink) over the median it is set against (slate), on one scale. */
function PairBars({ own, other, label }: { own: number; other: number; label: string }) {
  const top = Math.max(own, other, 0) || 1;
  return (
    <div className="flex h-8 flex-col justify-end gap-[5px]" role="img" aria-label={label} data-evidence-chart="fee">
      <span className="block h-2.5 rounded-r-[3px] bg-ink" style={{ width: `${Math.max(4, (own / top) * 100)}%` }} />
      <span className="block h-2.5 rounded-r-[3px] bg-ink/25" style={{ width: `${Math.max(4, (other / top) * 100)}%` }} />
    </div>
  );
}

function vs(a: string, b: string): ReactNode {
  return (
    <>
      {a} <span className="text-[0.6em] font-medium text-ink-muted">vs.</span> {b}
    </>
  );
}

/** "a $25" but "an $8", "an $18", "an $11,000": the article a dollar figure takes when read aloud. */
export function a(label: string): string {
  const whole = label.replace(/[^0-9.]/g, "").split(".")[0];
  const an = /^8/.test(whole) || /^1[18]$/.test(whole) || (whole.length % 3 === 2 && /^1[18]/.test(whole));
  return `${an ? "an" : "a"} ${label}`;
}

function amountOf(label: string): number {
  return Number(label.replace(/[^0-9.]/g, "")) || 0;
}

/** One card's figure, caption and chart, from the live sample only; without it, the caption alone. */
export function cardFigure(k: EvidenceKey, view: OneQuestionView | null, fee: OneQuestionFee | null): CardFigure {
  const empty = (caption: string): CardFigure => ({ metric: null, caption, source: null, chart: null, key: "empty" });
  const detail = EVIDENCE.find((e) => e.key === k)!.detail;
  if (k === "regulatory") {
    return { metric: "Evidence", caption: "Rules and consumer complaints", source: null, chart: <CapabilityTag />, key: "regulatory" };
  }
  if (!view) return empty(detail);
  if (k === "financial") {
    const income = view.income;
    if (!income) return empty(detail);
    return {
      metric: income.latestCompact,
      caption: `Deposit service charges · ${income.latestQuarter}`,
      source: `${income.filing}, ${income.latestQuarter}: ${income.latestLabel}`,
      chart: (
        <Bars
          values={income.quarters.map((q) => q.thousands)}
          highlight={income.quarters.length - 1}
          kind="income"
          label={`Deposit service charges by quarter: ${income.quarters.map((q) => `${q.label} ${q.valueLabel}`).join(", ")}`}
        />
      ),
      key: `income:${income.latestQuarter}`,
    };
  }
  if (k === "competitive") {
    if (!fee) return empty(detail);
    const read = `Published fee schedules${fee.readOn ? `, read ${fee.readOn}` : ""}`;
    if (fee.local) {
      return {
        metric: vs(fee.amountLabel, fee.local.medianLabel),
        caption: `Our ${fee.short} fee vs. local median`,
        source: read,
        chart: <PairBars own={amountOf(fee.amountLabel)} other={amountOf(fee.local.medianLabel)} label={`${fee.label}: ${view.institution} ${fee.amountLabel}, local median ${fee.local.medianLabel}`} />,
        key: `fee:${fee.key}`,
      };
    }
    if (fee.sizePeers) {
      return {
        metric: vs(fee.amountLabel, fee.sizePeers.medianLabel),
        caption: `Our ${fee.short} fee vs. ${view.peerNoun} our size`,
        source: `${read}. ${fee.sizePeers.groupLabel}.`,
        chart: (
          <PairBars
            own={amountOf(fee.amountLabel)}
            other={amountOf(fee.sizePeers.medianLabel)}
            label={`${fee.label}: ${view.institution} ${fee.amountLabel}, median for ${view.peerNoun} its size ${fee.sizePeers.medianLabel}`}
          />
        ),
        key: `fee:${fee.key}`,
      };
    }
    return { metric: fee.amountLabel, caption: `Our ${fee.short} fee`, source: read, chart: null, key: `fee:${fee.key}` };
  }
  const market = view.market;
  if (!market) return empty(detail);
  const source = `FDIC Summary of Deposits, ${market.sodYear}`;
  if (market.depositShare !== null && market.shareLabel) {
    const share = market.depositShare;
    return {
      metric: market.shareLabel,
      caption: "Local bank deposit share",
      source,
      chart: (
        <div className="flex h-8 items-end" role="img" aria-label={`${view.institution} holds ${market.shareLabel} of bank deposits in its counties`} data-evidence-chart="market">
          <div className="flex h-2.5 w-full gap-[2px]">
            <span className="rounded-l-[3px] bg-ink" style={{ width: `${Math.max(2, Math.min(100, share))}%` }} />
            <span className="flex-1 rounded-r-[3px] bg-ink/20" />
          </div>
        </div>
      ),
      key: "market",
    };
  }
  return { metric: String(market.branches), caption: market.branches === 1 ? "Branch in our counties" : "Branches in our counties", source, chart: null, key: "market" };
}

/* ---------- connectors: the question fans out to the four cards, the cards meet at Hamilton ---------- */

const LINE_H = 48;
/** The card grid's gap (gap-3), so each line lands on its card's middle. */
const GRID_GAP = 12;

/**
 * Lines from the question to each card (`out`) or from each card to Hamilton (`in`). The SVG is
 * measured, so its curves and the dot that runs along a newly lit line keep their shape at any
 * width; before it is measured (and on the server) it stretches a 100-unit box instead. Decoration only.
 */
function Connectors({ dir, lit, run }: { dir: "out" | "in"; lit: boolean[]; run: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width || null));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const w = width ?? 100;
  const h = width ? LINE_H : 100;
  const gap = width ? GRID_GAP : 0;
  const col = (w - gap * 3) / 4;
  const paths = [0, 1, 2, 3].map((i) => {
    const x = i * (col + gap) + col / 2;
    const mid = w / 2;
    return dir === "out" ? `M${mid},0 C${mid},${h * 0.55} ${x},${h * 0.45} ${x},${h}` : `M${x},0 C${x},${h * 0.55} ${mid},${h * 0.45} ${mid},${h}`;
  });
  return (
    <div ref={box} className="hidden h-12 w-full lg:block" aria-hidden="true">
      <svg className="fi-home-evidence-lines block h-full w-full overflow-visible" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="var(--color-ink)"
            strokeOpacity={lit[i] ? 0.7 : 0.16}
            strokeWidth={lit[i] ? 1.5 : 1}
            vectorEffect="non-scaling-stroke"
            className="transition-[stroke-opacity] duration-500 motion-reduce:transition-none"
          />
        ))}
        {width && run
          ? paths.map((d, i) => (lit[i] ? <circle key={`${run}-${i}`} r={3} fill="var(--color-ink)" className="fi-oq-dot" style={{ offsetPath: `path('${d}')` }} /> : null))
          : null}
      </svg>
    </div>
  );
}

/** Below lg the flow runs straight down the page. */
function Stem() {
  return <span aria-hidden="true" className="mx-auto block h-6 w-px bg-ink/25 lg:hidden" />;
}

/* ---------- the four outputs: a short preview, the full output behind Show detail ---------- */

function Preview({ heading, children, visual }: { heading: string; children: ReactNode; visual?: ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:items-center md:gap-8">
      <div className="min-w-0">
        <h3 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[24px]">{heading}</h3>
        <div className="mt-2 text-[15px] leading-relaxed text-ink-soft">{children}</div>
      </div>
      {visual ? <div className="min-w-0">{visual}</div> : null}
    </div>
  );
}

function Detail({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-5 border-t border-border pt-2" data-detail="">
      <summary className={`inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[4px] px-1 text-[14px] font-medium text-ink [&::-webkit-details-marker]:hidden ${FOCUS}`}>
        <span aria-hidden="true" className="inline-block transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none">
          ›
        </span>
        <span className="group-open:hidden">Show detail</span>
        <span className="hidden group-open:inline">Hide detail</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function NoSample() {
  return <p className="text-[14px] text-ink-muted">The live sample&rsquo;s figures are not available right now.</p>;
}

function FeeChart({ fee }: { fee: OneQuestionFee }) {
  const top = Math.max(...fee.bars.map((b) => b.amount), 0) || 1;
  return (
    <table className="w-full border-collapse text-[12px]" data-benchmark-chart="">
      <caption className="sr-only">{fee.label}, in dollars</caption>
      <tbody>
        {fee.bars.map((b) => (
          <tr key={`${b.kind}-${b.label}`} data-bar-kind={b.kind}>
            <th scope="row" className={`w-[42%] py-1 pr-3 text-left align-middle font-normal leading-tight ${b.kind === "subject" ? "font-semibold text-ink" : "text-ink-soft"}`}>
              {b.label}
            </th>
            <td className="py-1 align-middle">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`block h-3 rounded-r-[4px] ${b.kind === "subject" ? "bg-ink" : b.kind === "median" ? "bg-ink/45" : "bg-ink/20"}`}
                  style={{ width: `${Math.max(3, (b.amount / top) * 82)}%` }}
                />
                <span className={`shrink-0 ${NUM} ${b.kind === "subject" ? "font-semibold text-ink" : "text-ink-soft"}`}>{b.amountLabel}</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FinancialList({ view }: { view: OneQuestionView }) {
  const income = view.income;
  if (!income) return <p className="text-[13px] text-ink-muted">Call Report figures are not available right now.</p>;
  const rows: { line: string; value: string }[] = [{ line: `Deposit service charges, ${income.latestQuarter}`, value: income.latestLabel }];
  if (income.sizeMedian) rows.push({ line: `Median for its size (${income.sizeMedian.tierLabel})`, value: income.sizeMedian.valueLabel });
  if (income.share) rows.push({ line: `Share of revenue, own / median for ${view.peerNoun} its size`, value: `${income.share.own} / ${income.share.median}` });
  return (
    <>
      <dl className="text-[12px]">
        {rows.map((r) => (
          <div key={r.line} className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
            <dt className="min-w-0 text-ink-soft">{r.line}</dt>
            <dd className={`shrink-0 font-semibold ${NUM} text-ink`}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className={`mt-1 ${SOURCE}`}>
        Source: {income.filing}, {income.latestQuarter}
      </p>
    </>
  );
}

/** The sentence Benchmark leads with: the fee, then the medians the reads hold. */
export function benchmarkSentence(fee: OneQuestionFee): string {
  const parts: string[] = [];
  if (fee.local) parts.push(`${a(fee.local.medianLabel)} local median`);
  if (fee.sizePeers) parts.push(`${a(fee.sizePeers.medianLabel)} asset-size peer median`);
  const base = `Our ${fee.name} fee is ${fee.amountLabel}`;
  return parts.length ? `${base}, compared with ${parts.join(" and ")}.` : `${base}. Too few local competitors publish it for a local median.`;
}

/** The bank's fee and the medians, without the named competitors (those are in the detail). */
function MiniCompare({ fee }: { fee: OneQuestionFee }) {
  const rows = fee.bars.filter((b) => b.kind !== "competitor");
  const top = Math.max(...rows.map((b) => b.amount), 0) || 1;
  return (
    <dl className="space-y-2 text-[12px]" data-mini-compare="">
      {rows.map((b) => (
        <div key={b.label} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3rem] items-center gap-3">
          <dt className={`min-w-0 leading-tight ${b.kind === "subject" ? "font-semibold text-ink" : "text-ink-soft"}`}>{b.label}</dt>
          <span aria-hidden="true" className={`block h-2.5 rounded-r-[3px] ${b.kind === "subject" ? "bg-ink" : "bg-ink/30"}`} style={{ width: `${Math.max(4, (b.amount / top) * 100)}%` }} />
          <dd className={`text-right ${NUM} ${b.kind === "subject" ? "font-semibold text-ink" : "text-ink-soft"}`}>{b.amountLabel}</dd>
        </div>
      ))}
    </dl>
  );
}

function BenchmarkPanel({ view, fee }: { view: OneQuestionView | null; fee: OneQuestionFee | null }) {
  if (!view || !fee) {
    return (
      <Preview heading={OUTPUTS[0].heading}>
        <NoSample />
      </Preview>
    );
  }
  return (
    <>
      <Preview heading={OUTPUTS[0].heading} visual={<MiniCompare fee={fee} />}>
        <p data-benchmark-sentence="">{benchmarkSentence(fee)}</p>
      </Preview>
      <Detail>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">{fee.label} in its market</p>
            <div className="mt-2">
              <FeeChart fee={fee} />
            </div>
            <p className={`mt-3 ${SOURCE}`}>
              Published fee schedules{fee.competitorReadRange ? `, competitors read ${fee.competitorReadRange}` : ""}
              {fee.readOn ? `; ${view.institution} read ${fee.readOn}` : ""}
              {fee.sizePeers ? `. Size peers: ${fee.sizePeers.groupLabel}, ${fee.sizePeers.count.toLocaleString("en-US")} publish it.` : "."}
            </p>
            {fee.local ? (
              <p className={`mt-1 ${SOURCE}`} data-coverage="">
                Coverage: {fee.local.competitors} local competitors publish this fee; middle half {fee.local.rangeLabel}
              </p>
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">Financial performance</p>
            <div className="mt-2">
              <FinancialList view={view} />
            </div>
          </div>
        </div>
      </Detail>
    </>
  );
}

function interpretation(fee: OneQuestionFee): string {
  const p = fee.local?.position;
  if (p === "above_market") return "Most nearby competitors that publish this fee charge less, so it is the first price to examine.";
  if (p === "below_market") return "It already prices below most of the market, so a change would close a gap rather than open one.";
  if (p === "in_market") return "It sits with most of the market, so price alone does not set it apart.";
  if (p === "free") return "It costs nothing here, so any change starts from zero.";
  return "With too few local figures, the comparison leans on institutions its size.";
}

/**
 * The words the Investigate and Report outputs use for a fee: wires when the question is about a
 * wire (or no fee is known), the fee's own name otherwise.
 */
export function feeWords(fee: Pick<OneQuestionFee, "key" | "name"> | null) {
  if (!fee || fee.key.startsWith("wire_")) {
    return {
      fees: "wire fees",
      volume: "Wire volume",
      use: "send wires",
      counts: "wire counts",
      compare: "Compare how the named competitors bundle wires into business accounts.",
    };
  }
  const name = fee.name;
  return {
    fees: `${name} fees`,
    volume: `How often the ${name} fee is charged`,
    use: "pay it",
    counts: `${name} counts`,
    compare: `Compare how the named competitors price and waive the ${name} fee.`,
  };
}

function InvestigatePanel({ view, fee }: { view: OneQuestionView | null; fee: OneQuestionFee | null }) {
  const heading = OUTPUTS[1].heading;
  if (!view || !fee) {
    return (
      <Preview heading={heading}>
        <NoSample />
      </Preview>
    );
  }
  const local = fee.local;
  const words = feeWords(fee);
  return (
    <>
      <Preview heading={heading}>
        <p data-kind="observation">
          Our {fee.name} fee is <b className={`font-semibold text-ink ${NUM}`}>{fee.amountLabel}</b>
          {local ? (
            <>
              {" "}
              against {a(local.medianLabel).split(" ")[0]} <span className={NUM}>{local.medianLabel}</span> local median
              {local.chargingLess !== null ? `; ${local.chargingLess} of ${local.competitors} local competitors that publish it charge less` : ""}.
            </>
          ) : (
            "."
          )}{" "}
          <span data-kind="interpretation">{interpretation(fee)}</span>
        </p>
      </Preview>
      <Detail>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="min-w-0" data-kind="context">
            <p className="text-[13px] font-semibold text-ink">Context</p>
            <ul className="mt-2 space-y-1.5 text-[12px] leading-snug text-ink-soft">
              {view.income ? (
                <li>
                  {view.income.latestLabel} in deposit service charges, {view.income.latestQuarter}
                  {view.income.sizeMedian ? `, against ${a(view.income.sizeMedian.valueLabel)} median for its size` : ""} ({view.income.filing})
                </li>
              ) : null}
              {fee.sizePeers ? (
                <li>
                  {fee.sizePeers.medianLabel} median for {view.peerNoun} its size ({fee.sizePeers.count.toLocaleString("en-US")} publish it)
                </li>
              ) : null}
              {view.market?.shareLabel ? (
                <li>
                  {view.market.shareLabel} of bank deposits across its {view.market.counties} {view.market.counties === 1 ? "county" : "counties"} (FDIC Summary of Deposits, {view.market.sodYear})
                </li>
              ) : null}
              <li>Published fee schedules{fee.competitorReadRange ? `, read ${fee.competitorReadRange}` : ""}</li>
            </ul>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">Missing for a decision</p>
            <ul className="mt-2 space-y-1.5 text-[12px] leading-snug text-ink-soft">
              <li>{words.volume} and the income it earns. Public filings do not break it out.</li>
              <li>Which customers {words.use}: business or consumer.</li>
              <li>Waivers and relationship pricing in practice.</li>
            </ul>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">Next steps</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[12px] leading-snug text-ink-soft">
              <li>Pull {words.counts} and waivers from your core system.</li>
              <li>{words.compare}</li>
              <li>Take the finding and its sources to the pricing committee.</li>
            </ol>
          </div>
        </div>
      </Detail>
    </>
  );
}

/** What Monitor would track: a description of the capability, never a list of events. */
export const WATCH: { icon: LucideIcon; title: string; line: string }[] = [
  { icon: Landmark, title: "Competitor fee schedules", line: "A local competitor publishes a new price" },
  { icon: BarChart3, title: "Call Reports", line: "Each quarter’s fee income, beside institutions your size" },
  { icon: MapPin, title: "Market data", line: "New branch and deposit figures for your counties" },
  { icon: Scale, title: "Rules and complaints", line: "A rule, action or complaint trend that touches your fees" },
];

function MonitorPanel({ view }: { view: OneQuestionView | null }) {
  const income = view?.income ?? null;
  const change = income?.change ?? null;
  const watch = (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label="What Hamilton will watch">
      {WATCH.map((w) => (
        <li key={w.title} className="flex items-start gap-3 rounded-[6px] border border-border px-3 py-2.5" data-watch="">
          <w.icon aria-hidden="true" strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-ink" />
          <span className="min-w-0">
            <b className="block text-[13px] font-semibold text-ink">{w.title}</b>
            <span className="block text-[12px] leading-snug text-ink-soft">{w.line}</span>
          </span>
        </li>
      ))}
    </ul>
  );
  if (!income || !change) {
    return (
      <>
        <Preview heading="What Hamilton will watch">
          <p>Competitor fee schedules, Call Reports, market data and fee rules, for the changes that touch your fees.</p>
        </Preview>
        <div className="mt-5">{watch}</div>
      </>
    );
  }
  const verb = change.direction === "up" ? "rose" : change.direction === "down" ? "fell" : "held steady";
  return (
    <>
      <Preview
        heading={OUTPUTS[2].heading}
        visual={
          <div className="max-w-[22rem]" role="img" aria-label={`Deposit service charges by quarter: ${income.quarters.map((q) => `${q.label} ${q.valueLabel}`).join(", ")}`} data-evidence-chart="monitor">
            <div className="flex h-14 items-end gap-2" aria-hidden="true">
              {income.quarters.map((q, i) => {
                const top = Math.max(...income.quarters.map((x) => x.thousands), 0) || 1;
                return <span key={q.label} className={`flex-1 rounded-t-[3px] ${i === income.quarters.length - 1 ? "bg-ink" : "bg-ink/20"}`} style={{ height: `${Math.max(8, (q.thousands / top) * 100)}%` }} />;
              })}
            </div>
            <div className="mt-1.5 flex gap-2 text-[11px] text-ink-muted" aria-hidden="true">
              {income.quarters.map((q) => (
                <span key={q.label} className={`flex-1 text-center ${NUM}`}>
                  {q.label}
                </span>
              ))}
            </div>
          </div>
        }
      >
        <p data-monitor-change="">
          Deposit service charges {verb}
          {change.direction === "flat" ? "" : ` ${change.pctLabel}`} from {change.from} to {change.to}, from <span className={NUM}>{change.fromLabel}</span> to{" "}
          <span className={NUM}>{change.toLabel}</span>.
        </p>
        <p className={`mt-1 ${SOURCE}`}>
          Source: {income.filing}, {change.from} and {change.to}
        </p>
      </Preview>
      <Detail>
        <p className="mb-2 text-[13px] font-semibold text-ink">What Hamilton will watch</p>
        {watch}
      </Detail>
    </>
  );
}

function ReportPanel({ view, fee, sampleHref }: { view: OneQuestionView | null; fee: OneQuestionFee | null; sampleHref: string | null }) {
  const income = view?.income ?? null;
  const sections: { title: string; body: ReactNode }[] =
    view && fee
      ? [
          {
            title: "Executive summary",
            body: (
              <>
                {view.institution} charges {fee.amountLabel} for its {fee.name} fee
                {fee.local ? `, against ${a(fee.local.medianLabel)} local median` : ""}.
              </>
            ),
          },
          {
            title: "Current financial position",
            body: income ? (
              <>
                {income.latestLabel} in deposit service charges, {income.latestQuarter}
                {income.share ? `; ${income.share.own} of revenue against ${income.share.median} for ${view.peerNoun} its size` : ""}.
              </>
            ) : (
              "Call Report figures are not available right now."
            ),
          },
          {
            title: "Competitive findings",
            body: fee.local ? (
              <>
                {fee.local.chargingLess !== null ? `${fee.local.chargingLess} of ${fee.local.competitors} local competitors that publish it charge less. ` : ""}
                Local middle half: {fee.local.rangeLabel}.
              </>
            ) : (
              "Too few local competitors publish it for a local median."
            ),
          },
          {
            title: "Decision considerations",
            body: `What a change is worth depends on ${feeWords(fee).volume.toLowerCase()}, customer mix and waivers, which come from your own systems.`,
          },
          {
            title: "Evidence and sources",
            body: [
              `Published fee schedules${fee.competitorReadRange ? `, read ${fee.competitorReadRange}` : ""}`,
              income ? `${income.filing}, ${income.latestQuarter}` : null,
              view.market ? `FDIC Summary of Deposits, ${view.market.sodYear}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          },
        ]
      : [];
  return (
    <>
      <Preview heading={OUTPUTS[3].heading}>
        {view && fee ? (
          <p>
            A pricing committee brief on {feeWords(fee).fees}: summary, financial position, competitive findings and sources.
            {sampleHref ? (
              <>
                {" "}
                <TrackLink
                  event="sample_report_click"
                  eventProps={{ placement: "home_research_report" }}
                  href={sampleHref}
                  className={`font-medium text-ink underline decoration-ink-muted/50 underline-offset-4 hover:decoration-ink ${FOCUS}`}
                >
                  Open the sample report
                </TrackLink>
              </>
            ) : null}
          </p>
        ) : (
          <NoSample />
        )}
      </Preview>
      {view && fee ? (
        <Detail>
          <article className="rounded-[6px] border border-border bg-surface-0" aria-label="Pricing committee brief" data-report-brief="">
            <header className="border-b border-border px-4 py-3">
              <p className={LABEL}>Pricing committee brief</p>
              <p className="mt-1 text-[15px] font-semibold leading-tight text-ink">
                {view.institution}
                <span className="font-normal text-ink-soft"> · {fee.label}</span>
              </p>
            </header>
            <ol className="divide-y divide-border">
              {sections.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 px-4 py-2.5">
                  <span aria-hidden="true" className={`text-[12px] font-semibold ${NUM} text-ink-muted`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-ink">{s.title}</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </article>
        </Detail>
      ) : null}
    </>
  );
}

/* ---------- the flow ---------- */

const DEFAULT_QUESTION = "Should we change our outgoing wire fees?";

/**
 * One question, the four kinds of evidence, Hamilton, then four outputs in tabs (James's brief and
 * his Oct 19 review). The question rotates (James: "I'd like to see that question rotate ... we
 * highlight different things"): every ASK_MS a new real question fades in, the evidence cards it
 * draws on light one at a time with a dot running down each line, then its output tab opens. The
 * rotation holds on hover or focus, off screen, in a hidden tab and when paused, and never runs
 * with reduced motion (the dots still switch questions). Picking a question or a tab stops it.
 * With one question there is nothing to rotate, so no controls show. The server renders the first
 * question lit and its tab open. Tabs follow the WAI-ARIA tabs pattern.
 */
export function OneQuestionFlow({ view, sampleHref }: { view: OneQuestionView | null; sampleHref: string | null }) {
  const asks: OneQuestionAsk[] = view?.asks ?? [];
  const rotating = asks.length > 1;
  const root = useRef<HTMLDivElement>(null);
  const clock = useAutoAdvance({ count: Math.max(1, asks.length), duration: ASK_MS, rootRef: root, threshold: 0.3 });
  const reduced = useReducedMotion();
  const [tab, setTab] = useState(() => Math.max(0, OUTPUTS.findIndex((o) => o.key === (asks[0]?.output ?? "benchmark"))));
  /** While a question's evidence lights in turn, how many of its cards are lit; null once settled. */
  const [step, setStep] = useState<number | null>(null);
  /** Names the current run of dots, so each run starts afresh. */
  const [run, setRun] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const timers = useRef<number[]>([]);
  const shown = useRef(clock.index);
  const runs = useRef(0);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current.length = 0;
  };

  /** Lights a question's evidence one card at a time, then opens its output. */
  const sequence = (i: number) => {
    const ask = asks[i];
    if (!ask) return;
    clear();
    runs.current += 1;
    const id = `${ask.key}:${runs.current}`;
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    at(0, () => {
      setStep(0);
      setRun(id);
    });
    ask.evidence.forEach((_, n) => at(LEAD_MS + n * STEP_MS, () => setStep(n + 1)));
    at(LEAD_MS + ask.evidence.length * STEP_MS, () => {
      setStep(null);
      setTab(OUTPUTS.findIndex((o) => o.key === ask.output));
    });
  };

  // The first question's sequence runs once, when the section first comes into view.
  useEffect(() => {
    const el = root.current;
    if (reduced || !el || typeof IntersectionObserver === "undefined" || asks.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        if (shown.current === 0 && runs.current === 0) sequence(0);
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, asks.length]);

  // The clock moved on by itself: run the new question's sequence. A visitor's pick settles at once (pick()).
  useEffect(() => {
    if (shown.current === clock.index) return;
    shown.current = clock.index;
    if (!clock.manual && !reduced) sequence(clock.index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.index, clock.manual]);

  useEffect(() => () => clear(), []);

  /** Stops the rotation; the play button resumes it. */
  const stop = () => {
    if (rotating && !clock.paused && !clock.reduced) clock.togglePause();
  };

  /** A visitor's pick: that question, settled at once, with its output open. */
  const pick = (i: number, tabIndex?: number) => {
    clear();
    setStep(null);
    setRun(null);
    const ask = asks[i];
    setTab(tabIndex ?? (ask ? OUTPUTS.findIndex((o) => o.key === ask.output) : tab));
    if (rotating && i !== clock.index) {
      shown.current = i;
      clock.go(i);
    }
    stop();
  };

  const selectTab = (i: number, focus = false) => {
    const askAt = asks.findIndex((a) => a.output === OUTPUTS[i].key);
    if (askAt >= 0) pick(askAt, i);
    else {
      clear();
      setStep(null);
      setRun(null);
      setTab(i);
      stop();
    }
    if (focus) tabs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = OUTPUTS.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (tab + 1) % OUTPUTS.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (tab - 1 + OUTPUTS.length) % OUTPUTS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    selectTab(next, true);
  };

  const ask = asks[clock.index] ?? null;
  const tabAsk = asks.find((a) => a.output === OUTPUTS[tab].key) ?? null;
  const litKeys = step !== null && ask ? ask.evidence.slice(0, step) : (tabAsk ?? ask)?.evidence ?? OUTPUTS[tab].evidence;
  const lit = new Set<EvidenceKey>(litKeys);
  const litFlags = EVIDENCE.map((e) => lit.has(e.key));
  const cardFee = ask?.fee ?? view?.fee ?? null;
  const panelFee = (key: OutputKey) => asks.find((a) => a.output === key)?.fee ?? view?.fee ?? null;
  const dotsRun = reduced ? null : run;

  return (
    <div ref={root} data-one-question="">
      {/* A. The question */}
      <div className="mx-auto max-w-[36rem] rounded-[8px] border border-border bg-surface-0 px-4 py-3.5 shadow-[3px_3px_0_rgb(9_39_71/0.03)] sm:px-5 sm:py-4" data-question-card="">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <p className={`${LABEL} flex items-center gap-2`}>
            <MessageSquareText aria-hidden="true" strokeWidth={1.5} className="size-4 text-ink" />
            Your question
          </p>
          {rotating ? (
            <div className="flex items-center gap-1" data-question-controls="">
              <div role="group" aria-label="Questions" className="flex items-center">
                {asks.map((a, i) => {
                  const on = i === clock.index;
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => pick(i)}
                      aria-pressed={on}
                      aria-label={`Question ${i + 1} of ${asks.length}: ${a.question}`}
                      className={`inline-flex size-6 items-center justify-center rounded-full ${FOCUS}`}
                      data-question-dot={a.key}
                    >
                      <span aria-hidden="true" className={`block h-2 rounded-full transition-all duration-300 motion-reduce:transition-none ${on ? "w-4 bg-ink" : "w-2 bg-ink/25"}`} />
                    </button>
                  );
                })}
              </div>
              {clock.reduced ? null : (
                <button
                  type="button"
                  onClick={clock.togglePause}
                  aria-label="Pause question rotation"
                  aria-pressed={clock.paused}
                  title={clock.paused ? "Play" : "Pause"}
                  className={`ml-1 inline-flex size-7 items-center justify-center rounded-full border border-control-border text-ink hover:bg-paper ${FOCUS}`}
                  data-question-pause=""
                >
                  {clock.paused ? <Play aria-hidden="true" className="size-3" /> : <Pause aria-hidden="true" className="size-3" />}
                </button>
              )}
            </div>
          ) : null}
        </div>
        <p
          key={ask?.key ?? "question"}
          className="fi-home-fade mt-2 min-h-[3.3rem] text-[18px] font-medium leading-snug text-ink sm:min-h-[3.6rem] sm:text-[21px]"
          style={{ fontFamily: "var(--fi-home-serif, Georgia), Georgia, serif" }}
          aria-live={clock.manual ? "polite" : "off"}
          data-question-text=""
        >
          &ldquo;{ask?.question ?? view?.question ?? DEFAULT_QUESTION}&rdquo;
        </p>
      </div>

      <Connectors dir="out" lit={litFlags} run={dotsRun} />
      <Stem />

      {/* B. Four evidence layers */}
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Evidence Hamilton reads">
        {EVIDENCE.map((e, i) => {
          const on = litFlags[i];
          const fig = cardFigure(e.key, view, cardFee);
          return (
            <li
              key={e.key}
              className={`flex min-w-0 flex-col rounded-[6px] border bg-surface-0 p-3 transition-[border-color,box-shadow] duration-500 motion-reduce:transition-none sm:p-4 ${
                on ? "border-ink/45 shadow-[0_1px_0_rgb(9_39_71/0.04),0_8px_20px_-16px_rgb(9_39_71/0.45)]" : "border-border"
              }`}
              data-evidence={e.key}
              data-lit={on ? "true" : "false"}
              title={fig.source ?? undefined}
            >
              <p className="flex items-center gap-2 text-[13px] font-semibold leading-tight text-ink sm:text-[14px]">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-[5px] transition-colors duration-500 motion-reduce:transition-none ${on ? "bg-ink text-on-ink" : "bg-ink/[0.06] text-ink"}`}
                >
                  <e.icon aria-hidden="true" strokeWidth={1.5} className="size-4" />
                </span>
                <span className="min-w-0">{e.name}</span>
              </p>
              <div className={`mt-3 transition-opacity duration-500 motion-reduce:transition-none ${on ? "opacity-100" : "opacity-55"}`}>
                {fig.metric !== null ? (
                  <p key={fig.key} className={`fi-home-fade text-[24px] font-semibold leading-none tracking-[-0.02em] text-ink sm:text-[30px] ${NUM}`} data-evidence-metric="">
                    {fig.metric}
                  </p>
                ) : null}
                <p className="mt-1.5 text-[12px] leading-snug text-ink-soft" data-evidence-caption="">
                  {fig.caption}
                  {fig.source ? <span className="sr-only">. Source: {fig.source}</span> : null}
                </p>
              </div>
              {fig.chart ? <div className={`mt-auto pt-3 transition-opacity duration-500 motion-reduce:transition-none ${on ? "opacity-100" : "opacity-55"}`}>{fig.chart}</div> : null}
            </li>
          );
        })}
      </ul>

      <Connectors dir="in" lit={litFlags} run={dotsRun ? `${dotsRun}:in` : null} />
      <Stem />

      {/* C. Hamilton Intelligence */}
      <div className="mx-auto max-w-[40rem] rounded-[8px] bg-[#102d43] px-5 py-4 text-center text-white" data-evidence-hub="">
        <p className="flex items-center justify-center gap-2 text-[17px] font-semibold tracking-[-0.01em]">
          <Waypoints aria-hidden="true" strokeWidth={1.5} className="size-5" />
          Hamilton Intelligence
        </p>
        <p className="mx-auto mt-1 max-w-[32rem] text-[14px] leading-snug text-white/80">
          Connects the evidence, identifies what matters, and helps your team evaluate the next decision.
        </p>
      </div>

      <span aria-hidden="true" className="mx-auto block h-8 w-px bg-ink/25" />

      {/* D. Four outputs */}
      <div className="overflow-hidden rounded-[8px] border border-border bg-surface-0">
        <div role="tablist" aria-label="What Hamilton produces" className="grid grid-cols-2 border-b border-border bg-paper/60 sm:grid-cols-4">
          {OUTPUTS.map((o, i) => {
            const on = i === tab;
            return (
              <button
                key={o.key}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`oq-tab-${o.key}`}
                aria-selected={on}
                aria-controls={`oq-panel-${o.key}`}
                tabIndex={on ? 0 : -1}
                onClick={() => selectTab(i)}
                onKeyDown={onKeyDown}
                className={`relative flex min-h-14 items-center gap-3 px-4 py-3 text-left transition-colors duration-200 motion-reduce:transition-none ${FOCUS} focus-visible:-outline-offset-2 ${
                  on ? "bg-surface-0 text-ink" : "text-ink-soft hover:bg-surface-0/70 hover:text-ink"
                } ${i % 2 === 1 ? "border-l border-border" : ""} ${i > 1 ? "border-t border-border sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""}`}
                data-output={o.key}
              >
                <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-[3px] transition-colors duration-300 motion-reduce:transition-none ${on ? "bg-ink" : "bg-transparent"}`} />
                <o.icon aria-hidden="true" strokeWidth={1.5} className="size-5 shrink-0" />
                <span className="min-w-0">
                  <span className={`block text-[15px] leading-tight ${on ? "font-semibold" : "font-medium"}`}>{o.name}</span>
                  <span className="mt-0.5 hidden text-[12px] leading-tight text-ink-muted md:block">{o.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="fi-home-stack p-4 sm:p-6">
          {OUTPUTS.map((o, i) => {
            const on = i === tab;
            return (
              <div
                key={o.key}
                role="tabpanel"
                id={`oq-panel-${o.key}`}
                aria-labelledby={`oq-tab-${o.key}`}
                tabIndex={on ? 0 : -1}
                inert={!on}
                className={`fi-home-slide min-w-0 rounded-[4px] ${FOCUS}`}
                data-active={on ? "true" : "false"}
                data-panel={o.key}
              >
                {o.key === "benchmark" ? <BenchmarkPanel view={view} fee={panelFee("benchmark")} /> : null}
                {o.key === "investigate" ? <InvestigatePanel view={view} fee={panelFee("investigate")} /> : null}
                {o.key === "monitor" ? <MonitorPanel view={view} /> : null}
                {o.key === "report" ? <ReportPanel view={view} fee={panelFee("report")} sampleHref={sampleHref} /> : null}
              </div>
            );
          })}
        </div>
        <p className="max-w-none border-t border-border bg-paper/40 px-4 py-2.5 text-[12px] text-ink-muted sm:px-6" data-flow-footer="">
          {view ? `${view.institution} sample` : "Sample"} · Based on published evidence or described capability
        </p>
      </div>
    </div>
  );
}
