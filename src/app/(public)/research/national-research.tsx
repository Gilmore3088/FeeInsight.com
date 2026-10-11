import Link from "next/link";
import { GLASS_SOFT, H2 } from "@/components/public/site-look";

const NATIONAL_PATHS = [
  {
    href: "/research/national-fee-index",
    eyebrow: "National data",
    title: "National Fee Index",
    body: "See national fee medians, typical ranges and institution counts across the published fee catalog.",
    action: "Open national benchmarks",
  },
  {
    href: "/research/fee-revenue-analysis",
    eyebrow: "National research",
    title: "Fees, revenue and market structure",
    body: "Study published fee schedules alongside call-report income and market-concentration data.",
    action: "Explore national studies",
  },
  {
    href: "/research/data-sources",
    eyebrow: "Research data",
    title: "Federal data sources",
    body: "See the FDIC, NCUA, CFPB, Federal Reserve, BLS and Census data used across Fee Insight research.",
    action: "See data sources",
  },
] as const;

export function NationalResearch() {
  return (
    <section id="national" className="scroll-mt-28">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
            National data & research
          </p>
          <h2 className={`mt-2 ${H2}`}>Start with the national picture.</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-[#3D3830]">
            Benchmark fees across the country, then connect them to financial, economic and market data.
          </p>
        </div>
      </div>

      <div className="mt-7 grid gap-4 lg:grid-cols-3">
        {NATIONAL_PATHS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex min-h-[220px] flex-col p-6 no-underline hover:-translate-y-0.5 ${GLASS_SOFT}`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#A93D25]">
              {item.eyebrow}
            </p>
            <h3 className="mt-3 text-xl font-semibold tracking-tight text-[#1A1815] group-hover:text-[#A93D25]">
              {item.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[#5A5347]">{item.body}</p>
            <span className="mt-auto pt-6 text-sm font-semibold text-[#A93D25]">
              {item.action} <span aria-hidden="true">→</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
