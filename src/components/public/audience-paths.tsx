import Link from "next/link";
import { REPORT_OFFER } from "@/lib/constants";

interface AudiencePath {
  eyebrow: string;
  title: string;
  body: string;
  href: string;
}

/**
 * Three starting points, one per kind of reader. Shared by the home page (compact, under
 * the hero) and /research, so both answer "where do I start?" the same way.
 */
export const AUDIENCE_PATHS: readonly AudiencePath[] = [
  {
    eyebrow: "I'm a consumer",
    title: "Understand and reduce my fees",
    body: "Plain-language guides with real data",
    href: "/guides",
  },
  {
    eyebrow: "I'm a researcher",
    title: "National benchmarks and data",
    body: "Medians, percentiles, geographic analysis",
    href: "/research/national-fee-index",
  },
  {
    eyebrow: "I work at a bank or credit union",
    title: "Benchmark my institution",
    // A paid report, so the link opens the form on it with the price shown.
    body: `Institution competitor report, ${REPORT_OFFER.priceLabel.toLowerCase()}; national and district reports free`,
    href: "/for-institutions?report=institution#report",
  },
];

export function AudiencePaths({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <nav aria-label="Where to start" className={className}>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {AUDIENCE_PATHS.map((path) => (
          <li key={path.href}>
            <Link
              href={path.href}
              className={`group block h-full rounded-xl border border-[#E8DFD1] bg-white/70 no-underline transition-all hover:border-[#C44B2E]/20 hover:shadow-md hover:shadow-[#C44B2E]/5 ${
                compact ? "px-4 py-3" : "px-4 py-3.5"
              }`}
            >
              <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                {path.eyebrow}
              </span>
              <span className="mt-1 block text-[13px] font-semibold text-[#1A1815] transition-colors group-hover:text-[#A93D25]">
                {path.title}
              </span>
              <span className="mt-0.5 block text-[11px] text-[#6B6255]">{path.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
