import Link from "next/link";
import type { ReactNode } from "react";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { PRO_ANNUAL_RANGE_LABEL } from "@/lib/pro-tiers";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { SECTION_INNER, SectionHeading, TEXT_LINK } from "./landing-shared";

type FaqSummary = Pick<PublicStatsSummary, "freshnessLabel">;

/**
 * Brief 06 §1.9: the buyer's objections, five at most, one or two sentences each. No
 * re-read cadence and no accuracy figure: neither has a live field yet (08 §C.7, §C.9).
 */
export function faqItems(summary: FaqSummary): { q: string; a: ReactNode }[] {
  return [
    {
      q: "Where does each figure come from?",
      a: (
        <>
          From the institution&apos;s own published fee schedule, kept with its page and date. Our{" "}
          <Link href="/methodology" className={TEXT_LINK}>
            method is public
          </Link>
          .
        </>
      ),
    },
    {
      q: "How current is it?",
      a: <>{summary.freshnessLabel}. A changed schedule shows once it is re-read.</>,
    },
    {
      q: "What if my market has only a few institutions?",
      a: (
        <>
          Under {MIN_INSTITUTIONS_FOR_MEDIAN} institutions, a market is marked thin and gets no median. Your state, district,
          peer group and the nation still compare.
        </>
      ),
    },
    {
      q: "Does Hamilton tell us what to charge?",
      a: <>No. Hamilton shows where each fee stands and what a price would mean; the decision is yours.</>,
    },
    {
      q: "What does Hamilton cost?",
      a: <>{PRO_ANNUAL_RANGE_LABEL}, set by your institution&apos;s assets. Monthly billing is also available.</>,
    },
  ];
}

export function LandingFaq({ summary }: { summary: FaqSummary }) {
  return (
    <section className="border-t border-border bg-paper">
      <div className={`${SECTION_INNER} py-16 sm:py-24`}>
        <div className="mx-auto max-w-3xl">
          {/* A no-break space keeps "Questions" off a line of its own on a phone. */}
          <SectionHeading center title={"Questions\u00a0before you start"} />
          <div className="mt-8 divide-y divide-border border-y border-border">
            {faqItems(summary).map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-ink">
                  <span>{item.q}</span>
                  <span aria-hidden="true" className="text-[20px] text-ink-muted transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
