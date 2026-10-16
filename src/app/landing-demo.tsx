import type { DemoView } from "@/components/marketing/product-demo";
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
