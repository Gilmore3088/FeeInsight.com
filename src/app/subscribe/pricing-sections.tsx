import Link from "next/link";
import { TrackLink } from "@/components/track-link";
import { CONTACT_EMAIL, PRODUCT_NAME, REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { REPORT_BULLETS, REPORT_PRICE_LABEL } from "./pricing";

const CARD_CLASS = "rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6";
const PRIMARY_BUTTON_CLASS =
  "block w-full rounded-md bg-[#C44B2E] px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-[#A93D25] transition-colors";
const SECONDARY_BUTTON_CLASS =
  "block w-full rounded-md border border-[#D5CBBF] px-4 py-2.5 text-center text-sm font-medium text-[#1A1815] hover:border-[#1A1815] transition-colors";
const CHECK = "✓";

const REPORT_ANCHOR_HREF = "/for-institutions#report";
const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
const WALKTHROUGH_HREF = `mailto:${CONTACT_EMAIL}?subject=Walkthrough`;
const ADVISORY_HREF = `mailto:${CONTACT_EMAIL}?subject=Fee%20Insight%20Advisory`;

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

export function FreeTierCard({ summary }: { summary: PublicStatsSummary }) {
  return (
    <div className={`${CARD_CLASS} md:flex md:items-center md:justify-between md:gap-8`}>
      <div>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">Free</div>
        <p className="text-base text-[#1A1815]">
          <span className="font-semibold">{PRODUCT_NAME} lookup:</span> published fees for{" "}
          {summary.institutionsLabel} banks and credit unions, {summary.categoriesLabel} categories,
          consumer guides.
        </p>
      </div>
      <div className="mt-4 flex-shrink-0 md:mt-0 md:w-56">
        <Link href="/institutions" className={SECONDARY_BUTTON_CLASS}>
          Search the index
        </Link>
      </div>
    </div>
  );
}

/** The one commissioned product. Eyebrow is the product name, not the Advisory tier. */
export function ReportCard() {
  return (
    <div className={CARD_CLASS}>
      <div className="md:flex md:items-start md:justify-between md:gap-8">
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
            {REPORT_OFFER.name}
          </div>
          <h2 className="text-xl text-[#1A1815]" style={SERIF}>
            {REPORT_PRICE_LABEL}, {REPORT_OFFER.turnaround}
          </h2>
          <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm text-[#5A5347] sm:grid-cols-2">
            {REPORT_BULLETS.map((bullet) => (
              <li key={bullet} className="flex items-start gap-1.5">
                <span className="text-[#A93D25]">{CHECK}</span>
                {bullet}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-[#5A5347]">
            One institution, one peer set, one PDF for your pricing committee.{" "}
            <TrackLink
              event="see_sample_report"
              eventProps={{ placement: "pricing_report" }}
              href={SAMPLE_REPORT_HREF}
              className="font-medium text-[#1A1815] underline underline-offset-2"
            >
              See the sample report
            </TrackLink>
            .
          </p>
        </div>
        <div className="mt-4 flex-shrink-0 md:mt-0 md:w-56">
          <TrackLink
            event="request_report"
            eventProps={{ placement: "pricing_report" }}
            href={REPORT_ANCHOR_HREF}
            className={PRIMARY_BUTTON_CLASS}
          >
            {REPORT_OFFER.ctaLabel}
          </TrackLink>
        </div>
      </div>
    </div>
  );
}

/** Bespoke tier: absorbs the old "Contact sales" card. */
export function AdvisoryCard() {
  return (
    <div className={CARD_CLASS}>
      <div className="md:flex md:items-start md:justify-between md:gap-8">
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
            {SITE_NAME} Advisory
          </div>
          <h2 className="text-xl text-[#1A1815]" style={SERIF}>
            Custom competitor sets, board decks, multi-institution work
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[#5A5347]">
            Prepared by us on the same verified data. Also the path for multi-seat licenses, data
            feeds, invoicing and POs, and dedicated support for larger institutions and vendors.
          </p>
        </div>
        <div className="mt-4 flex-shrink-0 md:mt-0 md:w-56">
          <TrackLink
            event="contact_sales"
            eventProps={{ placement: "pricing_advisory" }}
            href={ADVISORY_HREF}
            className={SECONDARY_BUTTON_CLASS}
          >
            Talk to us
          </TrackLink>
        </div>
      </div>
    </div>
  );
}

function faqItems(summary: PublicStatsSummary) {
  return [
    {
      question: "Can I cancel anytime?",
      answer: "Yes. Monthly seats cancel at the end of the current billing period; no long-term commitment.",
    },
    {
      question: "Do you invoice or accept POs?",
      answer: `Yes, for annual seats. Email ${CONTACT_EMAIL} and we will send an invoice or work from your PO.`,
    },
    {
      question: "How do seats work?",
      answer: `One seat per named user. Each seat is billed separately; to add colleagues, email ${CONTACT_EMAIL} and we will set them up on the same workspace.`,
    },
    {
      question: "How often is the data refreshed?",
      answer: `On a rolling calendar — every schedule is rechecked at least quarterly. ${summary.freshnessLabel}.`,
    },
  ];
}

export function PricingFaq({ summary }: { summary: PublicStatsSummary }) {
  return (
    <section aria-labelledby="pricing-faq-heading">
      <h2 id="pricing-faq-heading" className="mb-4 text-xl text-[#1A1815]" style={SERIF}>
        Questions before you start
      </h2>
      <div className="divide-y divide-[#E0D7C9] rounded-xl border border-[#E0D7C9] bg-[#FDFBF8]">
        {faqItems(summary).map((item) => (
          <details key={item.question} className="group px-6 py-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-[#1A1815] marker:content-none">
              {item.question}
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-[#5A5347]">{item.answer}</p>
          </details>
        ))}
      </div>
      <p className="mt-4 text-sm text-[#5A5347]">
        Prefer to talk it through?{" "}
        <TrackLink
          event="book_walkthrough"
          eventProps={{ placement: "pricing_faq" }}
          href={WALKTHROUGH_HREF}
          className="font-medium text-[#1A1815] underline underline-offset-2"
        >
          Book a 20-minute walkthrough
        </TrackLink>
        .
      </p>
    </section>
  );
}
