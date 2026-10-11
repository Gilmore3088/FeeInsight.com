import Link from "next/link";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { GLASS, H2, TEXT_LINK } from "@/components/public/site-look";

export function LandingPublicSearch({ institutionsLabel }: { institutionsLabel: string }) {
  return (
    <section id="bank-fee-index" aria-labelledby="bank-fee-index-title" className="scroll-mt-20">
      <div className="mx-auto max-w-page px-4 pb-12 sm:px-6 sm:pb-16">
        <div className={`grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:items-center ${GLASS}`}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
              The Bank Fee Index
            </p>
            <h2 id="bank-fee-index-title" className={`mt-2 ${H2}`}>
              Looking up a bank or credit union?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#5A5347]">
              Search {institutionsLabel} institutions and trace published fees back to the source.
            </p>
          </div>
          <div>
            <div role="search" aria-label="Search for a bank or credit union">
              <InstitutionSearchBar />
            </div>
            <p className="mt-3 text-sm text-[#5A5347]">
              <Link href="/institutions" className={TEXT_LINK}>
                Browse by state
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
