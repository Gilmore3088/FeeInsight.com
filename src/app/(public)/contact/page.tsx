import type { Metadata } from "next";
import { CONTACT_EMAIL, REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { hamiltonFullName } from "@/lib/subscribe-reason";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: `Get in touch with ${SITE_NAME} about a Hamilton demo, Pro seats, the ${REPORT_OFFER.name}, Advisory work, data licensing, or anything else.`,
};

/**
 * /contact?source=demo is the Pro demo request (growth OS review M2): it reads as one, and we
 * reply to set a time. No booking link. Every other source keeps the general page.
 */
export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const isDemo = (await searchParams).source === "demo";
  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-brick/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brick/60">
          Contact
        </span>
      </div>

      <h1
        className="font-extrabold text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-ink"
        style={{ fontFamily: "var(--fi-font-sans)" }}
      >
        {isDemo ? "Ask for a Hamilton demo" : "Get in touch"}
      </h1>
      <p className="mt-2 text-[14px] text-ink-muted">
        {isDemo
          ? `We walk you through ${hamiltonFullName(SITE_NAME)}, using your own market. We reply within one business day to set a time.`
          : "Reports, Pro seats, Advisory work, data licensing, or general questions. We typically respond within one business day."}
      </p>

      <div className="mt-8">
        <ContactForm searchParamsPromise={searchParams} />
      </div>

      <div className="mt-10 rounded-xl border border-border bg-paper/50 px-6 py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-ink-muted mb-2">
          Prefer email?
        </p>
        <p className="text-[13px] text-ink-muted">
          Reach us directly at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-brick font-medium select-all">
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </div>
  );
}
