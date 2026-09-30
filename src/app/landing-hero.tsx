"use client";

import Link from "next/link";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { LeadCapture } from "@/components/public/lead-capture";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, REPORT_OFFER } from "@/lib/constants";
import { HAMILTON_CANONICAL } from "@/app/for-institutions/hamilton-copy";
import { ArrowRight, FileText, Search, Users, type LucideIcon } from "lucide-react";

interface LandingHeroProps {
  institutionsLabel: string;
}

const REPORT_LANE_HREF = "/for-institutions#report";
const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";

export function LandingHero({ institutionsLabel }: LandingHeroProps) {
  return (
    <section className="border-b border-[#E0D7C9] bg-[#FAF7F2]">
      <div className="mx-auto max-w-6xl px-6 py-10 lg:py-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)] lg:items-end">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
              Published fees · {institutionsLabel} institutions · every figure sourced
            </p>
            <h1
              className="mt-3 max-w-3xl text-5xl font-normal leading-[0.98] text-[#1A1815] sm:text-6xl"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              The {PRODUCT_NAME}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#5A5347]">
              What does your bank charge? Look up overdraft, ATM, wire and monthly fees for{" "}
              {institutionsLabel} banks and credit unions — every figure traced to the published
              schedule.
            </p>

            <div className="mt-6 max-w-2xl" aria-label="Search for a bank or credit union">
              <InstitutionSearchBar />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#6B6255]">
              <span>{institutionsLabel} institutions with verified fees</span>
              <span className="hidden h-1 w-1 rounded-full bg-[#C44B2E] sm:inline-block" />
              <Link href="/institutions" className="font-semibold text-[#1A1815] hover:text-[#C44B2E]">
                Browse institution directory
              </Link>
              <span className="hidden h-1 w-1 rounded-full bg-[#C44B2E] sm:inline-block" />
              <Link href="/submit-fees" className="font-semibold text-[#1A1815] hover:text-[#C44B2E]">
                Submit a fee source
              </Link>
            </div>
            <LeadCapture
              placement="homepage"
              className="mt-6 max-w-2xl"
              eyebrow="Work at a bank or credit union?"
              headline="Get the free sample fee report"
              body="A real Competitive Fee Position Report — one community bank against eight named peers. Sent to your work inbox."
              buttonLabel="Email me the sample"
              successMessage="Sent — check your work inbox for the sample PDF and confirm your email."
              secondaryLink={{
                href: REPORT_LANE_HREF,
                label: `Or get yours — ${REPORT_OFFER.priceLabel}`,
              }}
            />
          </div>

          <ProWorkflowCard />
        </div>
      </div>
    </section>
  );
}

function ProWorkflowCard() {
  return (
    <div className="rounded-lg border border-[#E0D7C9] bg-[#FDFBF8] p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
        For banks and credit unions
      </p>
      <h2 className="mt-2 text-xl font-semibold leading-snug text-[#1A1815]">
        Where your fees stand against the banks you actually compete with — named, cited, in 48 hours.
      </h2>
      <p className="mt-2 text-sm text-[#5A5347]">
        {REPORT_OFFER.name} — {REPORT_OFFER.priceLabel}, {REPORT_OFFER.turnaround}.
      </p>
      <div className="mt-4 divide-y divide-[#E0D7C9]">
        <WorkflowStep icon={Search} title="15 headline fees against your true peer cohort" />
        <WorkflowStep icon={Users} title="Named competitors on the same lines" />
        <WorkflowStep icon={FileText} title="Every figure traced to the published schedule" />
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <TrackLink
          event="see_sample_report"
          eventProps={{ placement: "home_card" }}
          href={SAMPLE_REPORT_HREF}
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#C44B2E] px-3 py-2 text-sm font-semibold text-white hover:bg-[#A93D25]"
        >
          See the sample report
          <ArrowRight className="h-4 w-4" />
        </TrackLink>
        <Link
          href={REPORT_LANE_HREF}
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[#D5CBBF] px-3 py-2 text-sm font-semibold text-[#1A1815] hover:border-[#1A1815]"
        >
          Request yours — {REPORT_OFFER.priceLabel}
        </Link>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-[#6B6255]">
        Need it every quarter? {HAMILTON_CANONICAL}{" "}
        <Link href="/subscribe" className="font-semibold text-[#A93D25] underline">
          See pricing
        </Link>
        .
      </p>
    </div>
  );
}

function WorkflowStep({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#C44B2E]" />
      <p className="text-sm font-semibold text-[#1A1815]">{title}</p>
    </div>
  );
}
