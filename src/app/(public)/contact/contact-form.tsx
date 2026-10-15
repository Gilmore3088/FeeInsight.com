"use client";

import { useEffect, useRef, useState, use, type ReactNode } from "react";
import { HoneypotField, honeypotValue } from "@/components/public/honeypot-field";
import { LEAD_HONEYPOT_FIELD } from "@/lib/lead-capture";
import { readFirstTouch } from "@/lib/marketing-touch";
import { CONTACT_EMAIL, REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";

const INQUIRY_TYPES = [
  // Pro first, the one-off report second (site v3 brief 03 section 4: Pro is the goal).
  // Short enough to show whole in the select at 375px (growth OS review M2).
  { value: "demo", label: "Hamilton demo" },
  { value: "report", label: `${REPORT_OFFER.name} (${REPORT_PRICE_INLINE})` },
  { value: "enterprise", label: "Hamilton Pro (seats, invoicing)" },
  { value: "billing", label: "Billing or my subscription" },
  { value: "advisory", label: "Fee Insight Advisory (custom work)" },
  { value: "partnership", label: "Data licensing / API" },
  { value: "general", label: "Something else" },
];

export interface ContactHeading {
  title: string;
  intro: string;
  /** "What happens next", in order. */
  steps: string[];
}

export interface ContactHeadings {
  /** Shown while "Hamilton demo" is the chosen option. */
  demo: ContactHeading;
  /** Shown for every other option. */
  general: ContactHeading;
}

interface ContactFormProps {
  searchParamsPromise: Promise<Record<string, string | string[] | undefined>>;
  /** The page's h1 and intro; they follow the select, as the button and reply do. */
  headings?: ContactHeadings;
  /** Drawn under "What happens next", beside the form. */
  aside?: ReactNode;
}

export function ContactForm({ searchParamsPromise, headings, aside }: ContactFormProps) {
  const searchParams = use(searchParamsPromise);
  // A source with no option of its own (e.g. sample_report, a correction) opens on "Something
  // else", not on the first option, so it is never recorded as a demo request.
  const defaultSource =
    typeof searchParams.source === "string" && INQUIRY_TYPES.some((t) => t.value === searchParams.source)
      ? searchParams.source
      : "general";
  const defaultCompany = typeof searchParams.company === "string" ? searchParams.company.slice(0, 160) : "";

  const [inquiry, setInquiry] = useState(defaultSource);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [confirmationSent, setConfirmationSent] = useState(false);
  const successRef = useRef<HTMLDivElement>(null);

  // The form unmounts on success; focus the confirmation so keyboard and screen reader users land on it.
  useEffect(() => {
    if (status === "success") successRef.current?.focus();
  }, [status]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");

    const form = new FormData(e.currentTarget);
    const data = {
      name: form.get("name") as string,
      email: form.get("email") as string,
      company: form.get("company") as string,
      role: form.get("role") as string,
      use_case: form.get("message") as string,
      source: `contact_${form.get("inquiry_type") || "general"}`,
      firstTouch: readFirstTouch(),
      [LEAD_HONEYPOT_FIELD]: honeypotValue(e.currentTarget),
    };

    try {
      const resp = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (resp.ok) {
        const body = (await resp.json().catch(() => null)) as {
          notifications?: { confirmation?: string };
        } | null;
        setConfirmationSent(body?.notifications?.confirmation === "sent");
        setStatus("success");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  // The heading, button and reply follow the option chosen, so a demo request reads as one.
  const isDemo = inquiry === "demo";
  const heading = headings ? (isDemo ? headings.demo : headings.general) : null;
  const header = heading ? (
    <>
      <h1 className="text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[44px]">{heading.title}</h1>
      <p className="mt-3 max-w-[34rem] text-[15px] text-ink-soft">{heading.intro}</p>
    </>
  ) : null;

  const success = (
    <div ref={successRef} tabIndex={-1} className="rounded-2xl border border-border bg-surface-0 px-6 py-8 shadow-fi-1 outline-none">
      <p className="text-[18px] font-semibold tracking-[-0.02em] text-ink">{isDemo ? "Request received" : "Message received"}</p>
      <p className="mt-2 text-[14px] text-ink-muted">
        {isDemo ? "We'll reply within one business day to set a time." : "We'll get back to you within one business day."}
        {confirmationSent ? " A confirmation is on its way to your inbox." : ""}
      </p>
    </div>
  );

  const nextSteps = heading ? (
    <section aria-labelledby="next-heading" aria-live="polite">
      <h2 id="next-heading" className="text-[15px] font-semibold text-ink">
        What happens next
      </h2>
      <ol className="mt-3 space-y-3">
        {heading.steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-[14px] text-ink-soft">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-on-ink" aria-hidden="true">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  ) : null;

  const layout = (body: ReactNode) => (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:gap-14">
      <div className="min-w-0">
        {header}
        <div className={header ? "mt-8" : ""}>{body}</div>
      </div>
      {(nextSteps || aside) && (
        <div className="space-y-8 lg:pt-3">
          {nextSteps}
          {aside}
        </div>
      )}
    </div>
  );

  if (status === "success") return layout(success);

  const inputClasses =
    "w-full rounded-lg border border-control-border bg-white px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-1 focus:outline-ink";
  const labelClasses = "mb-1.5 block text-[13px] font-medium text-ink";

  return layout(
    <form onSubmit={handleSubmit} className="relative space-y-4 rounded-2xl border border-border bg-surface-0 p-5 shadow-fi-2 sm:p-7">
      <HoneypotField />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="name" className={labelClasses}>
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder="Jane Smith"
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="email" className={labelClasses}>
            Work email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="jane@institution.com"
            className={inputClasses}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="company" className={labelClasses}>
            Company or institution
          </label>
          <input
            id="company"
            name="company"
            type="text"
            defaultValue={defaultCompany}
            placeholder="First National Bank"
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="role" className={labelClasses}>
            Role
          </label>
          <input
            id="role"
            name="role"
            type="text"
            placeholder="VP of Product"
            className={inputClasses}
          />
        </div>
      </div>

      <div>
        <label htmlFor="inquiry_type" className={labelClasses}>
          Inquiry type
        </label>
        <select
          id="inquiry_type"
          name="inquiry_type"
          value={inquiry}
          onChange={(e) => setInquiry(e.target.value)}
          className={inputClasses}
        >
          {INQUIRY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="message" className={labelClasses}>
          Message
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          placeholder="Tell us what you're looking for..."
          className={`${inputClasses} resize-none`}
        />
      </div>

      {status === "error" && (
        <p role="alert" className="text-[13px] text-brick">
          Something went wrong. Please try again or email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      )}

      <button
        type="submit"
        disabled={status === "loading"}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90 disabled:opacity-60"
      >
        {status === "loading" ? "Sending..." : isDemo ? DEMO_REQUEST_NAV.standaloneLabel : "Send message"}
      </button>
    </form>,
  );
}
