"use client";

import Link from "next/link";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { LeadCapture } from "@/components/public/lead-capture";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME } from "@/lib/constants";

// Display form of the site domain for the "powered by" line under the product name.
const SITE_DOMAIN_DISPLAY = "FeeInsight.com";

interface LandingHeroProps {
  institutionsLabel: string;
}

const REPORT_LANE_HREF = "/for-institutions#report";
const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";

/**
 * Two jobs, one each side: consumers look up a bank; bank/CU staff get the
 * sample report or request their own (free). Keep the copy short — the trust stats
 * band below carries the numbers.
 */
export function LandingHero({ institutionsLabel }: LandingHeroProps) {
  return (
    <section className="border-b border-[#E0D7C9] bg-[#FAF7F2]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:py-16">
        <div className="grid gap-8 sm:gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.7fr)] lg:items-center">
          <div className="min-w-0">
            {/* One line at every width: the size scales with the viewport instead of wrapping. */}
            <h1
              className="whitespace-nowrap text-[clamp(2rem,10vw,3.75rem)] font-normal leading-none tracking-[-0.01em] text-[#1A1815]"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              The {PRODUCT_NAME}
            </h1>
            <p className="mt-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A8072]">
              <span aria-hidden="true" className="h-px w-5 bg-[#C44B2E]/60" />
              Powered by <span className="text-[#5A5347]">{SITE_DOMAIN_DISPLAY}</span>
            </p>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[#5A5347] sm:text-base">
              Look up what {institutionsLabel} banks and credit unions charge — every fee sourced.
            </p>
            <div className="mt-5 max-w-2xl sm:mt-6" aria-label="Search for a bank or credit union">
              <InstitutionSearchBar />
            </div>
            <Link
              href="/institutions"
              className="mt-3 inline-block text-xs font-semibold text-[#6B6255] hover:text-[#C44B2E]"
            >
              Browse all institutions
            </Link>
          </div>

          <ReportCard />
        </div>
      </div>
    </section>
  );
}

function ReportCard() {
  return (
    <div className="rounded-lg border border-[#E0D7C9] bg-[#FDFBF8] p-5 sm:p-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
        For banks and credit unions
      </p>
      <h2 className="mt-2 text-lg font-semibold leading-snug text-[#1A1815]">
        See how your fees compare to your competitors.
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[#5A5347]">
        Get a free sample report by email.
      </p>
      <LeadCapture
        placement="homepage"
        variant="inline"
        className="mt-4"
        headline="Get a free sample report by email"
        buttonLabel="Send it"
      />
      <p className="mt-4 flex flex-wrap items-center gap-x-2 border-t border-[#EDE6DA] pt-3 text-xs text-[#6B6255]">
        <TrackLink
          event="see_sample_report"
          eventProps={{ placement: "home_card" }}
          href={SAMPLE_REPORT_HREF}
          className="font-semibold text-[#1A1815] hover:text-[#C44B2E]"
        >
          View sample
        </TrackLink>
        <span aria-hidden="true" className="text-[#D5CBBF]">·</span>
        <Link href={REPORT_LANE_HREF} className="font-semibold text-[#A93D25] hover:text-[#8E2A17]">
          Get yours free
        </Link>
      </p>
    </div>
  );
}
