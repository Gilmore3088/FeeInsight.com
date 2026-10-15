import type { CSSProperties, ReactNode } from "react";
import { BarChart3, Bookmark, FileText, Home, Search } from "lucide-react";
import { AppIcon, ChatMessage, FeeRange, FeeRangeAxis, Figure, StatCard } from "@/brand/components";
import { PRODUCT_NAME } from "@/lib/constants";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatCount } from "@/lib/public-stats";
import { axisMax, money, type DistrictPoint, type FeeLine, type HomeData, type RangeEntry } from "./landing-shared";

/**
 * The homepage exhibits: the real brand components (FeeRange, StatCard, ChatMessage) fed by
 * the live snapshot. The sizzle plays them in; the pillars show them still. Each one's
 * default style is its finished state, so a still render (server, reduced motion) is whole.
 * Classes starting fi-a- only move inside a playing sizzle chapter (globals.css).
 */

/** Delay for an fi-a- entrance inside a sizzle chapter. */
/** The fee the market and workspace exhibits follow. */
const OVERDRAFT_LABEL = getDisplayName("overdraft");
/** The same name without its abbreviation, for running text. */
const OVERDRAFT_NAME = OVERDRAFT_LABEL.replace(/\s*\(.*\)$/, "");

const at = (ms: number) => ({ "--fi-d": `${ms}ms` }) as CSSProperties;

/** The market layers Hamilton compares a fee against (brief 03 §2), as its layer switcher shows them. */
const LAYERS = ["Your market", "Your state", "Fed district", "Peer group", "Nation"] as const;

function SourceLine({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[12px] leading-5 text-ink-muted sm:text-[13px] ${className}`}>{children}</p>;
}

/** Every fee: the national box plot for each fee a committee asks about, with the source under it. */
export function FeeStackExhibit({ data, search = false }: { data: HomeData; search?: boolean }) {
  const { lines, summary } = data;
  if (lines.length === 0) return null;
  const hi = axisMax(Math.max(...lines.map((line) => line.row.max_amount)));
  const domain: [number, number] = [0, hi];
  return (
    <div className="p-4 sm:p-7">
      {search ? (
        <div className="fi-a-rise mb-5 flex h-11 items-center gap-2.5 rounded-lg border border-control-border bg-paper px-3" style={at(0)}>
          <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <span className="fi-a-type text-[15px] text-ink">Your institution</span>
        </div>
      ) : null}
      <div className="fi-range-stack">
        {lines.map((line, i) => (
          <div key={line.key} className="fi-a-rise" style={at(600 + i * 280)}>
            <FeeRange
              label={line.label}
              min={line.row.min_amount}
              q1={line.row.p25_amount}
              median={line.row.median_amount}
              q3={line.row.p75_amount}
              max={line.row.max_amount}
              domain={domain}
              format={money}
            />
          </div>
        ))}
        <FeeRangeAxis ticks={[0, hi / 2, hi]} domain={domain} />
      </div>
      <SourceLine className="fi-a-rise mt-4">
        <span className="fi-a-line">National medians from published fee schedules</span> · {summary.freshnessLabel}
      </SourceLine>
    </div>
  );
}

/** One live overdraft row with its source line: the Every fee pillar. */
export function FeeRowExhibit({ data }: { data: HomeData }) {
  const { overdraft, summary } = data;
  if (!overdraft) return null;
  const hi = axisMax(overdraft.max_amount);
  const domain: [number, number] = [0, hi];
  return (
    <div className="p-5 sm:p-8">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[15px] font-semibold text-ink sm:text-[17px]">{OVERDRAFT_LABEL}</p>
        <p className="font-mono text-[28px] font-semibold tabular-nums tracking-tight text-ink sm:text-[36px]">
          {money(overdraft.median_amount)}
        </p>
      </div>
      <p className="text-right text-[12px] text-ink-muted">National median</p>
      <div className="fi-range-stack mt-4">
        <FeeRange
          label="Middle half and full range"
          min={overdraft.min_amount}
          q1={overdraft.p25_amount}
          median={overdraft.median_amount}
          q3={overdraft.p75_amount}
          max={overdraft.max_amount}
          domain={domain}
          format={money}
        />
        <FeeRangeAxis ticks={[0, hi / 2, hi]} domain={domain} />
      </div>
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-paper px-4 py-3">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        <SourceLine>
          <span className="font-semibold text-ink">Source:</span> {formatCount(overdraft.institution_count)} published fee
          schedules, each kept with its page and date · {summary.freshnessLabel}
        </SourceLine>
      </div>
    </div>
  );
}

/** Each Fed district's range (lowest to highest fee) with its median as a dot, on the nation's axis. */
function DistrictRanges({
  districts,
  national,
  domain,
  limit,
  animate = false,
}: {
  districts: DistrictPoint[];
  national: number;
  domain: [number, number];
  /** On a phone, draw fewer rows, bigger. */
  limit?: number;
  animate?: boolean;
}) {
  const [lo, hi] = domain;
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return (
    <ol className="relative mt-3" aria-label="Overdraft by Fed district: range and median">
      <span
        aria-hidden
        className="absolute bottom-0 top-0 border-l border-dashed border-ink/45"
        style={{ left: `calc(7rem + (100% - 7rem - 3.75rem) * ${pct(national) / 100})` }}
      />
      {districts.map((d, i) => (
        <li
          key={d.district}
          className={`grid grid-cols-[7rem_minmax(0,1fr)_3.75rem] items-center py-[7px] text-[13px] sm:py-1.5 ${
            limit !== undefined && i >= limit ? "max-sm:hidden" : ""
          } ${animate ? "fi-a-rise" : ""}`}
          style={animate ? at(400 + i * 140) : undefined}
        >
          <span className="truncate pr-2 text-ink">{d.name}</span>
          <span className="relative h-4" aria-hidden="true">
            {d.median !== null && d.min !== null && d.max !== null ? (
              <>
                <span
                  className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-brick-tint"
                  style={{ left: `${pct(d.min)}%`, width: `${pct(d.max) - pct(d.min)}%` }}
                />
                <span
                  className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-0 bg-ink ${animate ? "fi-a-drop" : ""}`}
                  style={{ left: `${pct(d.median)}%`, ...(animate ? at(600 + i * 140) : {}) }}
                />
              </>
            ) : (
              <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
            )}
          </span>
          <span className="text-right font-mono text-[13px] tabular-nums text-ink">
            {d.median !== null ? money(d.median) : <span className="font-sans text-ink-muted">thin</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Every market: the layer switcher, the nation's box plot and each Fed district's median on one axis. */
export function MarketExhibit({
  data,
  animate = false,
  phoneRows = 6,
  wide = false,
}: {
  data: HomeData;
  animate?: boolean;
  phoneRows?: number;
  /** Desktop: the nation on the left, the districts on the right (the sizzle's wide frame). */
  wide?: boolean;
}) {
  const { overdraft, districts, summary } = data;
  if (!overdraft) return null;
  const hi = axisMax(Math.max(overdraft.max_amount, ...districts.map((d) => d.max ?? 0)));
  const domain: [number, number] = [0, hi];
  const nation = (
    <>
      <ul className="flex flex-wrap gap-1.5" aria-label="Market layers">
        {LAYERS.map((layer) => (
          <li
            key={layer}
            className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
              layer === "Fed district" ? "bg-ink text-on-ink" : "border border-border text-ink-soft"
            }`}
          >
            {layer}
          </li>
        ))}
      </ul>
      <div className="fi-range-stack mt-4">
        <FeeRange
          label={`${OVERDRAFT_LABEL}, the nation`}
          min={overdraft.min_amount}
          q1={overdraft.p25_amount}
          median={overdraft.median_amount}
          q3={overdraft.p75_amount}
          max={overdraft.max_amount}
          domain={domain}
          format={money}
        />
      </div>
    </>
  );
  const byDistrict =
    districts.length > 0 ? (
      <>
        <DistrictRanges districts={districts} national={overdraft.median_amount} domain={domain} limit={phoneRows} animate={animate} />
        <div className="mt-1 grid grid-cols-[7rem_minmax(0,1fr)_3.75rem] font-mono text-[11px] text-ink-muted" aria-hidden="true">
          <span />
          <span className="flex justify-between">
            <span>$0</span>
            <span>{`$${hi}`}</span>
          </span>
          <span />
        </div>
      </>
    ) : null;
  const source = (
    <SourceLine className="mt-3">
      Bar: each district&apos;s range · Dashed line: national median · {summary.freshnessLabel}
    </SourceLine>
  );
  if (wide) {
    return (
      <div className="grid gap-6 p-4 sm:p-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
        <div className="min-w-0">
          {nation}
          <div className="max-lg:hidden">{source}</div>
        </div>
        <div className="min-w-0">
          {byDistrict}
          <div className="lg:hidden">{source}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="p-4 sm:p-7">
      {nation}
      {byDistrict}
      {source}
    </div>
  );
}

function highLow(districts: DistrictPoint[]): { high: DistrictPoint; low: DistrictPoint } | null {
  const drawn = districts.filter((d): d is DistrictPoint & { median: number } => d.median !== null);
  if (drawn.length < 2) return null;
  const sorted = [...drawn].sort((a, b) => a.median - b.median);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  return low.median === high.median ? null : { high, low };
}

/** One workspace: Hamilton answering a committee question from the same live figures, with its source. */
export function WorkspaceExhibit({ data, animate = false }: { data: HomeData; animate?: boolean }) {
  const { overdraft, districts, summary } = data;
  if (!overdraft) return null;
  const spread = highLow(districts);
  // Named only while the list stays short enough to read in one line.
  const above = districts.filter((d) => d.median !== null && d.median > overdraft.median_amount);
  const fee = OVERDRAFT_NAME.toLowerCase();
  const hi = axisMax(overdraft.max_amount);
  const domain: [number, number] = [0, hi];
  const rail = [Home, BarChart3, Bookmark, FileText];
  return (
    <div className="flex min-h-full">
      <nav aria-hidden="true" className="hidden w-14 shrink-0 flex-col items-center gap-4 border-r border-border bg-paper/60 py-5 sm:flex">
        <AppIcon brand="hamilton" size={28} title="" />
        {rail.map((Icon, i) => (
          <Icon key={i} className={`h-[18px] w-[18px] ${i === 1 ? "text-ink" : "text-ink-muted"}`} />
        ))}
      </nav>
      <div className="min-w-0 flex-1 space-y-4 p-4 sm:p-7">
        <div className={animate ? "fi-a-rise" : undefined} style={animate ? at(200) : undefined}>
          <ChatMessage from="user" className="ml-auto max-w-[85%]">
            How do {fee} fees vary across Fed districts?
          </ChatMessage>
        </div>
        <div className={animate ? "fi-a-rise" : undefined} style={animate ? at(1200) : undefined}>
          <ChatMessage from="hamilton" source={`${PRODUCT_NAME} · ${summary.freshnessLabel}`} className="max-w-full">
            The national median is <Figure>{money(overdraft.median_amount)}</Figure>, from{" "}
            <Figure>{formatCount(overdraft.institution_count)}</Figure> institutions.
            {spread ? (
              <>
                {" "}
                By Fed district, {spread.low.name} is lowest at <Figure>{money(spread.low.median as number)}</Figure> and{" "}
                {spread.high.name} highest at <Figure>{money(spread.high.median as number)}</Figure>.
              </>
            ) : null}
            <div className="fi-range-stack mt-3">
              <FeeRange
                label="The nation"
                min={overdraft.min_amount}
                q1={overdraft.p25_amount}
                median={overdraft.median_amount}
                q3={overdraft.p75_amount}
                max={overdraft.max_amount}
                domain={domain}
                format={money}
              />
            </div>
          </ChatMessage>
        </div>
        {animate && above.length > 0 && above.length <= 4 ? (
          <>
            <div className="fi-a-rise" style={at(2600)}>
              <ChatMessage from="user" className="ml-auto max-w-[85%]">
                Which districts sit above the national median?
              </ChatMessage>
            </div>
            <div className="fi-a-rise" style={at(3400)}>
              <ChatMessage from="hamilton" source={`${PRODUCT_NAME} · ${summary.freshnessLabel}`} className="max-w-full">
                {above.map((d, i) => (
                  <span key={d.district}>
                    {i > 0 ? (i === above.length - 1 ? " and " : ", ") : null}
                    {d.name} at <Figure>{money(d.median as number)}</Figure>
                  </span>
                ))}
                .
              </ChatMessage>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Reports: a committee brief assembling from the same figures. The sizzle's end frame. */
export function ReportExhibit({ data }: { data: HomeData }) {
  const { overdraft, summary } = data;
  if (!overdraft) return null;
  const hi = axisMax(overdraft.max_amount);
  const domain: [number, number] = [0, hi];
  const fee = OVERDRAFT_NAME;
  return (
    <div className="grid items-start gap-6 bg-surface-200/70 px-4 py-5 sm:px-10 sm:py-8 lg:grid-cols-2">
      <article className="fi-a-rise min-w-0 rounded-lg bg-surface-0 p-5 shadow-fi-2 sm:p-8" style={at(0)}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Committee brief · Your institution</p>
        <h3 className="mt-2 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[24px]">
          {fee}: where the market stands
        </h3>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="fi-a-rise" style={at(500)}>
            <StatCard
              label="National median"
              value={money(overdraft.median_amount)}
              className="min-w-0 !p-4 [&_.fi-stat-value]:text-[24px] [&_.fi-stat-value]:leading-8 sm:[&_.fi-stat-value]:text-[30px]"
            />
          </div>
          <div className="fi-a-rise" style={at(800)}>
            <StatCard
              label="Institutions"
              value={formatCount(overdraft.institution_count)}
              className="min-w-0 !p-4 [&_.fi-stat-value]:text-[24px] [&_.fi-stat-value]:leading-8 sm:[&_.fi-stat-value]:text-[30px]"
            />
          </div>
        </div>
        <div className="fi-range-stack fi-a-rise mt-4" style={at(1200)}>
          <FeeRange
            label="Middle half, national"
            min={overdraft.min_amount}
            q1={overdraft.p25_amount}
            median={overdraft.median_amount}
            q3={overdraft.p75_amount}
            max={overdraft.max_amount}
            domain={domain}
            format={money}
          />
        </div>
        <p className="fi-a-rise mt-4 border-t border-border pt-3 text-[12px] leading-5 text-ink-muted" style={at(1700)}>
          Source: {PRODUCT_NAME}, published fee schedules · {summary.freshnessLabel}
        </p>
      </article>
      {data.districts.length > 0 ? (
        <article
          className="fi-a-rise hidden min-w-0 rounded-lg bg-surface-0 p-8 shadow-fi-2 lg:mt-10 lg:block lg:rotate-1"
          style={at(2000)}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Page 2 · By Fed district</p>
          <DistrictRanges
            districts={data.districts}
            national={overdraft.median_amount}
            domain={[0, axisMax(Math.max(overdraft.max_amount, ...data.districts.map((d) => d.max ?? 0)))]}
          />
        </article>
      ) : null}
    </div>
  );
}

export type { FeeLine, RangeEntry };
