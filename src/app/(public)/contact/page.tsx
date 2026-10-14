import type { Metadata } from "next";
import { CONTACT_EMAIL } from "@/lib/constants";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with Fee Insight about a Competitive Fee Position Report, Fee Insight Pro seats, Advisory work, data licensing, or anything else.",
};

export default function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
        Get in touch
      </h1>
      <p className="mt-2 text-[14px] text-ink-muted">
        Reports, Pro seats, Advisory work, data licensing, or general
        questions. We typically respond within one business day.
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
