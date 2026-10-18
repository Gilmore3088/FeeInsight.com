import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { CompareCounts } from "./profile-view";
import { SERIF } from "./profile-serif";

export interface HeroFact {
  label: string;
  value: string;
  href?: string;
  /** Spans both columns on a phone (long values such as a holding company's name). */
  wide?: boolean;
}

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
  counts,
  finding,
  source,
  primary,
  schedulesHref,
}: {
  name: string;
  stateName: string | null;
  stateCode: string | null;
  /** Headquarters, charter, assets, Fed district, regulator, holding company: only the ones known. */
  facts: HeroFact[];
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
          {facts.length > 0 && (
            <dl className="mt-6 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-4 border-t border-white/20 pt-5 sm:grid-cols-3">
              {facts.map((fact) => (
                <div key={fact.label} className={`min-w-0 ${fact.wide ? "col-span-2 sm:col-span-1" : ""}`}>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#b9c8d4]">{fact.label}</dt>
                  <dd className="mt-1 break-words text-[15px] leading-snug text-white sm:text-[16px]">
                    {fact.href ? (
                      <Link href={fact.href} className="underline decoration-white/40 underline-offset-4 hover:decoration-white">
                        {fact.value}
                      </Link>
                    ) : (
                      fact.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
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
              {/* The slash is drawn with CSS so copied or extracted text reads "16 of 24", never "16/ of 24" (#1953). */}
              <span className="mx-3 font-normal text-white/70 before:content-['/']" aria-hidden="true" />
              <span className="sr-only"> of </span>
              {counts.compared}
            </p>
            <p className="mt-4 text-[18px] text-white sm:text-[20px]">compared fees are above the median.</p>
            <p className="mt-3 text-[15px] text-[#d9e2e9] sm:text-[16px]">
              {counts.below} below, {counts.same} about the same.
            </p>
            {counts.same > 0 && <p className="mt-1 text-[13px] text-[#d9e2e9]">About the same: within 1% of the median.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
