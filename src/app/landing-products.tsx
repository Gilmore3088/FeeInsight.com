import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/brand/components";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { ProductFrame } from "@/components/marketing/product-frame";
import { TrackLink } from "@/components/track-link";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { PRODUCT_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { DistrictMap } from "./landing-charts";
import { DISPLAY_H2, InstitutionSearchForm, SANS, SECTION_INNER, TEXT_LINK, hasFigure, type HomeData } from "./landing-shared";
import { HamiltonAnswer, ReportPreview, workflowLead } from "./landing-workflow";

/** One product's column: its mark and line centered over the column (James, Oct 16). */
function Product({ mark, benefit, children, className = "" }: { mark: ReactNode; benefit: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <div className="text-center">
        <h3 className="flex h-8 items-center justify-center">{mark}</h3>
        <p className="mx-auto mt-3 max-w-md text-[17px] leading-relaxed text-ink-soft">{benefit}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * The two products and the report they lead to (James's notes of Oct 16): the Bank Fee Index
 * supplies the data, with the institution search and the district map; Hamilton applies it to one
 * institution, shown as one question answered from the live sample report. One compact report
 * preview follows, the answer's fee marked in it. Without a ready sample, Hamilton's answer and
 * the report preview are left out rather than shown with stand-in figures.
 */
export function LandingProducts({
  data,
  summary,
  report,
}: {
  data: HomeData;
  summary: Pick<PublicStatsSummary, "institutionsLabel" | "freshnessLabel">;
  report: MarketReport | null;
}) {
  const map = data.overdraft && data.districts.length > 0;
  const lead = workflowLead(report);
  return (
    <section aria-labelledby="products-heading" className="border-t border-border bg-surface-0">
      <div className={`${SECTION_INNER} py-16 sm:py-20`}>
        <h2 id="products-heading" className={`mx-auto max-w-3xl text-center ${DISPLAY_H2}`} style={SANS}>
          The fee data, and the workspace built on it
        </h2>
        {/* A faint rule between the two products on desktop shows the split. */}
        <div className="mt-10 grid gap-14 lg:mt-12 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:divide-border/70">
          <Product
            mark={<Logo mark="bank-fee-index-wordmark" height={24} />}
            benefit="See what banks and credit unions charge, with the spread and the benchmark for each fee, from the nation down to your market."
            className="lg:pr-10"
          >
            <InstitutionSearchForm id="index-search" secondary className="mt-5 w-full [&_.fi-field]:max-w-none [&_label]:sr-only" />
            <p className="mt-2.5 text-center text-[13px] leading-5 text-ink-muted">
              {hasFigure(summary.institutionsLabel) ? `${summary.institutionsLabel} institutions · ` : ""}
              {summary.freshnessLabel} ·{" "}
              <Link href="/fees" className={`whitespace-nowrap ${TEXT_LINK}`}>
                Explore the {PRODUCT_NAME}
              </Link>
            </p>
            {map ? (
              <ProductFrame label={`${PRODUCT_NAME} · National`} className="mt-6">
                <DistrictMap data={data} compact />
              </ProductFrame>
            ) : null}
          </Product>
          <Product
            mark={<Logo mark="hamilton-wordmark" height={24} />}
            benefit="Compare your fees, investigate the differences, and produce reports for your board, with the source behind every figure."
            className="lg:pl-10"
          >
            <p className="mt-3 text-center text-[14px]">
              <TrackLink event="upgrade_click" eventProps={{ placement: "home_products" }} href={PRO_PLANS_NAV.href} className={TEXT_LINK}>
                {PRO_PLANS_NAV.label}
              </TrackLink>
            </p>
            {lead ? (
              <div className="mt-6">
                <HamiltonAnswer lead={lead} />
              </div>
            ) : null}
          </Product>
        </div>
        {report && lead ? (
          <div className="mt-14 scroll-mt-24 sm:mt-16" id="report-preview">
            <ReportPreview report={report} lead={lead} />
          </div>
        ) : null}
        <p className="mx-auto mt-10 max-w-2xl text-center text-[14px] leading-relaxed text-ink-muted" data-trust-line="">
          Every figure comes from an institution&apos;s own published fee schedule, with the date it was read.{" "}
          <Link href="/methodology" className={TEXT_LINK}>
            How each fee is checked
          </Link>
        </p>
      </div>
    </section>
  );
}
