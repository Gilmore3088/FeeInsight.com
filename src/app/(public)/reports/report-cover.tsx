import { REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { lineScale, type SampleExhibit } from "./report-view";

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/**
 * The report itself as the hero picture: its cover page over a second page, drawn from the live
 * sample (whose report it is, and its first fee lines as dots on the local middle half). With no
 * live sample it shows the cover alone, with no figures.
 */
export function ReportCover({ sample }: { sample: SampleExhibit | null }) {
  const lines = sample?.lines.slice(0, 5) ?? [];
  return (
    <div className="relative mx-auto w-full max-w-[26rem] py-6" aria-hidden="true">
      {/* The brick block and the page behind give the cover depth. */}
      <span className="absolute -left-2 top-0 h-2/3 w-2/3 rounded-2xl bg-brick-tint" />
      <span className="absolute bottom-2 right-0 h-1/2 w-1/2 rounded-2xl bg-[#f3e3b8]" />
      <div className="absolute inset-x-8 bottom-4 top-10 rotate-[5deg] rounded-xl border border-border bg-surface-0 shadow-fi-1" />
      <div className="relative -rotate-[3deg] rounded-xl border border-border bg-surface-0 p-5 shadow-fi-2 sm:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brick">{REPORT_OFFER.name}</p>
        <p className="mt-2 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {sample ? sample.name : "Your institution"} against its local market
        </p>
        {sample && (
          <p className="mt-1 text-[12px] text-ink-muted">
            {sample.place ? `${sample.place} · ` : ""}
            {sample.competitorsWithData} local competitors with verified fees
          </p>
        )}
        {lines.length > 0 && (
          <ol className="mt-4 space-y-2.5">
            {lines.map((l) => {
              const x = lineScale(l);
              return (
                <li key={l.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.75rem] items-center gap-2 text-[11px]">
                  <span className="truncate text-ink-soft">{l.label}</span>
                  <span className="relative h-3">
                    <span className="absolute inset-x-0 top-1/2 border-t border-border" />
                    <span
                      className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-brick-tint"
                      style={{ left: `${x(l.p25)}%`, width: `${Math.max(x(l.p75) - x(l.p25), 1)}%` }}
                    />
                    <span
                      className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                        l.position === "above_market" ? "bg-brick" : "bg-ink"
                      }`}
                      style={{ left: `${x(l.own)}%` }}
                    />
                  </span>
                  <span className="text-right font-mono font-semibold tabular-nums text-ink">{money(l.own)}</span>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-5 border-t border-border pt-3 text-[10px] text-ink-muted">Prepared by {SITE_NAME} · A source for every figure</p>
      </div>
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
