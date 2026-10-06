"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { trackEvent, type AnalyticsProps } from "@/lib/analytics";
import {
  LEAD_CAPTURE_SOURCES,
  LEAD_HONEYPOT_FIELD,
  deliversSampleReport,
  type LeadCapturePlacement,
} from "@/lib/lead-capture";

export interface LeadCaptureProps {
  placement: LeadCapturePlacement;
  /** Card variant only. */
  eyebrow?: string;
  headline: string;
  /** Card variant only. */
  body?: string;
  buttonLabel: string;
  /**
   * Shown after a successful submit when the confirmation email went out; defaults to a
   * confirm-your-inbox line. Without a sent email the form never tells people to check it.
   */
  successMessage?: string;
  institutionId?: number | null;
  institutionName?: string | null;
  stateCode?: string | null;
  secondaryLink?: { href: string; label: string };
  className?: string;
  /**
   * "card" (default) is the standalone band with eyebrow, headline and body.
   * "inline" is just the email field and button, for placing inside an existing
   * card that already carries the offer copy; headline is used only as its label.
   */
  variant?: "card" | "inline";
}

type Status = "idle" | "loading" | "success" | "error";

function captureEventProps(placement: LeadCapturePlacement, stateCode: string | null): AnalyticsProps {
  return stateCode ? { placement, state: stateCode } : { placement };
}

const DEFAULT_SUCCESS = "Check your inbox and confirm your email to start getting updates.";
const SIGNED_UP_NO_EMAIL = "You're signed up.";
const SAMPLE_REPORT_PDF_HREF = "/reports/sample-competitive-fee-position.pdf";

interface LeadsResponse {
  notifications?: { confirmation?: string };
}

/**
 * Contextual, above-the-fold email capture. Posts to /api/leads with a
 * placement-specific source and tracks view / submit / success / error per
 * placement so conversion is measurable by placement.
 */
export function LeadCapture({
  placement,
  eyebrow = "",
  headline,
  body = "",
  buttonLabel,
  successMessage = DEFAULT_SUCCESS,
  institutionId = null,
  institutionName = null,
  stateCode = null,
  secondaryLink,
  className = "",
  variant = "card",
}: LeadCaptureProps) {
  const source = LEAD_CAPTURE_SOURCES[placement];
  const offersSample = deliversSampleReport(placement);
  const inputId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const viewedRef = useRef(false);
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const eventProps = captureEventProps(placement, stateCode);

  useEffect(() => {
    const node = rootRef.current;
    const fireView = () => {
      if (viewedRef.current) return;
      viewedRef.current = true;
      trackEvent("lead_capture_view", captureEventProps(placement, stateCode));
    };
    if (!node || typeof IntersectionObserver === "undefined") {
      fireView();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          fireView();
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [placement, stateCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    trackEvent("lead_capture_submit", eventProps);
    setStatus("loading");
    setError("");
    try {
      const resp = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          source,
          institutionId: institutionId ?? undefined,
          institutionName: institutionName ?? undefined,
          state: stateCode ?? undefined,
          [LEAD_HONEYPOT_FIELD]: honeypot || undefined,
        }),
      });
      if (resp.ok) {
        const payload = (await resp.json().catch(() => ({}))) as LeadsResponse;
        setEmailSent(payload.notifications?.confirmation === "sent");
        trackEvent("lead_capture_success", eventProps);
        setStatus("success");
        setEmail("");
        return;
      }
      const payload = (await resp.json().catch(() => ({}))) as { error?: string };
      trackEvent("lead_capture_error", { ...eventProps, status: resp.status });
      setError(payload.error ?? "Something went wrong — try again.");
      setStatus("error");
    } catch {
      trackEvent("lead_capture_error", { ...eventProps, status: 0 });
      setError("Something went wrong — try again.");
      setStatus("error");
    }
  }

  const honeypotField = (
    // Honeypot: hidden from people and assistive tech; bots fill it.
    <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label>
        Website
        <input
          type="text"
          name={LEAD_HONEYPOT_FIELD}
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </label>
    </div>
  );

  const fields = (
    <>
      <label htmlFor={inputId} className="sr-only">
        Email
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={offersSample ? "you@yourbank.com" : "you@company.com"}
          autoComplete="email"
          required
          className="min-w-0 flex-1 rounded-md border border-[#D4C9BA] bg-white px-3 py-2 text-[14px] text-[#1A1815] placeholder:text-[#8A8072] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#C44B2E]/30"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="shrink-0 whitespace-nowrap rounded-md bg-[#C44B2E] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#A93D25] disabled:opacity-50"
        >
          {status === "loading" ? "Sending…" : buttonLabel}
        </button>
      </div>
      {honeypotField}
    </>
  );

  const successBlock = (
    <div role="status" className="text-[13px] leading-relaxed text-[#1A1815]">
      {offersSample ? (
        <>
          <a
            href={SAMPLE_REPORT_PDF_HREF}
            download
            className="inline-flex items-center rounded-md bg-[#C44B2E] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#A93D25]"
          >
            Download the sample report (PDF)
          </a>
          {emailSent && <p className="mt-2 text-[#5A5347]">We also emailed you a copy.</p>}
        </>
      ) : (
        <p className="text-emerald-700">{emailSent ? successMessage : SIGNED_UP_NO_EMAIL}</p>
      )}
    </div>
  );

  const errorLine =
    status === "error" && error ? (
      <p className="mt-2 text-[12px] text-red-600" role="alert">
        {error}
      </p>
    ) : null;

  if (variant === "inline") {
    return (
      <div ref={rootRef as React.RefObject<HTMLDivElement>} data-placement={placement} className={className}>
        {status === "success" ? (
          successBlock
        ) : (
          <form onSubmit={handleSubmit} aria-label={headline} noValidate>
            {fields}
            {errorLine}
          </form>
        )}
      </div>
    );
  }

  return (
    <section
      ref={rootRef}
      aria-label={headline}
      data-placement={placement}
      className={`rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] px-4 py-4 sm:px-5 ${className}`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="min-w-0 md:max-w-[52%]">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#A93D25]">{eyebrow}</p>
          <p
            className="mt-1 text-[18px] leading-snug text-[#1A1815]"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            {headline}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6B6255]">{body}</p>
        </div>

        {status === "success" ? (
          <div className="md:max-w-[44%]">{successBlock}</div>
        ) : (
          <form onSubmit={handleSubmit} className="w-full md:max-w-[44%]" noValidate>
            {fields}
            {errorLine ?? (
              <p className="mt-2 text-[11px] text-[#6B6255]">
                One confirmation email, then only what you asked for. Unsubscribe anytime.
                {secondaryLink && (
                  <>
                    {" "}
                    <Link
                      href={secondaryLink.href}
                      className="text-[#A93D25] underline"
                      onClick={() => trackEvent("see_sample_report", eventProps)}
                    >
                      {secondaryLink.label}
                    </Link>
                  </>
                )}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
