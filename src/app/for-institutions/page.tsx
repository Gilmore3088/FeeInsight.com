// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { linkPreview } from "@/lib/link-preview";
import { ArrowRight, BarChart2, Megaphone, Shield, Users } from "lucide-react";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { PRODUCT_NAME, REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";

import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { TrackLink } from "@/components/track-link";
import { ReportOfferSection } from "./report-offer";
import { ProToolsSection } from "./pro-tools";
import { CompareTableSection } from "./compare-table";
import {
  AmbientGlow,
  BODY,
  CheckList,
  CTA_PRIMARY,
  CTA_SECONDARY,
  EYEBROW,
  GLASS,
  GLASS_SOFT,
  H1,
  H2,
  INTERACTION,
  LEAD,
  NUM,
} from "@/components/public/site-look";

const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
const REPORT_ANCHOR = "#report";
// Paid CTAs carry report=institution so the form opens on that option with its price shown;
// free CTAs say report=national so a reader who had picked the paid option gets the free one.
const INSTITUTION_REPORT_HREF = "/for-institutions?report=institution#report";
const FREE_REPORT_HREF = "/for-institutions?report=national#report";
const INSTITUTION_REPORT_PRICE = REPORT_OFFER.priceLabel.toLowerCase();
const PRO_ANCHOR = "#pro";

const PAGE_TITLE = "Bank Fee Benchmarking and Competitive Fee Reports";
const PAGE_DESCRIPTION =
  `Compare your institution's published fees with named local competitors, line by line, with a source ` +
  `for every figure. Start with the free national and Fed district fee reports from the ${PRODUCT_NAME}.`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ...linkPreview({ title: PAGE_TITLE, description: PAGE_DESCRIPTION, path: "/for-institutions" }),
};

const PRIMARY_BUTTON = CTA_PRIMARY;
const SECONDARY_BUTTON = CTA_SECONDARY;

/** What every figure on the index carries, as stated in the hero copy and the compare table. */
const HERO_CHECKS = [
  "Every figure traceable to the disclosure it came from",
  "Free national and Fed district reports, open right away",
  `Your institution against named competitors, ${INSTITUTION_REPORT_PRICE}`,
];

export default async function ForInstitutionsPage() {
  const [summary, sampleLive] = await Promise.all([getPublicStatsSummary(), sampleReportAvailable()]);

  return (
    <div className={`relative isolate min-h-screen overflow-x-clip bg-[#FAF7F2] ${INTERACTION}`}>
      <AmbientGlow />
      <ConsumerNav />
      <main id="main-content">
        {/* Light hero in the /subscribe look: the pitch beside one glass box of facts, equal
            columns at xl. */}
        <section aria-labelledby="fi-title">
          <div className="mx-auto grid max-w-page gap-10 px-6 pb-14 pt-12 sm:pt-16 xl:grid-cols-2 xl:items-center xl:gap-14">
            <div className="min-w-0">
              <p className={EYEBROW}>For banks and credit unions</p>
              <h1 id="fi-title" className={`mt-3 ${H1}`}>
                Stop guessing what your competitors charge
              </h1>
              <p className={`mt-5 ${LEAD}`}>
                Published fees for {summary.institutionsLabel} institutions across{" "}
                {summary.categoriesLabel} fee categories — every figure traceable to the disclosure
                it came from. Start with a free national or Fed district report, or run the workspace yourself.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {/* The sample is offline until it is re-rendered from source-checked data, so the
                    hero leads to the free reports instead of a "coming soon" page. */}
                {sampleLive ? (
                  <TrackLink
                    event="see_sample_report"
                    eventProps={{ placement: "for_institutions_hero" }}
                    href={SAMPLE_REPORT_HREF}
                    className={PRIMARY_BUTTON}
                  >
                    See the sample report
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </TrackLink>
                ) : (
                  <TrackLink
                    event="request_report_click"
                    eventProps={{ placement: "for_institutions_hero" }}
                    href={REPORT_ANCHOR}
                    className={PRIMARY_BUTTON}
                  >
                    {REPORT_OFFER.ctaLabel}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </TrackLink>
                )}
                {/* With the sample offline the first button already leads to #report, so the
                    second one leads to Pro instead of repeating it. */}
                <a href={sampleLive ? REPORT_ANCHOR : PRO_ANCHOR} className={SECONDARY_BUTTON}>
                  {sampleLive ? "What’s in the report" : `See ${SITE_NAME} Pro`}
                </a>
              </div>
            </div>

            <div className={`min-w-0 p-6 sm:p-8 ${GLASS}`}>
              <dl className="grid grid-cols-2 gap-6">
                <div>
                  <dd className={`text-4xl font-bold tracking-tight text-[#1A1815] ${NUM}`}>{summary.institutionsLabel}</dd>
                  <dt className="mt-1 text-sm text-[#5A5347]">institutions with published fees</dt>
                </div>
                <div>
                  <dd className={`text-4xl font-bold tracking-tight text-[#1A1815] ${NUM}`}>{summary.categoriesLabel}</dd>
                  <dt className="mt-1 text-sm text-[#5A5347]">fee categories</dt>
                </div>
              </dl>
              <CheckList items={HERO_CHECKS} className="mt-6 border-t border-[#E8E1D6] pt-6" />
            </div>
          </div>
        </section>

        <ReportOfferSection />
        <ProToolsSection />
        <CompareTableSection summary={summary} />
        <AudienceSection />
        <AdvisorySection />
        <FinalCtaSection sampleLive={sampleLive} />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}

const AUDIENCES = [
  {
    icon: Megaphone,
    title: "Marketing and product leaders",
    body: "Substantiate every lower-fees claim with the competitor's own disclosure. Know before the campaign, not after the complaint.",
  },
  {
    icon: Shield,
    title: "Pricing and finance",
    body: "Annual pricing studies in hours, not months. Current peer comparison instead of last year's survey.",
  },
  {
    icon: BarChart2,
    title: "Executives and boards",
    body: "Board-ready reports that show where you stand, with the fee-income context behind each line.",
  },
  {
    icon: Users,
    title: "Consultants and advisors",
    body: "Give every client engagement a data backbone. Custom peer analyses for each institution you serve.",
  },
];

function AudienceSection() {
  return (
    <section aria-labelledby="audiences-title">
      <div className="mx-auto max-w-page px-6 py-14 sm:py-16">
        <h2 id="audiences-title" className={H2}>
          Built for the people who set the prices
        </h2>
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
          {AUDIENCES.map(({ icon: Icon, title, body }) => (
            <li key={title} className={`h-full p-6 ${GLASS_SOFT}`}>
              <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#C44B2E]/10">
                <Icon className="h-5 w-5 text-terra" />
              </span>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-warm-900">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-warm-800">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function AdvisorySection() {
  return (
    <section aria-labelledby="advisory-title">
      <div className="mx-auto max-w-page px-6 pb-14 sm:pb-16">
        <div className={`flex flex-col gap-6 p-6 sm:p-8 xl:flex-row xl:items-center xl:justify-between ${GLASS}`}>
          <div className="min-w-0">
          <p className={EYEBROW}>{SITE_NAME} Advisory</p>
          <h2 id="advisory-title" className={`mt-3 ${H2}`}>
            Need more than one report?
          </h2>
          <p className={`mt-3 ${BODY}`}>
            {SITE_NAME} Advisory is the bespoke tier: custom competitor sets, board decks and
            multi-institution work, prepared by us on the same verified data.
          </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <TrackLink
              event="contact_sales"
              eventProps={{ placement: "for_institutions_advisory" }}
              href="/contact?source=advisory"
              className={PRIMARY_BUTTON}
            >
              Talk to us
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </TrackLink>
            <TrackLink
              event="request_report_click"
              eventProps={{ placement: "for_institutions_advisory", report: "institution" }}
              href={INSTITUTION_REPORT_HREF}
              className={SECONDARY_BUTTON}
            >
              {REPORT_OFFER.institutionCtaLabel}
            </TrackLink>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The closing CTA invites a request for the reader's own report, so its main button opens the
 * form on the paid institution report (report=institution) with the price named; the free
 * national and district reports are the second button, named as such.
 */
function FinalCtaSection({ sampleLive }: { sampleLive: boolean }) {
  return (
    <section aria-labelledby="fi-cta" className="mx-auto max-w-page px-6 pb-16">
      <div className={`px-6 py-10 text-center sm:px-10 ${GLASS}`}>
        <h2 id="fi-cta" className={H2}>
          Ready to see where your fees stand?
        </h2>
        <p className={`mx-auto mt-3 ${BODY}`}>
          Request your institution&apos;s own report against named competitors, {INSTITUTION_REPORT_PRICE}, or
          start with a free national or Fed district report.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <TrackLink
            event="request_report_click"
            eventProps={{ placement: "for_institutions_footer", report: "institution" }}
            href={INSTITUTION_REPORT_HREF}
            className={PRIMARY_BUTTON}
          >
            {REPORT_OFFER.institutionCtaLabel}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </TrackLink>
          <TrackLink
            event="request_report_click"
            eventProps={{ placement: "for_institutions_footer", report: "national" }}
            href={FREE_REPORT_HREF}
            className={SECONDARY_BUTTON}
          >
            {REPORT_OFFER.ctaLabel}
          </TrackLink>
        </div>
        {sampleLive && (
          <p className="mt-5 text-sm text-[#5A5347]">
            <TrackLink
              event="see_sample_report"
              eventProps={{ placement: "for_institutions_footer" }}
              href={SAMPLE_REPORT_HREF}
              className="font-semibold text-[#A93D25] underline underline-offset-4 hover:text-[#8E2A17]"
            >
              See the sample institution report
            </TrackLink>
          </p>
        )}
      </div>
    </section>
  );
}
