import { REPORT_INCLUDES, REPORT_OFFER, REPORT_OFFER_LINE } from "@/lib/constants";

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
      answer:
        "A one-time report that places your institution's published fees next to named competitors in your market, fee by fee.",
    },
    {
      question: "Who is it for?",
      answer: "Marketing, product, pricing and finance teams at banks and credit unions.",
    },
    {
      question: "What does it cost?",
      answer: `${REPORT_OFFER.priceLabel}. Each report is quoted for your institution: we reply within one business day with the scope and the price.`,
    },
    {
      question: "What is in it?",
      answer: `${REPORT_INCLUDES.join(". ")}.`,
    },
    {
      question: "How are the peers chosen?",
      answer:
        "Named institutions in your own market, chosen by charter, asset size, Fed district or county. We confirm the peer set with you before we build the report.",
    },
    {
      question: "How is it delivered?",
      answer: `As a PDF by email, on the date we agree when we confirm your peer set. ${REPORT_OFFER.refreshLabel}.`,
    },
    {
      question: "Is there a free report?",
      answer: `Yes. ${REPORT_OFFER_LINE.replace(" — ", ": ")}.`,
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
      <h2 id="report-faq-heading" className="mb-4 text-[22px] font-semibold tracking-tight text-[#1A1815]">
        Questions about the report
      </h2>
      <div className="max-w-[800px] divide-y divide-[#E8E1D6] rounded-2xl border border-[#E8E1D6] bg-[#FAF7F2]">
        {items.map((item) => (
          <details key={item.question} className="group px-6 py-4">
            <summary className="cursor-pointer list-none text-[14px] font-semibold text-[#1A1815] marker:content-none">
              {item.question}
            </summary>
            <p className="mt-2 text-[14px] leading-relaxed text-[#3D3833]">{item.answer}</p>
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
