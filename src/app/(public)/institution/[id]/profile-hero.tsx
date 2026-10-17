import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { CompareCounts } from "./profile-view";
import { SERIF } from "./profile-serif";

/**
 * The profile's hero (James's design file, Oct 17): a navy band with the institution, where it
 * sits and its size, the page's two actions, and on the right the one count the page leads with:
 * how many of its compared fees sit above the median. With no count (a thin or missing schedule)
 * the finding sentence takes the right side's place under the facts.
 */
export function ProfileHero({
  name,
  stateName,
  stateCode,
  facts,
  recordFacts,
  districtName,
  district,
  counts,
  finding,
  source,
  primary,
  schedulesHref,
}: {
  name: string;
  stateName: string | null;
  stateCode: string | null;
  /** "Tallahassee, Florida · Bank · $4.4B assets". */
  facts: string;
  /** "Regulator: OCC · Holding company: Capital City Bank Group"; empty when unknown. */
  recordFacts: string;
  districtName: string | null;
  district: number | null;
  counts: CompareCounts | null;
  finding: string;
  /** The source line under the finding, shown only when there is no count. */
  source: React.ReactNode;
  primary: { href: string; label: string };
  /** The schedule section's anchor; null when nothing is published. */
  schedulesHref: string | null;
}) {
  const place = counts?.level === "state" && stateName ? stateName : "the U.S.";
  return (
    <section className="fi-profile-hero relative isolate text-white" aria-labelledby="profile-title">
      <div
        className={`mx-auto max-w-page px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:pb-20 ${
          counts ? "lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-14" : ""
        }`}
      >
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-3 text-[13px] text-[#d9e2e9]">
            <Link href="/institutions" className="inline-flex min-h-11 items-center hover:text-white">
              Institutions
            </Link>
            {stateName && stateCode && (
              <>
                <span aria-hidden="true">/</span>
                <Link href={`/research/state/${stateCode}`} className="inline-flex min-h-11 items-center hover:text-white">
                  {stateName}
                </Link>
              </>
            )}
          </nav>
          <h1
            id="profile-title"
            className="mt-2 break-words text-[42px] font-medium leading-[1.02] tracking-[-0.025em] text-white sm:text-[60px] lg:text-[78px]"
            style={SERIF}
          >
            {name}
          </h1>
          {facts && <p className="mt-4 text-[17px] text-[#e0e9ee] sm:text-[19px]">{facts}</p>}
          {districtName && district && (
            <p className="mt-1 text-[15px] text-[#d9e2e9] sm:text-[17px]">
              <Link href={`/research/district/${district}`} className="hover:text-white hover:underline">
                {districtName} Fed district
              </Link>
            </p>
          )}
          {recordFacts && <p className="mt-1 text-[14px] text-[#d9e2e9] sm:text-[15px]">{recordFacts}</p>}
          {!counts && (
            <>
              <p className="mt-6 max-w-2xl text-[18px] font-semibold leading-snug text-white sm:text-[20px]">{finding}</p>
              <p className="mt-2 text-[13px] text-[#d9e2e9] [&_a]:text-white [&_a]:underline">{source}</p>
            </>
          )}
          <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-4">
            <Link href={primary.href} className="fi-btn fi-btn-brick min-h-12 px-8 text-[15px]">
              {primary.label}
            </Link>
            {schedulesHref && (
              <a
                href={schedulesHref}
                className="inline-flex min-h-11 items-center gap-2 text-[15px] font-medium text-white underline decoration-white/40 underline-offset-[6px] hover:decoration-white"
              >
                View published fees
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
            )}
          </div>
        </div>
        {counts && (
          <div className="mt-10 border-t border-white/20 pt-6 lg:mt-6 lg:border-l lg:border-t-0 lg:pl-14 lg:pt-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#d9e2e9]">Compared with {place}</p>
            <p className="mt-3 text-[68px] font-medium leading-none tracking-[-0.02em] [font-variant-numeric:tabular-nums] sm:text-[92px]" style={SERIF}>
              {counts.above}
              <span className="mx-3 font-normal text-white/70" aria-hidden="true">
                /
              </span>
              <span className="sr-only"> of </span>
              {counts.compared}
            </p>
            <p className="mt-4 text-[18px] text-white sm:text-[20px]">compared fees above the median.</p>
            <p className="mt-3 text-[15px] text-[#d9e2e9] sm:text-[16px]">
              {counts.below} below
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
              {counts.same} about the same.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
