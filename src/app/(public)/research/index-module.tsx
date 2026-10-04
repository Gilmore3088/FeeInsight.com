import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";

/** The Bank Fee Index module at the top of /research: one product, plainly named. */
export function IndexModule({ summary }: { summary: PublicStatsSummary }) {
  const updateDate = summary.refreshedOn;
  return (
    <section id="national-index">
      <Link
        href="/research/national-fee-index"
        className="group block rounded-xl border-2 border-[#C44B2E]/20 bg-gradient-to-br from-[#FAF7F2] via-white to-[#FAF7F2]/50 px-6 py-6 transition-all hover:border-[#C44B2E]/30 hover:shadow-md hover:shadow-[#C44B2E]/5"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#A93D25]">
              {PRODUCT_NAME}
            </p>
            <h2
              className="mt-1 text-lg font-extrabold text-[#1A1815] group-hover:text-[#C44B2E] transition-colors"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              {PRODUCT_NAME} — national benchmarks
            </h2>
            <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-[#6B6255]">
              Medians, percentiles, and charter comparisons across every fee
              category, from the published schedules of {summary.institutionsLabel} banks
              and credit unions.
            </p>
          </div>
          <svg aria-hidden="true"
            className="mt-1 h-8 w-8 shrink-0 text-[#C44B2E]/40 group-hover:text-[#C44B2E]/60 transition-colors"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
            />
          </svg>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4 border-t border-[#E8DFD1]/60 pt-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#A93D25]">
              Categories
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-[#1A1815]">
              {summary.categoriesLabel}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#A93D25]">
              Verified fees
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-[#1A1815]">
              {summary.observationsLabel}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#A93D25]">
              Updated
            </p>
            <p className="mt-0.5 text-lg font-bold text-[#1A1815]">
              {updateDate ?? "---"}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <span className="text-[12px] font-semibold text-[#A93D25] transition-colors">
            Open the index
          </span>
          <svg aria-hidden="true" className="h-4 w-4 text-[#A93D25] group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </div>
      </Link>
    </section>
  );
}
