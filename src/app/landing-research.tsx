"use client";

import { Files, Landmark, MapPinned, ScrollText, type LucideIcon } from "lucide-react";
import { useRef } from "react";
import { SlideControls } from "./landing-controls";
import { useAutoAdvance } from "./landing-motion";

type GroupKey = "fees" | "filings" | "markets" | "regulatory";
/** One source, so a report can light exactly the sources it reads. */
export type SourceKey = "schedules" | "callReports" | "sec" | "industry" | "branches" | "income" | "economy" | "rules" | "complaints";

export interface EvidenceGroup {
  key: GroupKey;
  icon: LucideIcon;
  name: string;
  /** Each source in the group: what it is and who publishes it. */
  items: { key: SourceKey; name: string; provider: string }[];
}

/**
 * The evidence Hamilton reads, in the four groups of James's landing critique (Oct 17, §5): the
 * source families accepted on Oct 17, grouped. Only sources whose terms allow commercial use
 * appear (James's licence rule, Oct 17, and the data-sources outline): no FRED, USDA, FINRA,
 * regional Fed text or FDIC national deposit rates. landing.test.tsx checks the names.
 */
export const EVIDENCE_GROUPS: EvidenceGroup[] = [
  {
    key: "fees",
    icon: Files,
    name: "Published fees",
    items: [{ key: "schedules", name: "Fee schedules", provider: "Banks and credit unions" }],
  },
  {
    key: "filings",
    icon: Landmark,
    name: "Financial filings",
    items: [
      { key: "callReports", name: "Call Reports", provider: "FDIC · NCUA" },
      { key: "sec", name: "Public filings", provider: "SEC" },
      { key: "industry", name: "Industry totals", provider: "FDIC" },
    ],
  },
  {
    key: "markets",
    icon: MapPinned,
    name: "Branches and markets",
    items: [
      { key: "branches", name: "Branches and deposits", provider: "FDIC · NCUA" },
      { key: "income", name: "Household income", provider: "Census · IRS" },
      { key: "economy", name: "Economic conditions", provider: "Beige Book · FOMC" },
    ],
  },
  {
    key: "regulatory",
    icon: ScrollText,
    name: "Regulatory sources",
    items: [
      { key: "rules", name: "Rules and actions", provider: "Regulators · States" },
      { key: "complaints", name: "Consumer complaints", provider: "CFPB" },
    ],
  },
];

/**
 * The reports Hamilton writes, each with the sources it reads (James, Oct 18: "a few more report
 * options", "the sources highlighted for each type of report", no question line). The flow lights
 * a report's sources in turn. Descriptions name what each covers and carry no figures. The
 * board, market and peer briefs and the Competitive Fee Position Report are named outputs; the
 * other three are questions Hamilton answers, so they are named by subject, not as reports.
 */
export const EVIDENCE_REPORTS: { key: string; name: string; detail: string; sources: SourceKey[] }[] = [
  {
    key: "board",
    name: "Board brief",
    detail: "Where each fee sits against your market, ready for committee, every figure linked to its source.",
    sources: ["schedules", "callReports", "branches", "rules", "complaints"],
  },
  {
    key: "position",
    name: "Competitive fee position",
    detail: "Every fee against the competitors in your market, fee by fee.",
    sources: ["schedules", "branches"],
  },
  {
    key: "income",
    name: "Fee income against peers",
    detail: "Your service-charge income beside institutions of your size, quarter by quarter.",
    sources: ["schedules", "callReports", "industry"],
  },
  {
    key: "peers",
    name: "Peer brief",
    detail: "Your fees and financials beside banks and credit unions of your size.",
    sources: ["schedules", "callReports", "sec"],
  },
  {
    key: "market",
    name: "Market brief",
    detail: "Who competes in your counties and the household income behind that market.",
    sources: ["schedules", "branches", "income"],
  },
  {
    key: "regional",
    name: "Regional conditions",
    detail: "Fee levels across your region, read against the latest Beige Book and industry totals.",
    sources: ["schedules", "economy", "industry"],
  },
  {
    key: "compliance",
    name: "Rules and complaints",
    detail: "The fee rules, regulator actions and consumer complaints that touch your fees.",
    sources: ["schedules", "rules", "complaints"],
  },
];

/** Each report shows this long before the next. */
const REPORT_MS = 5200;

/*
 * Connector geometry. From lg up the sources sit in four equal rows, so each line runs from a
 * row's middle (12.5%, 37.5%, 62.5%, 87.5% of the height) to Hamilton's middle (50%), and one
 * line runs out to the reports. The SVGs stretch to their column (preserveAspectRatio none) with
 * a non-scaling stroke, so the lines stay 1px whatever the height. A group the shown report reads
 * has its line drawn strong; the others stay faint.
 */
const IN_PATHS = [12.5, 37.5, 62.5, 87.5].map((y) => `M0,${y} C55,${y} 45,50 100,50`);
const OUT_PATHS = ["M0,50 C50,50 50,50 100,50"];
/* Below lg the flow runs down the page: two columns of sources join under Hamilton, then one line down to the reports. */
const MERGE_PATHS = ["M25,0 C25,60 50,40 50,100", "M75,0 C75,60 50,40 50,100"];
const SPLIT_PATHS = ["M50,0 C50,40 50,60 50,100"];

function Connectors({ paths, lit, className }: { paths: string[]; lit: boolean[]; className: string }) {
  return (
    <svg className={`fi-home-evidence-lines ${className}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {paths.map((d, i) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="var(--color-brick)"
          strokeOpacity={lit[i] ? 0.85 : 0.18}
          strokeWidth={lit[i] ? 1.6 : 1}
          vectorEffect="non-scaling-stroke"
          className="transition-[stroke-opacity] duration-500"
        />
      ))}
    </svg>
  );
}

/**
 * The evidence flow (James's critique §5, "Demonstration 2", and his Oct 18 note): four source
 * groups run into Hamilton and out to the reports it writes. The reports take turns; each one
 * lights the sources it reads. A visitor can pick a report, pause, or step through; the clock
 * stops off screen, in a hidden tab, on hover or focus, and never runs with reduced motion. The
 * first report renders lit on the server, so the flow is never blank.
 */
export function EvidenceFlow() {
  const root = useRef<HTMLDivElement>(null);
  const clock = useAutoAdvance({ count: EVIDENCE_REPORTS.length, duration: REPORT_MS, rootRef: root });
  const active = EVIDENCE_REPORTS[clock.index];
  const lit = new Set<SourceKey>(active.sources);
  const groupLit = EVIDENCE_GROUPS.map((g) => g.items.some((i) => lit.has(i.key)));
  const mergeLit = [groupLit[0] || groupLit[2], groupLit[1] || groupLit[3]];
  return (
    <div
      ref={root}
      className="grid gap-y-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(2.5rem,0.4fr)_minmax(0,0.9fr)_minmax(2rem,0.3fr)_minmax(0,1.1fr)] lg:items-stretch"
      data-evidence-flow=""
      role="region"
      aria-roledescription="carousel"
      aria-label="What Hamilton writes and the sources each reads"
    >
      <ul
        className="grid grid-cols-2 gap-2 sm:gap-3 lg:col-start-1 lg:grid-cols-1 lg:grid-rows-4"
        aria-label="Evidence Hamilton reads"
      >
        {EVIDENCE_GROUPS.map((g, gi) => (
          <li
            key={g.key}
            className={`flex min-w-0 flex-col gap-2 rounded-[6px] border bg-surface-0 p-3 shadow-[3px_3px_0_rgb(9_39_71/0.03)] transition-colors duration-500 lg:flex-row lg:items-center lg:gap-4 lg:px-4 ${
              groupLit[gi] ? "border-brick/45" : "border-border"
            }`}
            data-evidence-group={g.key}
            data-lit={groupLit[gi] ? "true" : "false"}
          >
            <span className="flex items-center gap-2 lg:w-[9.5rem] lg:shrink-0">
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-[5px] transition-colors duration-500 ${groupLit[gi] ? "bg-brick" : "bg-brick-tint"}`}>
                <g.icon aria-hidden="true" strokeWidth={1.5} className={`size-[18px] ${groupLit[gi] ? "text-white" : "text-brick"}`} />
              </span>
              <span className="text-[14px] font-semibold leading-tight text-ink">{g.name}</span>
            </span>
            <ul className="flex min-w-0 flex-col gap-1 lg:gap-0.5" aria-label={g.name}>
              {g.items.map((item) => {
                const on = lit.has(item.key);
                return (
                  <li
                    key={item.key}
                    className={`text-[12px] leading-snug transition-opacity duration-500 ${on ? "opacity-100" : "opacity-45"}`}
                    data-evidence-source={item.key}
                    data-lit={on ? "true" : "false"}
                  >
                    <span className={on ? "font-semibold text-brick" : "text-ink"}>{item.name}</span>
                    <span className="text-ink-muted"> · </span>
                    <span className="text-ink-soft" data-evidence-provider="">{item.provider}</span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      <Connectors paths={MERGE_PATHS} lit={mergeLit} className="h-10 w-full lg:hidden" />
      <Connectors paths={IN_PATHS} lit={groupLit} className="hidden h-full w-full lg:col-start-2 lg:block" />

      <div className="flex items-center lg:col-start-3">
        <div
          className="relative w-full overflow-hidden rounded-[8px] bg-[#102d43] px-5 py-6 text-center text-white shadow-[0_18px_40px_-24px_rgb(9_39_71/0.65)]"
          data-evidence-hub=""
        >
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgb(214_93_63/0.35),transparent_65%)]" />
          <p className="relative text-[26px] font-semibold leading-none tracking-[-0.03em] sm:text-[30px]">Hamilton</p>
          <p className="relative mx-auto mt-2.5 max-w-[16rem] text-[14px] leading-snug text-white/80">
            Connect evidence to institutional questions
          </p>
        </div>
      </div>

      <Connectors paths={SPLIT_PATHS} lit={[true]} className="h-10 w-full lg:hidden" />
      <Connectors paths={OUT_PATHS} lit={[true]} className="hidden h-full w-full lg:col-start-4 lg:block" />

      <div className="flex min-w-0 flex-col justify-center gap-3 lg:col-start-5">
        <ul className="flex flex-col gap-1.5" aria-label="What Hamilton writes">
          {EVIDENCE_REPORTS.map((r, i) => {
            const on = i === clock.index;
            return (
              <li key={r.key} data-evidence-report={r.key} data-active={on ? "true" : "false"}>
                <button
                  type="button"
                  onClick={() => clock.go(i)}
                  aria-pressed={on}
                  className={`w-full rounded-[6px] border px-3 py-2 text-left transition-colors duration-300 ${
                    on ? "border-brick/50 bg-brick-tint" : "border-transparent hover:bg-paper"
                  }`}
                >
                  <span className={`block text-[14px] leading-tight ${on ? "font-semibold text-ink" : "text-ink-soft"}`}>{r.name}</span>
                  {on ? <span className="mt-1 block text-[12px] leading-snug text-ink-soft">{r.detail}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <SlideControls clock={clock} count={EVIDENCE_REPORTS.length} name="Hamilton outputs" small />
      </div>
    </div>
  );
}
