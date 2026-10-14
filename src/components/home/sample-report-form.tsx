"use client";

import { useId, useState, type FormEvent } from "react";
import { trackEvent } from "@/lib/analytics";
import { readFirstTouch } from "@/lib/marketing-touch";
import { LEAD_HONEYPOT_FIELD } from "@/lib/lead-capture";
import { HoneypotField, honeypotValue } from "@/components/public/honeypot-field";
import { BUTTON_GREEN, INPUT, LABEL } from "./look";

/** The 10-page sample, the same bytes as public/reports/sample-competitive-fee-position.pdf. */
export const SAMPLE_REPORT_PDF_HREF = "/reports/illustrative-competitive-fee-position-2026-10-03.pdf";

const LEADS_ENDPOINT = "/api/leads";
/** A request row (contact_*), never a newsletter signup. */
const SOURCE = "contact_sample";
const PLACEHOLDER_NAME = "Sample report requester";
const GENERIC_ERROR = "We could not save your request. Please try again.";

type Status = "idle" | "busy" | "saved" | "error";

/**
 * Work email, one button, then the PDF link once the server has stored the request.
 * The link never shows before that, so a failed save keeps the form and its error.
 */
export function SampleReportForm() {
  const emailId = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("busy");
    setError("");
    trackEvent("lead_capture_submit", { placement: "homepage", offer: "sample" });
    try {
      const response = await fetch(LEADS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: SOURCE,
          name: PLACEHOLDER_NAME,
          email: String(data.get("email") ?? "").trim(),
          use_case: "Requested the sample report PDF; placement=homepage; no newsletter opt-in",
          firstTouch: readFirstTouch() ?? undefined,
          [LEAD_HONEYPOT_FIELD]: honeypotValue(form),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || GENERIC_ERROR);
      }
      trackEvent("lead_capture_success", { placement: "homepage", offer: "sample" });
      setStatus("saved");
    } catch (caught) {
      trackEvent("lead_capture_error", { placement: "homepage", offer: "sample" });
      setError(caught instanceof Error ? caught.message : GENERIC_ERROR);
      setStatus("error");
    }
  }

  if (status === "saved") {
    return (
      <div role="status" className="rounded-[8px] border border-index-line bg-index-cloud p-4">
        <p className="text-[15px] text-index-navy">Your request is saved.</p>
        <a
          href={SAMPLE_REPORT_PDF_HREF}
          download
          className={`${BUTTON_GREEN} mt-3`}
          onClick={() => trackEvent("see_sample_report", { placement: "homepage", asset: "sample_pdf" })}
        >
          Download the sample PDF
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-md" aria-label="Download the sample report">
      <label htmlFor={emailId} className={LABEL}>
        Work email
      </label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@yourbank.com"
          className={INPUT}
        />
        <button type="submit" disabled={status === "busy"} className={`${BUTTON_GREEN} shrink-0 disabled:opacity-60`}>
          {status === "busy" ? "Saving…" : "Download sample report"}
        </button>
      </div>
      <HoneypotField />
      {status === "error" && error ? (
        <p role="alert" className="mt-2 text-[14px] text-index-navy">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-index-muted">We use your email to reply to this request and for nothing else.</p>
      )}
    </form>
  );
}
