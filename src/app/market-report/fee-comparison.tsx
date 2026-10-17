/**
 * The report's one comparison exhibit: every compared fee as a row, largest gap to the local
 * median first, with its rank among local competitors drawn on one shared scale. Opening a row
 * (a native <details>, so it works without JavaScript; PrintOpen opens it for printing) shows
 * the local spread, the institution's own schedule line, and every competitor's published fee
 * with the schedule it was read from.
 */
import type { ReportLine } from "@/lib/custom-report/analysis";
import type { MarketBranchFootprint } from "@/lib/data-store/branches";
import { rankOf, ordinal, type PlottedLine } from "./[token]/at-a-glance";
import { ShowAll } from "./show-all";
import { EXTRA_BLOCK_ROW, ROWS_SHOWN, comparedAt, comparedLines, money, priceText } from "./report-view";

type Tone = "above" | "inside" | "below";

const DOT: Record<Tone, string> = { above: "bg-brick", inside: "bg-ink-soft", below: "bg-below-market" };
const TEXT: Record<Tone, string> = { above: "text-brick", inside: "text-ink", below: "text-below-market" };
const WORD: Record<Tone, string> = { above: "Above", inside: "Inside", below: "Below" };

function toneOf(line: ReportLine): Tone {
  if (line.position === "above_market") return "above";
  if (line.position === "in_market") return "inside";
  return "below";
}

function gapText(line: PlottedLine): string {
  const diff = line.own.amount - line.peers.median;
  if (Math.abs(diff) < 0.005) return "at median";
  return `${diff > 0 ? "+" : "-"}${money(Math.abs(diff))}`;
}

const GRID = "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 sm:grid-cols-[minmax(0,15rem)_minmax(8rem,1fr)_8.5rem_6rem_5.5rem]";

export interface FeeComparisonProps {
  name: string;
  lines: ReportLine[];
  /** Competitor names by institution id. */
  names: Map<number, string>;
  branches?: MarketBranchFootprint | null;
  footprint: (branches: MarketBranchFootprint | null | undefined, id: number) => string | null;
}

export function FeeComparison({ name, lines, names, branches, footprint }: FeeComparisonProps) {
  const rows = comparedLines(lines)
    .map((line) => ({ line, rank: rankOf(line), tone: toneOf(line) }))
    .sort((a, b) => Math.abs(b.line.own.amount - b.line.peers.median) - Math.abs(a.line.own.amount - a.line.peers.median));
  return (
    <ShowAll total={rows.length} shown={ROWS_SHOWN} noun="fees">
      <div role="list" aria-label={`${name}'s fees against local competitors`} className="border-y border-border">
        <div aria-hidden="true" className={`${GRID} border-b border-border py-2 text-[11px] uppercase tracking-[0.08em] text-ink-muted`}>
          <span>Fee</span>
          <span className="hidden justify-between sm:flex print:flex">
            <span>Lower</span>
            <span>Local median</span>
            <span>Higher</span>
          </span>
          <span className="text-right">{name.length > 16 ? "Its price" : name}</span>
          <span className="text-right">vs median</span>
          <span className="hidden text-right sm:block print:block">Position</span>
        </div>
        {rows.map(({ line, rank, tone }, index) => {
          const compared = comparedAt(line.key, line.own);
          const figures = [...line.peerFigures].sort((a, b) => a.amount - b.amount);
          return (
            <details
              key={line.key}
              role="listitem"
              className={`group/fee border-b border-border last:border-0 ${index >= ROWS_SHOWN ? EXTRA_BLOCK_ROW : ""}`}
            >
              <summary className={`${GRID} min-h-11 cursor-pointer list-none py-2.5 hover:bg-paper [&::-webkit-details-marker]:hidden`}>
                <span className="flex min-w-0 items-center gap-2 text-[14px] font-medium text-ink">
                  <span aria-hidden="true" className="inline-block text-ink-muted transition-transform group-open/fee:rotate-90 print:hidden">
                    &rsaquo;
                  </span>
                  {line.label}
                </span>
                <span className="relative order-last col-span-3 mt-2 block h-5 sm:order-none sm:col-span-1 sm:mt-0 sm:h-8 print:order-none print:col-span-1">
                  <span className="absolute inset-y-0 left-1/4 right-1/4 bg-surface-200" aria-hidden="true" />
                  <span className="absolute inset-y-0 left-1/2 w-px bg-ink-muted" aria-hidden="true" />
                  <span className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
                  <span
                    aria-hidden="true"
                    className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 [print-color-adjust:exact] ${DOT[tone]}`}
                    style={{ left: `${Math.min(98, Math.max(2, rank))}%` }}
                  />
                  <span className="sr-only">
                    {ordinal(Math.round(rank))} percentile among {line.peers.n} local competitors; middle 50% {money(line.peers.p25)} to{" "}
                    {money(line.peers.p75)}, median {money(line.peers.median)}.
                  </span>
                </span>
                <span className="text-right text-[14px] font-semibold tabular-nums text-ink">
                  {priceText(line.own).replace(", depending on account", "")}
                  {compared && <span className="block text-[11px] font-normal text-ink-muted">compared at {money(line.own.amount)}</span>}
                </span>
                <span className={`text-right text-[13px] tabular-nums ${TEXT[tone]}`}>{gapText(line)}</span>
                <span className={`hidden text-right text-[12px] font-semibold sm:block print:block ${TEXT[tone]}`}>{WORD[tone]}</span>
              </summary>

              <div className="grid gap-5 pb-5 pl-5 pr-1 pt-1 text-[13px] text-ink-soft lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-10">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 self-start">
                  <dt className="text-ink-muted">{name}</dt>
                  <dd className="text-right font-semibold tabular-nums text-ink">{priceText(line.own)}</dd>
                  {compared && (
                    <dd className="col-span-2 -mt-1 text-[12px] text-ink-muted">{compared}, the value the medians count for each institution.</dd>
                  )}
                  <dt className="text-ink-muted">Local median</dt>
                  <dd className="text-right tabular-nums text-ink">{money(line.peers.median)}</dd>
                  <dt className="text-ink-muted">Middle 50%</dt>
                  <dd className="text-right tabular-nums text-ink">
                    {money(line.peers.p25)} to {money(line.peers.p75)}
                  </dd>
                  <dt className="text-ink-muted">Population</dt>
                  <dd className="text-right text-ink">{line.peers.n} local competitors that publish it</dd>
                  <dt className="text-ink-muted">Charging less</dt>
                  <dd className="text-right tabular-nums text-ink">
                    {line.chargingLess ?? "-"} of {line.peers.n}
                  </dd>
                  <dt className="col-span-2 mt-2 text-ink-muted">
                    {name}&apos;s schedule: &ldquo;{line.own.source_line}&rdquo;
                    {line.own.source_url && (
                      <>
                        {" "}
                        <a href={line.own.source_url} className="inline-flex min-h-11 items-center underline sm:min-h-0" rel="noopener noreferrer" target="_blank">
                          source
                        </a>
                      </>
                    )}
                    {line.own.schedule_read_on ? `, read ${line.own.schedule_read_on}` : ""}
                  </dt>
                </dl>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted sm:mx-0 sm:text-left">
                    Each local competitor&apos;s published fee, lowest first
                  </p>
                  <ul className="mt-2 text-[12.5px]">
                    {figures.map((figure) => {
                      const where = footprint(branches, figure.institution_id);
                      const several = figure.tiers && new Set(figure.tiers.map((t) => t.amount)).size > 1;
                      return (
                        <li
                          key={figure.institution_id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border py-1.5 last:border-0 sm:grid-cols-[minmax(0,15rem)_7rem_minmax(0,1fr)]"
                        >
                          <span className="min-w-0 text-ink">
                            <a href={`/institution/${figure.institution_id}`} className="inline-flex min-h-11 items-center underline-offset-2 hover:underline sm:min-h-0">
                              {names.get(figure.institution_id) ?? `Institution ${figure.institution_id}`}
                            </a>
                            {where && <span className="block text-[11.5px] text-ink-muted">{where}</span>}
                          </span>
                          <span className="text-right tabular-nums text-ink">
                            {figure.source_url ? (
                              <a href={figure.source_url} className="inline-flex min-h-11 items-center justify-end underline decoration-border underline-offset-2 hover:decoration-brick sm:min-h-0" rel="noopener noreferrer" target="_blank">
                                {several ? priceText(figure).replace(", depending on account", "") : money(figure.amount)}
                              </a>
                            ) : several ? (
                              priceText(figure).replace(", depending on account", "")
                            ) : (
                              money(figure.amount)
                            )}
                          </span>
                          <span className="col-span-2 text-ink-muted sm:col-span-1">
                            &ldquo;{figure.source_line}&rdquo;{figure.schedule_read_on ? `, read ${figure.schedule_read_on}` : ""}
                            {several ? `; compared at ${money(figure.amount)}` : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </ShowAll>
  );
}
