import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { accountPricesText } from "@/lib/fee-representative";
import { money, positionOf, referenceOf, rowPriceText, type CheckBand, type CheckRow, type Position } from "./check-data";

const DOT: Record<Position, string> = {
  below: "bg-below-market",
  same: "bg-in-range",
  above: "bg-above-market",
};

const TEXT: Record<Position, string> = {
  below: "text-below-market",
  same: "text-in-range",
  above: "text-above-market",
};

const ACTION =
  "inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

/** A scale with room past the middle 50% and the compared value, rounded to a clean dollar. */
function domainOf(row: CheckRow): number {
  const tops = [row.state, row.nation].filter((b): b is CheckBand => b !== null).map((b) => b.p75);
  const hi = Math.max(row.high, ...tops, 1) * 1.4;
  const step = hi > 50 ? 10 : hi > 10 ? 5 : 1;
  return Math.ceil(hi / step) * step;
}

/** The house range bar: the market's middle 50% as a band, its median as a tick, this institution's prices as a span and its compared value as a dot. */
function RangeBar({ label, band, row, domain }: { label: string; band: CheckBand; row: CheckRow; domain: number }) {
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / domain) * 100))}%`;
  const position = positionOf(row.value, band.median);
  const summary = `${label}: middle 50% ${money(band.p25)} to ${money(band.p75)}, median ${money(band.median)}; this institution ${rowPriceText(row)}`;
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-[12px] font-medium text-ink-muted">{label}</span>
      <span role="img" aria-label={summary} className="relative block h-6">
        <span
          className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-[3px] bg-brick-tint"
          style={{ left: pct(band.p25), width: `max(2px, calc(${pct(band.p75)} - ${pct(band.p25)}))` }}
        />
        <span className="absolute top-1/2 h-5 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-ink" style={{ left: pct(band.median) }} />
        {row.low !== row.high && (
          <span
            className={`absolute top-1/2 h-1 -translate-y-1/2 rounded-full ${DOT[position]}`}
            style={{ left: pct(row.low), width: `calc(${pct(row.high)} - ${pct(row.low)})` }}
          />
        )}
        <span
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 ${DOT[position]}`}
          style={{ left: pct(row.value) }}
        />
      </span>
    </div>
  );
}

function Gap({ row, band }: { row: CheckRow; band: CheckBand | null }) {
  if (!band) return <span className="text-ink-muted">No median</span>;
  const position = positionOf(row.value, band.median);
  const diff = row.value - band.median;
  return (
    <span className={`font-mono tabular-nums ${TEXT[position]}`}>
      {position === "same" ? "About the same" : `${diff > 0 ? "+" : "-"}${money(Math.abs(diff))}`}
    </span>
  );
}

/** "Florida banks and credit unions, 412 institutions: median $7, middle 50% $5 to $10." */
function PopulationLine({ name, band }: { name: string; band: CheckBand }) {
  return (
    <p className="text-[12px] leading-snug text-ink-muted sm:mx-0 sm:text-left">
      {name}, {band.institutions.toLocaleString("en-US")} institutions: median{" "}
      <span className="font-mono tabular-nums">{money(band.median)}</span>, middle 50%{" "}
      <span className="font-mono tabular-nums">
        {money(band.p25)} to {money(band.p75)}
      </span>
      .
    </p>
  );
}

function Row({
  row,
  stateCode,
  stateLabel,
  guideHref,
}: {
  row: CheckRow;
  stateCode: string | null;
  stateLabel: string | null;
  guideHref: string | null;
}) {
  const ref = referenceOf(row);
  const domain = domainOf(row);
  const several = row.low !== row.high;
  const gapLabel = ref ? `vs ${ref.level === "state" ? (stateCode ?? "state") : "U.S."} median ` : "";
  return (
    <li className="border-t border-border first:border-t-0">
      <details className="group">
        <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_8.5rem] items-baseline gap-x-3 gap-y-0.5 px-4 py-3 hover:bg-paper sm:grid-cols-[minmax(0,1fr)_9rem_6rem_8.5rem] sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-baseline gap-2 text-[14px] text-ink">
            <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-90">
              ›
            </span>
            <span className="min-w-0 leading-snug">{row.label}</span>
          </span>
          <span className="text-right font-mono text-[15px] font-semibold tabular-nums text-ink">
            {several ? (
              <>
                {`${money(row.low)} to ${money(row.high)}`}
                <span className="block font-sans text-[11px] font-normal text-ink-muted">depending on account</span>
              </>
            ) : (
              money(row.value)
            )}
          </span>
          <span className="col-start-2 text-right text-[12px] text-ink-muted sm:col-start-auto sm:text-[13px]">
            {ref ? (
              <>
                <span className="sm:sr-only">{ref.level === "state" ? (stateCode ?? "State") : "U.S."} median </span>
                <span className="font-mono tabular-nums text-ink">{money(ref.band.median)}</span>
                <span className="block text-[11px]">
                  {ref.band.institutions.toLocaleString("en-US")} in {ref.level === "state" ? (stateCode ?? "state") : "U.S."}
                </span>
              </>
            ) : null}
          </span>
          <span className="col-start-2 text-right text-[13px] sm:col-start-auto">
            {gapLabel && <span className="text-[12px] text-ink-muted sm:sr-only">{gapLabel}</span>}
            <Gap row={row} band={ref?.band ?? null} />
            {row.comparedAt && (
              <span className="block text-[11px] text-ink-muted">Compared at {money(row.value)}</span>
            )}
          </span>
        </summary>
        <div className="space-y-2 px-4 pb-4 sm:px-5">
          {several && accountPricesText(row.prices, row.amounts) && (
            <p className="text-[13px] leading-snug text-ink sm:mx-0 sm:text-left">{accountPricesText(row.prices, row.amounts)}</p>
          )}
          {row.comparedAt && <p className="text-[12px] text-ink-muted sm:mx-0 sm:text-left">{row.comparedAt}.</p>}
          <div className="space-y-1">
            {row.state && <RangeBar label={stateCode ?? "State"} band={row.state} row={row} domain={domain} />}
            {row.nation && <RangeBar label="U.S." band={row.nation} row={row} domain={domain} />}
          </div>
          {row.state && stateLabel && <PopulationLine name={stateLabel} band={row.state} />}
          {row.nation && <PopulationLine name="U.S. banks and credit unions" band={row.nation} />}
          <div className="flex flex-wrap gap-x-5">
            {row.sourceUrl && (
              <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className={ACTION}>
                See the account terms
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
            {guideHref && (
              <Link href={guideHref} className={ACTION}>
                Ways to avoid this fee
              </Link>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}

/** The headline fees; each row opens to its prices, market bars, populations, source and guide. */
export function CheckTable({
  rows,
  stateCode,
  stateLabel,
  guideHrefs,
}: {
  rows: CheckRow[];
  stateCode: string | null;
  /** "Florida banks and credit unions"; null when every comparison is national. */
  stateLabel: string | null;
  guideHrefs: Record<string, string | null>;
}) {
  if (rows.length === 0) return null;
  const medianHead = stateCode ? `${stateCode} median` : "U.S. median";
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-0 shadow-fi-1">
      <div
        aria-hidden="true"
        className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-x-3 border-b border-border bg-paper px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted sm:grid-cols-[minmax(0,1fr)_9rem_6rem_8.5rem] sm:px-5"
      >
        <span>Fee</span>
        <span className="text-right">Its prices</span>
        <span className="hidden text-right sm:block">{medianHead}</span>
        <span className="hidden text-right sm:block">Compared vs median</span>
      </div>
      <ul>
        {rows.map((row) => (
          <Row key={row.category} row={row} stateCode={stateCode} stateLabel={stateLabel} guideHref={guideHrefs[row.category] ?? null} />
        ))}
      </ul>
    </div>
  );
}
