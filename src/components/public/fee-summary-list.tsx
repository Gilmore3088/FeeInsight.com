import Link from "next/link";
import { formatFeeAmount } from "@/lib/format";

/**
 * The homepage fee-summary pattern ("What banks charge") as a list for narrow screens:
 * each row states its name, median, middle half (25th to 75th percentile) and institution
 * count in words and numbers. The strip is a picture of the same figures, hidden from
 * screen readers and explained by <RangeLegend />, so nobody has to read the strip to
 * get the numbers.
 */
export interface FeeSummaryItem {
  key: string;
  /** Fee or group name ("Overdraft (OD)", "Boston"). */
  label: string;
  /** Second, quieter part of the name ("District 1"). */
  sublabel?: string;
  href?: string;
  median: number | null | undefined;
  p25: number | null | undefined;
  p75: number | null | undefined;
  /** Lowest and highest institution value; shown only when both are given. */
  low?: number | null;
  high?: number | null;
  institutions: number;
}

const COUNT = new Intl.NumberFormat("en-US");

/** Thousands-separated dollars ("$5,000", "$2.50"). */
function usd(value: number): string {
  return formatFeeAmount(value) ?? "-";
}

function isNum(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function institutionsLabel(n: number): string {
  return `${COUNT.format(n)} ${n === 1 ? "institution" : "institutions"}`;
}

/** "Middle half $25–$35" or a plain statement that it is not available. */
export function middleHalfLabel(p25: number | null | undefined, p75: number | null | undefined): string {
  return isNum(p25) && isNum(p75) ? `Middle half ${usd(p25)}–${usd(p75)}` : "Middle half not available";
}

/**
 * Key for the strips: a dot for the median, a band for the middle half, and, when a
 * scale is given, the strip's numeric endpoints ("Strips run $0 to $55").
 */
export function RangeLegend({
  scaleMax,
  compact = false,
  className = "",
}: {
  scaleMax?: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <p className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#5A5347] ${className}`}>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-[#C44B2E]" />
        Median
      </span>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-1.5 w-5 rounded-full bg-[#C44B2E]/25" />
        {compact ? "Middle half" : "Middle half of institutions (25th to 75th percentile)"}
      </span>
      {isNum(scaleMax) && <span className="tabular-nums">Strips run {usd(0)} to {usd(scaleMax)}</span>}
    </p>
  );
}

/**
 * The strip drawn from $0 to `scaleMax`. Decorative: every value it shows is also in text.
 */
export function RangeStrip({
  median,
  p25,
  p75,
  scaleMax,
  className = "",
}: {
  median: number | null | undefined;
  p25: number | null | undefined;
  p75: number | null | undefined;
  scaleMax: number;
  className?: string;
}) {
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / Math.max(scaleMax, 1)) * 100))}%`;
  return (
    <div aria-hidden="true" className={`relative h-2.5 ${className}`}>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#E0D7C9]" />
      {isNum(p25) && isNum(p75) && (
        <div
          className="absolute top-1/2 h-1.5 min-w-1.5 -translate-y-1/2 rounded-full bg-[#C44B2E]/25"
          style={{ left: pct(p25), width: `calc(${pct(p75)} - ${pct(p25)})` }}
        />
      )}
      {isNum(median) && (
        <div
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C44B2E] ring-2 ring-[#FDFBF8]"
          style={{ left: pct(median) }}
        />
      )}
    </div>
  );
}

/**
 * Shared scale for a list, so strips in one list compare with each other: the largest 75th
 * percentile (or median) with headroom, so the band never sits on the right edge.
 */
export function stripScale(items: Pick<FeeSummaryItem, "median" | "p75">[]): number {
  const tops = items
    .map((i) => (isNum(i.p75) ? i.p75 : i.median))
    .filter((v): v is number => isNum(v) && v > 0);
  return tops.length > 0 ? niceCeil(Math.max(...tops) * 1.15) : 1;
}

/** Rounds up to 1, 2, 2.5 or 5 times a power of ten, so the stated endpoint is a round figure. */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value) ?? 10;
  return step * power;
}

export function FeeSummaryList({
  items,
  label,
  className = "",
}: {
  items: FeeSummaryItem[];
  /** Names the list for screen readers. */
  label: string;
  className?: string;
}) {
  const scaleMax = stripScale(items);
  return (
    <div className={className}>
      <RangeLegend compact scaleMax={scaleMax} className="border-b border-[#EDE6DA] px-4 py-2.5" />
      <ul aria-label={label} className="divide-y divide-[#EDE6DA]">
        {items.map((item) => {
          const body = (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-[14px] font-medium leading-snug text-[#1A1815] [overflow-wrap:anywhere]">
                  {item.label}
                  {item.sublabel && (
                    <span className="ml-1 font-normal text-[#5A5347]">{item.sublabel}</span>
                  )}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="text-xl font-semibold text-[#1A1815]">
                    {isNum(item.median) ? usd(item.median) : "-"}
                  </span>
                  <span className="ml-1 text-[12px] text-[#5A5347]">median</span>
                </span>
              </div>
              <RangeStrip median={item.median} p25={item.p25} p75={item.p75} scaleMax={scaleMax} className="mt-2" />
              <span className="mt-1.5 block text-[13px] leading-snug tabular-nums text-[#5A5347]">
                {middleHalfLabel(item.p25, item.p75)} · {institutionsLabel(item.institutions)}
                {!isNum(item.median) && " · not enough institutions yet for a median"}
              </span>
              {isNum(item.low) && isNum(item.high) && (
                <span className="mt-0.5 block text-[12px] tabular-nums text-[#5A5347]">
                  Lowest–highest {usd(item.low)}–{usd(item.high)}
                </span>
              )}
            </>
          );
          return (
            <li key={item.key}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="block px-4 py-3.5 no-underline transition-colors hover:bg-[#FAF7F2]/70"
                >
                  {body}
                </Link>
              ) : (
                <div className="px-4 py-3.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
