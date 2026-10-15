import Link from "next/link";
import type { ReactNode } from "react";
import { REPORT_INCLUDES, REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { CONSULTANT_PRICE_NOTE, PRO_ANNUAL_RANGE_LABEL } from "@/lib/pro-tiers";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { SECTION_INNER, SectionHeading, TEXT_LINK } from "./landing-shared";

type FaqSummary = Pick<PublicStatsSummary, "institutionsLabel" | "statesLabel" | "freshnessLabel">;

/**
 * Brief 08 §B.11. Two [NEED]s have no live field yet, so their claims are left out: the
 * re-read cadence (FAQ 2, §C.7) and a published accuracy figure (FAQ 8, §C.9).
 */
export function faqItems(summary: FaqSummary): { q: string; a: ReactNode }[] {
  return [
    {
      q: "Where does each figure come from?",
      a: (
        <p>
          From the institution&apos;s own published fee schedule. Every fee keeps the document, the page and
          the date it was read from, and our method is public on the{" "}
          <Link href="/methodology" className={TEXT_LINK}>
            methodology page
          </Link>
          .
        </p>
      ),
    },
    {
      q: "How current is it?",
      a: <p>{summary.freshnessLabel}. A change to a fee schedule shows once the schedule is re-read.</p>,
    },
    {
      q: "Which institutions and fees are covered?",
      a: (
        <p>
          U.S. banks and credit unions that publish a fee schedule: {summary.institutionsLabel} institutions
          with published fees in {summary.statesLabel} states today. We cover consumer fee schedules. Deposit
          and loan rates and treasury management fees are outside the index.
        </p>
      ),
    },
    {
      q: "What if my market has only a few institutions?",
      a: (
        <p>
          A market with fewer than {MIN_INSTITUTIONS_FOR_MEDIAN} institutions is marked thin and gets no median,
          so you never see a figure built from two or three banks. Your state, Fed district, peer group and the
          nation still give a comparison.
        </p>
      ),
    },
    {
      q: "Does Hamilton tell us what to charge?",
      a: (
        <p>
          No. Hamilton shows where each fee stands and what a price you try would mean against your market. Its
          reports set out options for management to weigh. The decision is yours.
        </p>
      ),
    },
    {
      q: "What does Hamilton cost?",
      a: (
        <p>
          Pro is priced by your institution&apos;s assets, {PRO_ANNUAL_RANGE_LABEL}, as one plan for up to{" "}
          {WORKSPACE_SEAT_LIMIT} people. {CONSULTANT_PRICE_NOTE}
        </p>
      ),
    },
    {
      q: `What is in a ${REPORT_OFFER.name}?`,
      a: (
        <>
          <ul className="list-disc space-y-1 pl-5">
            {REPORT_INCLUDES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-2">
            Each report is quoted, {REPORT_PRICE_INLINE}. {REPORT_OFFER.nextStep}.
          </p>
        </>
      ),
    },
    {
      q: "How do you check accuracy, and what if a fee is wrong?",
      a: (
        <p>
          We measure accuracy as the share of live published fees whose amount and category match the
          institution&apos;s own current schedule. If a fee doesn&apos;t match, send us the source and we&apos;ll
          re-read it.{" "}
          <Link href="/submit-fees" className={TEXT_LINK}>
            Submit a fee source
          </Link>
        </p>
      ),
    },
  ];
}

export function LandingFaq({ summary }: { summary: FaqSummary }) {
  return (
    <section className="border-b border-border bg-paper">
      <div className={`${SECTION_INNER} py-14 sm:py-16`}>
        <div className="max-w-3xl">
          <SectionHeading title="Questions before you start" />
          <div className="mt-6 divide-y divide-border border-y border-border">
            {faqItems(summary).map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[16px] font-semibold text-ink">
                  <span>{item.q}</span>
                  <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <div className="mt-3 text-[15px] leading-relaxed text-ink-soft">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
