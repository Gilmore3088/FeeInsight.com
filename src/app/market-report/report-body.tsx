/**
 * The body of a Competitive Fee Position Report, laid out as a research brief: a short header,
 * then sections that each run title -> one finding -> one labeled exhibit -> source. Position in
 * the local market (the ranked rows), fee by fee, the checking account lineup and fee income
 * when the page loads them, named competitors with the schedule behind every amount, and the
 * method behind one disclosure. Shared by the buyer's signed report (/market-report/[token])
 * and the public sample report, so the sample always shows exactly what a buyer gets. Section
 * heads, source notes and figures follow the district and state pages (district-hub.tsx).
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
import { AtAGlance, SinceBought, sinceBoughtFinding } from "./[token]/at-a-glance";
import { HamiltonClose } from "./[token]/hamilton-close";
import type { CheckingLineupView } from "@/lib/custom-report/checking-lineup";
import { CheckingLineupSection } from "./checking-lineup-section";
import { NamedCompetitorsPhone } from "./named-competitors-phone";
import { HubSection, KICKER } from "@/app/(public)/research/district/[id]/district-hub";
import { Disclosure } from "./disclosure";
import { ShowAll } from "./show-all";
import { EXTRA_ROW, ROWS_SHOWN, comparedLines, leftOutNote, namedFinding, positionFinding, widestGapFinding } from "./report-view";

const DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

export const POSITION_LABEL: Record<LinePosition, string> = {
  above_market: "Above the local middle 50%",
  in_market: "Inside the local middle 50%",
  below_market: "Below the local middle 50%",
  free: "Free",
};

const POSITION_SHORT: Record<LinePosition, string> = {
  above_market: "Above",
  in_market: "Inside",
  below_market: "Below",
  free: "Free",
};

const POSITION_CLASS: Record<LinePosition, string> = {
  above_market: "bg-brick-tint/60 text-brick",
  in_market: "bg-surface-200 text-ink",
  below_market: "bg-below-market/10 text-below-market",
  free: "bg-below-market/10 text-below-market",
};

function PositionChip({ line }: { line: ReportLine }) {
  if (!line.position) return <span className="text-[12px] text-ink-muted">-</span>;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${POSITION_CLASS[line.position]}`}>
      {/* Phones show the short word; the column heading says what it is the middle 50% of. */}
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
  if (!line.own && (line.peers?.n ?? 0) >= MIN_LOCAL_PEERS_PER_LINE) return "Not found in your schedule";
  return "Too few local competitors";
}

const DOT_CLASS: Record<LinePosition, string> = {
  above_market: "bg-brick",
  in_market: "bg-ink",
  below_market: "bg-below-market",
  free: "bg-below-market",
};

/**
 * The line as a picture: the local middle 50% shaded, the local median as a tick, the
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
  /** The closing Hamilton band; the public sample has its own close (the report request) instead. */
  close?: boolean;
}

/** Whole dollars -> "$2.4 billion" / "$310 million". */
function depositsLabel(dollars: number): string {
  if (dollars >= 1e9) return `$${(dollars / 1e9).toFixed(1)} billion`;
  return `$${Math.round(dollars / 1e6).toLocaleString("en-US")} million`;
}

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

/** "12 branches · 8.4% of local deposits", or null when the institution has no SOD branches here. */
export function footprintLine(branches: MarketBranchFootprint | null | undefined, institutionId: number): string | null {
  const own = branches?.byInstitution[institutionId];
  if (!branches || !own || own.branches === 0) return null;
  const share = own.deposits !== null && branches.totalDeposits > 0 ? (own.deposits / branches.totalDeposits) * 100 : null;
  const shareText = share === null ? "" : share < 0.1 ? " · under 0.1% of local deposits" : ` · ${share.toFixed(1)}% of local deposits`;
  return `${own.branches} ${own.branches === 1 ? "branch" : "branches"}${shareText}`;
}

const TH = "py-2 pr-3 font-semibold";
const FIGURE_CAPTION = "text-[14px] font-semibold text-ink";

function RevenueSection({ name, charterType, revenue }: { name: string; charterType: string | null; revenue: RevenueContext }) {
  const latest = revenue.quarters[0];
  const filing = charterType === "credit_union" ? "NCUA 5300 Call Report" : "FDIC Call Report";
  const tiles = [
    { label: `Deposit service charges, ${quarterLabel(latest.quarter)}`, value: incomeLabel(latest.thousands) },
    ...(revenue.trailingThousands !== null ? [{ label: "Last four quarters", value: incomeLabel(revenue.trailingThousands) }] : []),
    ...(revenue.peer ? [{ label: `Median for its size, ${quarterLabel(latest.quarter)}`, value: incomeLabel(revenue.peer.medianThousands) }] : []),
  ];
  const finding = revenue.peer
    ? `${name} reported ${incomeLabel(latest.thousands)} in deposit service charges in ${quarterLabel(latest.quarter)}, ranking ${revenue.peer.rank.toLocaleString("en-US")} of ${revenue.peer.count.toLocaleString("en-US")} institutions its size, where 1 is the highest.`
    : `${name} reported ${incomeLabel(latest.thousands)} in deposit service charges in ${quarterLabel(latest.quarter)}.`;
  return (
    <HubSection
      id="revenue"
      title="Fee income"
      line={finding}
      source={
        <>
          {name}&apos;s {filing}, {quarterLabel(latest.quarter)}
          {revenue.peer && `; median of institutions with ${revenue.peer.tierLabel} in assets that reported for the quarter`}.
        </>
      }
    >
      <figure className="min-w-0 max-w-5xl">
      <figcaption className={FIGURE_CAPTION}>{name}&apos;s reported fee income, from its {filing}</figcaption>
      <dl className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="flex min-w-0 flex-col-reverse border-l-2 border-brick pl-4">
            <dt className="mt-2 text-[13px] leading-snug text-ink-soft">{t.label}</dt>
            <dd className="font-mono text-[24px] font-semibold leading-tight tabular-nums tracking-[-0.02em] text-ink sm:text-[22px] lg:text-[30px]">
              {t.value}
            </dd>
          </div>
        ))}
      </dl>
      </figure>
    </HubSection>
  );
}

export function MarketReportBody({ report, eyebrow, preparedOn, actions, contactHref, correctionNote, revenue, branches, lineup, titleAs: Title = "h1", close = true }: MarketReportBodyProps) {
  const { data, analysis, savedAt, sinceBought } = report;
  const market = data.market!;
  const droppedCount = Object.values(data.dropped ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
  const name = data.subject.institution_name;
  const marketLabel = `${placeLabel(market.places[0])} area${market.county_fips.length > 1 ? ` (${market.county_fips.length} counties)` : ""}`;
  const comparable = analysis.lines.filter((l) => l.comparable);
  const compared = comparedLines(analysis.lines);
  // Fee by fee: the furthest from the local median first, so the differences lead.
  const byGap = [...compared].sort((a, b) => Math.abs(b.own.amount - b.peers.median) - Math.abs(a.own.amount - a.peers.median));
  const leftOut = leftOutNote(name, analysis.lines);
  const tableKeys = comparable.slice(0, 6).map((l) => l.key);
  const ownFees = Object.fromEntries(analysis.lines.filter((l) => l.own).map((l) => [l.key, l.own!.amount]));
  const competitorName = new Map(data.competitors.map((c) => [c.institution_id, c.institution_name]));
  const { competitorsWithData, competitorsInMarket } = analysis.readiness;
  const firstLine = tableKeys[0] ? { key: tableKeys[0], label: FEE_LINE_LABELS[tableKeys[0]] ?? tableKeys[0] } : undefined;
  const named = namedFinding(name, firstLine, firstLine ? ownFees[firstLine.key] : undefined, analysis.named);
  const marketSource = `${market.county_fips.length === 1 ? "The county" : `The ${market.county_fips.length} counties`} ${
    market.basis === "branch_counties" ? `holding most of ${name}'s deposits` : `around ${name}'s headquarters`
  } (FDIC Summary of Deposits, ${market.sod_year}).`;

  return (
    <div className="space-y-14 sm:space-y-20">
      <header className="grid gap-6 border-b border-border pb-8 text-center sm:text-left lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-12">
        <div className="min-w-0">
          <p className={KICKER}>{eyebrow}</p>
          <Title className="mt-2 text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[44px]">
            {name} against its local market
          </Title>
          <p className="mx-auto mt-3 text-[15px] text-ink-soft sm:mx-0">
            {marketLabel} · prepared {DATE.format(preparedOn)} by {SITE_NAME}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3 sm:justify-start print:hidden">{actions}</div>
        </div>
        {analysis.readiness.ready && (
          <dl className="mx-auto grid grid-cols-2 gap-6 text-left sm:mx-0 sm:max-w-md">
            <div className="flex flex-col-reverse border-l-2 border-brick pl-4">
              <dt className="mt-2 text-[13px] leading-snug text-ink-soft">fees compared with local competitors</dt>
              <dd className="font-mono text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-ink sm:text-[40px]">{compared.length}</dd>
            </div>
            <div className="flex flex-col-reverse border-l-2 border-brick pl-4">
              <dt className="mt-2 text-[13px] leading-snug text-ink-soft">of {competitorsInMarket} local competitors with verified fees</dt>
              <dd className="font-mono text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-ink sm:text-[40px]">{competitorsWithData}</dd>
            </div>
          </dl>
        )}
      </header>

      {!analysis.readiness.ready ? (
        <section aria-labelledby="refresh-heading" className="max-w-3xl">
          <h2 id="refresh-heading" className="text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[36px]">
            This market is being refreshed
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft sm:mx-0">
            {analysis.readiness.reason} A comparison shows only when the local data supports it.{" "}
            <a href={contactHref} className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
              Send a question
            </a>
          </p>
        </section>
      ) : (
        <>
          {savedAt && (
            <p className="-mt-6 rounded-md border border-border bg-surface-0 px-4 py-3 text-sm text-ink-soft sm:-mt-10 sm:mx-0 sm:text-left" role="status">
              These figures are the ones saved on {DATE.format(new Date(savedAt))}, when this report was bought. The live data for
              this market is being refreshed; the report switches back to live figures once it passes its checks again.
            </p>
          )}

          <HubSection
            id="position"
            title="Position in the local market"
            line={positionFinding(name, analysis.lines)}
            source={`Each institution's own published fee schedule; market from the FDIC Summary of Deposits, ${market.sod_year}. Definitions under Sources and method.`}
          >
            <figure className="min-w-0 max-w-5xl">
              <figcaption className={FIGURE_CAPTION}>{name}&apos;s fees ranked against local competitors, highest first</figcaption>
              <div className="mt-4">
                <AtAGlance lines={analysis.lines} bare fold={ROWS_SHOWN} ownLabel={name.length > 18 ? "Amount" : name} />
              </div>
            </figure>
          </HubSection>

          {sinceBought && (
            <HubSection
              id="since"
              title="Since this report was bought"
              line={sinceBoughtFinding(sinceBought.savedAt, sinceBought.changes)}
              source={`${name}'s fees, the local medians and the named competitors' published fees, today against the copy saved at purchase.`}
            >
              <SinceBought name={name} changes={sinceBought.changes} />
            </HubSection>
          )}

          <HubSection
            id="lines"
            title="Fee by fee"
            line={widestGapFinding(name, analysis.lines)}
            source={`${competitorsWithData} local competitors' published fee schedules, ${marketLabel}; each figure and the date its schedule was read are listed under Sources and method.`}
          >
            <figure className="min-w-0 max-w-5xl">
              <figcaption className={FIGURE_CAPTION}>{name} against the local median, largest gap first</figcaption>
              <ShowAll total={byGap.length} shown={ROWS_SHOWN} noun="fees">
                {/* Phones get the four columns that fit; the method lists every figure behind them. */}
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm sm:min-w-[640px] print:min-w-0">
                    <thead className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                      <tr>
                        <th className={TH}>Fee</th>
                        <th className={`${TH} text-right`}>{name.length > 18 ? "Amount" : name}</th>
                        <th className={`${TH} text-right`}>Local median</th>
                        <th className={`${TH} hidden text-right sm:table-cell print:table-cell`}>Middle 50%</th>
                        <th className={`${TH} hidden text-right sm:table-cell print:table-cell`}>Competitors</th>
                        <th className={`${TH} hidden text-right sm:table-cell print:table-cell`}>Charging less</th>
                        <th className="py-2 font-semibold">
                          <span className="sm:hidden print:hidden">vs middle 50%</span>
                          <span className="hidden sm:inline print:inline">Position</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {byGap.map((line, index) => (
                        <tr key={line.key} className={`border-b border-border last:border-0 ${index >= ROWS_SHOWN ? EXTRA_ROW : ""}`}>
                          <td className="py-2.5 pr-3 text-ink">{line.label}</td>
                          <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-ink">
                            {money(line.own.amount)}
                            {line.own.tiers && line.own.tiers.length > 1 && (
                              <span className="block text-[11px] font-normal text-ink-muted">
                                tiered: {line.own.tiers.map((tier) => money(tier.amount)).join(" / ")}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{money(line.peers.median)}</td>
                          <td className="hidden whitespace-nowrap py-2.5 pr-3 text-right tabular-nums sm:table-cell print:table-cell">
                            {money(line.peers.p25)} to {money(line.peers.p75)}
                          </td>
                          <td className="hidden py-2.5 pr-3 text-right tabular-nums sm:table-cell print:table-cell">{line.peers.n}</td>
                          <td className="hidden py-2.5 pr-3 text-right tabular-nums sm:table-cell print:table-cell">
                            {line.chargingLess !== null ? `${line.chargingLess} of ${line.peers.n}` : "-"}
                          </td>
                          <td className="py-2.5">
                            <PositionChip line={line} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ShowAll>
              {leftOut && <p className="mt-3 text-[13px] text-ink-muted sm:mx-0 sm:text-left">{leftOut}</p>}
            </figure>
          </HubSection>

          {lineup && <CheckingLineupSection name={name} lineup={lineup} live={Boolean(savedAt)} />}

          {revenue && <RevenueSection name={name} charterType={data.subject.charter_type} revenue={revenue} />}

          {analysis.named.length > 0 && (
            <HubSection
              id="named"
              title="Named competitors"
              line={named ?? `${analysis.named.length} local competitors side by side with ${name} on the same fees.`}
              source={
                <>
                  Each institution&apos;s published fee schedule (every amount links to it); branches and deposits from the FDIC Summary of
                  Deposits, {market.sod_year}, and NCUA.
                  {branches &&
                    ` The market's ${branches.totalBranches.toLocaleString("en-US")} bank branches hold ${depositsLabel(branches.totalDeposits)} in deposits.`}
                </>
              }
            >
              <figure className="min-w-0">
                <figcaption className={FIGURE_CAPTION}>Published fees, {name} and {analysis.named.length} local competitors</figcaption>
                <NamedCompetitorsPhone
                  shown={ROWS_SHOWN}
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
                <div className="hidden sm:block print:block">
                <ShowAll total={analysis.named.length} shown={ROWS_SHOWN} noun="competitors">
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm print:min-w-0">
                    <thead className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                      <tr>
                        <th className={`${TH} min-w-[240px]`}>Institution</th>
                        {tableKeys.map((key) => (
                          <th key={key} className={`${TH} text-right`}>
                            {FEE_LINE_LABELS[key]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border bg-brick-tint/40 font-semibold">
                        <td className="py-2.5 pr-3">
                          {name}
                          {footprintLine(branches, data.subject.institution_id) && (
                            <span className="block whitespace-nowrap text-[12px] font-normal text-ink-muted">{footprintLine(branches, data.subject.institution_id)}</span>
                          )}
                        </td>
                        {tableKeys.map((key) => (
                          <td key={key} className="py-2.5 pr-3 text-right tabular-nums">
                            {money(ownFees[key])}
                          </td>
                        ))}
                      </tr>
                      {analysis.named.map((competitor, index) => (
                        <tr key={competitor.institution_id} className={`border-b border-border last:border-0 ${index >= ROWS_SHOWN ? EXTRA_ROW : ""}`}>
                          <td className="py-2.5 pr-3">
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
                              <td key={key} className="py-2.5 pr-3 text-right tabular-nums">
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
                </div>
                </ShowAll>
                </div>
              </figure>
            </HubSection>
          )}

          <section id="method" aria-labelledby="method-heading" className="space-y-3">
            <h2 id="method-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
              Sources and method
            </h2>
            <Disclosure summary="How the market, competitors and figures are chosen">
              <h3 className="text-[13px] font-semibold text-ink">Market</h3>
              <p className="sm:mx-0">{marketSource}</p>
              <h3 className="text-[13px] font-semibold text-ink">Competitors</h3>
              <p className="sm:mx-0">
                Every bank with a branch there and every institution headquartered there. Named competitors are banks by deposits held in
                the market, then up to {NAMED_WITHOUT_DEPOSITS} credit unions, which the Summary of Deposits does not cover, chosen by how
                many of {name}&apos;s fees they publish. Under each bank are its branches and share of local deposits; credit unions show
                branches only, because NCUA reports no deposits by branch.
              </p>
              <h3 className="text-[13px] font-semibold text-ink">Definitions</h3>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>A fee is compared when at least {MIN_LOCAL_PEERS_PER_LINE} local competitors publish it.</li>
                <li>
                  Local median and middle 50% (25th to 75th percentile) count one published figure per local competitor. They are
                  calculated from competitors&apos; fees, not a price any one institution sets.
                </li>
                <li>
                  In the ranked rows, each dot is {name}&apos;s fee ranked among those competitors; the shaded band is their middle 50% and
                  the line their median. &ldquo;vs median&rdquo; is {name}&apos;s fee less the local median.
                </li>
                <li>&ldquo;Charging less&rdquo; counts competitors whose published fee is lower than {name}&apos;s.</li>
                {revenue && (
                  <li>
                    A published schedule does not say how often each fee is charged, so this report does not estimate what any one fee
                    earns.
                  </li>
                )}
              </ul>
              <h3 className="text-[13px] font-semibold text-ink">Figures</h3>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  One published fee per institution and fee, each a line of its own schedule. &ldquo;Read&rdquo; is the day that schedule was
                  saved.
                </li>
                <li>A figure is used only when a line of the institution&apos;s stored schedule states that amount as the fee.</li>
                <li>
                  Left out: balance thresholds, amounts that depend on a balance band, amounts not found in the schedule, fee caps, fees
                  under review for a correction, business prices, savings fees on the checking line, and records whose fee name was not
                  read cleanly
                  {droppedCount > 0 ? ` (${droppedCount} published figures in this market)` : ""}.
                </li>
                <li>
                  When a schedule lists several versions of a fee, the standard consumer version is used, not an online, business or
                  other special one. If several remain, the lowest monthly maintenance fee and the highest amount for every other fee.
                </li>
              </ul>
            </Disclosure>
            <Disclosure summary={`${name}'s fees, in its schedule's words`}>
              <ul className="space-y-1.5">
                {analysis.lines
                  .filter((line) => line.own)
                  .map((line) => (
                    <li key={line.key}>
                      {line.label}: {money(line.own!.amount)}, as the schedule states it: “{line.own!.source_line}”
                      {line.own!.tiers && line.own!.tiers.length > 1 && (
                        <>
                          {" "}
                          The schedule states {line.own!.tiers.length} amounts for this fee (
                          {line.own!.tiers.map((tier) => `${money(tier.amount)}: “${tier.source_line}”`).join("; ")}); the comparison uses{" "}
                          {money(line.own!.amount)}.
                        </>
                      )}
                      {line.own!.source_url && (
                        <>
                          {" "}
                          (
                          <a href={line.own!.source_url} className="inline-flex min-h-11 items-center underline sm:min-h-0" rel="noopener noreferrer" target="_blank">
                            source
                          </a>
                          {line.own!.schedule_read_on ? `, read ${line.own!.schedule_read_on}` : ""})
                        </>
                      )}
                    </li>
                  ))}
              </ul>
            </Disclosure>
            <Disclosure summary="Every competitor figure behind the local numbers">
              {comparable.map((line) => (
                <div key={line.key}>
                  <h3 className="text-[13px] font-semibold text-ink">
                    {line.label} ({line.peerFigures.length} competitors)
                  </h3>
                  {/* One stacked row per figure, so the schedule's words wrap instead of scrolling sideways. */}
                  <ul className="mt-1 text-[12px]">
                    {line.peerFigures.map((figure) => (
                      <li
                        key={figure.institution_id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border py-1 last:border-0 sm:grid-cols-[minmax(0,14rem)_4rem_minmax(0,1fr)_auto]"
                      >
                        <span className="text-ink">{competitorName.get(figure.institution_id) ?? `Institution ${figure.institution_id}`}</span>
                        <span className="text-right tabular-nums text-ink">{money(figure.amount)}</span>
                        <span className="col-span-2 sm:col-span-1">“{figure.source_line}”</span>
                        <span className="col-span-2 sm:col-span-1 sm:whitespace-nowrap">
                          {figure.source_url ? (
                            <a href={figure.source_url} className="inline-flex min-h-11 items-center underline sm:min-h-0" rel="noopener noreferrer" target="_blank">
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
            </Disclosure>
            <p className="max-w-[860px] border-t border-border pt-3 text-[12.5px] leading-[1.65] text-ink-muted sm:mx-0 sm:text-left">{correctionNote}</p>
          </section>
          {close && (
            <HamiltonClose competitors={competitorsWithData} institutionId={data.subject.institution_id} institutionName={name} />
          )}
        </>
      )}
    </div>
  );
}
