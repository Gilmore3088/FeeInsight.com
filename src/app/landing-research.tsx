"use client";

import {
  BarChart3,
  Bell,
  FileText,
  Landmark,
  MapPin,
  MessageSquareText,
  Scale,
  Search,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { TrackLink } from "@/components/track-link";
import type { EvidenceKey, OneQuestionFee, OneQuestionView } from "./landing-one-question";
import { useReducedMotion } from "./landing-motion";

/**
 * The four kinds of evidence Hamilton reads for one question (James's brief, Oct 19, §3B). Each
 * card draws its own figures from the live sample (OneQuestionView); without them it shows only
 * what it covers. Regulatory context has no record behind it on the homepage, so its card is
 * marked Illustrative.
 */
export const EVIDENCE: { key: EvidenceKey; icon: LucideIcon; name: string; detail: string }[] = [
  { key: "financial", icon: BarChart3, name: "Financial performance", detail: "Fee income by quarter, from the Call Report, against institutions your size" },
  { key: "competitive", icon: Landmark, name: "Competitive position", detail: "Published fees from local competitors and asset-size peers" },
  { key: "market", icon: MapPin, name: "Market conditions", detail: "Branches and deposits in the counties you serve" },
  { key: "regulatory", icon: Scale, name: "Regulatory context", detail: "Fee rules, enforcement actions and CFPB complaints" },
];

export type OutputKey = "benchmark" | "investigate" | "monitor" | "report";

/** The four outputs (brief §4), each with the evidence it reads, which the flow lights when it is picked. */
export const OUTPUTS: { key: OutputKey; icon: LucideIcon; name: string; detail: string; evidence: EvidenceKey[] }[] = [
  { key: "benchmark", icon: BarChart3, name: "Benchmark", detail: "See how you compare", evidence: ["financial", "competitive"] },
  { key: "investigate", icon: Search, name: "Investigate", detail: "Find what to examine", evidence: ["financial", "competitive", "market"] },
  { key: "monitor", icon: Bell, name: "Monitor", detail: "Track what changes", evidence: ["financial", "competitive", "market", "regulatory"] },
  { key: "report", icon: FileText, name: "Report", detail: "Brief your committee", evidence: ["financial", "competitive", "market", "regulatory"] },
];

/** Each card lights this long after the one before when the section first comes into view. */
const INTRO_STEP_MS = 280;

const LABEL = "text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted";
const SOURCE = "text-[11px] leading-snug text-ink-muted";
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function IllustrativeTag() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-[3px] border border-dashed border-ink-muted/60 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted" data-illustrative="">
      Illustrative
    </span>
  );
}

/* ---------- the evidence cards' small charts, real figures only ---------- */

function IncomeSpark({ view }: { view: OneQuestionView }) {
  const income = view.income;
  if (!income) return null;
  const top = Math.max(...income.quarters.map((q) => q.thousands), 0) || 1;
  return (
    <>
      <div
        className="flex h-11 items-end gap-[2px]"
        role="img"
        aria-label={`Deposit service charges by quarter: ${income.quarters.map((q) => `${q.label} ${q.valueLabel}`).join(", ")}`}
        data-evidence-chart="income"
      >
        {income.quarters.map((q, i) => (
          <span
            key={q.label}
            title={`${q.label}: ${q.valueLabel}`}
            className={`flex-1 rounded-t-[4px] ${i === income.quarters.length - 1 ? "bg-ink" : "bg-ink/25"}`}
            style={{ height: `${Math.max(6, (q.thousands / top) * 100)}%` }}
          />
        ))}
      </div>
      <p className="mt-2 text-[12px] leading-snug text-ink">
        <b className="font-semibold [font-variant-numeric:tabular-nums]">{income.latestLabel}</b> in deposit service charges, {income.latestQuarter}
      </p>
      <p className={SOURCE}>{income.filing}</p>
    </>
  );
}

function FeeSpark({ fee, institution }: { fee: OneQuestionFee; institution: string }) {
  const top = Math.max(...fee.bars.map((b) => b.amount), 0) || 1;
  return (
    <>
      <div className="flex h-11 items-end gap-[2px]" role="img" aria-label={`${fee.label}: ${fee.bars.map((b) => `${b.label} ${b.amountLabel}`).join(", ")}`} data-evidence-chart="fee">
        {fee.bars.map((b) => (
          <span
            key={`${b.kind}-${b.label}`}
            title={`${b.label}: ${b.amountLabel}`}
            className={`flex-1 rounded-t-[4px] ${b.kind === "subject" ? "bg-ink" : b.kind === "median" ? "bg-ink/45" : "bg-ink/20"}`}
            style={{ height: `${Math.max(6, (b.amount / top) * 100)}%` }}
          />
        ))}
      </div>
      <p className="mt-2 text-[12px] leading-snug text-ink">
        <b className="font-semibold [font-variant-numeric:tabular-nums]">{fee.amountLabel}</b> {fee.label.toLowerCase()} at {institution}
        {fee.local ? (
          <>
            , <span className="[font-variant-numeric:tabular-nums]">{fee.local.medianLabel}</span> local median
          </>
        ) : null}
      </p>
      <p className={SOURCE}>Published fee schedules{fee.readOn ? `, read ${fee.readOn}` : ""}</p>
    </>
  );
}

function MarketSpark({ view }: { view: OneQuestionView }) {
  const market = view.market;
  if (!market) return null;
  const share = market.depositShare;
  return (
    <>
      {share !== null ? (
        <div className="flex h-11 items-end" role="img" aria-label={`${view.institution} holds ${market.shareLabel} of bank deposits in its counties`} data-evidence-chart="market">
          <div className="flex h-2.5 w-full gap-[2px]">
            <span className="rounded-l-[4px] bg-ink" style={{ width: `${Math.max(2, share)}%` }} />
            <span className="flex-1 rounded-r-[4px] bg-ink/20" />
          </div>
        </div>
      ) : null}
      <p className="mt-2 text-[12px] leading-snug text-ink">
        <b className="font-semibold [font-variant-numeric:tabular-nums]">{market.branches}</b> {market.branches === 1 ? "branch" : "branches"}
        {market.shareLabel ? (
          <>
            , <b className="font-semibold [font-variant-numeric:tabular-nums]">{market.shareLabel}</b> of bank deposits in its counties
          </>
        ) : null}
      </p>
      <p className={SOURCE}>FDIC Summary of Deposits, {market.sodYear}</p>
    </>
  );
}

function RegulatorySpark() {
  return (
    <>
      <ul className="flex h-11 flex-col justify-end gap-1.5" aria-label="What Hamilton checks">
        {["Fee rules", "Enforcement actions", "CFPB complaints"].map((item) => (
          <li key={item} className="flex items-center gap-2 text-[11px] leading-none text-ink-soft">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-ink-muted/60" />
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-2 text-[12px] leading-snug text-ink">
        <IllustrativeTag />
      </p>
      <p className={SOURCE}>No records shown in this example</p>
    </>
  );
}

function EvidenceFigures({ k, view }: { k: EvidenceKey; view: OneQuestionView | null }) {
  if (k === "regulatory") return <RegulatorySpark />;
  if (!view) return null;
  if (k === "financial") return <IncomeSpark view={view} />;
  if (k === "competitive") return view.fee ? <FeeSpark fee={view.fee} institution={view.institution} /> : null;
  return <MarketSpark view={view} />;
}

/* ---------- connectors: the question fans out to the four cards, the cards meet at Hamilton ---------- */

const COLUMN_X = [12.5, 37.5, 62.5, 87.5];
const FAN_OUT = COLUMN_X.map((x) => `M50,0 C50,55 ${x},45 ${x},100`);
const FAN_IN = COLUMN_X.map((x) => `M${x},0 C${x},55 50,45 50,100`);

function Connectors({ paths, lit }: { paths: string[]; lit: boolean[] }) {
  return (
    <svg className="fi-home-evidence-lines hidden h-12 w-full lg:block" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {paths.map((d, i) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="var(--color-ink)"
          strokeOpacity={lit[i] ? 0.7 : 0.16}
          strokeWidth={lit[i] ? 1.5 : 1}
          vectorEffect="non-scaling-stroke"
          className="transition-[stroke-opacity] duration-500 motion-reduce:transition-none"
        />
      ))}
    </svg>
  );
}

/** Below lg the flow runs straight down the page. */
function Stem() {
  return <span aria-hidden="true" className="mx-auto block h-6 w-px bg-ink/25 lg:hidden" />;
}

/* ---------- the four outputs ---------- */

function PanelHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div>
      <p className={LABEL}>{eyebrow}</p>
      <h3 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[24px]">{title}</h3>
      {children ? <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">{children}</p> : null}
    </div>
  );
}

function NoSample() {
  return <p className="mt-4 text-[14px] text-ink-muted">The live sample&rsquo;s figures are not available right now.</p>;
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
                  title={`${b.label}: ${b.amountLabel}`}
                  className={`block h-3 rounded-r-[4px] ${b.kind === "subject" ? "bg-ink" : b.kind === "median" ? "bg-ink/45" : "bg-ink/20"}`}
                  style={{ width: `${Math.max(3, (b.amount / top) * 82)}%` }}
                />
                <span className={`shrink-0 [font-variant-numeric:tabular-nums] ${b.kind === "subject" ? "font-semibold text-ink" : "text-ink-soft"}`}>{b.amountLabel}</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function positionWords(position: string | null | undefined): string | null {
  if (position === "above_market") return "Above the local middle half";
  if (position === "below_market") return "Below the local middle half";
  if (position === "in_market") return "Inside the local middle half";
  if (position === "free") return "Free here";
  return null;
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
            <dd className="shrink-0 font-semibold [font-variant-numeric:tabular-nums] text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className={`mt-1 ${SOURCE}`}>Source: {income.filing}, {income.latestQuarter}</p>
    </>
  );
}

function BenchmarkPanel({ view }: { view: OneQuestionView | null }) {
  const fee = view?.fee ?? null;
  if (!view || !fee) {
    return (
      <>
        <PanelHead eyebrow="Sample output" title="Competitive fee position">Your fee against named competitors, local and asset-size medians.</PanelHead>
        <NoSample />
      </>
    );
  }
  const local = fee.local;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,0.9fr)]">
      <div>
        <PanelHead eyebrow={`Sample: ${view.institution}${view.place ? `, ${view.place}` : ""}`} title="Competitive fee position">
          {fee.label} against local competitors and {view.peerNoun} its size.
        </PanelHead>
        <ul className="mt-4 space-y-2 text-[13px] leading-snug text-ink">
          {local ? (
            <>
              <li className="border-l-2 border-ink pl-3">
                <b className="font-semibold [font-variant-numeric:tabular-nums]">{fee.amountLabel}</b> against a <span className="[font-variant-numeric:tabular-nums]">{local.medianLabel}</span> local median
                {positionWords(local.position) ? <span className="block text-[12px] text-ink-soft">{positionWords(local.position)} ({local.rangeLabel})</span> : null}
              </li>
              {local.chargingLess !== null ? (
                <li className="border-l-2 border-ink/25 pl-3">
                  {local.chargingLess} of {local.competitors} local competitors that publish it charge less
                </li>
              ) : null}
            </>
          ) : (
            <li className="border-l-2 border-ink pl-3">
              <b className="font-semibold [font-variant-numeric:tabular-nums]">{fee.amountLabel}</b>. Too few local competitors publish it for a local median.
            </li>
          )}
          {fee.sizePeers ? (
            <li className="border-l-2 border-ink/25 pl-3">
              <span className="[font-variant-numeric:tabular-nums]">{fee.sizePeers.medianLabel}</span> median across {fee.sizePeers.count.toLocaleString("en-US")} {view.peerNoun} its size
            </li>
          ) : null}
        </ul>
      </div>
      <div className="min-w-0 rounded-[6px] border border-border bg-surface-0 p-4">
        <p className="text-[13px] font-semibold text-ink">{fee.label} in its market</p>
        <div className="mt-3">
          <FeeChart fee={fee} />
        </div>
        <p className={`mt-3 ${SOURCE}`}>
          Published fee schedules{fee.competitorReadRange ? `, competitors read ${fee.competitorReadRange}` : ""}
          {fee.readOn ? `; ${view.institution} read ${fee.readOn}` : ""}
          {fee.sizePeers ? `. Size peers: ${fee.sizePeers.groupLabel}.` : "."}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink">Financial performance</p>
        <div className="mt-2">
          <FinancialList view={view} />
        </div>
        {local ? (
          <p className={`mt-3 ${SOURCE}`} data-coverage="">
            Coverage: {local.competitors} local competitors publish this fee
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Kind({ children }: { children: string }) {
  return <span className="mr-2 inline-block rounded-[3px] bg-ink/[0.07] px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-soft">{children}</span>;
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
 * The words the Investigate, Monitor and Report outputs use for the question's fee: wires when the
 * question is about a wire (or no fee is known), the fee's own name when the bank publishes no wire.
 */
export function feeWords(fee: Pick<OneQuestionFee, "key" | "label"> | null) {
  if (!fee || fee.key.startsWith("wire_")) {
    return {
      fees: "wire fees",
      volume: "Wire volume",
      use: "send wires",
      counts: "wire counts",
      compare: "Compare how the named competitors bundle wires into business accounts.",
    };
  }
  const name = fee.label.toLowerCase();
  return {
    fees: `${name} fees`,
    volume: `How often the ${name} fee is charged`,
    use: "pay it",
    counts: `${name} counts`,
    compare: `Compare how the named competitors price and waive the ${name} fee.`,
  };
}

function InvestigatePanel({ view }: { view: OneQuestionView | null }) {
  const fee = view?.fee ?? null;
  if (!view || !fee) {
    return (
      <>
        <PanelHead eyebrow="Sample output" title="A finding worth examining">What stands out, why it matters and what is still missing.</PanelHead>
        <NoSample />
      </>
    );
  }
  const local = fee.local;
  const words = feeWords(fee);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <PanelHead eyebrow={`Sample: ${view.institution}`} title="A finding worth examining" />
        <div className="mt-4 space-y-3 text-[13px] leading-snug text-ink">
          <p data-kind="observation">
            <Kind>Observation</Kind>
            {fee.label} is <b className="font-semibold [font-variant-numeric:tabular-nums]">{fee.amountLabel}</b>
            {local ? (
              <>
                {" "}against a <span className="[font-variant-numeric:tabular-nums]">{local.medianLabel}</span> local median
                {local.chargingLess !== null ? `; ${local.chargingLess} of ${local.competitors} local competitors that publish it charge less` : ""}.
              </>
            ) : (
              "."
            )}
          </p>
          <p data-kind="interpretation">
            <Kind>Why it matters</Kind>
            {interpretation(fee)}
          </p>
          <div data-kind="context">
            <Kind>Context</Kind>
            <ul className="mt-1.5 space-y-1 text-[12px] text-ink-soft">
              {view.income ? (
                <li>
                  {view.income.latestLabel} in deposit service charges, {view.income.latestQuarter}
                  {view.income.sizeMedian ? `, against a ${view.income.sizeMedian.valueLabel} median for its size` : ""} ({view.income.filing})
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
            </ul>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <div className="rounded-[6px] border border-border bg-surface-0 p-4">
          <p className="text-[13px] font-semibold text-ink">Missing for a decision</p>
          <ul className="mt-2 space-y-1.5 text-[12px] leading-snug text-ink-soft">
            <li>{words.volume} and the income it earns. Public filings do not break it out.</li>
            <li>Which customers {words.use}: business or consumer.</li>
            <li>Waivers and relationship pricing in practice.</li>
          </ul>
        </div>
        <div className="rounded-[6px] border border-border bg-surface-0 p-4">
          <p className="text-[13px] font-semibold text-ink">Next steps</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[12px] leading-snug text-ink-soft">
            <li>Pull {words.counts} and waivers from your core system.</li>
            <li>{words.compare}</li>
            <li>Take the finding and its sources to the pricing committee.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function MonitorPanel({ view }: { view: OneQuestionView | null }) {
  const change = view?.income?.change ?? null;
  const feeLabel = view?.fee?.label.toLowerCase() ?? "outgoing wire fee";
  const rows: { icon: LucideIcon; title: string; line: string; real: string | null }[] = [
    {
      icon: Landmark,
      title: "Competitor fee changes",
      line: `A local competitor changes its ${feeLabel}`,
      real: null,
    },
    {
      icon: BarChart3,
      title: "Financial performance",
      line: change
        ? `Deposit service charges ${change.direction === "flat" ? "unchanged" : `${change.direction} ${change.pctLabel}`} from ${change.from} to ${change.to}`
        : "Deposit service charges move from one quarter to the next",
      real: change && view?.income ? `${view.income.filing}, ${change.to}` : null,
    },
    { icon: MapPin, title: "Economic developments", line: "New branch, deposit or income data for your counties", real: null },
    { icon: Scale, title: "Regulatory changes", line: `A rule or enforcement action that touches ${feeWords(view?.fee ?? null).fees}`, real: null },
  ];
  return (
    <>
      <PanelHead eyebrow={view ? `Sample: ${view.institution}` : "Sample output"} title="What changed" />
      <ul className="mt-4 divide-y divide-border rounded-[6px] border border-border bg-surface-0">
        {rows.map((r) => (
          <li key={r.title} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4" data-monitor-row="" data-real={r.real ? "true" : "false"}>
            <span className="flex min-w-0 flex-1 items-start gap-3">
              <r.icon aria-hidden="true" strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-ink" />
              <span className="min-w-0">
                <b className="block text-[13px] font-semibold text-ink">{r.title}</b>
                <span className="block text-[13px] leading-snug text-ink-soft">{r.line}</span>
              </span>
            </span>
            {r.real ? <span className={`${SOURCE} sm:text-right`}>Source: {r.real}</span> : <IllustrativeTag />}
          </li>
        ))}
      </ul>
      <p className={`mt-3 ${SOURCE}`}>Illustrative rows show what a tracked change looks like. None is a detected change.</p>
    </>
  );
}

function ReportPanel({ view, sampleHref }: { view: OneQuestionView | null; sampleHref: string | null }) {
  const fee = view?.fee ?? null;
  const income = view?.income ?? null;
  const sections: { title: string; body: ReactNode }[] = view && fee
    ? [
        {
          title: "Executive summary",
          body: (
            <>
              {view.institution} charges {fee.amountLabel} for an {fee.label.toLowerCase()}
              {fee.local ? `, against a ${fee.local.medianLabel} local median` : ""}.
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <article className="rounded-[6px] border border-border bg-surface-0 shadow-[3px_3px_0_rgb(9_39_71/0.04)]" aria-label="Pricing committee brief" data-report-brief="">
        <header className="border-b border-border px-5 py-4">
          <p className={LABEL}>Pricing committee brief</p>
          <p className="mt-1 text-[17px] font-semibold leading-tight text-ink">
            {view ? view.institution : "Your institution"}
            {fee ? <span className="font-normal text-ink-soft"> · {fee.label}</span> : null}
          </p>
        </header>
        {sections.length ? (
          <ol className="divide-y divide-border">
            {sections.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 px-5 py-2.5">
                <span aria-hidden="true" className="text-[12px] font-semibold [font-variant-numeric:tabular-nums] text-ink-muted">{i + 1}</span>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-ink">{s.title}</p>
                  <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="px-5 py-4">
            <NoSample />
          </div>
        )}
      </article>
      <div className="flex flex-col justify-center">
        <PanelHead eyebrow="Report" title="Ready for committee">
          Every fee in the brief traces to the schedule it came from, every income figure to its filing.
        </PanelHead>
        {sampleHref && view ? (
          <p className="mt-4 text-[13px] leading-snug text-ink-soft">
            The full sample is today&rsquo;s live Competitive Fee Position Report for {view.institution}.{" "}
            <TrackLink event="sample_report_click" eventProps={{ placement: "home_research_report" }} href={sampleHref} className={`font-medium text-ink underline decoration-ink-muted/50 underline-offset-4 hover:decoration-ink ${FOCUS}`}>
              Open the sample report
            </TrackLink>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- the flow ---------- */

/**
 * One question, the four kinds of evidence, Hamilton, then four outputs in tabs (James's brief,
 * Oct 19). The motion and highlighting carry over from the evidence flow it replaces: when the
 * section first comes into view the evidence cards light one after another, then the cards the
 * picked output reads stay lit, with their lines drawn strong. Nothing advances on its own; with
 * reduced motion the cards simply show lit. The server renders the first output lit, so the flow is
 * never blank. Tabs follow the WAI-ARIA tabs pattern: arrow keys, Home and End move and select.
 */
export function OneQuestionFlow({ view, sampleHref }: { view: OneQuestionView | null; sampleHref: string | null }) {
  const [active, setActive] = useState(0);
  /** During the entry sequence, how many cards are lit; null once it has run (or never runs). */
  const [intro, setIntro] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const grid = useRef<HTMLUListElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const el = grid.current;
    if (reduced || !el || typeof IntersectionObserver === "undefined") return;
    const pending = timers.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        for (let n = 0; n <= EVIDENCE.length; n++) pending.push(window.setTimeout(() => setIntro(n), n * INTRO_STEP_MS));
        pending.push(window.setTimeout(() => setIntro(null), (EVIDENCE.length + 2) * INTRO_STEP_MS));
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      pending.forEach((t) => window.clearTimeout(t));
      pending.length = 0;
    };
  }, [reduced]);

  const select = (i: number, focus = false) => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current.length = 0;
    setIntro(null);
    setActive(i);
    if (focus) tabs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = OUTPUTS.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (active + 1) % OUTPUTS.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (active - 1 + OUTPUTS.length) % OUTPUTS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    select(next, true);
  };

  const output = OUTPUTS[active];
  const lit = new Set<EvidenceKey>(intro === null ? output.evidence : EVIDENCE.slice(0, intro).map((e) => e.key));
  const litFlags = EVIDENCE.map((e) => lit.has(e.key));

  return (
    <div data-one-question="">
      {/* A. The question */}
      <div className="mx-auto flex max-w-[34rem] items-center gap-4 rounded-[8px] border border-border bg-surface-0 px-5 py-4 shadow-[3px_3px_0_rgb(9_39_71/0.03)]" data-question-card="">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[6px] border border-border text-ink">
          <MessageSquareText aria-hidden="true" strokeWidth={1.5} className="size-5" />
        </span>
        <div className="min-w-0">
          <p className={LABEL}>Your question</p>
          <p className="mt-1 text-[18px] font-medium leading-snug text-ink sm:text-[20px]" style={{ fontFamily: "var(--fi-home-serif, Georgia), Georgia, serif" }}>
            &ldquo;{view?.question ?? "Should we change our outgoing wire fees?"}&rdquo;
          </p>
        </div>
      </div>

      <Connectors paths={FAN_OUT} lit={litFlags} />
      <Stem />

      {/* B. Four evidence layers */}
      <ul ref={grid} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Evidence Hamilton reads">
        {EVIDENCE.map((e, i) => {
          const on = litFlags[i];
          return (
            <li
              key={e.key}
              className={`flex min-w-0 flex-col rounded-[6px] border bg-surface-0 p-4 transition-[border-color,box-shadow] duration-500 motion-reduce:transition-none ${
                on ? "border-ink/45 shadow-[0_1px_0_rgb(9_39_71/0.04),0_8px_20px_-16px_rgb(9_39_71/0.45)]" : "border-border"
              }`}
              data-evidence={e.key}
              data-lit={on ? "true" : "false"}
            >
              <div className="flex items-start gap-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-[6px] transition-colors duration-500 motion-reduce:transition-none ${on ? "bg-ink text-on-ink" : "bg-ink/[0.06] text-ink"}`}>
                  <e.icon aria-hidden="true" strokeWidth={1.5} className="size-[18px]" />
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-tight text-ink">{e.name}</p>
                  <p className="mt-1 text-[12px] leading-snug text-ink-soft">{e.detail}</p>
                </div>
              </div>
              <div className={`mt-auto pt-4 transition-opacity duration-500 motion-reduce:transition-none ${on ? "opacity-100" : "opacity-60"}`}>
                <EvidenceFigures k={e.key} view={view} />
              </div>
            </li>
          );
        })}
      </ul>

      <Connectors paths={FAN_IN} lit={litFlags} />
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
            const on = i === active;
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
                onClick={() => select(i)}
                onKeyDown={onKeyDown}
                className={`relative flex min-h-14 items-center gap-3 px-4 py-3 text-left transition-colors duration-200 motion-reduce:transition-none ${FOCUS} focus-visible:-outline-offset-2 ${
                  on ? "bg-surface-0 text-ink" : "text-ink-soft hover:bg-surface-0/70 hover:text-ink"
                } ${i % 2 === 1 ? "border-l border-border" : ""} ${i > 1 ? "border-t border-border sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""}`}
                data-output={o.key}
              >
                <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-[3px] ${on ? "bg-ink" : "bg-transparent"}`} />
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
            const on = i === active;
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
                {o.key === "benchmark" ? <BenchmarkPanel view={view} /> : null}
                {o.key === "investigate" ? <InvestigatePanel view={view} /> : null}
                {o.key === "monitor" ? <MonitorPanel view={view} /> : null}
                {o.key === "report" ? <ReportPanel view={view} sampleHref={sampleHref} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
