import Link from "next/link";
import type { PublicStatsSummary } from "@/lib/public-stats";

interface LandingTrustStatsProps {
  summary: PublicStatsSummary;
}

export function LandingTrustStats({ summary }: LandingTrustStatsProps) {
  // Palette: warm-*/terra tokens from globals.css @theme. Works in any route,
  // no .consumer-brand wrapper required (older slate-* utilities still work
  // via the wrapper for compatibility with older surfaces).
  return (
    <section className="border-t border-warm-300 bg-warm-150/60">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
          <div>
            <dd className="text-[24px] font-bold text-warm-900 tabular-nums sm:text-[28px]">
              {summary.institutionsLabel}
            </dd>
            <dt className="text-[11px] font-normal text-warm-600 uppercase tracking-wide mt-1 leading-snug sm:text-[12px]">
              Institutions with verified fees
            </dt>
          </div>

          <div>
            <dd className="text-[24px] font-bold text-warm-900 tabular-nums sm:text-[28px]">
              {summary.categoriesLabel}
            </dd>
            <dt className="text-[11px] font-normal text-warm-600 uppercase tracking-wide mt-1 leading-snug sm:text-[12px]">
              Fee categories
            </dt>
          </div>

          <div>
            <dd className="text-[24px] font-bold text-warm-900 tabular-nums sm:text-[28px]">
              {summary.statesLabel}
            </dd>
            <dt className="text-[11px] font-normal text-warm-600 uppercase tracking-wide mt-1 leading-snug sm:text-[12px]">
              U.S. states covered
            </dt>
          </div>

          <div>
            <dd className="text-[24px] font-bold text-warm-900 tabular-nums sm:text-[28px]">
              {summary.observationsLabel}
            </dd>
            <dt className="text-[11px] font-normal text-warm-600 uppercase tracking-wide mt-1 leading-snug sm:text-[12px]">
              Verified fee observations
            </dt>
          </div>
        </dl>

        {/* Provenance row — concrete sources + freshness + methodology link.
            Bankers buy on provenance, not on testimonials. */}
        <div className="mt-6 pt-6 border-t border-warm-300 flex flex-col lg:flex-row lg:items-baseline gap-3 lg:gap-6 text-[12px] text-warm-600">
          <span className="font-bold uppercase tracking-[0.12em] text-[11px] text-warm-600 shrink-0">
            Sources
          </span>
          <span className="leading-relaxed">
            FDIC Call Reports · NCUA 5300 · Federal Reserve FRED · Beige Book ·
            Published deposit account agreements
          </span>
          <span className="lg:ml-auto shrink-0 text-warm-700 inline-flex items-center gap-1.5">
            {/* Pulse dot acknowledges live data without shouting. The pulse
                ring is decorative; the inner dot conveys state. Hidden under
                prefers-reduced-motion via the live-pulse utility. */}
            <span
              aria-hidden="true"
              className="relative inline-flex h-1.5 w-1.5 shrink-0"
            >
              <span className="absolute inset-0 rounded-full bg-terra/40 live-pulse" />
              <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-terra" />
            </span>
            <span className="text-warm-900 font-medium">{summary.freshnessLabel}</span>
            {" · "}
            <Link
              href="/methodology"
              className="text-terra-dark hover:underline underline-offset-2"
            >
              Methodology
            </Link>
          </span>
        </div>
      </div>
    </section>
  );
}
