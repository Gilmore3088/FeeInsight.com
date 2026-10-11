import Link from "next/link";
import type { ReactNode } from "react";
import { CTA_PRIMARY, CTA_SECONDARY, H1, LEAD } from "@/components/public/site-look";

interface LandingHeroProps {
  showcase: ReactNode;
}

/**
 * Commercial homepage hero: lead with the institutional job, then demonstrate the
 * four product outcomes in the rotating showcase.
 */
export function LandingHero({ showcase }: LandingHeroProps) {
  return (
    <section aria-labelledby="home-title">
      <div className="mx-auto max-w-page px-6 pb-10 pt-10 sm:pb-14 sm:pt-14 lg:pt-16">
        <div className="grid items-center gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
        <div className="min-w-0 text-center sm:text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
            Your on-demand industry consultant
          </p>
          <h1 id="home-title" className={`mt-3 ${H1}`}>
            Turn scattered market research into a clear fee review.
            <span className="mt-2 block text-[#A93D25]">In one afternoon.</span>
          </h1>
          <p className={`mt-4 mx-auto max-w-3xl text-pretty sm:mx-0 ${LEAD}`}>
            For banks and credit unions. Bring local competitors, published fees, and market context into one sourced brief.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link href="#sample-work" className={CTA_PRIMARY}>
              See a sample fee review
            </Link>
            <Link href="#hamilton-walkthrough" className={CTA_SECONDARY}>
              Explore Hamilton
            </Link>
          </div>
        </div>

        <div className="min-w-0" id="hamilton-walkthrough">
          {showcase}
        </div>
        </div>
      </div>
    </section>
  );
}
