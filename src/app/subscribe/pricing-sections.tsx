import Link from "next/link";
import { CONSULTANT_PRICE_NOTE, PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { TrackLink } from "@/components/track-link";
import { CONTACT_EMAIL, PRODUCT_NAME, REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { REPORT_PRICE_LABEL } from "./pricing";

const LINK_CLASS = "inline-flex min-h-11 items-center text-sm font-medium text-[#A93D25] underline underline-offset-2";

const REPORT_ANCHOR_HREF = "/for-institutions?report=institution#report";
// Contact form, not mailto, so every ask lands in /admin/leads with a due time.
const CONTACT_SALES_HREF = "/contact?source=enterprise";
const ADVISORY_HREF = "/contact?source=advisory";

const DISPLAY = { fontFamily: "var(--font-jakarta), ui-sans-serif, system-ui, sans-serif" };

/**
 * The rest of the catalog for a direct visit (James, 9 Oct 2026): the one-time report, the
 * free index and Advisory, one line each, so Pro stays the page's subject.
 */
export function OtherOptions() {
  const rows = [
    {
      name: REPORT_OFFER.name,
      note: `${REPORT_PRICE_LABEL}, one institution, paid once`,
      link: (
        <TrackLink event="request_report_click" eventProps={{ placement: "pricing_report" }} href={REPORT_ANCHOR_HREF} className={LINK_CLASS}>
          Request a report
        </TrackLink>
      ),
    },
    {
      name: PRODUCT_NAME,
      note: "Free published-fee lookup",
      link: (
        <Link href="/institutions" className={LINK_CLASS}>
          Search the index
        </Link>
      ),
    },
    {
      name: `${SITE_NAME} Advisory`,
      note: "Custom research, teams over 5, data feeds",
      link: (
        <TrackLink event="contact_sales" eventProps={{ placement: "pricing_advisory" }} href={ADVISORY_HREF} className={LINK_CLASS}>
          Talk to us
        </TrackLink>
      ),
    },
  ];
  return (
    <section aria-labelledby="other-options-heading">
      <h2 id="other-options-heading" className="text-2xl text-[#1A1815] font-semibold tracking-tight" style={DISPLAY}>
        Not ready for a subscription?
      </h2>
      <ul className="mt-5 divide-y divide-[#E8E1D6] border-y border-[#E8E1D6]">
        {rows.map((row) => (
          <li key={row.name} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3.5">
            <p className="text-[15px] text-[#3D3833]">
              <span className="font-semibold text-[#1A1815]">{row.name}</span> · {row.note}
            </p>
            {row.link}
          </li>
        ))}
      </ul>
    </section>
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
      <h2 id="pricing-faq-heading" className="mb-4 text-xl text-[#1A1815] font-semibold tracking-tight" style={DISPLAY}>
        Questions before you start
      </h2>
      <div className="divide-y divide-[#E8E1D6] rounded-2xl border border-[#E8E1D6] bg-[#FAF7F2]">
        {faqItems(summary).map((item) => (
          <details key={item.question} className="group px-6 py-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-[#1A1815] marker:content-none">
              {item.question}
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-[#3D3833]">{item.answer}</p>
          </details>
        ))}
      </div>
      <p className="mt-4 text-sm text-[#3D3833]">
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
