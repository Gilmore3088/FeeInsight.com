import { getPublicSnapshot } from "@/lib/public-stats";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { getFeeCategoryDetailCached } from "@/lib/data-store/public-cached-reads";
import { buildHomeData, buildSampleView, type HomeData } from "@/app/landing-shared";
import { buildScenario } from "./scenario";

/**
 * The live figures the plans page's Hamilton window draws: the same reads, in the same shape,
 * as the homepage demo (src/app/page.tsx), so the two windows never disagree. The sample bank
 * is the live sample report's (Capital City Bank when its market passes the bar today). A read
 * that fails hides only the views that need it.
 */
export async function loadPlansExhibitData(): Promise<HomeData> {
  const [{ summary, categories }, sample, overdraftDetail] = await Promise.all([
    getPublicSnapshot(),
    loadSampleReport().catch((error: unknown) => {
      console.error("[subscribe] sample report read failed; sample views hidden", error);
      return null;
    }),
    getFeeCategoryDetailCached("overdraft").catch((error: unknown) => {
      console.error("[subscribe] overdraft district read failed; district map hidden", error);
      return null;
    }),
  ]);
  return buildHomeData(summary, categories, overdraftDetail?.by_fed_district, {
    sample: buildSampleView(sample),
    scenario: buildScenario("Overdraft", categories.find((c) => c.fee_category === "overdraft")),
  });
}
