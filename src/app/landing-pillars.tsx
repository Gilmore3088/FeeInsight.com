import type { ReactNode } from "react";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { FrameMedia, type FrameVideo } from "@/components/marketing/frame-media";
import { ProductFrame } from "@/components/marketing/product-frame";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME } from "@/lib/constants";
import { AskExhibit, FeeStackExhibit, MarketExhibit, SourcedFeesExhibit, TryPriceExhibit } from "./landing-exhibits";
import { SECTION_INNER, SectionHeading, TEXT_LINK, type HomeData } from "./landing-shared";

/**
 * A recorded clip per pillar, once one is approved; each would replace its live exhibit
 * behind a "Watch" button. None exist yet, so none is shown.
 */
export const PILLAR_VIDEOS: Record<"fee" | "market" | "workspace", FrameVideo | null> = {
  fee: null,
  market: null,
  workspace: null,
};

function Pillar({
  eyebrow,
  title,
  line,
  frameLabel,
  video,
  flip = false,
  after,
  children,
}: {
  eyebrow: string;
  title: string;
  line: string;
  frameLabel: string;
  video: FrameVideo | null;
  flip?: boolean;
  after?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid items-center gap-8 lg:gap-16 ${
        flip ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]" : "lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
      }`}
    >
      <div className={`min-w-0 ${flip ? "lg:order-2" : ""}`}>
        <SectionHeading eyebrow={eyebrow} title={title} line={line} />
        {after}
      </div>
      <ProductFrame label={frameLabel} className={`fi-window-lift ${flip ? "lg:order-1" : ""}`}>
        <FrameMedia video={video}>{children}</FrameMedia>
      </ProductFrame>
    </div>
  );
}

/**
 * Brief 06 §4.3 item 4, as the level under the hero's demo (James's note of Oct 15): live
 * samples, each a heading, one line and one live exhibit drawn from published schedules.
 * Each exhibit differs from the demo's chapters: the sample bank's own fees with their source
 * lines, the fee's spread in the nation and each Fed district (the demo shows the bank's own
 * ladder), and Hamilton's Try a price.
 */
export function LandingPillars({ data }: { data: HomeData }) {
  if (!data.overdraft) return null;
  return (
    <section id="live-samples" className="bg-paper">
      <div className={`${SECTION_INNER} py-16 sm:py-24`}>
        <SectionHeading
          eyebrow="Live samples"
          title="See it in action"
          line="Each sample below is drawn live from published fee schedules."
          center
        />
        <div className="mt-14 space-y-20 sm:mt-20 sm:space-y-28">
          <Pillar
            eyebrow="Every fee"
            title="Each fee, quoted from the bank's own schedule"
            line="Every figure keeps the document and the date we read it."
            frameLabel={PRODUCT_NAME}
            video={PILLAR_VIDEOS.fee}
          >
            {data.sample && data.sample.fees.length > 0 ? <SourcedFeesExhibit data={data} /> : <FeeStackExhibit data={data} />}
          </Pillar>
          <Pillar
            eyebrow="Every market"
            title="One fee against every market around it"
            line="Local competitors, the state, peers and the nation on one axis."
            frameLabel="Hamilton · My fees"
            video={PILLAR_VIDEOS.market}
            flip
          >
              <MarketExhibit data={data} phoneRows={6} />
          </Pillar>
          <Pillar
            eyebrow="One workspace"
            title="Ask, compare and take it to committee"
            line="Hamilton answers each question with its source and writes the committee report."
            frameLabel={data.scenario ? "Hamilton · Try a price" : "Hamilton · Your institution"}
            video={PILLAR_VIDEOS.workspace}
            after={
              <p className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                <TrackLink
                  event="upgrade_click"
                  eventProps={{ placement: "home_workspace" }}
                  href={PRO_PLANS_NAV.href}
                  className="fi-btn fi-btn-secondary min-h-11"
                >
                  {PRO_PLANS_NAV.label}
                </TrackLink>
                <TrackLink
                  event="contact_sales"
                  eventProps={{ placement: "home_workspace_demo" }}
                  href={DEMO_REQUEST_NAV.href}
                  className={`text-[14px] ${TEXT_LINK}`}
                >
                  {DEMO_REQUEST_NAV.label}
                </TrackLink>
              </p>
            }
          >
            {data.scenario ? <TryPriceExhibit data={data} /> : <AskExhibit data={data} />}
          </Pillar>
        </div>
      </div>
    </section>
  );
}
