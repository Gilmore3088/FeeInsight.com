import { AppIcon } from "@/brand/components";
import { ProductDemo, type DemoView } from "@/components/marketing/product-demo";
import { DistrictMap, MyFeesChart, PriceSlider } from "./landing-charts";
import { NationalFeesExhibit, ReportExhibit } from "./landing-exhibits";
import type { HomeData } from "./landing-shared";

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
 * The hero's visual (brief 06 §4.2; James's notes of Oct 15): one product window directly
 * under the hero copy, opening on the interactive Fed district map. Its tabs are the only
 * navigation; nothing advances on its own.
 */
export function LandingDemo({ data }: { data: HomeData }) {
  if (!data.overdraft || data.lines.length === 0) return null;
  return (
    // Its own section under the hero: the window never overlaps the hero copy. This section
    // is the demo's one landmark; ProductDemo adds none inside it.
    <section aria-label="Hamilton demo" className="bg-paper">
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-2 sm:px-6 sm:pb-12 sm:pt-2">
        <ProductDemo
          label="Hamilton views"
          mark={
            <>
              <AppIcon brand="hamilton" size={22} title="" />
              <span className="hidden sm:inline">Hamilton</span>
            </>
          }
          views={demoViews(data)}
        />
      </div>
    </section>
  );
}
