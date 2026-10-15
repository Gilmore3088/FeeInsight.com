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
      <p className="text-[13px] leading-snug text-warm-ink-50" role="status">
        {emailSent
          ? "Almost done: check your inbox and click the confirm link to start getting the monthly update."
          : `Saved, but the confirm email didn't go out. Write to ${CONTACT_EMAIL} and we'll add you.`}
      </p>
    );
  }

  // Sits in the footer's navy band (James's review, 2026-10-15): one framed unit with a short line,
  // the state picker James kept, then email and button. The button stays outlined so the page's own
  // call to action is the only filled one.
  const field =
    "rounded-lg border border-warm-ink-500 bg-warm-ink-900 px-3 py-2 text-[13px] text-warm-ink-50 placeholder:text-warm-ink-500";
  return (
    <form onSubmit={handleSubmit} className="relative">
      <HoneypotField />
      <label htmlFor="footer-newsletter-email" className="block text-[13px] font-semibold text-warm-ink-50">
        Monthly fee index update
      </label>
      <p className="mt-0.5 text-[12px] text-warm-ink-300">One email a month. Pick a state to get its numbers too.</p>
      <label htmlFor="footer-newsletter-state" className="sr-only">
        Your state (optional)
      </label>
      <StateSelect id="footer-newsletter-state" value={state} onChange={setState} className={`mt-3 w-full ${field}`} />
      <div className="mt-2 flex gap-2">
        <input
          id="footer-newsletter-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          required
          className={`min-w-0 flex-1 ${field}`}
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="shrink-0 rounded-lg border border-warm-ink-50 px-4 py-2 text-[12px] font-semibold text-warm-ink-50 transition-colors hover:bg-warm-ink-50 hover:text-warm-ink-900 disabled:opacity-50"
        >
          {status === "loading" ? "..." : "Subscribe"}
        </button>
      </div>
      {status === "error" && (
        <p className="mt-2 text-[12px] text-red-300" role="alert">
          Something went wrong. Try again.
        </p>
      )}
    </form>
  );
}
