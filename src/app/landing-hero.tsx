import Link from "next/link";
import type { ReactNode } from "react";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { PRODUCT_NAME } from "@/lib/constants";
import { GLASS, H1, LEAD, TEXT_LINK } from "@/components/public/site-look";

interface LandingHeroProps {
  institutionsLabel: string;
  aside?: ReactNode;
}

/**
 * Homepage job: help a visitor find an institution's published fees immediately.
 * National benchmark data sits beside the search as supporting proof, not a second journey.
 */
export function LandingHero({ institutionsLabel, aside }: LandingHeroProps) {
  return (
    <section aria-labelledby="home-title">
      <div className="mx-auto max-w-page px-4 pb-10 pt-10 sm:px-6 sm:pb-14 sm:pt-14 lg:pt-16">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
            The {PRODUCT_NAME}
          </p>
          <h1 id="home-title" className={`mt-3 ${H1}`}>
            See what your bank charges.
          </h1>
          <p className={`mt-4 text-pretty ${LEAD}`}>
            Search {institutionsLabel} U.S. banks and credit unions. Every published fee traces back to the institution&apos;s own fee schedule.
          </p>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-2 xl:items-stretch xl:gap-8">
          <div className={`flex min-w-0 flex-col justify-center p-5 sm:p-7 ${GLASS}`}>
            <h2 className="text-xl font-semibold tracking-tight text-[#1A1815] sm:text-2xl">
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
          {aside}
        </div>
      </div>
    </section>
  );
}
