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
      <p className={`text-[12px] ${emailSent ? "text-emerald-700" : "text-[#5A5347]"}`} role="status">
        {emailSent
          ? "Almost done: check your inbox and click the confirm link to start getting the monthly update."
          : `Saved, but the confirm email didn't go out. Write to ${CONTACT_EMAIL} and we'll add you.`}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="relative flex flex-col gap-2">
      <HoneypotField />
      <label htmlFor="footer-newsletter-email" className="text-[12px] font-semibold text-[#5A5347]">
        Monthly fee index update
      </label>
      <p className="text-[12px] leading-relaxed text-[#6B6255]">
        New benchmarks, notable fee changes, one chart. About once a month. Pick a state to get its numbers too.
      </p>
      <label htmlFor="footer-newsletter-state" className="sr-only">
        Your state (optional)
      </label>
      <StateSelect
        id="footer-newsletter-state"
        value={state}
        onChange={setState}
        className="w-full max-w-[200px] rounded-lg border border-[#D4C9BA] bg-[#FAF7F2] px-2 py-1.5 text-[12px] text-[#1A1815] focus:border-transparent focus:outline-none focus:ring-1 focus:ring-[#C44B2E]/30"
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
          className="w-full max-w-[200px] rounded-lg border border-[#D4C9BA] bg-[#FAF7F2] px-3 py-1.5 text-[12px] text-[#1A1815] placeholder:text-[#6B6255] focus:border-transparent focus:outline-none focus:ring-1 focus:ring-[#C44B2E]/30"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="shrink-0 rounded-lg bg-[#C44B2E] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#A93D25] disabled:opacity-50"
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
