import { REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import type { SampleExhibit } from "./report-view";

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
              const lo = Math.min(l.own, l.p25);
              const hi = Math.max(l.own, l.p75);
              const pad = Math.max((hi - lo) * 0.2, 1);
              const min = Math.max(0, lo - pad);
              const x = (v: number) => ((v - min) / (hi + pad - min)) * 100;
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
