import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { DISPLAY_H2, SAMPLE_REPORT_HREF, SANS, SECTION_INNER, TEXT_LINK } from "./landing-shared";

/**
 * The walkthrough video (James, Oct 17 05:27: he records it). Until it is set the section shows
 * a plain placeholder in its place. A poster keeps phones from showing a black box, and captions
 * are required (WebVTT).
 */
export const HAMILTON_VIDEO: { src: string; type: string; poster: string; captions: string } | null = null;

function HamiltonVideo() {
  if (HAMILTON_VIDEO) {
    return (
      <video
        controls
        playsInline
        preload="metadata"
        poster={HAMILTON_VIDEO.poster}
        className="aspect-video w-full rounded-2xl border border-border bg-ink"
        aria-label="Hamilton walkthrough"
      >
        <source src={HAMILTON_VIDEO.src} type={HAMILTON_VIDEO.type} />
        <track kind="captions" src={HAMILTON_VIDEO.captions} srcLang="en" label="English" default />
        <a href={SAMPLE_REPORT_HREF}>Open the sample report</a>
      </video>
    );
  }
  // No play mark: nothing here plays yet, so nothing should look like a button.
  return (
    <div
      className="flex aspect-video w-full items-center justify-center rounded-2xl border border-dashed border-border bg-surface-0 px-6 text-center"
      data-hamilton-video-placeholder=""
    >
      <p className="text-[15px] font-semibold text-ink-soft">Video walkthrough coming soon</p>
    </div>
  );
}

/** Hamilton's own section (James, Oct 17): the name, two lines, the walkthrough video and two actions. */
export function LandingHamilton() {
  return (
    <section id="hamilton" aria-labelledby="hamilton-heading" className="scroll-mt-20 border-t border-border bg-paper">
      <div className={`${SECTION_INNER} py-16 sm:py-20`}>
        <div className="mx-auto max-w-3xl text-center">
          <h2 id="hamilton-heading" className={DISPLAY_H2} style={SANS}>
            Meet Hamilton
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-ink sm:text-[19px]">
            See your fee schedule beside named local competitors and peers, with the source behind every figure.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Hamilton is the{" "}
            <a href="/for-institutions#hamilton" className={TEXT_LINK}>
              Pro workspace
            </a>{" "}
            where bank and credit union teams track that position each month, try a price and build the committee report.
          </p>
        </div>
        {/* The placeholder stays smaller than the video will be, so the actions stay in view. */}
        <div className={`mx-auto mt-10 sm:mt-12 ${HAMILTON_VIDEO ? "max-w-5xl" : "max-w-3xl"}`}>
          <HamiltonVideo />
        </div>
        <div className="mx-auto mt-10 flex w-full max-w-sm flex-col items-center gap-3 sm:max-w-none sm:flex-row sm:justify-center sm:gap-4" data-hamilton-actions="">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "home_hamilton" }}
            href={PRO_PLANS_NAV.href}
            className="fi-btn fi-btn-primary min-h-11 w-full justify-center sm:w-auto"
          >
            {PRO_PLANS_NAV.label}
          </TrackLink>
          <TrackLink
            event="sample_report_click"
            eventProps={{ placement: "home_hamilton" }}
            href={SAMPLE_REPORT_HREF}
            className="fi-btn fi-btn-secondary min-h-11 w-full justify-center sm:w-auto"
          >
            Open the sample report
          </TrackLink>
        </div>
      </div>
    </section>
  );
}
