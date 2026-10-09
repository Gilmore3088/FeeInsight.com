/**
 * Histogram of what institutions charge for one fee, drawn as plain server-rendered SVG.
 *
 * It used to be a client-side Recharts chart that sized itself after hydration, so a
 * crawler, a screenshot, a print or a slow phone could see the axes with no bars. Plain
 * SVG has its bars in the HTML. Each value is one institution (the same population as
 * the national median), so the bars add up to the institution count stated beside them.
 */

interface DistributionChartProps {
  /** One value per institution, in dollars. */
  values: number[];
  median: number | null;
  bucketCount?: number;
}

export interface HistogramBin {
  low: number;
  /** Exclusive upper edge; null for the open-ended last bin. */
  high: number | null;
  count: number;
}

const COUNT = new Intl.NumberFormat("en-US");
const formatCount = (n: number) => COUNT.format(n);

const BIN_WIDTHS = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000, 2500, 5000];

function money(n: number): string {
  return Number.isInteger(n) ? `$${n.toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

/**
 * Even dollar bins from $0. The top is set at the 98th percentile so one outlier cannot
 * squeeze every other bar into the first bin; anything above lands in an open "and up" bin.
 */
export function buildHistogram(values: number[], bucketCount = 16): HistogramBin[] {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const top = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
  const width = BIN_WIDTHS.find((w) => top / w <= bucketCount) ?? BIN_WIDTHS[BIN_WIDTHS.length - 1];
  const closedBins = Math.max(1, Math.floor(top / width) + 1);
  const bins: HistogramBin[] = Array.from({ length: closedBins }, (_, i) => ({
    low: i * width,
    high: (i + 1) * width,
    count: 0,
  }));
  const overflowFrom = closedBins * width;
  let overflow = 0;
  for (const v of sorted) {
    if (v >= overflowFrom) overflow++;
    else bins[Math.floor(v / width)].count++;
  }
  if (overflow > 0) bins.push({ low: overflowFrom, high: null, count: overflow });
  return bins;
}

function binLabel(bin: HistogramBin): string {
  return bin.high === null ? `${money(bin.low)} and up` : `${money(bin.low)} to under ${money(bin.high)}`;
}

/** Wide plot for tablets and up; a narrower plot on phones so the 14-unit tick labels stay near 11px. */
const WIDE_W = 440;
const NARROW_W = 300;
const VIEW_H = 220;
const PAD = { top: 16, right: 8, bottom: 30, left: 40 };

interface PlotProps {
  bins: HistogramBin[];
  median: number | null;
  viewW: number;
  /** At most this many dollar labels along the bottom. */
  maxLabels: number;
  label: string;
  className: string;
}

function Plot({ bins, median, viewW, maxLabels, label, className }: PlotProps) {
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const plotW = viewW - PAD.left - PAD.right;
  const plotH = VIEW_H - PAD.top - PAD.bottom;
  const slot = plotW / bins.length;
  const barW = Math.max(slot - 3, 1);
  const y = (count: number) => PAD.top + plotH - (count / maxCount) * plotH;
  const ticks = [0, Math.round(maxCount / 2), maxCount].filter((t, i, all) => all.indexOf(t) === i);
  // Median marker sits inside its bin, proportionally.
  const medianBinIndex =
    median === null ? -1 : bins.findIndex((b) => median >= b.low && (b.high === null || median < b.high));
  const medianX =
    medianBinIndex < 0 || median === null
      ? null
      : (() => {
          const bin = bins[medianBinIndex];
          const frac = bin.high === null ? 0.5 : (median - bin.low) / (bin.high - bin.low);
          return PAD.left + slot * (medianBinIndex + frac);
        })();
  const labelEvery = Math.ceil(bins.length / maxLabels);

  return (
    <svg viewBox={`0 0 ${viewW} ${VIEW_H}`} className={`h-auto w-full ${className}`} role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={viewW - PAD.right} y1={y(t)} y2={y(t)} stroke="#E8DFD1" strokeDasharray={t === 0 ? undefined : "3 3"} />
          <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize="14" fill="#6B6255">
            {formatCount(t)}
          </text>
        </g>
      ))}
      {bins.map((bin, i) => {
        const x = PAD.left + slot * i + (slot - barW) / 2;
        const top = y(bin.count);
        return (
          <g key={bin.low}>
            <rect x={x} y={top} width={barW} height={PAD.top + plotH - top} rx={2} fill="#C44B2E">
              <title>{`${binLabel(bin)}: ${formatCount(bin.count)} institutions`}</title>
            </rect>
            {i % labelEvery === 0 && bin.high !== null && (
              <text
                x={PAD.left + slot * i}
                y={VIEW_H - 8}
                fontSize="14"
                fill="#6B6255"
                textAnchor={PAD.left + slot * i > viewW - 60 ? "end" : "start"}
              >
                {money(bin.low)}
              </text>
            )}
          </g>
        );
      })}
      {medianX !== null && median !== null && (
        <g>
          <line x1={medianX} x2={medianX} y1={PAD.top} y2={PAD.top + plotH} stroke="#1A1815" strokeWidth={1.5} strokeDasharray="4 3" />
          <text
            x={medianX + 5}
            y={PAD.top + 10}
            fontSize="14"
            fontWeight="600"
            fill="#1A1815"
            textAnchor={medianX > viewW - 120 ? "end" : "start"}
            dx={medianX > viewW - 120 ? -10 : 0}
          >
            Median {money(median)}
          </text>
        </g>
      )}
    </svg>
  );
}

/** Axis titles are HTML, not SVG, so they keep the page's text size at any chart width and never rotate. */
const AXIS_TITLE = "text-[12px] font-semibold text-[#5A5347]";

export function DistributionChart({ values, median, bucketCount = 16 }: DistributionChartProps) {
  if (values.length < 3) {
    return (
      <p className="py-8 text-center text-sm text-[#5A5347]">
        Not enough institutions yet to show how this fee is spread.
      </p>
    );
  }

  const bins = buildHistogram(values, bucketCount);
  const total = values.length;
  const overflowBin = bins.find((b) => b.high === null) ?? null;
  const tallest = bins.reduce((a, b) => (b.count > a.count ? b : a), bins[0]);
  const label = `Histogram of ${formatCount(total)} institutions. Most common: ${binLabel(tallest)} (${formatCount(tallest.count)} institutions).${median !== null ? ` Median ${money(median)}.` : ""}`;

  return (
    <figure className="m-0">
      {/* Y-axis title, set above the axis's own numbers. */}
      <p aria-hidden="true" className={`mb-1 ${AXIS_TITLE}`}>
        Institutions
      </p>
      <Plot bins={bins} median={median} viewW={NARROW_W} maxLabels={4} label={label} className="sm:hidden" />
      <Plot bins={bins} median={median} viewW={WIDE_W} maxLabels={6} label={label} className="hidden sm:block" />
      {/* X-axis title, under the dollar labels. */}
      <p aria-hidden="true" className={`mt-1 text-right ${AXIS_TITLE}`}>
        Fee amount (US dollars)
      </p>
      <figcaption className="mt-2 text-[12px] text-[#5A5347]">
        Each bar counts institutions whose fee falls in that range; {formatCount(total)} institutions in all.
        {overflowBin ? ` The last bar is ${money(overflowBin.low)} and up.` : ""}
      </figcaption>
      <table className="sr-only">
        <caption>Institutions by fee amount</caption>
        <thead>
          <tr>
            <th scope="col">Fee</th>
            <th scope="col">Institutions</th>
          </tr>
        </thead>
        <tbody>
          {bins.map((bin) => (
            <tr key={bin.low}>
              <td>{binLabel(bin)}</td>
              <td>{bin.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
