// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { linkPreview } from "@/lib/link-preview";
import { ArrowRight, BarChart2, Megaphone, Shield, Users } from "lucide-react";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";

import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { TrackLink } from "@/components/track-link";
import { ReportOfferSection } from "./report-offer";
import { ProToolsSection } from "./pro-tools";
import { CompareTableSection } from "./compare-table";

const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
const REPORT_ANCHOR = "#report";
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

const HERO_BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md px-7 py-3.5 text-[15px] transition-colors";
const PRIMARY_BUTTON = `${HERO_BUTTON_BASE} bg-[#C44B2E] font-bold text-white hover:bg-[#A93D25]`;

export default async function ForInstitutionsPage() {
  const [summary, sampleLive] = await Promise.all([getPublicStatsSummary(), sampleReportAvailable()]);

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ConsumerNav />
      <main id="main-content">
        <section className="bg-warm-900 relative overflow-hidden">
          <div className="mx-auto max-w-page px-6 pt-16 pb-14 lg:pt-20 lg:pb-16">
            <div className="w-full">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#D16A52]">
                For banks and credit unions
              </span>
              <h1
                className="mt-4 text-warm-150 leading-[1.1] tracking-[-0.02em]"
                style={{
                  fontFamily: "var(--font-newsreader), Georgia, serif",
                  fontSize: "clamp(28px, 5vw, 44px)",
                  fontWeight: 400,
                }}
              >
                Stop guessing what your competitors charge
              </h1>
              <p className="mt-5 max-w-[70ch] text-[16px] leading-relaxed text-[#D5CBBF]">
                Published fees for {summary.institutionsLabel} institutions across{" "}
                {summary.categoriesLabel} fee categories — every figure traceable to the disclosure
                it came from. Start with a free national or Fed district report, or run the workspace yourself.
              </p>

              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
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
                    <ArrowRight className="h-4 w-4" />
                  </TrackLink>
                ) : (
                  <TrackLink
                    event="request_report_click"
                    eventProps={{ placement: "for_institutions_hero" }}
                    href={REPORT_ANCHOR}
                    className={PRIMARY_BUTTON}
                  >
                    Get a free fee report
                    <ArrowRight className="h-4 w-4" />
                  </TrackLink>
                )}
                {/* With the sample offline the first button already leads to #report, so the
                    second one leads to Pro instead of repeating it. */}
                <a
                  href={sampleLive ? REPORT_ANCHOR : PRO_ANCHOR}
                  className={`${HERO_BUTTON_BASE} border border-warm-ink-700 font-normal text-warm-150 hover:border-warm-ink-500`}
                >
                  {sampleLive ? "What’s in the report" : `See ${SITE_NAME} Pro`}
                </a>
              </div>
              <p className="mt-4 text-[13px] text-[#D5CBBF]">National and Fed district reports, free and instant.</p>
            </div>
          </div>
          <div className="pointer-events-none absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-terra/[0.06] to-transparent" />
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
    <section className="bg-warm-100 border-b border-warm-200">
      <div className="mx-auto max-w-page px-6 py-14">
        <h2
          className="text-center text-[28px] text-warm-900"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Built for the people who set the prices
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="text-center">
              <Icon className="mx-auto h-6 w-6 text-terra" />
              <p className="mt-3 text-[15px] font-bold text-warm-900">{title}</p>
              <p className="mt-2 text-[14px] leading-relaxed text-warm-700">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AdvisorySection() {
  return (
    <section className="bg-white border-b border-warm-200">
      <div className="mx-auto max-w-page px-6 py-14">
        <div className="max-w-3xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
            {SITE_NAME} Advisory
          </p>
          <h2
            className="mt-3 text-[28px] text-warm-900"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            Need more than one report?
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-warm-700">
            {SITE_NAME} Advisory is the bespoke tier: custom competitor sets, board decks and
            multi-institution work, prepared by us on the same verified data.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <TrackLink
              event="contact_sales"
              eventProps={{ placement: "for_institutions_advisory" }}
              href="/contact?source=advisory"
              className={PRIMARY_BUTTON}
            >
              Talk to us
              <ArrowRight className="h-4 w-4" />
            </TrackLink>
            <TrackLink
              event="request_report_click"
              eventProps={{ placement: "for_institutions_advisory" }}
              href={REPORT_ANCHOR}
              className={`${HERO_BUTTON_BASE} border border-warm-300 font-normal text-warm-900 hover:border-warm-900`}
            >
              Get your free report
            </TrackLink>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCtaSection({ sampleLive }: { sampleLive: boolean }) {
  return (
    <section className="bg-warm-900">
      <div className="mx-auto max-w-page px-6 py-14 text-center">
        <h2
          className="text-[28px] text-warm-150"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Ready to see where your fees stand?
        </h2>
        <p className="mt-3 text-[15px] text-[#D5CBBF]">
          {sampleLive
            ? "Start with the sample, or request your own report today."
            : "Start with a free national or Fed district report, or ask us to quote your institution's own."}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
          {sampleLive ? (
            <>
              <TrackLink
                event="see_sample_report"
                eventProps={{ placement: "for_institutions_footer" }}
                href={SAMPLE_REPORT_HREF}
                className={PRIMARY_BUTTON}
              >
                See the sample report
                <ArrowRight className="h-4 w-4" />
              </TrackLink>
              <a
                href={REPORT_ANCHOR}
                className={`${HERO_BUTTON_BASE} border border-warm-ink-700 font-normal text-warm-150 hover:border-warm-ink-500`}
              >
                Get your free report
              </a>
            </>
          ) : (
            <TrackLink
              event="request_report_click"
              eventProps={{ placement: "for_institutions_footer" }}
              href={REPORT_ANCHOR}
              className={PRIMARY_BUTTON}
            >
              Get your free report
              <ArrowRight className="h-4 w-4" />
            </TrackLink>
          )}
        </div>
      </div>
    </section>
  );
}
