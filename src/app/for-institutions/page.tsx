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
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { ReportOfferSection } from "./report-offer";
import { ProToolsSection } from "./pro-tools";
import { CompareTableSection } from "./compare-table";

const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
const REPORT_ANCHOR = "#report";

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
const PRIMARY_BUTTON = `${HERO_BUTTON_BASE} bg-brick font-bold text-white hover:bg-brick-ink`;

export default async function ForInstitutionsPage() {
  const [summary, sampleLive] = await Promise.all([getPublicStatsSummary(), sampleReportAvailable()]);

  return (
    <div className="min-h-screen bg-paper">
      <ConsumerNav />
      <main id="main-content">
        <section className="bg-warm-900 relative overflow-hidden">
          <div className="mx-auto max-w-page px-6 pt-16 pb-14 lg:pt-20 lg:pb-16">
            <div className="max-w-2xl">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#e0716a]">
                For banks and credit unions
              </span>
              <h1
                className="font-extrabold mt-4 text-warm-150 leading-[1.1] tracking-[-0.02em]"
                style={{
                  fontFamily: "var(--fi-font-sans)",
                  fontSize: "clamp(28px, 5vw, 44px)",
                  fontWeight: 400,
                }}
              >
                Stop guessing what your competitors charge
              </h1>
              <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-border">
                Published fees for {summary.institutionsLabel} institutions across{" "}
                {summary.categoriesLabel} fee categories — every figure traceable to the disclosure
                it came from. Hamilton Pro keeps your fees against your market every month.
              </p>

              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                {/* Pro is the goal (James, 2026-10-15); the free report is the step for visitors
                    not ready to subscribe. */}
                <TrackLink
                  event="upgrade_click"
                  eventProps={{ placement: "for_institutions_hero" }}
                  href={PRO_PLANS_NAV.href}
                  className={PRIMARY_BUTTON}
                >
                  {PRO_PLANS_NAV.label}
                  <ArrowRight className="h-4 w-4" />
                </TrackLink>
                <TrackLink
                  event="request_report_click"
                  eventProps={{ placement: "for_institutions_hero" }}
                  href={REPORT_ANCHOR}
                  className={`${HERO_BUTTON_BASE} border border-warm-ink-700 font-normal text-warm-150 hover:border-warm-ink-500`}
                >
                  Get a free fee report
                </TrackLink>
              </div>
              <p className="mt-4 text-[13px] text-border">National and Fed district reports, free and instant.</p>
            </div>
          </div>
          <div className="pointer-events-none absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-terra/[0.06] to-transparent" />
        </section>

        <ProToolsSection />
        <ReportOfferSection />
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
    body: "Current peer comparison instead of last year's survey.",
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
          className="font-bold text-center text-[28px] text-warm-900"
          style={{ fontFamily: "var(--fi-font-sans)" }}
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
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">
            {SITE_NAME} Advisory
          </p>
          <h2
            className="font-bold mt-3 text-[28px] text-warm-900"
            style={{ fontFamily: "var(--fi-font-sans)" }}
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
              Get a free fee report
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
          className="font-bold text-[28px] text-warm-150"
          style={{ fontFamily: "var(--fi-font-sans)" }}
        >
          Ready to see where your fees stand?
        </h2>
        <p className="mt-3 text-[15px] text-border">
          Hamilton Pro keeps your fees against your market every month. Not ready yet? Start with a free
          report.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "for_institutions_footer" }}
            href={PRO_PLANS_NAV.href}
            className={PRIMARY_BUTTON}
          >
            {PRO_PLANS_NAV.label}
            <ArrowRight className="h-4 w-4" />
          </TrackLink>
          <TrackLink
            event={sampleLive ? "see_sample_report" : "request_report_click"}
            eventProps={{ placement: "for_institutions_footer" }}
            href={sampleLive ? SAMPLE_REPORT_HREF : REPORT_ANCHOR}
            className={`${HERO_BUTTON_BASE} border border-warm-ink-700 font-normal text-warm-150 hover:border-warm-ink-500`}
          >
            {sampleLive ? "See the sample report" : "Get a free fee report"}
          </TrackLink>
        </div>
      </div>
    </section>
  );
}
