"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { REPORT_OFFER } from "@/lib/constants";
import { LEAD_HONEYPOT_FIELD } from "@/lib/lead-capture";

const LEADS_ENDPOINT = "/api/leads";
const REPORT_USE_CASE = "competitive-fee-position-report";
const REPORT_SOURCE = "report";
const DEFAULT_SRC = "for-institutions";
const SRC_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

const SUCCESS_HEADLINE = "Request received.";
const SUCCESS_PROMISE =
  "We confirm your peer set within one business day; the report follows within 48 hours of confirmation.";
const CONFIRMATION_SENT = "A confirmation email is on its way to you now.";
const CONFIRMATION_MISSING =
  "We couldn't send a confirmation email — we still have your request; expect an email from";
const GENERIC_ERROR = "We couldn't send that request. Please try again or email us directly.";

const INPUT_CLASS =
  "w-full rounded-md border border-[#D5CBBF] bg-white px-3 py-2 text-sm text-[#1A1815] " +
  "placeholder:text-[#6B6255] focus:outline-none focus:ring-2 focus:ring-[#C44B2E] focus:border-transparent " +
  "read-only:bg-[#F4EFE7] read-only:text-[#5A5347]";
const LABEL_CLASS = "block text-sm font-medium text-[#1A1815] mb-1";

type Status = "idle" | "submitting" | "success" | "error";
type ConfirmationStatus = "sent" | "not_configured" | "failed" | "unknown";

interface LeadsResponse {
  success?: boolean;
  error?: string;
  notifications?: { notification?: string; confirmation?: string };
}

interface RequestReportFormProps {
  contactEmail: string;
  /** Lead `src` when the URL carries none, so each page's requests are attributable. */
  defaultSrc?: string;
}

interface Prefill {
  institutionId: number | null;
  institutionName: string;
  src: string;
}

function readPrefill(params: URLSearchParams, defaultSrc: string): Prefill {
  const idRaw = Number(params.get("institution"));
  const srcRaw = (params.get("src") ?? "").trim();
  return {
    institutionId: Number.isInteger(idRaw) && idRaw > 0 ? idRaw : null,
    institutionName: (params.get("name") ?? "").trim(),
    src: SRC_PATTERN.test(srcRaw) ? srcRaw : defaultSrc,
  };
}

function toConfirmationStatus(body: LeadsResponse | null): ConfirmationStatus {
  const status = body?.notifications?.confirmation;
  return status === "sent" || status === "not_configured" || status === "failed"
    ? status
    : "unknown";
}

export function RequestReportForm(props: RequestReportFormProps) {
  return (
    <Suspense fallback={<RequestReportFormInner {...props} prefill={null} />}>
      <RequestReportFormWithParams {...props} />
    </Suspense>
  );
}

function RequestReportFormWithParams(props: RequestReportFormProps) {
  const params = useSearchParams();
  return <RequestReportFormInner {...props} prefill={readPrefill(params, props.defaultSrc ?? DEFAULT_SRC)} />;
}

function RequestReportFormInner({
  contactEmail,
  defaultSrc = DEFAULT_SRC,
  prefill,
}: RequestReportFormProps & { prefill: Prefill | null }) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationStatus>("unknown");
  const [institutionLocked, setInstitutionLocked] = useState(
    Boolean(prefill?.institutionName),
  );

  const src = prefill?.src ?? defaultSrc;
  const lockedInstitutionId = institutionLocked ? prefill?.institutionId ?? null : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const payload = {
      name: String(formData.get("name") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      company: String(formData.get("institution") ?? "").trim(),
      role: String(formData.get("role") ?? "").trim() || null,
      use_case: REPORT_USE_CASE,
      source: REPORT_SOURCE,
      institutionId: lockedInstitutionId,
      src,
      [LEAD_HONEYPOT_FIELD]: String(formData.get(LEAD_HONEYPOT_FIELD) ?? "").trim() || undefined,
    };

    try {
      const response = await fetch(LEADS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as LeadsResponse | null;
      if (!response.ok) {
        throw new Error(body?.error || GENERIC_ERROR);
      }
      trackEvent("request_report", { src });
      setConfirmation(toConfirmationStatus(body));
      setStatus("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : GENERIC_ERROR);
      setStatus("error");
    }
  }

  if (status === "success") {
    return <RequestReportSuccess contactEmail={contactEmail} confirmation={confirmation} />;
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-[#E0D7C9] bg-[#FDFBF8] p-6 space-y-4"
      aria-label={`Request a ${REPORT_OFFER.name}`}
    >
      {/* Honeypot: hidden from people and assistive tech; bots fill it and the server drops the request. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" name={LEAD_HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      {status === "error" && errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errorMessage}
        </div>
      )}

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <label htmlFor="report-institution" className={`${LABEL_CLASS} mb-0`}>
            Institution
          </label>
          {institutionLocked && (
            <button
              type="button"
              onClick={() => setInstitutionLocked(false)}
              className="text-xs font-medium text-[#6B6255] underline underline-offset-2 hover:text-[#1A1815]"
            >
              Change
            </button>
          )}
        </div>
        <input
          id="report-institution"
          name="institution"
          type="text"
          required
          readOnly={institutionLocked}
          aria-readonly={institutionLocked}
          defaultValue={prefill?.institutionName ?? ""}
          autoComplete="organization"
          placeholder="First National Bank"
          className={INPUT_CLASS}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="report-name" className={LABEL_CLASS}>
            Name
          </label>
          <input
            id="report-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="report-email" className={LABEL_CLASS}>
            Work email
          </label>
          <input
            id="report-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div>
        <label htmlFor="report-role" className={LABEL_CLASS}>
          Role <span className="font-normal text-[#6B6255]">(optional)</span>
        </label>
        <input
          id="report-role"
          name="role"
          type="text"
          autoComplete="organization-title"
          placeholder="VP Retail Banking"
          className={INPUT_CLASS}
        />
      </div>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#A93D25] disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {status === "submitting" ? "Sending…" : REPORT_OFFER.ctaLabel}
      </button>
      <p className="text-xs leading-relaxed text-[#6B6255]">
        It&apos;s free — no payment, no card. We confirm your peer set by email before any work
        starts.
      </p>
    </form>
  );
}

function RequestReportSuccess({
  contactEmail,
  confirmation,
}: {
  contactEmail: string;
  confirmation: ConfirmationStatus;
}) {
  const confirmationSent = confirmation === "sent";
  return (
    <div
      role="status"
      className="rounded-lg border border-[#E0D7C9] bg-[#FDFBF8] p-6 text-sm text-[#1A1815]"
    >
      <p className="font-semibold">{SUCCESS_HEADLINE}</p>
      <p className="mt-2 text-[#5A5347]">{SUCCESS_PROMISE}</p>
      <p className="mt-2 text-[#5A5347]">
        {confirmationSent ? (
          CONFIRMATION_SENT
        ) : (
          <>
            {CONFIRMATION_MISSING}{" "}
            <a href={`mailto:${contactEmail}`} className="font-medium underline underline-offset-2">
              {contactEmail}
            </a>
            .
          </>
        )}
      </p>
      <p className="mt-2 text-[#5A5347]">
        Questions in the meantime? Email{" "}
        <a href={`mailto:${contactEmail}`} className="font-medium underline underline-offset-2">
          {contactEmail}
        </a>
        .
      </p>
    </div>
  );
}
