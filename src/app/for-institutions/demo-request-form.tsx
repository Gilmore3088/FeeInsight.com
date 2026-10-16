"use client";

import { useState, type FormEvent } from "react";
import { HoneypotField, honeypotValue } from "@/components/public/honeypot-field";
import { LEAD_HONEYPOT_FIELD } from "@/lib/lead-capture";
import { readFirstTouch } from "@/lib/marketing-touch";
import { trackEvent } from "@/lib/analytics";
import { CONTACT_EMAIL } from "@/lib/constants";

/** Stored as the /contact form's demo request, so it lands in the same lead queue and reply. */
export const DEMO_LEAD_SOURCE = "contact_demo";
const USE_CASE = "Hamilton demo, from /for-institutions";

const INPUT =
  "w-full rounded-lg border border-border bg-white px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ink";
const LABEL = "mb-1 block text-[12px] font-semibold text-ink";

/**
 * The short Pro demo request (B2B landing pattern: three fields beside the pitch). It posts the
 * same lead the /contact demo option does; anything longer is asked on the reply.
 */
export function DemoRequestForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("sending");
    try {
      const resp = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          company: form.get("company"),
          use_case: USE_CASE,
          source: DEMO_LEAD_SOURCE,
          firstTouch: readFirstTouch(),
          [LEAD_HONEYPOT_FIELD]: honeypotValue(event.currentTarget),
        }),
      });
      if (!resp.ok) throw new Error(String(resp.status));
      trackEvent("contact_sales", { placement: "for_institutions_demo_form" });
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div role="status" className="rounded-2xl bg-surface-0 p-6 text-ink shadow-fi-2">
        <p className="text-[17px] font-semibold">Request received</p>
        <p className="mt-1 text-[14px] text-ink-soft">We&apos;ll reply within one business day to set a time.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} aria-label="Ask for a Hamilton demo" className="relative space-y-3 rounded-2xl bg-surface-0 p-5 text-ink shadow-fi-2 sm:p-6">
      <HoneypotField />
      <div>
        <label htmlFor="demo-name" className={LABEL}>
          Name
        </label>
        <input id="demo-name" name="name" type="text" required autoComplete="name" className={INPUT} />
      </div>
      <div>
        <label htmlFor="demo-email" className={LABEL}>
          Work email
        </label>
        <input id="demo-email" name="email" type="email" required autoComplete="email" className={INPUT} />
      </div>
      <div>
        <label htmlFor="demo-company" className={LABEL}>
          Bank or credit union
        </label>
        <input id="demo-company" name="company" type="text" required autoComplete="organization" className={INPUT} />
      </div>
      {status === "error" ? (
        <p role="alert" className="text-[13px] text-brick">
          That didn&apos;t send. Try again, or email {CONTACT_EMAIL}.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={status === "sending"}
        className="fi-btn fi-btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : "Request a demo"}
      </button>
    </form>
  );
}
