import type { FrameVideo } from "@/components/marketing/frame-media";
import { ProductSizzle } from "@/components/marketing/product-sizzle";
import { FeeStackExhibit, MarketExhibit, ReportExhibit, WorkspaceExhibit } from "./landing-exhibits";
import type { HomeData } from "./landing-shared";

/**
 * A recorded tour, once one is approved (brief 06 §4.1). Until then there is none, and the
 * frame shows no "Watch the tour" button.
 */
export const HOME_TOUR_VIDEO: FrameVideo | null = null;

/**
 * Brief 06 §4.2: the product sizzle under the hero. Four chapters, each the real exhibit fed
 * by the live snapshot; the Reports chapter is the composed end frame the server renders.
 */
export function LandingSizzle({ data }: { data: HomeData }) {
  if (!data.overdraft || data.lines.length === 0) return null;
  return (
    <section aria-label="The product, chapter by chapter" className="bg-paper">
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
        <ProductSizzle
          label="Hamilton · Your institution"
          video={HOME_TOUR_VIDEO}
          chapters={[
            { key: "fee", label: "Every fee", scene: <FeeStackExhibit data={data} search /> },
            { key: "market", label: "Every market", scene: <MarketExhibit data={data} animate wide /> },
            { key: "workspace", label: "One workspace", scene: <WorkspaceExhibit data={data} animate /> },
            { key: "reports", label: "Reports", scene: <ReportExhibit data={data} /> },
          ]}
        />
      </div>
    </section>
  );
}
