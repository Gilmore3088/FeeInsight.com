import type { FrameVideo } from "@/components/marketing/frame-media";
import { ProductSizzle } from "@/components/marketing/product-sizzle";
import { AskExhibit, FeeStackExhibit, MarketExhibit, ReportExhibit } from "./landing-exhibits";
import type { HomeData } from "./landing-shared";

/**
 * A recorded tour, once one is approved (brief 06 §4.1). With one, the demo frame plays it in
 * place of the coded chapters, at the same size, with the same segments and caption. Until
 * then the coded chapters are the tour, so there is no separate video block.
 */
export const HOME_TOUR_VIDEO: FrameVideo | null = null;

/**
 * The hero's visual (brief 06 §4.2, James's note of Oct 15): one product demo directly under
 * the hero copy. Four chapters, each a different live exhibit with its own motion: fee rows
 * filling in, the sample bank's fee sliding into place against each market, a question typed
 * and answered with its source, and the report assembling.
 */
export function LandingSizzle({ data }: { data: HomeData }) {
  if (!data.overdraft || data.lines.length === 0) return null;
  const ladder = data.ladder?.feeKey === "overdraft";
  return (
    <section className="bg-paper">
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
        <ProductSizzle
          label="Hamilton"
          video={HOME_TOUR_VIDEO}
          chapters={[
            {
              key: "fee",
              label: "Every fee",
              caption: "Every fee, against the nation",
              scene: <FeeStackExhibit data={data} search shell />,
            },
            {
              key: "market",
              label: "Every market",
              caption: ladder ? "One fee, in every market" : "One fee, by Fed district",
              scene: <MarketExhibit data={data} animate wide phoneDistricts={!ladder} phoneRows={4} />,
            },
            {
              key: "workspace",
              label: "One workspace",
              caption: "Ask a question, see the source",
              scene: <AskExhibit data={data} animate />,
            },
            {
              key: "reports",
              label: "Reports",
              caption: "A report, ready for committee",
              scene: <ReportExhibit data={data} />,
            },
          ]}
        />
      </div>
    </section>
  );
}
