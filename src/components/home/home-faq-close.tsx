import Link from "next/link";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { REPORT_INCLUDES, REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { CONSULTANT_PRICE_NOTE, PRO_ANNUAL_RANGE_LABEL } from "@/lib/pro-tiers";
import type { HomeData } from "./home-data";
import { Eyebrow, Section } from "./home-section";

export interface FaqItem {
  question: string;
  answer: string;
}

/** Only true answers: each one is checked against code or a recorded decision. */
export function homeFaq(data: HomeData): FaqItem[] {
  return [
    {
      question: "Where does each figure come from?",
      answer:
        "From the institution's own published fee schedule. Every fee keeps the document, the page and the date it was read from, and our method is public on the methodology page.",
    },
    {
      question: "How current is it?",
      answer: `${data.freshnessLabel}. Schedules are re-read on a rolling calendar, and a change shows once the schedule is re-read. The index is not a real-time feed.`,
    },
    {
      question: "Which institutions and fees are covered?",
      answer: `U.S. banks and credit unions that publish a fee schedule: ${data.institutionsLabel} institutions with published fees in ${data.statesLabel} states today. Deposit and loan rates and treasury management fees are outside the index.`,
    },
    {
      question: "What if my market has only a few institutions?",
      answer:
        "A market with fewer than five institutions gets no median, so you never see a figure built from two or three banks. Your state, Fed district, peer group and the nation still give a comparison.",
    },
    {
      question: "Does Hamilton tell us what to charge?",
      answer:
        "No. Hamilton shows where each fee stands and what a price you try would mean against your market. Its reports set out options for management to weigh. The decision is yours.",
    },
    {
      question: "What does Hamilton cost?",
      answer: `Pro is priced by your institution's assets, ${PRO_ANNUAL_RANGE_LABEL}, as one plan for up to 5 people. ${CONSULTANT_PRICE_NOTE}`,
    },
    {
      question: `What is in a ${REPORT_OFFER.name}?`,
      answer: `${REPORT_INCLUDES.join(". ")}. Each report is quoted, ${REPORT_PRICE_INLINE}. ${REPORT_OFFER.nextStep}.`,
    },
    {
      question: "How do you check accuracy, and what if a fee is wrong?",
      answer:
        "We measure accuracy as the share of live published fees whose amount and category match the institution's own current schedule. If a fee doesn't match, send us the source and we'll re-read it.",
    },
  ];
}

export function FaqSection({ items }: { items: FaqItem[] }) {
  return (
    <Section tone="surface">
      <div className="mx-auto max-w-3xl">
        <Eyebrow>Questions before you start</Eyebrow>
        <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-extrabold leading-tight tracking-[-0.03em] text-ink">
          What fee owners ask us
        </h2>
        <div className="mt-8 divide-y divide-border border-y border-border">
          {items.map((item) => (
            <details key={item.question} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-bold text-ink">
                {item.question}
                <span aria-hidden="true" className="text-ink-muted transition-transform duration-150 group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{item.answer}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-[14px] text-ink-muted">
          Found a fee that doesn&apos;t match?{" "}
          <Link href="/submit-fees" className="font-semibold text-ink underline underline-offset-2">
            Send us the source
          </Link>
          .
        </p>
      </div>
    </Section>
  );
}

/** The closing navy band repeats the promise and the search. */
export function ClosingBand() {
  return (
    <Section dark>
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <h2 className="text-[clamp(2rem,4.5vw,3.25rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-ink">
          See where your fees stand in your market
        </h2>
        <p className="mt-4 text-[17px] text-ink-soft">Search your bank or credit union. Every figure comes with its source.</p>
        <div className="mt-8 w-full max-w-xl text-left">
          <InstitutionSearchBar ariaLabel="Search your bank or credit union" placeholder="Your bank or credit union" />
        </div>
        <Link href="/subscribe" className="mt-6 text-[15px] font-semibold text-ink underline underline-offset-4">
          See Hamilton plans
        </Link>
      </div>
    </Section>
  );
}
