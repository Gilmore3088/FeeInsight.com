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

function stateCodeOrLabel(code: string | null, label: string | null): string {
  return code ?? label ?? "State";
}

function HeadlineCard({ row, stateLabel, stateCode }: { row: HeadlineRow; stateLabel: string | null; stateCode: string | null }) {
  const domainMax = rangeDomain(row.amount, [row.state, row.nation]);
  const reference = row.state ?? row.nation;
  const position = reference ? positionIn(row.amount, reference) : null;
  const where = row.state ? stateLabel : "U.S.";
  return (
    <li className="min-w-0 border-b border-border px-4 py-4 last:border-b-0 sm:rounded-xl sm:border sm:bg-surface-0 sm:shadow-fi-1 sm:last:border-b">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 text-[15px] font-semibold text-ink">{row.label}</h3>
        <span className="shrink-0 font-mono text-[22px] font-semibold tabular-nums text-ink">{money(row.amount)}</span>
      </div>
      {position && (
        <p className={`mt-0.5 text-[13px] font-medium ${TEXT[position]}`}>
          {VERDICT[position]} the {where} middle half
        </p>
      )}
      {row.spread && (
        <p className="text-[12px] text-ink-muted">
          {row.category === "overdraft" ? "Highest" : "Median"} of its {row.spread.count} fees, {money(row.spread.low)} to{" "}
          {money(row.spread.high)}
        </p>
      )}
      <div className="mt-3 space-y-1">
        {row.state && stateLabel && <MarketRange label={stateCode ?? stateLabel} band={row.state} amount={row.amount} domainMax={domainMax} />}
        {row.nation && <MarketRange label="U.S." band={row.nation} amount={row.amount} domainMax={domainMax} />}
      </div>
      {reference && (
        <p className="mt-2 font-mono text-[11px] tabular-nums text-ink-muted">
          {row.state ? stateCodeOrLabel(stateCode, stateLabel) : "U.S."} median {money(reference.median)} · middle half{" "}
          {money(reference.p25)}–{money(reference.p75)} · {reference.institutions.toLocaleString("en-US")} institutions
        </p>
      )}
      {row.sourceUrl && (
        <a
          href={row.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-ink-muted underline decoration-border underline-offset-2 hover:text-ink"
        >
          From its fee schedule
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
    </li>
  );
}

/** The hero exhibit: each headline fee placed in its state and the nation. */
export function MarketPosition({
  rows,
  stateLabel,
  stateCode,
  kind,
}: {
  rows: HeadlineRow[];
  /** "TX", the short label beside each state bar so every bar starts at the same point. */
  stateCode: string | null;
  /** "Texas"; null when the state has too few institutions for a median. */
  stateLabel: string | null;
  /** "bank" or "credit union", for the legend. */
  kind: string;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="market-position-heading" className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="market-position-heading" className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">
          Its fees against the market
        </h2>
        <Legend kind={kind} />
      </div>
      <ul className="overflow-hidden rounded-xl border border-border bg-surface-0 shadow-fi-1 sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none lg:grid-cols-3">
        {rows.map((row) => (
          <HeadlineCard key={row.category} row={row} stateLabel={stateLabel} stateCode={stateCode} />
        ))}
      </ul>
    </section>
  );
}

/** Below, inside and above the national middle half, across every fee with a benchmark. */
export function PositionSummary({ counts }: { counts: Record<Position, number> }) {
  const total = counts.below + counts.within + counts.above;
  if (total === 0) return null;
  const order: Position[] = ["below", "within", "above"];
  return (
    <figure className="rounded-xl border border-border bg-surface-0 p-4 shadow-fi-1">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold text-ink">All {total} fees vs. the U.S.</span>
      </figcaption>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-surface-200" aria-hidden="true">
        {order.map((p) =>
          counts[p] > 0 ? <span key={p} className={DOT[p]} style={{ width: `${(counts[p] / total) * 100}%` }} /> : null,
        )}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {order.map((p) => (
          <div key={p}>
            <dt className={`text-[12px] font-medium ${TEXT[p]}`}>{VERDICT[p]}</dt>
            <dd className="font-mono text-[20px] font-semibold tabular-nums text-ink">{counts[p]}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
