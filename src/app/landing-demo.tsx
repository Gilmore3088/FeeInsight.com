import type { DemoView } from "@/components/marketing/product-demo";
import { DistrictMap, MyFeesChart, PriceSlider } from "./landing-charts";
import { NationalFeesExhibit, ReportExhibit } from "./landing-exhibits";
import { PRODUCT_NAME } from "@/lib/constants";
import { SECTION_INNER, SectionHeading, type HomeData } from "./landing-shared";

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
 * Bank Fee Index research (James's notes of Oct 16): the overdraft median by Fed district, from
 * the national index. It is the index's research, so it sits in a plain card under its own
 * heading, not in a Hamilton window: it shows no institution and no customer task.
 */
export function LandingResearch({ data }: { data: HomeData }) {
  if (!data.overdraft || data.districts.length === 0) return null;
  return (
    <section aria-label={`${PRODUCT_NAME} research`} className="bg-paper">
      <div className={`${SECTION_INNER} pb-14 pt-4 sm:pb-20 sm:pt-6`}>
        <SectionHeading
          eyebrow={`${PRODUCT_NAME} research`}
          title="Overdraft fees by Fed district"
          line="The national index, district by district. Pick a district for its median and its report."
        />
        <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-surface-0">
          <DistrictMap data={data} />
        </div>
      </div>
    </section>
  );
}
