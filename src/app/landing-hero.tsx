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
      <div className="mx-auto max-w-page px-4 pb-10 pt-10 sm:px-6 sm:pb-14 sm:pt-14 lg:pt-16">
        <div className="max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
            Fee intelligence for banks and credit unions
          </p>
          <h1 id="home-title" className={`mt-3 ${H1}`}>
            See where your fees stand.
          </h1>
          <p className={`mt-4 max-w-3xl text-pretty ${LEAD}`}>
            Compare named peers, analyze market context, monitor changes, and turn the evidence into a board-ready review.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link href="/subscribe" className={CTA_PRIMARY}>
              See Fee Insight Pro
            </Link>
            <Link href="#bank-fee-index" className={CTA_SECONDARY}>
              Explore the Bank Fee Index
            </Link>
          </div>
        </div>

        <div className="mt-8">
          {showcase}
        </div>
      </div>
    </section>
  );
}
