"use client";

import { useState, use } from "react";
import { HoneypotField, honeypotValue } from "@/components/public/honeypot-field";
import { LEAD_HONEYPOT_FIELD } from "@/lib/lead-capture";
import { readFirstTouch } from "@/lib/marketing-touch";
import { REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import { PAGE_HEADER } from "@/components/public/page-header";

const INQUIRY_TYPES = [
  // Pro first, the one-off report second (site v3 brief 03 section 4: Pro is the goal).
  // Short enough to show whole in the select at 375px (growth OS review M2).
  { value: "demo", label: "Hamilton demo" },
  { value: "report", label: `${REPORT_OFFER.name} (${REPORT_PRICE_INLINE})` },
  { value: "enterprise", label: "Hamilton (seats, invoicing)" },
  { value: "billing", label: "Billing or my subscription" },
  { value: "partnership", label: "Data licensing / API" },
  { value: "general", label: "Something else" },
];

export interface ContactHeadings {
  /** Shown while "Hamilton demo" is the chosen option. */
  demo: { title: string; intro: string };
  /** Shown for every other option. */
  general: { title: string; intro: string };
}

interface ContactFormProps {
  searchParamsPromise: Promise<Record<string, string | string[] | undefined>>;
  /** The page's h1 and intro; they follow the select, as the button and reply do. */
  headings?: ContactHeadings;
}

export function ContactForm({ searchParamsPromise, headings }: ContactFormProps) {
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
    <header className={PAGE_HEADER}>
      <h1
        className="font-extrabold text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-ink"
        style={{ fontFamily: "var(--fi-font-sans)" }}
      >
        {heading.title}
      </h1>
      <p className="mx-auto mt-2 max-w-[34rem] text-[14px] text-ink-muted sm:mx-0 sm:max-w-none">{heading.intro}</p>
    </header>
  ) : null;

  if (status === "success") {
    return (
      <>
      {header}
      <div className={`${header ? "mt-8 " : ""}rounded-xl border border-emerald-200 bg-emerald-50/50 px-6 py-8 text-center`}>
        <p className="text-[16px] font-medium text-emerald-800">
          {isDemo ? "Request received" : "Message received"}
        </p>
        <p className="mt-2 text-[13px] text-emerald-700">
          {isDemo
            ? "We'll reply within one business day to set a time."
            : "We'll get back to you within one business day."}
          {confirmationSent ? " A confirmation is on its way to your inbox." : ""}
        </p>
      </div>
      </>
    );
  }

  const inputClasses =
    "w-full rounded-xl border border-border bg-white px-4 py-2.5 text-[13px] text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brick/30 focus:border-transparent";

  return (
    <>
    {header}
    <form onSubmit={handleSubmit} className={`relative space-y-4${header ? " mt-8" : ""}`}>
      <HoneypotField />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="name" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-ink-muted mb-1.5">
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
          <label htmlFor="email" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-ink-muted mb-1.5">
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
          <label htmlFor="company" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-ink-muted mb-1.5">
            Company / Institution
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
          <label htmlFor="role" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-ink-muted mb-1.5">
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
        <label htmlFor="inquiry_type" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-ink-muted mb-1.5">
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
        <label htmlFor="message" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-ink-muted mb-1.5">
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
        <p className="text-[12px] text-red-600">
          Something went wrong. Please try again or email us directly.
        </p>
      )}

      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-xl bg-brick py-3 text-[14px] font-semibold text-white hover:bg-brick-ink transition-colors disabled:opacity-50"
      >
        {status === "loading" ? "Sending..." : isDemo ? DEMO_REQUEST_NAV.standaloneLabel : "Send message"}
      </button>
    </form>
    </>
  );
}
