import type { CSSProperties, ReactNode } from "react";
import { BarChart3, Bookmark, FileText, Home, Search } from "lucide-react";
import { AppIcon, ChatMessage, FeeRange, FeeRangeAxis, Figure, StatCard } from "@/brand/components";
import { HAMILTON_MODES, PRODUCT_NAME, type HamiltonMode } from "@/lib/constants";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatCount } from "@/lib/public-stats";
import { TryAPricePanel } from "@/app/subscribe/try-a-price-panel";
import { axisMax, money, type DistrictPoint, type FeeLine, type HomeData, type RangeEntry, type SampleRow } from "./landing-shared";

/**
 * The homepage exhibits: the real brand components (FeeRange, StatCard, ChatMessage) fed by
 * the live snapshot. The sizzle plays them in; the pillars show them still. Each one's
 * default style is its finished state, so a still render (server, reduced motion) is whole.
 * Classes starting fi-a- only move inside a playing sizzle chapter (globals.css).
 */

/** The fee the market exhibit follows. */
const OVERDRAFT_LABEL = getDisplayName("overdraft");
/** The same name without its abbreviation, for running text. */
const OVERDRAFT_NAME = OVERDRAFT_LABEL.replace(/\s*\(.*\)$/, "");

/** Delay for an fi-a- entrance inside a sizzle chapter. */
const at = (ms: number) => ({ "--fi-d": `${ms}ms` }) as CSSProperties;

/** The gap between one market row of the ladder and the next as the chapter plays. */
const LADDER_STEP_MS = 450;

/** When Hamilton starts reading, and when its answer appears, in ms from the chapter's start. */
const ASK_THINK_MS = 1700;
const ASK_ANSWER_MS = 2700;

/** A question that appears a word at a time, as if typed, when the chapter plays. */
function Typed({ text, from, animate }: { text: string; from: number; animate: boolean }) {
  if (!animate) return <>{text}</>;
  const words = text.split(" ");
  return (
    <>
      {words.map((word, i) => (
        <span key={i} className="fi-a-word" style={at(from + i * 110)}>
          {word}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

/** Hamilton reading before it answers: three dots that show only while the chapter plays. */
function Thinking({ ms }: { ms: number }) {
  return (
    <span aria-hidden="true" className="fi-a-think absolute left-0 top-0 flex items-center gap-2" style={at(ms)}>
      <AppIcon brand="hamilton" size={32} title="" />
      <span className="flex gap-1 rounded-full border border-border bg-surface-0 px-3 py-3">
        <span className="fi-a-dot h-1.5 w-1.5 rounded-full bg-ink-muted" />
        <span className="fi-a-dot h-1.5 w-1.5 rounded-full bg-ink-muted" />
        <span className="fi-a-dot h-1.5 w-1.5 rounded-full bg-ink-muted" />
      </span>
    </span>
  );
}

/** The market layers Hamilton compares a fee against (brief 03 §2), shown as a legend, not a control. */
const LAYERS = ["Your market", "Your state", "Fed district", "Peer group", "Nation"] as const;
/** The layers the still (non-wide) market view actually draws. */
const DRAWN_LAYERS = ["Fed district", "Nation"] as const;

function SourceLine({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[12px] leading-5 text-ink-muted sm:text-[13px] ${className}`}>{children}</p>;
}

/**
 * Every fee: the national box plot for each fee a committee asks about, with the source under it.
 * `shell` draws it inside Hamilton's rail and tabs (My fees), as the sizzle shows it.
 */
export function FeeStackExhibit({ data, search = false, shell = false }: { data: HomeData; search?: boolean; shell?: boolean }) {
  const { lines, summary } = data;
  if (lines.length === 0) return null;
  const hi = axisMax(Math.max(...lines.map((line) => line.row.max_amount)));
  const domain: [number, number] = [0, hi];
  const body = (
    <div className="p-4 sm:p-7">
      {search ? (
        <div className="fi-a-rise mb-5 flex h-11 items-center gap-2.5 rounded-lg border border-control-border bg-paper px-3" style={at(0)}>
          <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <span className="fi-a-type text-[15px] text-ink">Your institution</span>
        </div>
      ) : null}
      <div className="fi-range-stack">
        {lines.map((line, i) => (
          <div key={line.key} className="fi-a-rise fi-a-fill" style={at(900 + i * 350)}>
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
        <span className="fi-a-line">National medians from published fee schedules</span> · <span className="whitespace-nowrap">{summary.freshnessLabel}</span>
      </SourceLine>
    </div>
  );
  return shell ? <HamiltonShell active="My fees">{body}</HamiltonShell> : body;
}

/** Each Fed district's range (lowest to highest fee) with its median as a dot, on the nation's axis. */
function DistrictRanges({
  districts,
  national,
  domain,
  limit,
  animate = false,
  delay = 400,
}: {
  districts: DistrictPoint[];
  national: number;
  domain: [number, number];
  /** On a phone, draw fewer rows, bigger. */
  limit?: number;
  animate?: boolean;
  /** When the first row plays in, in ms from the chapter's start. */
  delay?: number;
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
          style={animate ? at(delay + i * 140) : undefined}
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
                  style={{ left: `${pct(d.median)}%`, ...(animate ? at(delay + 200 + i * 140) : {}) }}
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

/**
 * Every market: the market layers as a legend, the nation's box plot and each Fed district's
 * median on one axis. In the sizzle's `wide` frame, with a live sample ladder for the same fee,
 * the left column is the sample bank's fee in each of its markets instead of the nation alone.
 */
export function MarketExhibit({
  data,
  animate = false,
  phoneRows = 6,
  wide = false,
  phoneDistricts = true,
}: {
  data: HomeData;
  animate?: boolean;
  phoneRows?: number;
  /** False leaves the Fed district rows off a phone, so a demo frame stays one screen tall. */
  phoneDistricts?: boolean;
  /** Desktop: the bank's markets on the left, the districts on the right, in Hamilton's shell (My fees). */
  wide?: boolean;
}) {
  const { overdraft, districts, summary } = data;
  if (!overdraft) return null;
  const ladder = wide && data.ladder?.feeKey === "overdraft" ? data.ladder : null;
  const hi = axisMax(
    Math.max(
      overdraft.max_amount,
      ...districts.map((d) => d.max ?? 0),
      ...(ladder ? [ladder.value, ...ladder.rows.map((row) => row.max)] : []),
    ),
  );
  const domain: [number, number] = [0, hi];
  // The still view draws only the nation and the Fed districts, so its legend names only those.
  const layers: readonly string[] = wide ? LAYERS : DRAWN_LAYERS;
  const legend = (
    <ul className="flex flex-wrap gap-y-1 text-[12px]" aria-label="Market layers">
      {/* Each separator rides with the layer before it, so a wrapped line starts with a layer. */}
      {layers.map((layer, i) => (
        <li key={layer} className={`whitespace-nowrap ${layer === "Fed district" ? "font-semibold text-ink" : "text-ink-muted"}`}>
          {layer}
          {i < layers.length - 1 ? <span aria-hidden="true" className="px-1.5 font-normal text-ink-muted">·</span> : null}
        </li>
      ))}
    </ul>
  );
  const nation = (
    <>
      {legend}
      {ladder ? (
        <>
          <p
            className={`max-w-[none] mt-4 flex items-baseline justify-between gap-3 ${animate ? "fi-a-rise" : ""}`}
            style={animate ? at(150) : undefined}
          >
            <span className="min-w-0 truncate text-[15px] font-semibold text-ink">{ladder.institutionName}</span>
            <span className="shrink-0 font-mono text-[22px] font-semibold tabular-nums tracking-tight text-ink">{money(ladder.value)}</span>
          </p>
          <div className="fi-range-stack mt-2 space-y-1">
            {ladder.rows.map((row, i) => (
              <div
                key={row.label}
                className={animate ? "fi-a-rise fi-a-fill fi-a-marker" : undefined}
                style={animate ? at(500 + i * LADDER_STEP_MS) : undefined}
              >
                <FeeRange
                  label={row.label}
                  min={row.min}
                  q1={row.q1}
                  median={row.median}
                  q3={row.q3}
                  max={row.max}
                  value={ladder.value}
                  domain={domain}
                  format={money}
                  figure="median"
                />
              </div>
            ))}
            <FeeRangeAxis ticks={[0, hi / 2, hi]} domain={domain} />
          </div>
        </>
      ) : (
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
      )}
    </>
  );
  const byDistrict =
    districts.length > 0 ? (
      <>
        <DistrictRanges
          districts={districts}
          national={overdraft.median_amount}
          domain={domain}
          limit={phoneRows}
          animate={animate}
          delay={ladder ? 900 + ladder.rows.length * LADDER_STEP_MS : 400}
        />
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
  const districtKey = phoneDistricts ? "" : "max-sm:hidden";
  const source = (
    <SourceLine className="mt-3">
      {ladder ? "Dot: its own fee · Right: each market's median · " : ""}
      <span className={districtKey}>Bar: each district&apos;s range · Dashed line: national median · </span>
      {summary.freshnessLabel}
    </SourceLine>
  );
  if (wide) {
    return (
      <HamiltonShell active="My fees">
        <div className="grid gap-6 p-4 sm:p-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
          <div className="min-w-0">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{OVERDRAFT_LABEL}</p>
            {nation}
            <div className="max-lg:hidden">{source}</div>
          </div>
          <div className="min-w-0">
            {byDistrict && !phoneDistricts ? <div className="max-sm:hidden">{byDistrict}</div> : byDistrict}
            <div className="lg:hidden">{source}</div>
          </div>
        </div>
      </HamiltonShell>
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

const POSITION_SHORT: Record<SampleRow["position"], string> = {
  above_market: "Above",
  in_market: "Inside",
  below_market: "Below",
  free: "Free",
};

/** "2026-10-08" as "Oct 8, 2026"; anything else is left out. */
function readOnLabel(iso: string | null): string | null {
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A fee's name for running text: "Overdraft (OD)" reads as "overdraft"; an acronym keeps its capitals. */
const plainFee = (label: string) => label.replace(/\s*\(.*\)$/, "").replace(/\b[A-Z][a-z]+\b/g, (word) => word.toLowerCase());

/**
 * Every fee: several of the sample bank's own fees, each with the words of its schedule that
 * state it. Only fees whose source passes the shared check are here (`sourcedFees`).
 */
export function SourcedFeesExhibit({ data, limit = 4, animate = false }: { data: HomeData; limit?: number; animate?: boolean }) {
  const sample = data.sample;
  if (!sample || sample.fees.length === 0) return null;
  return (
    <div className="p-4 sm:p-7">
      <p className="flex items-center gap-2 text-[13px] text-ink-muted">
        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">
          <span className="font-semibold text-ink">{sample.institutionName}</span> · its published fee schedule
        </span>
      </p>
      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-0">
        {sample.fees.slice(0, limit).map((fee, i) => {
          const read = readOnLabel(fee.readOn);
          return (
            <li key={fee.key} className={`px-4 py-3.5 ${animate ? "fi-a-rise" : ""}`} style={animate ? at(300 + i * 300) : undefined}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="min-w-0 text-[15px] font-semibold text-ink">{fee.label}</span>
                <span className="shrink-0 font-mono text-[20px] font-semibold tabular-nums tracking-tight text-ink sm:text-[22px]">
                  {money(fee.amount)}
                </span>
              </div>
              <p className="mt-1.5 text-[12px] leading-5 text-ink-muted sm:text-[13px]">
                <span className="mr-1.5 rounded bg-brick-tint px-1.5 py-0.5 text-[11px] font-semibold text-ink">Source</span>
                &ldquo;{fee.quote}&rdquo;
                {read ? <span className="whitespace-nowrap"> · read {read}</span> : null}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Hamilton's left rail, and its mode tabs when the scene names one, so every sizzle chapter
 * reads as the workspace (growth OS re-walk R2).
 */
function HamiltonShell({ active, children }: { active?: HamiltonMode; children: ReactNode }) {
  const rail = [Home, BarChart3, Bookmark, FileText];
  const lit = active === "Reports" ? 3 : 1;
  return (
    <div data-hamilton-shell="" className="flex h-full min-h-full flex-1">
      <nav aria-hidden="true" className="hidden w-14 shrink-0 flex-col items-center gap-4 border-r border-border bg-paper/60 py-5 sm:flex">
        <AppIcon brand="hamilton" size={28} title="" />
        {rail.map((Icon, i) => (
          <Icon key={i} className={`h-[18px] w-[18px] ${i === lit ? "text-ink" : "text-ink-muted"}`} />
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? <ModeTabs active={active} /> : null}
        {children}
      </div>
    </div>
  );
}

/** Hamilton's mode tabs, with the scene's own mode marked. */
function ModeTabs({ active }: { active: HamiltonMode }) {
  return (
    <div role="presentation" className="flex gap-1 overflow-x-auto border-b border-border px-3 pt-2 text-[13px] [scrollbar-width:none]">
      {HAMILTON_MODES.map((mode) => (
        <span
          key={mode}
          className={
            mode === active
              ? "whitespace-nowrap border-b-2 border-ink px-2.5 pb-2 font-semibold text-ink"
              : "whitespace-nowrap px-2.5 pb-2 text-ink-muted"
          }
        >
          {mode}
        </span>
      ))}
    </div>
  );
}

/** One workspace, Try a price: any amount against the live national range. */
export function TryPriceExhibit({ data }: { data: HomeData }) {
  if (!data.scenario) return null;
  return (
    <HamiltonShell active="Try a price">
      <div className="flex flex-1 flex-col justify-center p-0 sm:p-7">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col sm:flex-none sm:rounded-xl sm:border sm:border-border">
          <TryAPricePanel scenario={data.scenario} bare />
        </div>
      </div>
    </HamiltonShell>
  );
}

/**
 * One workspace, Ask: Hamilton answers a question about the sample bank's fee from the same
 * live layers as the market ladder, each figure with its market. Without a sample it answers
 * from the Fed district medians. No box plot: the answer is the figures.
 */
export function AskExhibit({ data, animate = false }: { data: HomeData; animate?: boolean }) {
  const { ladder, summary, overdraft, districts } = data;
  const rise = (ms: number) => (animate ? { className: "fi-a-rise", style: at(ms) } : {});
  // The answer, with its source line after it, once the question is typed and Hamilton has read.
  const answer = animate ? { className: "fi-a-rise fi-a-sourced", style: at(ASK_ANSWER_MS) } : {};
  const source = `${PRODUCT_NAME} · ${summary.freshnessLabel}`;
  if (ladder) {
    const local = ladder.rows[0];
    const where =
      ladder.value < local.q1 ? "below the middle half" : ladder.value > local.q3 ? "above the middle half" : "inside the middle half";
    return (
      <HamiltonShell>
        <div className="space-y-4 p-4 sm:p-7">
          <div {...rise(100)}>
            <ChatMessage from="user" className="ml-auto max-w-[85%]">
              <Typed text={`Where does ${ladder.institutionName}'s ${plainFee(ladder.feeLabel)} fee sit?`} from={350} animate={animate} />
            </ChatMessage>
          </div>
          <div className="relative">
            {animate ? <Thinking ms={ASK_THINK_MS} /> : null}
            <div {...answer}>
              <ChatMessage from="hamilton" source={source} className="max-w-full">
                At <Figure>{money(ladder.value)}</Figure>, it sits {where} of the {formatCount(local.institutions)} local competitors
                that publish this fee.
                <table className="mt-3 w-full text-[13px]">
                  <tbody>
                    {ladder.rows.map((row) => (
                      <tr key={row.label} className="border-t border-border">
                        <td className="py-1.5 pr-3 text-ink">{row.label}</td>
                        <td className="py-1.5 pr-3 text-right text-ink-muted">median</td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-ink">{money(row.median)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ChatMessage>
            </div>
          </div>
        </div>
      </HamiltonShell>
    );
  }
  if (!overdraft) return null;
  const drawn = districts.filter((d): d is DistrictPoint & { median: number } => d.median !== null).sort((a, b) => a.median - b.median);
  const low = drawn[0];
  const high = drawn[drawn.length - 1];
  return (
    <HamiltonShell>
      <div className="space-y-4 p-4 sm:p-7">
        <div {...rise(100)}>
          <ChatMessage from="user" className="ml-auto max-w-[85%]">
            <Typed text={`How do ${plainFee(OVERDRAFT_LABEL)} fees vary across Fed districts?`} from={350} animate={animate} />
          </ChatMessage>
        </div>
        <div className="relative">
          {animate ? <Thinking ms={ASK_THINK_MS} /> : null}
          <div {...answer}>
            <ChatMessage from="hamilton" source={source} className="max-w-full">
              The national median is <Figure>{money(overdraft.median_amount)}</Figure>, from{" "}
              <Figure>{formatCount(overdraft.institution_count)}</Figure> institutions.
              {low && high && low.median !== high.median ? (
                <>
                  {" "}
                  {low.name} is lowest at <Figure>{money(low.median)}</Figure> and {high.name} highest at{" "}
                  <Figure>{money(high.median)}</Figure>.
                </>
              ) : null}
            </ChatMessage>
          </div>
        </div>
      </div>
    </HamiltonShell>
  );
}

/**
 * Reports: the sizzle's end frame. With a live sample it is the Competitive Fee Position
 * Report's first table: the bank's fees against its local market. Without one, a national
 * committee brief.
 */
export function ReportExhibit({ data, phoneRows = 4 }: { data: HomeData; phoneRows?: number }) {
  const sample = data.sample;
  if (!sample || sample.rows.length < 3) return <NationalBriefExhibit data={data} />;
  const rows = sample.rows.slice(0, 6);
  const count = (position: SampleRow["position"]) => sample.rows.filter((row) => row.position === position).length;
  const stat = "min-w-0 !p-3 sm:!p-4 [&_.fi-stat-value]:text-[22px] [&_.fi-stat-value]:leading-7 sm:[&_.fi-stat-value]:text-[28px]";
  return (
    <HamiltonShell active="Reports">
      <article className="fi-a-rise min-w-0 p-4 sm:px-8 sm:py-6" style={at(0)}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Competitive Fee Position Report</p>
        <h3 className="mt-1.5 text-[19px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[23px]">
          {sample.institutionName} against {formatCount(sample.competitors)} local competitors
        </h3>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          {(["above_market", "in_market", "below_market"] as const).map((position, i) => (
            <div key={position} className="fi-a-rise" style={at(400 + i * 250)}>
              <StatCard label={`${POSITION_SHORT[position]} range`} value={String(count(position))} className={stat} />
            </div>
          ))}
        </div>
        <table className="mt-4 w-full text-[13px] sm:text-[14px]">
          <thead>
            <tr className="fi-a-rise text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted" style={at(1300)}>
              <th className="pb-1.5 font-semibold">Fee</th>
              <th className="pb-1.5 text-right font-semibold">Its fee</th>
              <th className="pb-1.5 pl-2 text-right font-semibold">Local median</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.key}
                className={`fi-a-rise border-t border-border ${i >= phoneRows ? "max-sm:hidden" : ""}`}
                style={at(1500 + i * 220)}
              >
                <td className="py-1.5 pr-2 text-ink">
                  {row.label}
                  {row.position !== "in_market" ? (
                    <span
                      className={`ml-1.5 whitespace-nowrap rounded px-1 text-[11px] font-semibold ${
                        row.position === "above_market" ? "bg-brick-tint text-ink" : "bg-surface-200 text-ink-soft"
                      }`}
                    >
                      {POSITION_SHORT[row.position]}
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums text-ink">{money(row.amount)}</td>
                <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-ink-soft">{money(row.median)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="max-w-[none] fi-a-rise mt-3 border-t border-border pt-3 text-[12px] leading-5 text-ink-muted" style={at(1700 + rows.length * 220)}>
          Source: each bank&apos;s published fee schedule · {data.summary.freshnessLabel}
        </p>
      </article>
    </HamiltonShell>
  );
}

/** Without a live sample: the national overdraft brief, with its Fed district page beside it. */
function NationalBriefExhibit({ data }: { data: HomeData }) {
  const { overdraft, summary } = data;
  if (!overdraft) return null;
  const hi = axisMax(Math.max(overdraft.max_amount, ...data.districts.map((d) => d.max ?? 0)));
  const domain: [number, number] = [0, hi];
  return (
    <HamiltonShell active="Reports">
    <div className="grid items-start gap-6 p-4 sm:p-7 lg:grid-cols-2">
      <article className="fi-a-rise min-w-0" style={at(0)}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Committee brief</p>
        <h3 className="mt-2 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[24px]">
          {OVERDRAFT_NAME}: where the market stands
        </h3>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <StatCard label="National median" value={money(overdraft.median_amount)} className="min-w-0 !p-4" />
          <StatCard label="Institutions" value={formatCount(overdraft.institution_count)} className="min-w-0 !p-4" />
        </div>
        <p className="max-w-[none] mt-4 border-t border-border pt-3 text-[12px] leading-5 text-ink-muted">
          Source: {PRODUCT_NAME}, published fee schedules · {summary.freshnessLabel}
        </p>
      </article>
      {data.districts.length > 0 ? (
        <article className="fi-a-rise hidden min-w-0 lg:block" style={at(800)}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">By Fed district</p>
          <DistrictRanges districts={data.districts} national={overdraft.median_amount} domain={domain} />
        </article>
      ) : null}
    </div>
    </HamiltonShell>
  );
}

export type { FeeLine, RangeEntry };
