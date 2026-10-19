import { ArrowUpRight } from "lucide-react";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { AtAGlance } from "./market-report/[token]/at-a-glance";
import { placeLabel } from "./market-report/report-body";
import { HOME_WRAP, SAMPLE_REPORT_HREF, SERIF } from "./landing-shared";

/** Fees the first page shows before it fades; the full sample has the rest. */
const PAGE_ROWS = 4;

/** The prepared date, in the full sample's form, dated in U.S. Eastern so a U.S. evening render is never dated tomorrow. */
const DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

export interface DeliverablePage {
  institutionName: string;
  market: string;
  competitors: { withData: number; inMarket: number };
}

/** The first page's header, from the live sample report; null without a ready report. */
export function deliverablePage(report: MarketReport | null): DeliverablePage | null {
  if (!report || !report.data.market || !report.analysis.lines.some((l) => l.comparable && l.own && l.peers)) return null;
  const market = report.data.market;
  return {
    institutionName: report.data.subject.institution_name,
    market: `${placeLabel(market.places[0])} area${market.county_fips.length > 1 ? ` (${market.county_fips.length} counties)` : ""}`,
    competitors: { withData: report.analysis.readiness.competitorsWithData, inMarket: report.analysis.readiness.competitorsInMarket },
  };
}

/**
 * The report before the plans (James's review, Oct 19: "one authentic report image and a link"):
 * the first page of today's live sample report for the demo bank (loadSampleReport), drawn by the
 * report's own at-a-glance component with the report's own header, cut off where the page fades.
 * It repeats none of the One question section's financial or fee findings in its own words. No
 * price and no buy button. A failed read hides the page and keeps the subscription.
 */
export function LandingDeliverable({ report, preparedOn }: { report: MarketReport | null; preparedOn: Date }) {
  const page = deliverablePage(report);
  return (
    <section id="sample" aria-labelledby="deliverable-title" className="bg-paper py-10 sm:py-14" data-deliverable="">
      <div className={`${HOME_WRAP} grid items-center gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14`}>
        <div className="min-w-0">
          <h2 id="deliverable-title" className="text-[34px] !font-medium leading-[1.06] tracking-[-0.025em] text-ink sm:text-[46px]" style={SERIF}>
            See what your next pricing committee could walk in with.
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft sm:text-[16px]">
            {page
              ? `Today’s sample report for ${page.institutionName}, built live, every amount linked to its fee schedule.`
              : "Each report is built live, every amount linked to its fee schedule."}
          </p>
          <div className="mt-6 flex flex-col items-center gap-3.5 sm:flex-row sm:gap-6">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "home_deliverable" }}
              href={PRO_PLANS_NAV.href}
              className="fi-btn fi-btn-brick min-h-12 w-full justify-center px-6 text-[15px] sm:w-auto"
            >
              Get Hamilton for your institution
            </TrackLink>
            {/* The full sample only when it exists today, so the link never lands on its "on its way" note. */}
            {page && (
              <TrackLink
                event="sample_report_click"
                eventProps={{ placement: "home_deliverable" }}
                href={SAMPLE_REPORT_HREF}
                className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-brick underline decoration-brick/40 underline-offset-4 hover:decoration-brick"
              >
                Open the full sample
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </TrackLink>
            )}
          </div>
        </div>
        {page && report ? (
          <figure className="min-w-0" data-deliverable-page="">
            <div className="relative max-h-[30rem] overflow-hidden rounded-[10px] border border-border bg-surface-200/60 p-3 shadow-[0_22px_44px_-28px_rgb(9_39_71/0.55)] sm:p-4">
              <div className="rounded-xl border border-border bg-surface-0 p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brick">{REPORT_OFFER.name}</p>
                <p className="mt-2 text-[1.35rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[1.6rem]" style={SERIF}>
                  {page.institutionName} against its local market
                </p>
                <p className="mt-2 text-[13px] text-ink-soft">
                  {page.market} · verified fees for {page.competitors.withData} of {page.competitors.inMarket} local competitors · prepared{" "}
                  {DATE.format(preparedOn)} by {SITE_NAME}
                </p>
              </div>
              <div className="[&>section]:mt-3 [&>section]:p-5">
                <AtAGlance lines={report.analysis.lines} narrow limit={PAGE_ROWS} />
              </div>
              <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-paper to-transparent" />
            </div>
            <figcaption className="mt-3 text-[12px] text-ink-muted">The first page of today&rsquo;s live sample report</figcaption>
          </figure>
        ) : null}
      </div>
    </section>
  );
}
