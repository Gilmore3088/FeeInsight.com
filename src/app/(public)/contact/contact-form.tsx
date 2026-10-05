"use client";

import { useState, use } from "react";
import { HoneypotField, honeypotValue } from "@/components/public/honeypot-field";
import { LEAD_HONEYPOT_FIELD } from "@/lib/lead-capture";

const INQUIRY_TYPES = [
  { value: "report", label: "Competitive Fee Position Report (free)" },
  { value: "enterprise", label: "Fee Insight Pro (seats, invoicing)" },
  { value: "advisory", label: "Fee Insight Advisory (custom work)" },
  { value: "partnership", label: "Data licensing / API" },
  { value: "general", label: "Something else" },
];

interface ContactFormProps {
  searchParamsPromise: Promise<Record<string, string | string[] | undefined>>;
}

export function ContactForm({ searchParamsPromise }: ContactFormProps) {
  const searchParams = use(searchParamsPromise);
  const defaultSource = typeof searchParams.source === "string" ? searchParams.source : "";

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

  if (status === "success") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-6 py-8 text-center">
        <p className="text-[16px] font-medium text-emerald-800">
          Message received
        </p>
        <p className="mt-2 text-[13px] text-emerald-700">
          We&apos;ll get back to you within one business day.
          {confirmationSent ? " A confirmation is on its way to your inbox." : ""}
        </p>
      </div>
    );
  }

  const inputClasses =
    "w-full rounded-xl border border-[#E8DFD1] bg-white px-4 py-2.5 text-[13px] text-[#1A1815] placeholder:text-[#6B6255] focus:outline-none focus:ring-2 focus:ring-[#C44B2E]/30 focus:border-transparent";

  return (
    <form onSubmit={handleSubmit} className="relative space-y-4">
      <HoneypotField />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="name" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255] mb-1.5">
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
          <label htmlFor="email" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255] mb-1.5">
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
          <label htmlFor="company" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255] mb-1.5">
            Company / Institution
          </label>
          <input
            id="company"
            name="company"
            type="text"
            placeholder="First National Bank"
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="role" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255] mb-1.5">
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
        <label htmlFor="inquiry_type" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255] mb-1.5">
          Inquiry type
        </label>
        <select
          id="inquiry_type"
          name="inquiry_type"
          defaultValue={defaultSource || "general"}
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
        <label htmlFor="message" className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255] mb-1.5">
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
        className="w-full rounded-xl bg-[#C44B2E] py-3 text-[14px] font-semibold text-white hover:bg-[#A83D25] transition-colors disabled:opacity-50"
      >
        {status === "loading" ? "Sending..." : "Send message"}
      </button>
    </form>
  );
}
