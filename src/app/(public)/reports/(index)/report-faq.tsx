import { REPORT_INCLUDES, REPORT_OFFER } from "@/lib/constants";

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * The report's questions, built from the offer constants so the page and its FAQPage JSON-LD say
 * the same thing (#1174). Each answer restates what the offer already says; nothing is added.
 */
export function reportFaqItems(): FaqItem[] {
  return [
    {
      question: `What is the ${REPORT_OFFER.name}?`,
      answer: "A one-time report placing your published fees next to named competitors in your market, fee by fee.",
    },
    {
      question: "What does it cost?",
      answer: `${REPORT_OFFER.priceLabel}, quoted for your institution. ${REPORT_OFFER.nextStep}.`,
    },
    {
      question: "What is in it?",
      answer: `${REPORT_INCLUDES.join(". ")}.`,
    },
    {
      question: "How are the competitors chosen?",
      answer: "By charter, asset size and the counties you serve, and we confirm the list with you first.",
    },
    {
      question: "How is it delivered?",
      answer: `As a PDF by email, on the date we agree. ${REPORT_OFFER.refreshLabel}.`,
    },
  ];
}

export function reportFaqJsonLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function ReportFaq() {
  const items = reportFaqItems();
  return (
    <section aria-labelledby="report-faq-heading" className="mx-auto max-w-page px-6 pt-16">
      <h2 id="report-faq-heading" className="mb-4 text-[22px] font-semibold tracking-tight text-ink">
        Questions about the report
      </h2>
      <div className="max-w-[800px] divide-y divide-border rounded-2xl border border-border bg-paper">
        {items.map((item) => (
          <details key={item.question} className="group px-6 py-4">
            <summary className="cursor-pointer list-none text-[14px] font-semibold text-ink marker:content-none">
              {item.question}
            </summary>
            <p className="mt-2 text-[14px] leading-relaxed text-ink">{item.answer}</p>
          </details>
        ))}
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(reportFaqJsonLd(items)).replace(/</g, "\\u003c") }}
      />
    </section>
  );
}
