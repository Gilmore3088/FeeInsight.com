import Link from "next/link";
import { CONSULTANT_PRICE_NOTE, PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
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

const REPORT_ANCHOR_HREF = "/for-institutions?report=institution#report";
const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
// Contact form, not mailto, so every ask lands in /admin/leads with a due time.
const CONTACT_SALES_HREF = "/contact?source=enterprise";
const ADVISORY_HREF = "/contact?source=advisory";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

export function FreeTierCard({ summary }: { summary: PublicStatsSummary }) {
  return (
    <div className={`${CARD_CLASS} md:flex md:items-center md:justify-between md:gap-8`}>
      <div>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">Free</div>
        <p className="text-base text-[#1A1815]">
          <span className="font-semibold">{PRODUCT_NAME} lookup:</span> published fees for{" "}
          {summary.institutionsLabel} banks and credit unions, {summary.categoriesLabel} categories,
          consumer guides, and an email when a bank or credit union you follow changes a fee.
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
export function ReportCard({ sampleLive = false }: { sampleLive?: boolean }) {
  return (
    <div className={CARD_CLASS}>
      <div className="md:flex md:items-start md:justify-between md:gap-8">
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
            {REPORT_OFFER.name}
          </div>
          <h3 className="text-xl text-[#1A1815]" style={SERIF}>
            {REPORT_PRICE_LABEL}
          </h3>
          <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm text-[#5A5347] sm:grid-cols-2">
            {REPORT_BULLETS.map((bullet) => (
              <li key={bullet} className="flex items-start gap-1.5">
                <span className="text-[#A93D25]">{CHECK}</span>
                {bullet}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-[#5A5347]">
            One institution, one peer set, one source-backed PDF for your pricing committee, prepared by us
            and paid once. It&apos;s separate from the reports you build yourself in Pro.{" "}
            {REPORT_OFFER.nextStep}.
            {sampleLive && (
              <>
                {" "}
                <TrackLink
                  event="see_sample_report"
                  eventProps={{ placement: "pricing_report" }}
                  href={SAMPLE_REPORT_HREF}
                  className="font-medium text-[#1A1815] underline underline-offset-2"
                >
                  See the sample report
                </TrackLink>
                .
              </>
            )}
          </p>
        </div>
        <div className="mt-4 flex-shrink-0 md:mt-0 md:w-56">
          <TrackLink
            event="request_report_click"
            eventProps={{ placement: "pricing_report" }}
            href={REPORT_ANCHOR_HREF}
            className={PRIMARY_BUTTON_CLASS}
          >
            Request your institution report
          </TrackLink>
        </div>
      </div>
    </div>
  );
}

/** Advisory is a contact option under the FAQ, not a fourth plan (James, 9 Oct 2026). */
export function AdvisoryLine() {
  return (
    <p className="mt-6 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] px-6 py-4 text-sm leading-relaxed text-[#5A5347]">
      <span className="font-semibold text-[#1A1815]">{SITE_NAME} Advisory:</span> custom competitor sets, board
      decks and multi-institution work, prepared by us on the same verified data. It&apos;s also the path for
      teams of more than 5 people, data feeds, invoicing and POs.{" "}
      <TrackLink
        event="contact_sales"
        eventProps={{ placement: "pricing_advisory" }}
        href={ADVISORY_HREF}
        className="font-medium text-[#1A1815] underline underline-offset-2"
      >
        Talk to us
      </TrackLink>
      .
    </p>
  );
}

function faqItems(summary: PublicStatsSummary) {
  return [
    {
      question: "Can I cancel anytime?",
      answer: "Yes. Every plan cancels at the end of its current billing period, from your account's billing page. Annual plans cancelled within 14 days of the first annual payment are refunded in full; after that, an annual plan runs to the end of its paid year. Monthly plans aren't refunded.",
    },
    {
      question: "Do you invoice or accept POs?",
      answer: `Yes, for annual plans. Email ${CONTACT_EMAIL} and we will send an invoice or work from your PO.`,
    },
    {
      question: "How is the Pro price set?",
      answer: `By your institution's total assets from its latest call report: ${PRO_TIERS.map(
        (tier) => `${tier.assetsLabel.toLowerCase()} is ${tierPriceLabel(tier.key, "annual")}`,
      ).join(", ")}. ${CONSULTANT_PRICE_NOTE} If we don't have your institution's total assets, email ${CONTACT_EMAIL} and we'll set your price. If we don't have your fee schedule yet, send it there too and we'll add it.`,
    },
    {
      question: "How do seats work?",
      answer: "An institution account includes up to five teammates, the owner included. Once your bank's workspace is set up, add colleagues from Hamilton Settings and send them the invite link. Each person gets their own login and full Pro access.",
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
          event="contact_sales"
          eventProps={{ placement: "pricing_faq" }}
          href={CONTACT_SALES_HREF}
          className="font-medium text-[#1A1815] underline underline-offset-2"
        >
          Send us a message
        </TrackLink>{" "}
        or email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-[#1A1815] underline underline-offset-2">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </section>
  );
}
