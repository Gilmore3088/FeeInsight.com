"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { trackEvent, type AnalyticsProps } from "@/lib/analytics";
import {
  LEAD_CAPTURE_SOURCES,
  LEAD_HONEYPOT_FIELD,
  isWorkEmail,
  requiresWorkEmail,
  type LeadCapturePlacement,
} from "@/lib/lead-capture";

export interface LeadCaptureProps {
  placement: LeadCapturePlacement;
  eyebrow: string;
  headline: string;
  body: string;
  buttonLabel: string;
  /** Shown after a successful submit; defaults to a confirm-your-inbox line. */
  successMessage?: string;
  institutionId?: number | null;
  institutionName?: string | null;
  stateCode?: string | null;
  secondaryLink?: { href: string; label: string };
  className?: string;
}

type Status = "idle" | "loading" | "success" | "error";

function captureEventProps(placement: LeadCapturePlacement, stateCode: string | null): AnalyticsProps {
  return stateCode ? { placement, state: stateCode } : { placement };
}

const DEFAULT_SUCCESS = "Check your inbox — confirm your email and your first update is on its way.";

/**
 * Contextual, above-the-fold email capture. Posts to /api/leads with a
 * placement-specific source and tracks view / submit / success / error per
 * placement so conversion is measurable by placement.
 */
export function LeadCapture({
  placement,
  eyebrow,
  headline,
  body,
  buttonLabel,
  successMessage = DEFAULT_SUCCESS,
  institutionId = null,
  institutionName = null,
  stateCode = null,
  secondaryLink,
  className = "",
}: LeadCaptureProps) {
  const source = LEAD_CAPTURE_SOURCES[placement];
  const workEmailOnly = requiresWorkEmail(source);
  const inputId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const viewedRef = useRef(false);
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

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
    if (workEmailOnly && !isWorkEmail(trimmed)) {
      setError("Use your work email — the sample is for bank and credit union teams.");
      setStatus("error");
      return;
    }

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
          <p className="text-[13px] leading-relaxed text-emerald-700 md:max-w-[44%]" role="status">
            {successMessage}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="w-full md:max-w-[44%]" noValidate>
            <label htmlFor={inputId} className="sr-only">
              {workEmailOnly ? "Work email" : "Email"}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id={inputId}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={workEmailOnly ? "you@yourbank.com" : "you@company.com"}
                autoComplete="email"
                required
                className="min-w-0 flex-1 rounded-md border border-[#D4C9BA] bg-white px-3 py-2 text-[14px] text-[#1A1815] placeholder:text-[#8A8072] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#C44B2E]/30"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="shrink-0 rounded-md bg-[#C44B2E] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#A93D25] disabled:opacity-50"
              >
                {status === "loading" ? "Sending…" : buttonLabel}
              </button>
            </div>
            {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
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
            {status === "error" && error ? (
              <p className="mt-2 text-[12px] text-red-600" role="alert">
                {error}
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-[#6B6255]">
                One confirmation email, then only what you asked for. Unsubscribe anytime.
                {secondaryLink && (
                  <>
                    {" "}
                    <Link href={secondaryLink.href} className="text-[#A93D25] underline">
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
