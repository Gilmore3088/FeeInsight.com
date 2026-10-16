import Image from "next/image";
import { REPORT_SHOWCASE } from "@/lib/report-showcase";
import { lineScale, type SampleExhibit } from "./report-view";

/**
 * The report as delivered, its pages fanned under the hero. The pictures come from
 * `REPORT_SHOWCASE` (src/lib/report-showcase.ts), the one place to update when the report changes.
 */
export function ReportShowcase() {
  const [cover, second, third] = REPORT_SHOWCASE.pages;
  const page = "rounded-[3px] bg-white shadow-[0_18px_48px_-18px_rgba(26,24,21,0.45)] ring-1 ring-border";
  return (
    <div className="relative mx-auto mt-10 h-[15rem] w-full max-w-[44rem] sm:mt-12 sm:h-[25rem]">
      <span aria-hidden="true" className="absolute inset-x-[8%] bottom-0 top-[18%] rounded-[2rem] bg-brick-tint/60" />
      {second && (
        <Image
          src={second.src}
          alt={second.alt}
          width={REPORT_SHOWCASE.width}
          height={REPORT_SHOWCASE.height}
          sizes="(min-width: 640px) 260px, 40vw"
          className={`absolute left-[2%] top-[14%] w-[38%] -rotate-[5deg] sm:left-[6%] sm:w-[34%] ${page}`}
        />
      )}
      {third && (
        <Image
          src={third.src}
          alt={third.alt}
          width={REPORT_SHOWCASE.width}
          height={REPORT_SHOWCASE.height}
          sizes="(min-width: 640px) 260px, 40vw"
          className={`absolute right-[2%] top-[14%] w-[38%] rotate-[5deg] sm:right-[6%] sm:w-[34%] ${page}`}
        />
      )}
      {cover && (
        <Image
          src={cover.src}
          alt={cover.alt}
          width={REPORT_SHOWCASE.width}
          height={REPORT_SHOWCASE.height}
          sizes="(min-width: 640px) 300px, 46vw"
          priority
          className={`absolute left-1/2 top-0 w-[46%] -translate-x-1/2 sm:w-[40%] ${page}`}
        />
      )}
    </div>
  );
}

/**
 * The video, in its own section under the hero. Until the clip exists the poster draws the
 * sample's own fee lines, so the slot shows the product.
 */
export function ReportVideo({ sample }: { sample: SampleExhibit | null }) {
  const lines = sample?.lines.slice(0, 6) ?? [];
  return (
    <section aria-labelledby="video-heading" className="mx-auto max-w-page px-4 pt-12 sm:px-6 sm:pt-16 print:hidden">
      <figure className="mx-auto max-w-3xl">
        <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="video-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">
            Watch a report come together
          </h2>
          <span className="text-[13px] text-ink-muted">Video coming</span>
        </figcaption>
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-warm-ink-900 shadow-fi-2 ring-1 ring-ink/10" aria-hidden="true">
          {lines.length > 0 && (
            <div className="absolute inset-x-[10%] inset-y-[16%] flex flex-col justify-between opacity-40">
              {lines.map((l) => {
                const x = lineScale(l);
                return (
                  <span key={l.key} className="relative block h-3">
                    <span className="absolute inset-x-0 top-1/2 border-t border-white/30" />
                    <span
                      className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-[#e0716a]/60"
                      style={{ left: `${x(l.p25)}%`, width: `${Math.max(x(l.p75) - x(l.p25), 1)}%` }}
                    />
                    <span
                      className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                      style={{ left: `${x(l.own)}%` }}
                    />
                  </span>
                );
              })}
            </div>
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-fi-2 sm:h-20 sm:w-20">
              <svg viewBox="0 0 12 12" className="ml-1 h-6 w-6 text-ink sm:h-7 sm:w-7">
                <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
              </svg>
            </span>
          </span>
        </div>
      </figure>
    </section>
  );
}
