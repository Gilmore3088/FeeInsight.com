// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { linkPreview } from "@/lib/link-preview";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";

import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { TrackLink } from "@/components/track-link";
import { ReportOfferSection } from "./report-offer";
import { ProToolsSection } from "./pro-tools";
import { CompareTableSection } from "./compare-table";
import {
  AmbientGlow,
  CTA_PRIMARY,
  CTA_SECONDARY,
  EYEBROW,
  GLASS,
  H1,
  INTERACTION,
  LEAD,
  NUM,
} from "@/components/public/site-look";

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

const PRIMARY_BUTTON = CTA_PRIMARY;
const SECONDARY_BUTTON = CTA_SECONDARY;

export default async function ForInstitutionsPage() {
  const summary = await getPublicStatsSummary();

  return (
    <div className={`relative isolate min-h-screen overflow-x-clip bg-[#FAF7F2] ${INTERACTION}`}>
      <AmbientGlow />
      <ConsumerNav />
      <main id="main-content">
        <section aria-labelledby="fi-title">
          <div className="mx-auto grid max-w-page gap-8 px-6 pb-12 pt-12 sm:pt-16 xl:grid-cols-2 xl:items-center xl:gap-14">
            <div className="min-w-0">
              <p className={EYEBROW}>For banks and credit unions</p>
              <h1 id="fi-title" className={`mt-3 ${H1}`}>
                Compare your fees with the market.
              </h1>
              <p className={`mt-4 ${LEAD}`}>
                Use published fee schedules, named peers and market context to answer pricing questions and build a board-ready review.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <TrackLink
                  event="pricing_click"
                  eventProps={{ placement: "for_institutions_hero" }}
                  href="/subscribe"
                  className={PRIMARY_BUTTON}
                >
                  See {SITE_NAME} Pro
                </TrackLink>
                <a href={REPORT_ANCHOR} className={SECONDARY_BUTTON}>
                  See report options
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
              <p className="mt-6 border-t border-[#E8E1D6] pt-5 text-sm leading-relaxed text-[#5A5347]">
                Figures are tied to published sources. Detailed methodology and evidence stay with the data instead of being repeated here.
              </p>
            </div>
          </div>
        </section>

        <ReportOfferSection />
        <ProToolsSection />
        <CompareTableSection summary={summary} />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
