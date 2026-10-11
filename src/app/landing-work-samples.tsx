import Link from "next/link";
import { GLASS_SOFT, H2 } from "@/components/public/site-look";

const SAMPLE_HREF = "/reports/sample-competitive-fee-position";
const SAMPLE_PAGES = [
  { src: "/reports/sample-preview/page-1.webp", label: "Report cover" },
  { src: "/reports/sample-preview/page-2.webp", label: "Findings summary" },
  { src: "/reports/sample-preview/page-3.webp", label: "Fee-by-fee peer view" },
] as const;

/** Compact proof section: show the work instead of explaining it. */
export function LandingWorkSamples() {
  return (
    <section aria-labelledby="work-samples-title">
      <div className="mx-auto max-w-page px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
              Sample work
            </p>
            <h2 id="work-samples-title" className={`mt-2 ${H2}`}>
              See the output.
            </h2>
          </div>
          <Link
            href={SAMPLE_HREF}
            className="text-sm font-semibold text-[#A93D25] underline underline-offset-4 hover:text-[#8E2A17]"
          >
            Open the full sample
          </Link>
        </div>

        <ul className="mt-6 grid grid-cols-3 gap-3 sm:gap-5">
          {SAMPLE_PAGES.map((page) => (
            <li key={page.src} className="min-w-0">
              <Link href={SAMPLE_HREF} className={`group block overflow-hidden p-2 sm:p-3 ${GLASS_SOFT}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static report preview image */}
                <img
                  src={page.src}
                  alt={`Sample Competitive Fee Position Report: ${page.label}`}
                  width={850}
                  height={1100}
                  loading="lazy"
                  className="block h-auto w-full rounded-lg bg-white ring-1 ring-[#E8E1D6] transition-transform duration-200 group-hover:-translate-y-0.5"
                />
                <span className="mt-2 block text-xs font-medium text-[#5A5347] group-hover:text-[#A93D25]">
                  {page.label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
