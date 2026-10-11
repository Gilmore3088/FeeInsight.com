import Link from "next/link";
import type { ReactNode } from "react";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { PRODUCT_NAME } from "@/lib/constants";
import { GLASS, H1, LEAD, TEXT_LINK } from "@/components/public/site-look";

interface LandingHeroProps {
  institutionsLabel: string;
  showcase: ReactNode;
}

/**
 * Homepage hero: direct institution lookup on the left; four rotating Fee Insight Pro
 * value examples on the right (Benchmark, Analyze, Monitor, Report).
 */
export function LandingHero({ institutionsLabel, showcase }: LandingHeroProps) {
  return (
    <section aria-labelledby="home-title">
      <div className="mx-auto max-w-page px-4 pb-10 pt-10 sm:px-6 sm:pb-14 sm:pt-14 lg:pt-16">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:items-start xl:gap-10">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
              The {PRODUCT_NAME}
            </p>
            <h1 id="home-title" className={`mt-3 ${H1}`}>
              See what your bank charges.
            </h1>
            <p className={`mt-4 max-w-xl text-pretty ${LEAD}`}>
              Search {institutionsLabel} U.S. banks and credit unions. Every published fee traces back to the institution&apos;s own fee schedule.
            </p>

            <div className={`mt-7 p-5 sm:p-6 ${GLASS}`}>
              <h2 className="text-xl font-semibold tracking-tight text-[#1A1815]">
                Find an institution
              </h2>
              <div className="mt-4" role="search" aria-label="Search for a bank or credit union">
                <InstitutionSearchBar />
              </div>
              <p className="mt-3 text-sm text-[#5A5347]">
                <Link href="/institutions" className={TEXT_LINK}>
                  Browse by state
                </Link>
              </p>
            </div>
          </div>

          <div className="min-w-0">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#6B6255]">
              Fee Insight Pro in action
            </p>
            {showcase}
          </div>
        </div>
      </div>
    </section>
  );
}
