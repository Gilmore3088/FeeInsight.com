"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { LEAD_HONEYPOT_FIELD } from "@/lib/lead-capture";
import { CONTACT_EMAIL } from "@/lib/constants";
import { HoneypotField, honeypotValue } from "./honeypot-field";
import { StateSelect } from "./state-select";

const NEWSLETTER_SOURCE = "newsletter";
const NEWSLETTER_LEAD_NAME = "Newsletter signup";

export function EmailSignup() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [emailSent, setEmailSent] = useState(true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    const honeypot = honeypotValue(e.currentTarget as HTMLFormElement);
    setStatus("loading");
    try {
      const resp = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: NEWSLETTER_LEAD_NAME,
          email: email.trim(),
          source: NEWSLETTER_SOURCE,
          ...(state ? { state } : {}),
          [LEAD_HONEYPOT_FIELD]: honeypot,
        }),
      });
      if (resp.ok) {
        const payload = (await resp.json().catch(() => ({}))) as { notifications?: { confirmation?: string } };
        // Without the confirm email the address can never be confirmed, so say so.
        setEmailSent(payload.notifications?.confirmation === "sent");
        trackEvent("newsletter_signup", { placement: "footer" });
        setStatus("success");
        setEmail("");
        setState("");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <p className={`text-[12px] ${emailSent ? "text-emerald-700" : "text-ink-soft"}`} role="status">
        {emailSent
          ? "Almost done: check your inbox and click the confirm link to start getting the monthly update."
          : `Saved, but the confirm email didn't go out. Write to ${CONTACT_EMAIL} and we'll add you.`}
      </p>
    );
  }

  // Compact on purpose: the footer is one short band (James's review, 2026-10-15), so the form is
  // one row (state, email, button) and its button stays outlined navy rather than a second brick
  // action. James kept the state picker: a reader who picks a state gets its numbers too.
  return (
    <form onSubmit={handleSubmit} className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
      <HoneypotField />
      <label htmlFor="footer-newsletter-email" className="w-full text-[12px] font-semibold text-ink-soft sm:w-auto">
        Monthly fee index update
      </label>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
        <label htmlFor="footer-newsletter-state" className="sr-only">
          Your state (optional)
        </label>
        <StateSelect
          id="footer-newsletter-state"
          value={state}
          onChange={setState}
          className="w-full rounded-lg border border-border bg-paper px-2 sm:w-[170px] py-1.5 text-[12px] text-ink focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        />
        <input
          id="footer-newsletter-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          required
          className="min-w-0 flex-1 rounded-lg border sm:w-[200px] sm:flex-none border-border bg-paper px-3 py-1.5 text-[12px] text-ink placeholder:text-ink-muted focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="shrink-0 rounded-lg border border-ink px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-1 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:bg-ink hover:text-on-ink disabled:opacity-50"
        >
          {status === "loading" ? "..." : "Subscribe"}
        </button>
      </div>
      {status === "error" && (
        <span className="w-full text-[11px] text-red-600 lg:text-right" role="alert">
          Something went wrong. Try again.
        </span>
      )}
    </form>
  );
}
