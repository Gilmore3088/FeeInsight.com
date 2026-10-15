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
 * Brief 06 §4.3 item 4, as the level under the hero's demo (James's notes of Oct 15): live
 * samples, each a heading, one line and one visual drawn from published schedules. None
 * repeats a demo view: the schedule drawn to the index, the bank's fee as a column chart
 * across its markets, and Hamilton answering with a chart. A pillar without its live
 * figures is left out.
 */
export function LandingPillars({ data }: { data: HomeData }) {
  if (!data.overdraft) return null;
  const sourced = Boolean(data.sample && data.sample.fees.length > 0);
  return (
    <section id="live-samples" className="bg-paper">
      <div className={`${SECTION_INNER} pb-16 pt-8 sm:pb-24 sm:pt-12`}>
        <SectionHeading eyebrow="Live samples" title="See it in action" line="Each sample is drawn live from published fee schedules." center />
        <div className="mt-10 space-y-16 sm:mt-14 sm:space-y-24">
          {sourced ? (
            <Pillar
              eyebrow="Every fee"
              title="Each fee, quoted from the bank's own schedule"
              line="Every figure keeps the document and the date we read it."
              frameLabel={PRODUCT_NAME}
              video={PILLAR_VIDEOS.fee}
            >
              <SourceDiagram data={data} />
            </Pillar>
          ) : null}
          {data.ladder ? (
            <Pillar
              eyebrow="Every market"
              title="One fee, in every market"
              line="A bank's fee against its local competitors, its state, its charter and the nation."
              frameLabel="Hamilton · Markets"
              video={PILLAR_VIDEOS.market}
              flip
            >
              <LadderColumns ladder={data.ladder} />
            </Pillar>
          ) : null}
          <Pillar
            eyebrow="One workspace"
            title="Ask, compare and take it to committee"
            line="Hamilton answers each question with a chart and its source."
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
