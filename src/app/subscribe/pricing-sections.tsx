import Link from "next/link";
import { CONSULTANT_PRICE_NOTE } from "@/lib/pro-tiers";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { TrackLink } from "@/components/track-link";
import { CONTACT_EMAIL, PRODUCT_NAME, REPORT_OFFER } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import { REPORT_PRICE_LABEL } from "./pricing";

const LINK_CLASS = "inline-flex min-h-11 items-center text-sm font-medium text-ink underline underline-offset-2";

const REPORT_ANCHOR_HREF = "/reports?report=institution&src=pricing#request";
// Contact form, not mailto, so every ask lands in /admin/leads with a due time.
const CONTACT_SALES_HREF = "/contact?source=enterprise";

const DISPLAY = { fontFamily: "var(--fi-font-sans)" };

/**
 * The rest of the catalog for a direct visit (James, 9 Oct 2026): a Pro demo, the one-time
 * report and the free index, one line each, so Pro stays the page's subject. No "Advisory" row:
 * Fee Insight is not marketed as advisory (James, 16 Oct 2026, #1174); demos and calls stay.
 */
export function OtherOptions() {
  const rows = [
    {
      name: "A Pro demo",
      note: "A walkthrough of Hamilton on your own market",
      link: (
        <TrackLink event="contact_sales" eventProps={{ placement: "pricing_demo" }} href={DEMO_REQUEST_NAV.href} className={LINK_CLASS}>
          {DEMO_REQUEST_NAV.standaloneLabel}
        </TrackLink>
      ),
    },
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
  ];
  return (
    <section aria-labelledby="other-options-heading">
      <h2 id="other-options-heading" className="text-2xl text-ink font-semibold tracking-tight" style={DISPLAY}>
        Not ready for a subscription?
      </h2>
      <ul className="mt-5 divide-y divide-border border-y border-border">
        {rows.map((row) => (
          <li key={row.name} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3.5">
            <p className="min-w-0 break-words text-[15px] text-ink">
              <span className="font-semibold text-ink">{row.name}</span> · {row.note}
            </p>
            {row.link}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The two lines under the plans for a visitor /pro sent here (the gated state): a demo first, then
 * the one-off report for someone who needs research on one institution instead.
 */
export function GatedOptions({ reportHref }: { reportHref: string }) {
  return (
    <div className="space-y-2 text-[15px] leading-relaxed text-ink">
      <p>
        Want to see Hamilton first?{" "}
        <TrackLink
          event="contact_sales"
          eventProps={{ placement: "pricing_gated_demo" }}
          href={DEMO_REQUEST_NAV.href}
          className="whitespace-nowrap font-medium text-ink underline underline-offset-2"
        >
          {DEMO_REQUEST_NAV.standaloneLabel}
        </TrackLink>
      </p>
      <p>
        Need research for one institution instead?{" "}
        <Link href={reportHref} className="font-medium text-ink underline underline-offset-2">
          Explore the {REPORT_OFFER.name}
        </Link>
      </p>
    </div>
  );
}

function faqItems(summary: PublicStatsSummary) {
  return [
    {
      question: "Can I cancel anytime?",
      answer: "Yes, from your billing page; a plan ends with its paid period. An annual plan cancelled within 14 days of the first payment is refunded in full.",
    },
    {
      question: "Do you invoice or accept POs?",
      answer: `Yes, for annual plans. Email ${CONTACT_EMAIL} and we will send an invoice or work from your PO.`,
    },
    {
      question: "How is the Pro price set?",
      answer: `By your institution's total assets in its latest call report. ${CONSULTANT_PRICE_NOTE} If we don't have your institution's total assets, email ${CONTACT_EMAIL} and we'll set your price. If the plan is used for a larger institution, we'll email you before changing the price.`,
    },
    {
      question: "Where do the figures come from?",
      answer: "From each bank's and credit union's own published fee schedule. Every figure in Hamilton keeps its source document and the date we read it.",
    },
    {
      question: "How do seats work?",
      answer: `One plan covers up to ${WORKSPACE_SEAT_LIMIT} people, each with their own login. Invite them from Hamilton Settings.`,
    },
    {
      question: "How often is the data refreshed?",
      answer: `On a rolling calendar. ${summary.freshnessLabel}.`,
    },
  ];
}

export function PricingFaq({ summary }: { summary: PublicStatsSummary }) {
  return (
    <section aria-labelledby="pricing-faq-heading">
      <h2 id="pricing-faq-heading" className="mb-4 text-xl text-ink font-semibold tracking-tight" style={DISPLAY}>
        Questions before you start
      </h2>
      <div className="divide-y divide-border rounded-2xl border border-border bg-paper">
        {faqItems(summary).map((item) => (
          <details key={item.question} className="group px-6 py-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-ink marker:content-none">
              {item.question}
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-ink">{item.answer}</p>
          </details>
        ))}
      </div>
      <p className="mt-4 text-sm text-ink">
        Prefer to talk it through?{" "}
        <TrackLink
          event="contact_sales"
          eventProps={{ placement: "pricing_faq" }}
          href={CONTACT_SALES_HREF}
          className="font-medium text-ink underline underline-offset-2"
        >
          Send us a message
        </TrackLink>{" "}
        or email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-ink underline underline-offset-2">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </section>
  );
}
