import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { DISPLAY_H2, SAMPLE_REPORT_HREF, SANS, SECTION_INNER } from "./landing-shared";

/**
 * The walkthrough video (James, Oct 17 05:27: he records it). Until it is set the section shows
 * a plain placeholder in its place; set `src` (and `captions`, a WebVTT file) to show the video.
 */
export const HAMILTON_VIDEO: { src: string; poster?: string; captions?: string } | null = null;

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
        <source src={HAMILTON_VIDEO.src} />
        {HAMILTON_VIDEO.captions ? <track kind="captions" src={HAMILTON_VIDEO.captions} srcLang="en" label="English" default /> : null}
      </video>
    );
  }
  return (
    <div
      className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-surface-0 px-6 text-center"
      data-hamilton-video-placeholder=""
    >
      <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-paper sm:h-20 sm:w-20">
        <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6 text-ink-muted sm:h-7 sm:w-7" fill="currentColor">
          <path d="M8 5.5v13l10.5-6.5z" />
        </svg>
      </span>
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
          <p className="mx-auto mt-5 max-w-2xl text-[19px] leading-relaxed text-ink sm:text-[21px]">
            See your fee schedule beside named local competitors and peers, with the source behind every figure.
          </p>
          <p className="mx-auto mt-3 max-w-xl text-[16px] leading-relaxed text-ink-soft">
            Hamilton is the Pro workspace for bank and credit union teams who price fees and present them to committee.
          </p>
        </div>
        <div className="mx-auto mt-10 max-w-5xl sm:mt-12">
          <HamiltonVideo />
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3" data-hamilton-actions="">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "home_hamilton" }}
            href={PRO_PLANS_NAV.href}
            className="fi-btn fi-btn-primary min-h-11 justify-center whitespace-nowrap"
          >
            {PRO_PLANS_NAV.label}
          </TrackLink>
          <TrackLink
            event="sample_report_click"
            eventProps={{ placement: "home_hamilton" }}
            href={SAMPLE_REPORT_HREF}
            className="fi-btn fi-btn-secondary min-h-11 justify-center whitespace-nowrap"
          >
            Open the sample report
          </TrackLink>
        </div>
      </div>
    </section>
  );
}
