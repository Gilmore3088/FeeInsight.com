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
  type LinePosition,
  type ReportLine,
} from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import type { MarketBranchFootprint } from "@/lib/data-store/branches";
import { incomeLabel, quarterLabel, type RevenueContext } from "@/lib/custom-report/revenue-context";
import { SinceBought, sinceBoughtFinding } from "./[token]/at-a-glance";
import { HamiltonClose } from "./[token]/hamilton-close";
import type { CheckingLineupView } from "@/lib/custom-report/checking-lineup";
import { CheckingLineupSection } from "./checking-lineup-section";
import { HubSection, KICKER } from "@/app/(public)/research/district/[id]/district-hub";
import { Disclosure } from "./disclosure";
import { ShowAll } from "./show-all";
import { EXTRA_ROW, ROWS_SHOWN, countiesText, headlineFinding, leftOutNote, marketFinding, widestGapFinding } from "./report-view";
import { FeeComparison } from "./fee-comparison";
import { PrintOpen } from "./print-open";

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

const FIGURE_CAPTION = "text-[14px] font-semibold text-ink";

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse border-l-2 border-brick pl-4">
      <dt className="mt-2 text-[13px] leading-snug text-ink-soft">{label}</dt>
      <dd className="font-mono text-[24px] font-semibold leading-tight tabular-nums tracking-[-0.02em] text-ink sm:text-[22px] lg:text-[30px]">{value}</dd>
    </div>
  );
}

function RevenueSection({ name, charterType, revenue }: { name: string; charterType: string | null; revenue: RevenueContext }) {
  const latest = revenue.quarters[0];
  const filing = charterType === "credit_union" ? "NCUA 5300 Call Report" : "FDIC Call Report";
  const peer = revenue.peer;
  const population = peer
    ? `${peer.count.toLocaleString("en-US")} ${peer.population ?? "banks and credit unions"} with ${peer.tierLabel} in assets that reported deposit service charges for ${quarterLabel(latest.quarter)}`
    : null;
  const finding = peer
    ? `${name} reported ${incomeLabel(latest.thousands)} in deposit service charges in ${quarterLabel(latest.quarter)}, ranking ${peer.rank.toLocaleString("en-US")} of ${peer.count.toLocaleString("en-US")} ${peer.population ?? "institutions"} its size, where 1 is the highest.`
    : `${name} reported ${incomeLabel(latest.thousands)} in deposit service charges in ${quarterLabel(latest.quarter)}.`;
  return (
    <HubSection
      id="revenue"
      title="Fee income"
      line={finding}
      source={`${name}'s ${filing}, ${quarterLabel(latest.quarter)}${peer ? `; the peer median and rank come from the same quarter's filings` : ""}.`}
    >
      <figure className="min-w-0 max-w-5xl">
        <figcaption className={FIGURE_CAPTION}>Deposit service charges reported by {name}{peer ? `, against ${peer.population ?? "institutions"} its size` : ""}</figcaption>
        <dl className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <Tile label={`${name}, ${quarterLabel(latest.quarter)}`} value={incomeLabel(latest.thousands)} />
          {revenue.trailingThousands !== null && <Tile label={`${name}, last four quarters`} value={incomeLabel(revenue.trailingThousands)} />}
          {peer && <Tile label={`Median of ${peer.count.toLocaleString("en-US")} ${peer.population ?? "institutions"} its size, ${quarterLabel(latest.quarter)}`} value={incomeLabel(peer.medianThousands)} />}
        </dl>
        {population && (
          <p className="mt-4 text-[13px] text-ink-soft sm:mx-0 sm:text-left">
            Compared with {population}. {peer?.population === "banks" ? "Credit unions are left out: their NCUA fee income is a wider measure than bank service charges." : peer?.population === "credit unions" ? "Banks are left out: their service charges are a narrower measure than NCUA fee income." : ""}
          </p>
        )}
      </figure>
    </HubSection>
  );
}

export function MarketReportBody({ report, eyebrow, preparedOn, actions, contactHref, correctionNote, revenue, branches, lineup, titleAs: Title = "h1", close = true }: MarketReportBodyProps) {
  const { data, analysis, savedAt, sinceBought } = report;
  const market = data.market!;
  const droppedCount = Object.values(data.dropped ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
  const name = data.subject.institution_name;
  const counties = countiesText(market.county_fips);
  const leftOut = leftOutNote(name, analysis.lines);
  const competitorName = new Map(data.competitors.map((c) => [c.institution_id, c.institution_name]));
  const { competitorsWithData, competitorsInMarket } = analysis.readiness;
  const withFees = new Set(data.lines.filter((l) => l.institution_id !== data.subject.institution_id).map((l) => l.institution_id));
  // Local competitors by deposits held in the market; credit unions (no SOD deposits) after the banks.
  const byDeposits = [...data.competitors].sort(
    (a, b) => (b.market_deposits ?? -1) - (a.market_deposits ?? -1) || a.institution_name.localeCompare(b.institution_name),
  );
  const ownDeposits = branches?.byInstitution[data.subject.institution_id]?.deposits ?? null;
  const ownShare = branches && ownDeposits !== null && branches.totalDeposits > 0 ? (ownDeposits / branches.totalDeposits) * 100 : null;

  return (
    <div className="space-y-14 sm:space-y-20">
      <PrintOpen />
      <header className="grid gap-6 border-b border-border pb-8 text-center sm:text-left lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-12">
        <div className="min-w-0">
          <p className={KICKER}>{eyebrow}</p>
          <Title className="mt-2 text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[44px]">
            {name}: competitive fee position
          </Title>
          {analysis.readiness.ready && (
            <p className="mx-auto mt-3 text-[18px] font-semibold leading-snug text-ink sm:mx-0 sm:text-[21px]">{headlineFinding(analysis.lines)}</p>
          )}
          <p className="mx-auto mt-3 text-[14px] text-ink-soft sm:mx-0">
            {counties} · prepared {DATE.format(preparedOn)} by {SITE_NAME}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3 sm:justify-start print:hidden">{actions}</div>
        </div>
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
            title="Fees against the local market"
            line={widestGapFinding(name, analysis.lines)}
            source={`Each institution's own published fee schedule, ${counties}. Every competitor figure, its schedule line and read date are under each fee.`}
          >
            <figure className="min-w-0 max-w-6xl">
              <figcaption className={FIGURE_CAPTION}>
                {name}&apos;s fees ranked among the local competitors that publish each one, largest gap to the local median first. Open a
                fee for its competitors and evidence.
              </figcaption>
              <div className="mt-4">
                <FeeComparison name={name} lines={analysis.lines} names={competitorName} branches={branches} footprint={footprintLine} />
              </div>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted sm:mx-0" aria-hidden="true">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 bg-surface-200" /> Middle 50% of local competitors</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-px bg-ink-muted" /> Local median</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-brick" /> Above</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink-soft" /> Inside</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-below-market" /> Below</span>
              </p>
              {leftOut && <p className="mt-3 text-[13px] text-ink-muted sm:mx-0 sm:text-left">{leftOut}</p>}
            </figure>
          </HubSection>

          {sinceBought && (
            <HubSection
              id="since"
              title="Since this report was bought"
              line={sinceBoughtFinding(sinceBought.savedAt, sinceBought.changes)}
              source={`${name}'s fees, the local medians and named competitors' published fees, today against the copy saved at purchase.`}
            >
              <SinceBought name={name} changes={sinceBought.changes} />
            </HubSection>
          )}

          <HubSection
            id="market"
            title="The local market"
            line={marketFinding(counties, competitorsInMarket, competitorsWithData)}
            source={`FDIC Summary of Deposits, ${market.sod_year} (bank branches and deposits); NCUA (credit union branches); each institution's published fee schedule.`}
          >
            <figure className="min-w-0 max-w-5xl">
              <figcaption className={FIGURE_CAPTION}>Institutions in the market, and which publish usable fees</figcaption>
              <div className="mt-4" role="img" aria-label={`${competitorsWithData} of ${competitorsInMarket} institutions publish usable fees`}>
                <div className="flex h-3 overflow-hidden rounded-full bg-surface-200 [print-color-adjust:exact]">
                  <span className="bg-ink" style={{ width: `${competitorsInMarket ? (competitorsWithData / competitorsInMarket) * 100 : 0}%` }} />
                </div>
                <p className="mt-2 flex flex-wrap justify-between gap-2 text-[12.5px] text-ink-soft sm:mx-0">
                  <span><span className="font-semibold text-ink">{competitorsWithData}</span> with at least one fee confirmed on its own schedule</span>
                  <span><span className="font-semibold text-ink">{competitorsInMarket - competitorsWithData}</span> without one</span>
                </p>
              </div>
              <p className="mt-4 text-[13px] text-ink-soft sm:mx-0 sm:text-left">
                Identified: every bank with a branch in {counties}, from the Summary of Deposits, and every institution headquartered in
                their cities. Usable: at least one of this report&apos;s fees, with the amount confirmed on the institution&apos;s own schedule.
              </p>
              {branches && (
                <dl className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
                  <Tile value={branches.totalBranches.toLocaleString("en-US")} label="bank branches in the market" />
                  <Tile value={depositsLabel(branches.totalDeposits)} label={`deposits held at those branches, ${market.sod_year}`} />
                  {ownShare !== null && <Tile value={`${ownShare.toFixed(1)}%`} label={`${name}'s share of those deposits`} />}
                </dl>
              )}
              <div className="mt-6">
                <p className={FIGURE_CAPTION}>Local competitors, largest deposits in the market first</p>
                <ShowAll total={byDeposits.length} shown={ROWS_SHOWN} noun="institutions">
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[20rem] text-left text-sm">
                      <thead className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                        <tr>
                          <th className="py-2 pr-3 font-semibold">Institution</th>
                          <th className="hidden py-2 pr-3 font-semibold sm:table-cell print:table-cell">Branches and deposit share</th>
                          <th className="py-2 text-right font-semibold">Usable fees</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byDeposits.map((c, index) => (
                          <tr key={c.institution_id} className={`border-b border-border last:border-0 ${index >= ROWS_SHOWN ? EXTRA_ROW : ""}`}>
                            <td className="py-1 pr-3">
                              <a href={`/institution/${c.institution_id}`} className="flex min-h-11 items-center text-ink underline-offset-2 hover:underline sm:min-h-0 sm:py-1.5">
                                {c.institution_name}
                              </a>
                            </td>
                            <td className="hidden py-1.5 pr-3 text-ink-soft sm:table-cell print:table-cell">
                              {[c.city ? cityLabel(c.city) : null, footprintLine(branches, c.institution_id)].filter(Boolean).join(" · ") || "-"}
                            </td>
                            <td className="py-1.5 text-right text-ink">{withFees.has(c.institution_id) ? "Yes" : "No"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ShowAll>
              </div>
            </figure>
          </HubSection>

          {lineup && <CheckingLineupSection name={name} lineup={lineup} live={Boolean(savedAt)} />}

          {revenue && <RevenueSection name={name} charterType={data.subject.charter_type} revenue={revenue} />}

          <section id="method" aria-labelledby="method-heading" className="space-y-3">
            <h2 id="method-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
              Sources and method
            </h2>
            <Disclosure summary="How the market, competitors and figures are chosen">
              <h3 className="text-[13px] font-semibold text-ink">Market</h3>
              <p className="sm:mx-0">
                {counties}: the {market.county_fips.length === 1 ? "county" : "counties"}{" "}
                {market.basis === "branch_counties" ? `holding most of ${name}'s deposits` : `around ${name}'s headquarters`}, from the
                FDIC Summary of Deposits, {market.sod_year}.
              </p>
              <h3 className="text-[13px] font-semibold text-ink">Competitors</h3>
              <p className="sm:mx-0">
                Every bank with a branch there and every institution headquartered there. Credit unions show branches only, because
                NCUA reports no deposits by branch.
              </p>
              <h3 className="text-[13px] font-semibold text-ink">Definitions</h3>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>A fee is compared when at least {MIN_LOCAL_PEERS_PER_LINE} local competitors publish it.</li>
                <li>
                  Local median and middle 50% (25th to 75th percentile) count one value per local competitor. They are calculated from
                  competitors&apos; fees, not a price any one institution sets.
                </li>
                <li>
                  When an institution publishes several prices for one fee, the range is shown and the comparison uses the value the
                  Bank Fee Index counts for it: the middle of its prices, or for overdraft its standard fee, the highest of its prices.
                </li>
                <li>
                  Each dot is {name}&apos;s fee ranked among the competitors that publish it; the shaded band is their middle 50% and the
                  line their median. &ldquo;vs median&rdquo; is {name}&apos;s compared value less the local median.
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
                  A figure is used only when a line of the institution&apos;s stored schedule states that amount as the fee. &ldquo;Read&rdquo;
                  is the day that schedule was saved.
                </li>
                <li>
                  Left out: balance thresholds, amounts that depend on a balance band, amounts not found in the schedule, fee caps, fees
                  under review for a correction, business prices, savings fees on the checking line, and records whose fee name was not
                  read cleanly
                  {droppedCount > 0 ? ` (${droppedCount} published figures in this market)` : ""}.
                </li>
              </ul>
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
