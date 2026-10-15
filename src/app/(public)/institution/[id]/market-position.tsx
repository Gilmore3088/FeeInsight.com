import { ExternalLink } from "lucide-react";
import { formatFeeAmount } from "@/lib/format";

/** One market's spread for a fee: the live index entry's min, middle half, median and max. */
export interface MarketBand {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  institutions: number;
}

export interface HeadlineRow {
  category: string;
  label: string;
  /** The index's value for this institution (the median of its amounts; the highest for overdraft). */
  amount: number;
  /** Set when it publishes several amounts in the category. */
  spread: { count: number; low: number; high: number } | null;
  sourceUrl: string | null;
  state: MarketBand | null;
  nation: MarketBand | null;
}

export type Position = "below" | "within" | "above";

export function positionIn(amount: number, band: MarketBand): Position {
  return amount < band.p25 ? "below" : amount > band.p75 ? "above" : "within";
}

const DOT: Record<Position, string> = {
  below: "bg-below-market",
  within: "bg-in-range",
  above: "bg-above-market",
};

const TEXT: Record<Position, string> = {
  below: "text-below-market",
  within: "text-in-range",
  above: "text-above-market",
};

const VERDICT: Record<Position, string> = {
  below: "Below",
  within: "Inside",
  above: "Above",
};

const money = (n: number) => formatFeeAmount(n) ?? `$${n.toFixed(2)}`;

/** A scale that leaves room past the middle half and the fee itself, rounded to a clean dollar. */
export function rangeDomain(amount: number, bands: Array<MarketBand | null>): number {
  const tops = bands.filter((b): b is MarketBand => b !== null).map((b) => b.p75);
  const hi = Math.max(amount, ...tops, 1) * 1.4;
  const step = hi > 50 ? 10 : hi > 10 ? 5 : 1;
  return Math.ceil(hi / step) * step;
}

/**
 * The house range bar, full width: whisker from the market's lowest to highest fee (cut at the
 * scale's edge), the middle half as a band, the median as a tick and this institution as a dot.
 */
export function MarketRange({
  label,
  band,
  amount,
  domainMax,
}: {
  label: string;
  band: MarketBand;
  amount: number;
  domainMax: number;
}) {
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / domainMax) * 100))}%`;
  const position = positionIn(amount, band);
  const clipped = band.max > domainMax;
  const summary = `${label}: middle half ${money(band.p25)} to ${money(band.p75)}, median ${money(band.median)}, ${band.institutions} institutions; this fee ${money(amount)}, ${VERDICT[position].toLowerCase()} the middle half`;
  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2">
      <span className={`text-[12px] font-medium text-ink-muted`}>{label}</span>
      <span role="img" aria-label={summary} className="relative block h-6">
        <span
          className={`absolute top-1/2 h-px -translate-y-1/2 bg-control-border`}
          style={{
            left: pct(band.min),
            width: `calc(${pct(Math.min(band.max, domainMax))} - ${pct(band.min)})`,
            maskImage: clipped ? "linear-gradient(to right, black 85%, transparent)" : undefined,
          }}
        />
        <span
          className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-[3px] bg-brick-tint`}
          style={{ left: pct(band.p25), width: `max(2px, calc(${pct(band.p75)} - ${pct(band.p25)}))` }}
        />
        <span
          className={`absolute top-1/2 h-5 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-ink`}
          style={{ left: pct(band.median) }}
        />
        <span
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 ${DOT[position]}`}
          style={{ left: pct(amount) }}
        />
      </span>
    </div>
  );
}

function Legend({ kind }: { kind: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-hidden="true">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-5 rounded-[2px] bg-brick-tint" />
        Middle half
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3.5 w-[2px] bg-ink" />
        Median
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-in-range" />
        This {kind}
      </span>
    </p>
  );
}

/** The difference from a median, coloured by where the fee sits in that market's middle half. */
function Diff({ amount, band }: { amount: number; band: MarketBand | null }) {
  if (!band) return <span className="text-ink-muted">—</span>;
  const diff = amount - band.median;
  const position = positionIn(amount, band);
  return (
    <span className={`font-mono tabular-nums ${TEXT[position]}`}>
      {Math.abs(diff) < 0.005 ? "at median" : `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}`}
    </span>
  );
}

function HeadlineRowItem({ row, stateCode }: { row: HeadlineRow; stateCode: string | null }) {
  const domainMax = rangeDomain(row.amount, [row.state, row.nation]);
  const reference = row.state ?? row.nation;
  const place = row.state ? (stateCode ?? "State") : "U.S.";
  return (
    <li className="border-t border-border first:border-t-0">
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_4.5rem_5.5rem] items-baseline gap-2 px-4 py-3 hover:bg-paper sm:grid-cols-[minmax(0,1fr)_6rem_7rem_7rem] sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-baseline gap-2 text-[14px] text-ink">
            <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-90">›</span>
            <span className="truncate">{row.label}</span>
          </span>
          <span className="text-right font-mono text-[15px] font-semibold tabular-nums text-ink">{money(row.amount)}</span>
          <span className="text-right text-[13px]">
            <Diff amount={row.amount} band={reference} />
          </span>
          <span className="hidden text-right text-[13px] sm:block">
            {row.state && row.nation ? <Diff amount={row.amount} band={row.nation} /> : <span className="text-ink-muted">—</span>}
          </span>
        </summary>
        <div className="space-y-2 px-4 pb-4 sm:px-5">
          {row.spread && (
            <p className="text-[12px] text-ink-muted">
              {row.category === "overdraft" ? "Highest" : "Median"} of its {row.spread.count} fees, {money(row.spread.low)} to{" "}
              {money(row.spread.high)}
            </p>
          )}
          <div className="space-y-1">
            {row.state && <MarketRange label={stateCode ?? "State"} band={row.state} amount={row.amount} domainMax={domainMax} />}
            {row.nation && <MarketRange label="U.S." band={row.nation} amount={row.amount} domainMax={domainMax} />}
          </div>
          {reference && (
            <p className="font-mono text-[11px] tabular-nums text-ink-muted">
              {place} median {money(reference.median)} · middle half {money(reference.p25)}–{money(reference.p75)} ·{" "}
              {reference.institutions.toLocaleString("en-US")} institutions
            </p>
          )}
          {row.sourceUrl && (
            <a
              href={row.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink"
            >
              From its fee schedule
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
      </details>
    </li>
  );
}

/** One compact table of the headline fees; each row opens to its market bars, numbers and source. */
export function HeadlineTable({
  rows,
  stateCode,
  stateLabel,
  kind,
}: {
  rows: HeadlineRow[];
  /** "TX"; null when the state has too few institutions for a median. */
  stateCode: string | null;
  /** "Texas banks". */
  stateLabel: string | null;
  /** "bank" or "credit union", for the legend. */
  kind: string;
}) {
  if (rows.length === 0) return null;
  const vs = stateCode ? `vs ${stateCode}` : "vs U.S.";
  return (
    <section aria-labelledby="headline-table-heading" className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="headline-table-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">
          Its main fees against {stateLabel ?? "the U.S."}
        </h2>
        <Legend kind={kind} />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface-0 shadow-fi-1">
        <div
          aria-hidden="true"
          className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.5rem] gap-2 border-b border-border bg-paper px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted sm:grid-cols-[minmax(0,1fr)_6rem_7rem_7rem] sm:px-5"
        >
          <span>Fee</span>
          <span className="text-right">Its fee</span>
          <span className="text-right">{vs} median</span>
          <span className="hidden text-right sm:block">vs U.S. median</span>
        </div>
        <ul>
          {rows.map((row) => (
            <HeadlineRowItem key={row.category} row={row} stateCode={stateCode} />
          ))}
        </ul>
      </div>
      <p className="text-[12px] text-ink-muted">Tap a fee for its range, sample size and source.</p>
    </section>
  );
}
