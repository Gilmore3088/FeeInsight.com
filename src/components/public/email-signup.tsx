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

  return (
    <form onSubmit={handleSubmit} className="relative flex flex-col gap-2">
      <HoneypotField />
      <label htmlFor="footer-newsletter-email" className="text-[12px] font-semibold text-ink-soft">
        Monthly fee index update
      </label>
      <p className="text-[12px] leading-relaxed text-ink-muted">
        New national benchmarks and one table worth bringing to a pricing meeting. No more than once a month. Pick a state to get its numbers too.
      </p>
      <label htmlFor="footer-newsletter-state" className="sr-only">
        Your state (optional)
      </label>
      <StateSelect
        id="footer-newsletter-state"
        value={state}
        onChange={setState}
        className="w-full max-w-[200px] rounded-lg border border-border bg-paper px-2 py-1.5 text-[12px] text-ink focus:border-transparent focus:outline-none focus:ring-1 focus:ring-brick/30"
      />
      <div className="flex gap-2">
        <input
          id="footer-newsletter-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          required
          className="w-full max-w-[200px] rounded-lg border border-border bg-paper px-3 py-1.5 text-[12px] text-ink placeholder:text-ink-muted focus:border-transparent focus:outline-none focus:ring-1 focus:ring-brick/30"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="shrink-0 rounded-lg bg-brick px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-brick-ink disabled:opacity-50"
        >
          {status === "loading" ? "..." : "Subscribe"}
        </button>
        {status === "error" && (
          <span className="self-center text-[11px] text-red-600" role="alert">
            Something went wrong — try again.
          </span>
        )}
      </div>
    </form>
  );
}
