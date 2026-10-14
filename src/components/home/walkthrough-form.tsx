"use client";

import { useId, useState, type FormEvent } from "react";
import { trackEvent } from "@/lib/analytics";
import { readFirstTouch } from "@/lib/marketing-touch";
import { LEAD_HONEYPOT_FIELD } from "@/lib/lead-capture";
import { HoneypotField, honeypotValue } from "@/components/public/honeypot-field";
import { BUTTON_GREEN_ON_DARK, INPUT_ON_DARK, LABEL_ON_DARK } from "./look";

const LEADS_ENDPOINT = "/api/leads";
/** A request row (contact_*) with a due time in /admin/leads, never a newsletter signup. */
const SOURCE = "contact_walkthrough";
const GENERIC_ERROR = "We could not save your request. Please try again.";

type Status = "idle" | "busy" | "saved" | "error";

/** Name, institution, work email. The same /api/leads request flow as the rest of the site. */
export function WalkthroughForm() {
  const base = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("busy");
    setError("");
    trackEvent("lead_capture_submit", { placement: "homepage", offer: "walkthrough" });
    try {
      const response = await fetch(LEADS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: SOURCE,
          name: String(data.get("name") ?? "").trim(),
          company: String(data.get("institution") ?? "").trim() || undefined,
          email: String(data.get("email") ?? "").trim(),
          use_case: "Requested a free Hamilton walkthrough; placement=homepage; no newsletter opt-in",
          firstTouch: readFirstTouch() ?? undefined,
          [LEAD_HONEYPOT_FIELD]: honeypotValue(form),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || GENERIC_ERROR);
      }
      trackEvent("lead_capture_success", { placement: "homepage", offer: "walkthrough" });
      trackEvent("contact_sales", { placement: "homepage", offer: "walkthrough" });
      setStatus("saved");
    } catch (caught) {
      trackEvent("lead_capture_error", { placement: "homepage", offer: "walkthrough" });
      setError(caught instanceof Error ? caught.message : GENERIC_ERROR);
      setStatus("error");
    }
  }

  if (status === "saved") {
    return (
      <div role="status" className="rounded-[8px] border border-white/20 bg-index-navy-soft p-5">
        <p className="text-[17px] font-medium text-white">Request received.</p>
        <p className="mt-1 text-[15px] text-index-muted-dark">We will email you to set a time.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} aria-label="Request a free walkthrough" className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${base}-name`} className={LABEL_ON_DARK}>
          Name
        </label>
        <input id={`${base}-name`} name="name" autoComplete="name" required className={`mt-1.5 ${INPUT_ON_DARK}`} />
      </div>
      <div>
        <label htmlFor={`${base}-institution`} className={LABEL_ON_DARK}>
          Institution
        </label>
        <input
          id={`${base}-institution`}
          name="institution"
          autoComplete="organization"
          required
          className={`mt-1.5 ${INPUT_ON_DARK}`}
        />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${base}-email`} className={LABEL_ON_DARK}>
          Work email
        </label>
        <input
          id={`${base}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@yourbank.com"
          className={`mt-1.5 ${INPUT_ON_DARK}`}
        />
      </div>
      <HoneypotField />
      <div className="sm:col-span-2">
        <button type="submit" disabled={status === "busy"} className={`${BUTTON_GREEN_ON_DARK} w-full disabled:opacity-60 sm:w-auto`}>
          {status === "busy" ? "Saving…" : "Request a free walkthrough"}
        </button>
        {status === "error" && error ? (
          <p role="alert" className="mt-3 text-[14px] text-white">
            {error}
          </p>
        ) : (
          <p className="mt-3 text-[13px] text-index-muted-dark">
            We use your email to reply to this request and for nothing else.
          </p>
        )}
      </div>
    </form>
  );
}
