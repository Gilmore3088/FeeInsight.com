import type { FrameVideo } from "@/components/marketing/frame-media";
import { ProductSizzle } from "@/components/marketing/product-sizzle";
import { AskExhibit, FeeStackExhibit, MarketExhibit, ReportExhibit, TryPriceExhibit } from "./landing-exhibits";
import type { HomeData } from "./landing-shared";

/**
 * A recorded tour, once one is approved (brief 06 §4.1). Until then there is none, and the
 * frame shows no "Watch the tour" button.
 */
export const HOME_TOUR_VIDEO: FrameVideo | null = null;

/**
 * Brief 06 §4.2: the product sizzle. Four chapters, each a different live exhibit: several
 * fees nationally, one fee by Fed district, the workspace, and the sample report as the
 * composed end frame the server renders.
 *
 * `workspace` picks the One workspace scene: Try a price, or Hamilton answering a question
 * (for a page that already shows Try a price). `topPadding` adds room above the sizzle when
 * it does not sit right under a hero.
 */
export function LandingSizzle({
  data,
  workspace = "try",
  topPadding = false,
}: {
  data: HomeData;
  workspace?: "try" | "ask";
  topPadding?: boolean;
}) {
  if (!data.overdraft || data.lines.length === 0) return null;
  const workspaceScene =
    workspace === "try" && data.scenario ? <TryPriceExhibit data={data} /> : <AskExhibit data={data} animate />;
  return (
    <section aria-label="The product, chapter by chapter" className="bg-paper">
      <div className={`mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24 ${topPadding ? "pt-16 sm:pt-24" : ""}`}>
        <ProductSizzle
          label="Hamilton · Your institution"
          video={HOME_TOUR_VIDEO}
          chapters={[
            { key: "fee", label: "Every fee", scene: <FeeStackExhibit data={data} search /> },
            { key: "market", label: "Every market", scene: <MarketExhibit data={data} animate wide /> },
            { key: "workspace", label: "One workspace", scene: workspaceScene },
            { key: "reports", label: "Reports", scene: <ReportExhibit data={data} /> },
          ]}
        />
      </div>
    </section>
  );
}
