import type { ReactNode } from "react";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { FrameMedia, type FrameVideo } from "@/components/marketing/frame-media";
import { ProductFrame } from "@/components/marketing/product-frame";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME } from "@/lib/constants";
import { FeeRowExhibit, MarketExhibit, WorkspaceExhibit } from "./landing-exhibits";
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

/** Brief 06 §4.3 item 4: three pillars, each a heading, one line and one live exhibit. */
export function LandingPillars({ data }: { data: HomeData }) {
  if (!data.overdraft) return null;
  return (
    <section className="bg-paper">
      <div className={`${SECTION_INNER} space-y-20 py-16 sm:space-y-28 sm:py-24`}>
        <Pillar
          eyebrow="Every fee"
          title="Your competitors' fees, from their own schedules"
          line="Every fee keeps the document, page and date it came from."
          frameLabel={PRODUCT_NAME}
          video={PILLAR_VIDEOS.fee}
        >
          <FeeRowExhibit data={data} />
        </Pillar>
        <Pillar
          eyebrow="Every market"
          title="Each fee in five markets at once"
          line="Markets with too few institutions are marked thin and get no median."
          frameLabel="Hamilton · Markets"
          video={PILLAR_VIDEOS.market}
          flip
        >
          <MarketExhibit data={data} phoneRows={6} />
        </Pillar>
        <Pillar
          eyebrow="One workspace"
          title="Ask, compare and take it to committee"
          line="Hamilton answers each question with its source and writes the committee report."
          frameLabel="Hamilton · Your institution"
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
          <WorkspaceExhibit data={data} />
        </Pillar>
      </div>
    </section>
  );
}
