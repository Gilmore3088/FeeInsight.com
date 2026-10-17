import Link from "next/link";
import { Logo } from "@/brand/components";
import { ProductFrame } from "@/components/marketing/product-frame";
import { PRODUCT_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { DistrictMap } from "./landing-charts";
import { InstitutionSearchForm, SECTION_INNER, TEXT_LINK, hasFigure, type HomeData } from "./landing-shared";

/**
 * The Bank Fee Index on its own (Hamilton has its own section after it, James, Oct 17): the
 * search and the line beside the district map on desktop, stacked on a phone.
 */
export function LandingProducts({
  data,
  summary,
}: {
  data: HomeData;
  summary: Pick<PublicStatsSummary, "institutionsLabel" | "freshnessLabel">;
}) {
  const map = data.overdraft && data.districts.length > 0;
  return (
    <section aria-labelledby="products-heading" className="border-t border-border bg-surface-0">
      <div className={`${SECTION_INNER} py-16 sm:py-20`}>
        <div className={`grid items-center gap-10 ${map ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-12" : "mx-auto max-w-xl"}`}>
          <div className={`text-center ${map ? "lg:text-left" : ""}`} data-product-column="">
            <h2 id="products-heading" className={`flex h-8 items-center justify-center ${map ? "lg:justify-start" : ""}`}>
              <Logo mark="bank-fee-index-wordmark" height={26} title="" />
              <span className="sr-only">Bank Fee Index</span>
            </h2>
            <p className={`mx-auto mt-4 max-w-md text-[17px] leading-relaxed text-ink-soft ${map ? "lg:mx-0" : ""}`}>
              See what banks and credit unions charge for each fee, from the national median down to your own market.
            </p>
            <div className="mt-6">
              <InstitutionSearchForm id="index-search" secondary className="w-full [&_.fi-field]:max-w-none [&_label]:sr-only" />
              <p className="mt-2.5 text-[13px] leading-5 text-ink-muted">
                {hasFigure(summary.institutionsLabel) ? `${summary.institutionsLabel} institutions · ` : ""}
                {summary.freshnessLabel} ·{" "}
                <Link href="/fees" className={`whitespace-nowrap ${TEXT_LINK}`}>
                  Explore the {PRODUCT_NAME}
                </Link>
              </p>
            </div>
            <p className={`mx-auto mt-6 text-[14px] leading-relaxed text-ink-muted ${map ? "lg:mx-0" : ""}`} data-trust-line="">
              Every figure comes from an institution&apos;s own published fee schedule, with the date it was read.{" "}
              <Link href="/methodology" className={TEXT_LINK}>
                How each fee is checked
              </Link>
            </p>
          </div>
          {map ? (
            <ProductFrame label={`${PRODUCT_NAME} · National`} className="flex flex-col" bodyClassName="flex flex-col justify-center">
              <DistrictMap data={data} compact />
            </ProductFrame>
          ) : null}
        </div>
      </div>
    </section>
  );
}
