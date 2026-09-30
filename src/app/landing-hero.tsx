"use client";

import Link from "next/link";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { LeadCapture } from "@/components/public/lead-capture";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, REPORT_OFFER } from "@/lib/constants";

interface LandingHeroProps {
  institutionsLabel: string;
}

const REPORT_LANE_HREF = "/for-institutions#report";
const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";

/**
 * Two jobs, one each side: consumers look up a bank; bank/CU staff get the
 * sample report or request their own. Keep the copy short — the trust stats
 * band below carries the numbers.
 */
export function LandingHero({ institutionsLabel }: LandingHeroProps) {
  return (
    <section className="border-b border-[#E0D7C9] bg-[#FAF7F2]">
      <div className="mx-auto max-w-6xl px-6 py-12 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.7fr)] lg:items-center">
          <div className="min-w-0">
            <h1
              className="max-w-3xl text-5xl font-normal leading-[0.98] text-[#1A1815] sm:text-6xl"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              The {PRODUCT_NAME}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-[#5A5347]">
              Look up what {institutionsLabel} banks and credit unions charge — every fee sourced.
            </p>
            <div className="mt-6 max-w-2xl" aria-label="Search for a bank or credit union">
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
    <div className="rounded-lg border border-[#E0D7C9] bg-[#FDFBF8] p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
        For banks and credit unions
      </p>
      <h2 className="mt-2 text-lg font-semibold leading-snug text-[#1A1815]">
        See how your fees compare to your competitors.
      </h2>
      <p className="mt-4 text-sm text-[#5A5347]">Get a free sample report by email:</p>
      <LeadCapture
        placement="homepage"
        variant="inline"
        className="mt-2"
        headline="Get a free sample report by email"
        buttonLabel="Send it"
        successMessage="Sent — check your work inbox for the sample and confirm your email."
      />
      <p className="mt-3 text-xs text-[#6B6255]">
        <TrackLink
          event="see_sample_report"
          eventProps={{ placement: "home_card" }}
          href={SAMPLE_REPORT_HREF}
          className="font-semibold text-[#1A1815] hover:text-[#C44B2E]"
        >
          View sample
        </TrackLink>
        <span className="mx-2 text-[#D5CBBF]">·</span>
        <Link href={REPORT_LANE_HREF} className="font-semibold text-[#A93D25] hover:text-[#8E2A17]">
          Get yours — {REPORT_OFFER.priceLabel}
        </Link>
      </p>
    </div>
  );
}
