/**
 * The body of a Competitive Fee Position Report: the header card, the at-a-glance
 * table, findings, every fee line against the local market, the checking account lineup
 * (when the page loads one), named competitors with
 * the schedule each amount was read from, and sources and method. Shared by the
 * buyer's signed report (/market-report/[token]) and the public sample report, so the
 * sample always shows exactly what a buyer gets.
 */
import type { ReactNode } from "react";
import { SITE_NAME } from "@/lib/constants";
import {
  MIN_LOCAL_PEERS_PER_LINE,
  NAMED_WITHOUT_DEPOSITS,
  type LinePosition,
  type ReportLine,
} from "@/lib/custom-report/analysis";
import { FEE_LINE_LABELS } from "@/lib/custom-report/rules";
import type { MarketReport } from "@/lib/custom-report/report-data";
import type { MarketBranchFootprint } from "@/lib/data-store/branches";
import { incomeLabel, quarterLabel, type RevenueContext } from "@/lib/custom-report/revenue-context";
import { AtAGlance, SinceBought } from "./[token]/at-a-glance";
import { HamiltonClose } from "./[token]/hamilton-close";
import type { CheckingLineupView } from "@/lib/custom-report/checking-lineup";
import { CheckingLineupSection } from "./checking-lineup-section";
import { NamedCompetitorsPhone } from "./named-competitors-phone";

const SERIF = { fontFamily: "var(--fi-font-sans)" };
const MONO_FIGURE = { fontFamily: "var(--fi-font-mono)" } as const;
const DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

export const POSITION_LABEL: Record<LinePosition, string> = {
  above_market: "Above the local middle half",
  in_market: "Inside the local middle half",
  below_market: "Below the local middle half",
  free: "Free",
};

const POSITION_SHORT: Record<LinePosition, string> = {
  above_market: "Above",
  in_market: "Inside",
  below_market: "Below",
  free: "Free",
};

const POSITION_CLASS: Record<LinePosition, string> = {
  above_market: "bg-[#FBE9E4] text-brick",
  in_market: "bg-surface-200 text-ink",
  below_market: "bg-[#EAF0EC] text-below-market",
  free: "bg-[#EAF0EC] text-below-market",
};

function PositionChip({ line }: { line: ReportLine }) {
  if (!line.position) return <span className="text-[12px] text-ink-muted">—</span>;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${POSITION_CLASS[line.position]}`}>
      {/* Phones show the short word; the legend above the table says what it is the middle half of. */}
      <span className="sm:hidden print:hidden">{POSITION_SHORT[line.position]}</span>
      <span className="hidden sm:inline print:inline">{POSITION_LABEL[line.position]}</span>
    </span>
  );
}

/**
 * Why a line has no position: the institution's own fee is missing from its schedule, or too few
 * local competitors publish the line to compare it.
 */
export function notComparableNote(line: Pick<ReportLine, "own" | "peers">): string {
  if (!line.own && (line.peers?.n ?? 0) >= MIN_LOCAL_PEERS_PER_LINE) return "Your fee not found";
  return "Too few local competitors";
}

const DOT_CLASS: Record<LinePosition, string> = {
  above_market: "bg-brick",
  in_market: "bg-ink",
  below_market: "bg-below-market",
  free: "bg-below-market",
};

/**
 * The line as a picture: the local middle half shaded, the local median as a tick, the
 * institution's own amount as a dot. The axis widens so the dot always fits.
 */
export function LineRange({ line }: { line: ReportLine }) {
  if (!line.comparable || !line.peers || !line.own || !line.position) return null;
  const { p25, p75, median } = line.peers;
  const own = line.own.amount;
  const lo = Math.min(own, p25);
  const hi = Math.max(own, p75);
  const pad = Math.max((hi - lo) * 0.2, 1);
  // Not clamped at $0: the axis is never labelled, and a $0 dot needs room to sit whole.
  const min = lo - pad;
  const span = hi + pad - min;
  const x = (v: number) => ((v - min) / span) * 100;
  return (
    <span className="relative block h-4 w-full min-w-[7rem] [print-color-adjust:exact]" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 border-t border-border" />
      <span className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-brick-tint" style={{ left: `${x(p25)}%`, width: `${Math.max(x(p75) - x(p25), 1)}%` }} />
      <span className="absolute top-0 h-4 w-[2px] bg-ink/60" style={{ left: `${x(median)}%` }} />
      <span
        className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 ${DOT_CLASS[line.position]}`}
        style={{ left: `${x(own)}%` }}
      />
    </span>
  );
}

export interface MarketReportBodyProps {
  report: MarketReport;
  /** Small label over the title. */
  eyebrow: string;
  preparedOn: Date;
  /** Buttons in the header card (print, CSV, contact). */
  actions: ReactNode;
  /** Where "tell us" and "send us a question" links go. */
  contactHref: string;
  /** The closing line of sources and method: who to tell about a wrong figure. */
  correctionNote: ReactNode;
  /** Reported service-charge income; the section is left out when null. */
  revenue?: RevenueContext | null;
  /** Branch counts and deposits in the market counties; footprint lines are left out when null. */
  branches?: MarketBranchFootprint | null;
  /** The checking account lineup against local competitors; the section is left out when null. */
  lineup?: CheckingLineupView | null;
  /** "h2" when the page already has its own h1 (the public sample); a page has one h1. */
  titleAs?: "h1" | "h2";
}

/** Whole dollars -> "$2.4 billion" / "$310 million". */
function depositsLabel(dollars: number): string {
  if (dollars >= 1e9) return `$${(dollars / 1e9).toFixed(1)} billion`;
  return `$${Math.round(dollars / 1e6).toLocaleString("en-US")} million`;
}

/** "12 branches · 8.4% of local deposits", or null when the institution has no SOD branches here. */
/** "READING" -> "Reading", "KING OF PRUSSIA" -> "King of Prussia"; mixed-case names such as "McAllen" are kept. */
export function cityLabel(city: string): string {
  if (city !== city.toUpperCase()) return city;
  return city
    .toLowerCase()
    .replace(/(^|[\s\-'.])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/ (Of|The|And|On|In) /g, (word) => word.toLowerCase());
}

/** "READING, PA" -> "Reading, PA": the city part only, so the state code stays upper case. */
export function placeLabel(place: string): string {
  const cut = place.lastIndexOf(", ");
  return cut < 0 ? cityLabel(place) : `${cityLabel(place.slice(0, cut))}${place.slice(cut)}`;
}

export function footprintLine(branches: MarketBranchFootprint | null | undefined, institutionId: number): string | null {
  const own = branches?.byInstitution[institutionId];
  if (!branches || !own || own.branches === 0) return null;
  const share = own.deposits !== null && branches.totalDeposits > 0 ? (own.deposits / branches.totalDeposits) * 100 : null;
  const shareText = share === null ? "" : share < 0.1 ? " · under 0.1% of local deposits" : ` · ${share.toFixed(1)}% of local deposits`;
  return `${own.branches} ${own.branches === 1 ? "branch" : "branches"}${shareText}`;
}

function RevenueSection({ name, charterType, revenue }: { name: string; charterType: string | null; revenue: RevenueContext }) {
  const latest = revenue.quarters[0];
  const filing = charterType === "credit_union" ? "NCUA 5300 Call Report" : "FDIC Call Report";
  return (
    <section className="mt-8 rounded-xl border border-border bg-surface-0 p-6" aria-labelledby="revenue-heading">
      <h2 id="revenue-heading" className="font-bold text-xl text-ink" style={SERIF}>
        Fee income behind these prices
      </h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Deposit service charges, {quarterLabel(latest.quarter)}
          </dt>
          <dd className="font-semibold mt-1 text-[1.35rem] tabular-nums text-ink" style={MONO_FIGURE}>
            {incomeLabel(latest.thousands)}
          </dd>
        </div>
        {revenue.trailingThousands !== null && (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Last four quarters</dt>
            <dd className="font-semibold mt-1 text-[1.35rem] tabular-nums text-ink" style={MONO_FIGURE}>
              {incomeLabel(revenue.trailingThousands)}
            </dd>
          </div>
        )}
        {revenue.peer && (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Median for its size, {quarterLabel(latest.quarter)}
            </dt>
            <dd className="font-semibold mt-1 text-[1.35rem] tabular-nums text-ink" style={MONO_FIGURE}>
              {incomeLabel(revenue.peer.medianThousands)}
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">
        {name} reported these figures in its {filing}.
        {revenue.peer &&
          ` Among the ${revenue.peer.count.toLocaleString("en-US")} institutions of its size (${revenue.peer.tierLabel} in assets) that reported for the quarter, it ranks ${revenue.peer.rank.toLocaleString("en-US")} by this income, where 1 is the highest.`}{" "}
        A published schedule does not say how often each fee is charged, so this report does not estimate what any one
        fee earns.
      </p>
    </section>
  );
}

export function MarketReportBody({ report, eyebrow, preparedOn, actions, contactHref, correctionNote, revenue, branches, lineup, titleAs: Title = "h1" }: MarketReportBodyProps) {
  const { data, analysis, savedAt, sinceBought } = report;
  const market = data.market!;
  const droppedCount = Object.values(data.dropped ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
  const name = data.subject.institution_name;
  const marketLabel = `${placeLabel(market.places[0])} area${market.county_fips.length > 1 ? ` (${market.county_fips.length} counties)` : ""}`;
  const comparable = analysis.lines.filter((l) => l.comparable);
  const tableKeys = comparable.slice(0, 6).map((l) => l.key);
  const ownFees = Object.fromEntries(analysis.lines.filter((l) => l.own).map((l) => [l.key, l.own!.amount]));
  const competitorName = new Map(data.competitors.map((c) => [c.institution_id, c.institution_name]));

  return (
    <>
      <section className="flex flex-col gap-5 rounded-xl border border-border bg-surface-0 p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brick">{eyebrow}</p>
          <Title className="font-semibold mt-2 text-[1.5rem] leading-tight tracking-[-0.02em] text-ink sm:text-[1.85rem]" style={SERIF}>
            {name} against its local market
          </Title>
          <p className="mt-2 text-[14px] text-ink-soft">
            {marketLabel} · verified fees for {analysis.readiness.competitorsWithData} of{" "}
            {analysis.readiness.competitorsInMarket} local competitors · prepared{" "}
            {DATE.format(preparedOn)} by {SITE_NAME}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 print:hidden">{actions}</div>
      </section>

      {!analysis.readiness.ready ? (
        <section className="mt-8 rounded-xl border border-border bg-surface-0 p-6">
          <h2 className="font-bold text-xl text-ink" style={SERIF}>
            This market is being refreshed
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            {analysis.readiness.reason} We only show a comparison when the local data supports it.{" "}
            <a href={contactHref} className="underline">
              Send us a question
            </a>
            .
          </p>
        </section>
      ) : (
        <>
          {savedAt && (
            <p className="mt-6 rounded-md border border-border bg-surface-0 px-4 py-3 text-sm text-ink-soft" role="status">
              These figures are the ones saved on {DATE.format(new Date(savedAt))}, when this report was bought. Our live
              data for your market is being refreshed; the report switches back to live figures once it passes our checks
              again.
            </p>
          )}
          <AtAGlance lines={analysis.lines} />
          {sinceBought && <SinceBought savedAt={sinceBought.savedAt} changes={sinceBought.changes} />}
          <section className="mt-8 rounded-xl border border-border bg-surface-0 p-4 sm:p-6" aria-labelledby="findings-heading">
            <h2 id="findings-heading" className="font-bold text-xl text-ink" style={SERIF}>
              What stands out
            </h2>
            <ul className="mt-3 space-y-2 text-[15px] leading-relaxed text-ink">
              {analysis.findings.map((finding) => (
                <li key={finding} className="flex gap-2">
                  <span className="text-brick">●</span>
                  {finding}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8 rounded-xl border border-border bg-surface-0 p-4 sm:overflow-x-auto sm:p-6" aria-labelledby="lines-heading">
            <h2 id="lines-heading" className="font-bold text-xl text-ink" style={SERIF}>
              Your fees against local competitors
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              A line is compared only when at least {MIN_LOCAL_PEERS_PER_LINE} local competitors publish it.
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted print:hidden" aria-hidden="true">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-5 rounded-full bg-brick-tint" /> Local middle half
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-[2px] bg-ink/60" /> Local median
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-brick" /> {name}, above
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-ink" /> Inside
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-below-market" /> Below
              </span>
            </p>
            {/* Phones get the four columns that fit; every figure is also in the named competitors and method below. */}
            <table className="mt-4 w-full text-left text-sm sm:min-w-[760px] print:min-w-0">
              <thead className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Fee</th>
                  <th className="py-2 pr-3 text-right font-semibold">Yours</th>
                  <td className="hidden w-[22%] py-2 pr-4 sm:table-cell print:hidden" aria-hidden="true" />
                  <th className="py-2 pr-3 text-right font-semibold">Local median</th>
                  <th className="hidden py-2 pr-3 text-right font-semibold sm:table-cell print:table-cell">Middle half</th>
                  <th className="hidden py-2 pr-3 text-right font-semibold sm:table-cell print:table-cell">Competitors</th>
                  <th className="hidden py-2 pr-3 text-right font-semibold sm:table-cell print:table-cell">Charging less</th>
                  <th className="py-2 font-semibold">Position</th>
                </tr>
              </thead>
              <tbody>
                {analysis.lines.map((line) => (
                  <tr key={line.key} className="border-b border-surface-200 last:border-0">
                    <td className="py-2 pr-3 text-ink">{line.label}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {line.own ? money(line.own.amount) : "Not found"}
                      {line.own?.tiers && line.own.tiers.length > 1 && (
                        <span className="block text-[11px] text-ink-muted">
                          tiered: {line.own.tiers.map((tier) => money(tier.amount)).join(" / ")}
                        </span>
                      )}
                    </td>
                    <td className="hidden py-2 pr-4 sm:table-cell print:hidden" aria-hidden="true">
                      <LineRange line={line} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{line.comparable ? money(line.peers?.median) : "—"}</td>
                    <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell print:table-cell">
                      {line.comparable && line.peers ? `${money(line.peers.p25)}–${money(line.peers.p75)}` : "—"}
                    </td>
                    <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell print:table-cell">{line.peers?.n ?? 0}</td>
                    <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell print:table-cell">
                      {line.chargingLess !== null && line.peers ? `${line.chargingLess} of ${line.peers.n}` : "—"}
                    </td>
                    <td className="py-2">
                      {line.comparable ? <PositionChip line={line} /> : <span className="text-[12px] text-ink-muted">{notComparableNote(line)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {lineup && <CheckingLineupSection name={name} lineup={lineup} live={Boolean(savedAt)} />}

          {revenue && <RevenueSection name={name} charterType={data.subject.charter_type} revenue={revenue} />}

          {analysis.named.length > 0 && (
            <section className="mt-8 rounded-xl border border-border bg-surface-0 p-4 sm:overflow-x-auto sm:p-6" aria-labelledby="named-heading">
              <h2 id="named-heading" className="font-bold text-xl text-ink" style={SERIF}>
                Named competitors, same lines
              </h2>
              <p className="mt-1 text-[13px] text-ink-muted">
                Banks by deposits held in your market (FDIC Summary of Deposits, {market.sod_year}), then up to{" "}
                {NAMED_WITHOUT_DEPOSITS} credit unions, which the Summary of Deposits does not cover, chosen by how many of
                your fees they publish. Each amount links to the schedule it was read from.
                {branches &&
                  ` The market's ${branches.totalBranches.toLocaleString("en-US")} bank branches hold ${depositsLabel(branches.totalDeposits)} in deposits; under each bank are its branches and share of those deposits. Credit unions show branches only, in the market's cities, because NCUA reports no deposits by branch.`}
              </p>
              <NamedCompetitorsPhone
                lines={tableKeys.map((key) => ({ key, label: FEE_LINE_LABELS[key] ?? key }))}
                subject={{
                  id: data.subject.institution_id,
                  name,
                  detail: footprintLine(branches, data.subject.institution_id),
                  href: null,
                  fees: Object.fromEntries(tableKeys.map((key) => [key, key in ownFees ? { amount: ownFees[key], url: null, line: null } : undefined])),
                }}
                competitors={analysis.named.map((competitor) => ({
                  id: competitor.institution_id,
                  name: competitor.institution_name,
                  detail: [competitor.city ? cityLabel(competitor.city) : null, footprintLine(branches, competitor.institution_id)].filter(Boolean).join(" · ") || null,
                  href: `/institution/${competitor.institution_id}`,
                  fees: Object.fromEntries(
                    tableKeys.map((key) => [
                      key,
                      competitor.fees[key] === undefined
                        ? undefined
                        : { amount: competitor.fees[key], url: competitor.sources[key]?.source_url ?? null, line: competitor.sources[key]?.source_line ?? null },
                    ]),
                  ),
                }))}
              />
              <table className="mt-4 hidden w-full min-w-[760px] text-left text-sm sm:table print:table">
                <thead className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                  <tr>
                    <th className="min-w-[240px] py-2 pr-3 font-semibold">Institution</th>
                    {tableKeys.map((key) => (
                      <th key={key} className="py-2 pr-3 text-right font-semibold">
                        {FEE_LINE_LABELS[key]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-surface-200 bg-[#FBF3EF] font-semibold">
                    <td className="py-2 pr-3">
                      {name}
                      {footprintLine(branches, data.subject.institution_id) && (
                        <span className="block whitespace-nowrap text-[12px] font-normal text-ink-muted">{footprintLine(branches, data.subject.institution_id)}</span>
                      )}
                    </td>
                    {tableKeys.map((key) => (
                      <td key={key} className="py-2 pr-3 text-right tabular-nums">
                        {money(ownFees[key])}
                      </td>
                    ))}
                  </tr>
                  {analysis.named.map((competitor) => (
                    <tr key={competitor.institution_id} className="border-b border-surface-200 last:border-0">
                      <td className="py-2 pr-3">
                        <a href={`/institution/${competitor.institution_id}`} className="text-ink underline-offset-2 hover:underline">
                          {competitor.institution_name}
                        </a>
                        {competitor.city && <span className="whitespace-nowrap text-[12px] text-ink-muted"> · {cityLabel(competitor.city)}</span>}
                        {footprintLine(branches, competitor.institution_id) && (
                          <span className="block whitespace-nowrap text-[12px] text-ink-muted">{footprintLine(branches, competitor.institution_id)}</span>
                        )}
                      </td>
                      {tableKeys.map((key) => {
                        const source = competitor.sources[key];
                        return (
                          <td key={key} className="py-2 pr-3 text-right tabular-nums">
                            {source?.source_url ? (
                              <a
                                href={source.source_url}
                                title={`“${source.source_line}”`}
                                className="underline decoration-border underline-offset-2 hover:decoration-brick"
                                rel="noopener noreferrer"
                                target="_blank"
                              >
                                {money(competitor.fees[key])}
                              </a>
                            ) : (
                              money(competitor.fees[key])
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="mt-8 rounded-xl border border-border bg-surface-0 p-4 text-[13px] sm:p-6 leading-relaxed text-ink-soft" aria-labelledby="method-heading">
            <h2 id="method-heading" className="font-bold text-lg text-ink" style={SERIF}>
              Sources and method
            </h2>
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Market</dt>
                <dd className="mt-1">
                  The {market.county_fips.length === 1 ? "county" : `${market.county_fips.length} counties`}{" "}
                  {market.basis === "branch_counties" ? "holding most of your deposits" : "around your headquarters"}, from the
                  FDIC Summary of Deposits, {market.sod_year}.
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Competitors</dt>
                <dd className="mt-1">Every bank with a branch there and every institution headquartered there.</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Figures</dt>
                <dd className="mt-1">
                  One published fee per institution and line, each a line of its own schedule. &ldquo;Read&rdquo; is the day we
                  saved that schedule.
                </dd>
              </div>
            </dl>
            <details className="mt-4 rounded-md border border-border bg-white/60 p-3">
              <summary className="cursor-pointer font-semibold text-ink">How each figure is chosen</summary>
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                <li>A figure is used only when a line of the institution&apos;s stored schedule states that amount as the fee.</li>
                <li>
                  Left out: balance thresholds, amounts that depend on a balance band, amounts not found in the schedule, fee
                  caps, fees under review for a correction, business prices, savings fees on the checking line, and records
                  whose fee name was not read cleanly
                  {droppedCount > 0 ? ` (${droppedCount} published figures in this market)` : ""}.
                </li>
                <li>
                  When a schedule lists several versions of a fee, the standard consumer version is used, not an online,
                  business or other special one. If several remain, the lowest monthly maintenance fee and the highest amount
                  for every other fee.
                </li>
              </ul>
            </details>
            <details className="mt-3 rounded-md border border-border bg-white/60 p-3">
              <summary className="cursor-pointer font-semibold text-ink">Your fees, in your schedule&apos;s words</summary>
            <ul className="mt-2 space-y-1.5">
              {analysis.lines
                .filter((line) => line.own)
                .map((line) => (
                  <li key={line.key}>
                    {line.label}: {money(line.own!.amount)}, as your schedule states it: “{line.own!.source_line}”
                    {line.own!.tiers && line.own!.tiers.length > 1 && (
                      <>
                        {" "}
                        Your schedule states {line.own!.tiers.length} amounts for this fee (
                        {line.own!.tiers.map((tier) => `${money(tier.amount)}: “${tier.source_line}”`).join("; ")}); the
                        comparison uses {money(line.own!.amount)}.
                      </>
                    )}
                    {line.own!.source_url && (
                      <>
                        {" "}
                        (
                        <a href={line.own!.source_url} className="underline" rel="noopener noreferrer" target="_blank">
                          source
                        </a>
                        {line.own!.schedule_read_on ? `, read ${line.own!.schedule_read_on}` : ""})
                      </>
                    )}
                  </li>
                ))}
            </ul>
            </details>
            <details className="mt-3 rounded-md border border-border bg-white/60 p-3">
              <summary className="cursor-pointer font-semibold text-ink">
                Every competitor figure behind the local numbers, with its source
              </summary>
              {comparable.map((line) => (
                <div key={line.key} className="mt-4">
                  <h3 className="text-[13px] font-semibold text-ink">
                    {line.label} ({line.peerFigures.length} competitors)
                  </h3>
                  {/* One stacked row per figure, so the schedule's words wrap instead of scrolling sideways. */}
                  <ul className="mt-1 text-[12px]">
                      {line.peerFigures.map((figure) => (
                        <li key={figure.institution_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-surface-200 py-1 last:border-0 sm:grid-cols-[minmax(0,14rem)_4rem_minmax(0,1fr)_auto]">
                          <span className="text-ink">{competitorName.get(figure.institution_id) ?? `Institution ${figure.institution_id}`}</span>
                          <span className="text-right tabular-nums text-ink">{money(figure.amount)}</span>
                          <span className="col-span-2 sm:col-span-1">“{figure.source_line}”</span>
                          <span className="col-span-2 sm:col-span-1 sm:whitespace-nowrap">
                            {figure.source_url ? (
                              <a href={figure.source_url} className="underline" rel="noopener noreferrer" target="_blank">
                                source
                              </a>
                            ) : (
                              "stored copy"
                            )}
                            {figure.schedule_read_on ? `, read ${figure.schedule_read_on}` : ""}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </details>
            <p className="mt-3">{correctionNote}</p>
          </section>
          <HamiltonClose
            competitors={analysis.readiness.competitorsWithData}
            institutionId={data.subject.institution_id}
          />
        </>
      )}
    </>
  );
}
