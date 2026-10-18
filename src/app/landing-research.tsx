import { FileChartColumn, Files, Landmark, MapPinned, Presentation, ScrollText, type LucideIcon } from "lucide-react";

type GroupKey = "fees" | "filings" | "markets" | "regulatory";

export interface EvidenceGroup {
  key: GroupKey;
  icon: LucideIcon;
  name: string;
  /** Each source in the group: what it is and who publishes it. */
  items: { name: string; provider: string }[];
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
    items: [{ name: "Fee schedules", provider: "Banks and credit unions" }],
  },
  {
    key: "filings",
    icon: Landmark,
    name: "Financial filings",
    items: [
      { name: "Call Reports", provider: "FDIC · NCUA" },
      { name: "Public filings", provider: "SEC" },
      { name: "Industry totals", provider: "FDIC" },
    ],
  },
  {
    key: "markets",
    icon: MapPinned,
    name: "Branches and markets",
    items: [
      { name: "Branches and deposits", provider: "FDIC · NCUA" },
      { name: "Household income", provider: "Census · IRS" },
      { name: "Economic conditions", provider: "Beige Book · FOMC" },
    ],
  },
  {
    key: "regulatory",
    icon: ScrollText,
    name: "Regulatory sources",
    items: [
      { name: "Rules and actions", provider: "Regulators · States" },
      { name: "Consumer complaints", provider: "CFPB" },
    ],
  },
];

/** What comes out of Hamilton. */
export const EVIDENCE_OUTPUTS: { key: string; icon: LucideIcon; name: string; detail: string }[] = [
  { key: "analysis", icon: FileChartColumn, name: "Analysis", detail: "Your fees in the context of your market and your financials." },
  { key: "board", icon: Presentation, name: "Board reports", detail: "Ready for committee, every figure linked to its source." },
];

/*
 * Connector geometry. From lg up the sources sit in four equal rows and the outputs in two, so
 * each line runs from a row's middle (12.5%, 37.5%, 62.5%, 87.5% of the height) to Hamilton's
 * middle (50%), and out to 25% and 75%. The SVGs stretch to their column (preserveAspectRatio
 * none) with a non-scaling stroke, so the lines stay 1px whatever the height.
 */
const IN_PATHS = [12.5, 37.5, 62.5, 87.5].map((y) => `M0,${y} C55,${y} 45,50 100,50`);
const OUT_PATHS = [25, 75].map((y) => `M0,50 C55,50 45,${y} 100,${y}`);
/* Below lg the flow runs down the page: two columns of sources join under Hamilton, which splits to two outputs. */
const MERGE_PATHS = ["M25,0 C25,60 50,40 50,100", "M75,0 C75,60 50,40 50,100"];
const SPLIT_PATHS = ["M50,0 C50,60 25,40 25,100", "M50,0 C50,60 75,40 75,100"];

function Connectors({ paths, className, viewBox = "0 0 100 100" }: { paths: string[]; className: string; viewBox?: string }) {
  return (
    <svg className={`fi-home-evidence-lines ${className}`} viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {paths.map((d) => (
        <g key={d}>
          <path d={d} fill="none" stroke="var(--color-brick)" strokeOpacity={0.28} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={d} fill="none" stroke="var(--color-brick)" strokeOpacity={0.8} strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="fi-home-evidence-pulse" />
        </g>
      ))}
    </svg>
  );
}

/**
 * The evidence flow (James's critique §5, "Demonstration 2"): four source groups run into
 * Hamilton, which connects them to the institution's questions, then out to analysis and board
 * reports. A screen reader reads it as three lists in order; the lines are decoration. Nothing
 * rotates; with reduced motion the lines are drawn still.
 */
export function EvidenceFlow() {
  return (
    <div
      className="grid gap-y-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(2.5rem,0.4fr)_minmax(0,1fr)_minmax(2.5rem,0.4fr)_minmax(0,0.9fr)] lg:items-stretch"
      data-evidence-flow=""
    >
      <ul
        className="grid grid-cols-2 gap-2 sm:gap-3 lg:col-start-1 lg:grid-cols-1 lg:grid-rows-4"
        aria-label="Evidence Hamilton reads"
      >
        {EVIDENCE_GROUPS.map((g) => (
          <li
            key={g.key}
            className="flex min-w-0 flex-col gap-2 rounded-[6px] border border-border bg-surface-0 p-3 shadow-[3px_3px_0_rgb(9_39_71/0.03)] lg:flex-row lg:items-center lg:gap-4 lg:px-4"
            data-evidence-group={g.key}
          >
            <span className="flex items-center gap-2 lg:w-[9.5rem] lg:shrink-0">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[5px] bg-brick-tint">
                <g.icon aria-hidden="true" strokeWidth={1.5} className="size-[18px] text-brick" />
              </span>
              <span className="text-[14px] font-semibold leading-tight text-ink">{g.name}</span>
            </span>
            <ul className="flex min-w-0 flex-col gap-1 lg:gap-0.5" aria-label={g.name}>
              {g.items.map((item) => (
                <li key={item.name} className="text-[12px] leading-snug text-ink-soft">
                  <span className="text-ink">{item.name}</span>
                  <span className="text-ink-muted"> · </span>
                  <span data-evidence-provider="">{item.provider}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <Connectors paths={MERGE_PATHS} className="h-10 w-full lg:hidden" />
      <Connectors paths={IN_PATHS} className="hidden h-full w-full lg:col-start-2 lg:block" />

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

      <Connectors paths={SPLIT_PATHS} className="h-10 w-full lg:hidden" />
      <Connectors paths={OUT_PATHS} className="hidden h-full w-full lg:col-start-4 lg:block" />

      <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:col-start-5 lg:grid-cols-1 lg:grid-rows-2" aria-label="What Hamilton delivers">
        {EVIDENCE_OUTPUTS.map((o) => (
          <li
            key={o.key}
            className="flex min-w-0 flex-col justify-center gap-1.5 rounded-[6px] border border-brick/40 bg-brick-tint p-3 lg:my-5 lg:p-4"
            data-evidence-output={o.key}
          >
            <span className="flex items-center gap-2">
              <o.icon aria-hidden="true" strokeWidth={1.5} className="size-5 shrink-0 text-brick" />
              <span className="text-[15px] font-semibold leading-tight text-ink">{o.name}</span>
            </span>
            <span className="text-[12px] leading-snug text-ink-soft">{o.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
