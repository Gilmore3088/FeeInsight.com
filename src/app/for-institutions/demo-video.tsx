import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import { lineAxisMax, type CompetitorBoard } from "./board-math";
import { SANS } from "@/app/landing-shared";

/**
 * The tour video's place, in its own section under the hero (never over it). Until a clip is
 * approved, the 16:9 poster draws the live sample's own fee lines under a static "Tour coming
 * soon" mark: a picture, not a control, so the only action here is the on-page demo request.
 * With no live sample there is nothing to draw, and the section is left out.
 */
export function DemoVideoSection({ board }: { board: CompetitorBoard | null }) {
  if (!board) return null;
  const lines = board.lines;
  return (
    <section aria-labelledby="tour-heading" className="border-b border-border bg-paper">
      <div className="mx-auto max-w-5xl px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <h2
            id="tour-heading"
            className="text-[1.75rem] !font-semibold leading-[1.08] !tracking-[-0.03em] text-ink sm:text-[2.25rem]"
            style={SANS}
          >
            Watch Hamilton work
          </h2>
          <TrackLink
            event="contact_sales"
            eventProps={{ placement: "for_institutions_tour" }}
            href="#demo"
            className="fi-btn fi-btn-secondary justify-center"
          >
            {DEMO_REQUEST_NAV.standaloneLabel}
          </TrackLink>
        </div>
        <figure className="mt-6">
          <div
            data-video-placeholder=""
            role="img"
            aria-label="Tour coming soon"
            className="relative aspect-video overflow-hidden rounded-2xl bg-warm-ink-900 shadow-fi-2 ring-1 ring-ink/10"
          >
            {lines.length > 0 ? (
              <div className="absolute inset-x-[8%] inset-y-[14%] flex flex-col justify-between opacity-45">
                {lines.map((line) => {
                  const top = lineAxisMax(line);
                  const x = (v: number) => `${(v / top) * 100}%`;
                  return (
                    <span key={line.key} className="relative grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-4 max-sm:grid-cols-[minmax(0,1fr)]">
                      <span className="truncate text-[12px] font-medium text-warm-ink-300 max-sm:hidden">{line.label}</span>
                      <span className="relative block h-3">
                        <span className="absolute inset-x-0 top-1/2 border-t border-white/25" />
                        <span
                          className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-white/25"
                          style={{ left: x(line.p25), width: `max(4px, calc(${x(line.p75)} - ${x(line.p25)}))` }}
                        />
                        <span
                          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#e0716a]"
                          style={{ left: x(line.own) }}
                        />
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : null}
            {/* A mark, not a button: muted and flat, with the static label under it. */}
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/25 sm:h-16 sm:w-16">
                <svg viewBox="0 0 12 12" className="ml-1 h-5 w-5 text-white/60 sm:h-6 sm:w-6">
                  <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
                </svg>
              </span>
              <span className="relative z-10 rounded-full bg-warm-ink-900 px-3 py-1 text-[12px] font-semibold tracking-wide text-white/80 shadow-[0_0_0_6px_var(--color-warm-ink-900)] ring-1 ring-white/20">
                Tour coming soon
              </span>
            </span>
          </div>
        </figure>
      </div>
    </section>
  );
}
