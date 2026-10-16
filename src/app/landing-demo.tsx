import type { DemoView } from "@/components/marketing/product-demo";
import { DistrictMap, MyFeesChart, PriceSlider } from "./landing-charts";
import { NationalFeesExhibit, ReportExhibit } from "./landing-exhibits";
import { Logo } from "@/brand/components";
import { PRODUCT_NAME } from "@/lib/constants";
import { ProductFrame } from "@/components/marketing/product-frame";
import { SECTION_INNER, type HomeData } from "./landing-shared";

/** The sample's fee chart needs this many comparable lines to read as a chart. */
const MIN_SAMPLE_ROWS = 3;

/**
 * The views the demo shows, each only when its live figures are there. The district map
 * leads; without district figures the demo opens on My fees.
 */
export function demoViews(data: HomeData): DemoView[] {
  const views: DemoView[] = [];
  if (data.districts.length > 0) views.push({ key: "map", label: "District map", short: "Map", view: <DistrictMap data={data} /> });
  if (data.sample && data.sample.rows.length >= MIN_SAMPLE_ROWS) {
    views.push({ key: "fees", label: "My fees", view: <MyFeesChart sample={data.sample} freshness={data.summary.freshnessLabel} /> });
  } else if (data.lines.length > 0) {
    views.push({ key: "fees", label: "My fees", view: <NationalFeesExhibit data={data} /> });
  }
  if (data.scenario && data.overdraft) views.push({ key: "price", label: "Try a price", short: "Price", view: <PriceSlider data={data} /> });
  views.push({ key: "reports", label: "Reports", view: <ReportExhibit data={data} /> });
  return views;
}

/**
 * Bank Fee Index research under the hero (James's notes of Oct 16): the overdraft median by Fed
 * district, from the national index. It shows no institution and no customer task, so its window
 * is labelled as the index's research, not as Hamilton.
 */
export function LandingResearch({ data }: { data: HomeData }) {
  if (!data.overdraft || data.districts.length === 0) return null;
  return (
    <section aria-label={`${PRODUCT_NAME} research`} className="bg-paper">
      <div className={`${SECTION_INNER} pb-10 pt-2 sm:pb-12`}>
        <ProductFrame
          label={
            <span className="flex items-center gap-2">
              <Logo mark="bank-fee-index-wordmark" height={13} title={PRODUCT_NAME} className="translate-y-px" />
              <span className="font-medium text-ink-muted">research</span>
            </span>
          }
          className="fi-window-lift"
        >
          <DistrictMap data={data} />
        </ProductFrame>
      </div>
    </section>
  );
}
