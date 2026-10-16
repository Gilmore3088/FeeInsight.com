import type { ReactNode } from "react";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { FrameMedia, type FrameVideo } from "@/components/marketing/frame-media";
import { ProductFrame } from "@/components/marketing/product-frame";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME } from "@/lib/constants";
import { LadderColumns } from "./landing-charts";
import { AskChart, SourceDiagram } from "./landing-exhibits";
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
  title,
  line,
  frameLabel,
  video,
  flip = false,
  after,
  children,
}: {
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
        <SectionHeading title={title} line={line} />
        {after}
      </div>
      <ProductFrame label={frameLabel} className={`fi-window-lift ${flip ? "lg:order-1" : ""}`}>
        <FrameMedia video={video}>{children}</FrameMedia>
      </ProductFrame>
    </div>
  );
}

/**
 * Brief 06 §4.3 item 4, as the level under the hero's demo (James's notes of Oct 15): live
 * samples, each a heading, one line and one visual drawn from published schedules. None
 * repeats a demo view: the schedule drawn to the index, the bank's fee as a column chart
 * across its markets, and Hamilton answering with a chart. A pillar without its live
 * figures is left out. No section intro and no eyebrows (James, Oct 16): the demo above
 * already introduces them, and the product name sits on each frame.
 */
export function LandingPillars({ data }: { data: HomeData }) {
  if (!data.overdraft) return null;
  const sourced = Boolean(data.sample && data.sample.fees.length > 0);
  return (
    <section id="live-samples" aria-label="Live samples" className="bg-paper">
      <div className={`${SECTION_INNER} pb-16 pt-6 sm:pb-24 sm:pt-10`}>
        <div className="space-y-16 sm:space-y-20">
          {sourced ? (
            <Pillar
              title="Trace every fee to its source"
              line="Inspect the published schedule and the date it was read."
              frameLabel={PRODUCT_NAME}
              video={PILLAR_VIDEOS.fee}
            >
              <SourceDiagram data={data} />
            </Pillar>
          ) : null}
          {data.ladder ? (
            <Pillar
              title="Compare across markets"
              line="See the same fee against local competitors, your state, banks nationwide and the full index."
              frameLabel="Hamilton · Markets"
              video={PILLAR_VIDEOS.market}
              flip
            >
              <LadderColumns ladder={data.ladder} />
            </Pillar>
          ) : null}
          <Pillar
            title="Bring the findings to committee"
            line="Explore an answer with its chart and supporting sources."
            frameLabel="Hamilton · Ask"
            video={PILLAR_VIDEOS.workspace}
            flip={!data.ladder}
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
            <AskChart data={data} />
          </Pillar>
        </div>
      </div>
    </section>
  );
}
