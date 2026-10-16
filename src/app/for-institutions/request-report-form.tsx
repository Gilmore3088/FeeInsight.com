"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { REPORT_OFFER } from "@/lib/constants";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { benchmarkReportPath, isFedDistrict, type BenchmarkScope } from "@/lib/benchmark-report";
import { LEAD_HONEYPOT_FIELD } from "@/lib/lead-capture";
import { readFirstTouch } from "@/lib/marketing-touch";
import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";
import { HoneypotField, honeypotValue } from "@/components/public/honeypot-field";
import { InstitutionCombobox, type PickedInstitution } from "./institution-combobox";

const LEADS_ENDPOINT = "/api/leads";
const READER_ENDPOINT = "/api/leads/reader";
const REPORT_USE_CASE = "competitive-fee-position-report";
const REPORT_SOURCE = "report";
const NATIONAL_REPORT_SOURCE = "report_national";
const DISTRICT_REPORT_SOURCE = "report_district";
/** Each bank's free page is the instant own-institution snapshot (James, 8 Oct 2026). */
const OWN_INSTITUTION_HREF = "/institutions";
const DEFAULT_SRC = "for-institutions";
const INSTITUTION_REPORT_HREF = "/reports?report=institution#request";
const SRC_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const FALLBACK_ID_SUFFIX = "-fallback";

const SUCCESS_HEADLINE = "Request received.";
const SUCCESS_PROMISE = "The institution report is paid. We reply within one business day with scope and price.";
const CONFIRMATION_SENT = "A confirmation email is on its way to you now.";
const CONFIRMATION_MISSING =
  "We couldn't send a confirmation email, but we have your request. Expect an email from";
const FREE_SUCCESS_HEADLINE = "Your report is ready.";
const FREE_EMAIL_SENT = "We also emailed you the link.";
const FREE_EMAIL_MISSING = "We couldn't email the link, so keep this page or bookmark the report.";
// Say plainly what the email field signs someone up for (James, 2026-10-06).
const FREE_EMAIL_NOTE =
  "We email you the link. Nothing else arrives unless you confirm your address in that email.";
const KNOWN_READER_NOTE =
  "You confirmed this address earlier. A first free report also starts three short emails on reading it. Unsubscribe anytime.";
const GENERIC_ERROR = "We couldn't send that request. Please try again or email us directly.";

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-ink focus:border-transparent " +
  "read-only:bg-surface-200 read-only:text-ink-soft";
const LABEL_CLASS = "block text-sm font-medium text-ink mb-1";

type Status = "idle" | "submitting" | "success" | "error";
type ReportType = "national" | "district" | "institution";

// The paid report first: it is the one that answers "where do our fees stand" (site brief, /reports).
const REPORT_TYPES: { value: ReportType; title: string; detail: string; paid: boolean }[] = [
  { value: "institution", title: "Your institution", detail: "Your fees against named local competitors.", paid: true },
  { value: "national", title: "National", detail: "The headline fees across the U.S.", paid: false },
  { value: "district", title: "Fed district", detail: "The same fees for one Fed district, against the nation.", paid: false },
];
type ConfirmationStatus = "sent" | "not_configured" | "failed" | "unknown";

interface LeadsResponse {
  success?: boolean;
  error?: string;
  notifications?: { notification?: string; confirmation?: string };
}

interface RequestReportFormProps {
  contactEmail: string;
  /** The report picked when the URL names none. */
  defaultReportType?: ReportType;
  /** A heading inside the card, for a form that stands alone (the reports page's hero). */
  title?: string;
  /** Lead `src` when the URL carries none, so each page's requests are attributable. */
  defaultSrc?: string;
}

interface Prefill {
  institutionId: number | null;
  institutionName: string;
  src: string;
  reportType: ReportType;
  district: number | null;
}

function readPrefill(params: URLSearchParams, defaultSrc: string, defaultReportType: ReportType): Prefill {
  const idRaw = Number(params.get("institution"));
  const srcRaw = (params.get("src") ?? "").trim();
  const districtRaw = Number(params.get("district"));
  const institutionName = (params.get("name") ?? "").trim();
  const requested = params.get("report");
  // A link that names an institution (a profile page or a hosted report) asks for its report.
  const reportType: ReportType =
    requested === "national" || requested === "district" || requested === "institution"
      ? requested
      : institutionName
        ? "institution"
        : defaultReportType;
  return {
    institutionId: Number.isInteger(idRaw) && idRaw > 0 ? idRaw : null,
    institutionName,
    src: SRC_PATTERN.test(srcRaw) ? srcRaw : defaultSrc,
    reportType,
    district: isFedDistrict(districtRaw) ? districtRaw : null,
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
    // React streams the fallback first and swaps in the loaded form, so the HTML carries both
    // copies. The fallback's ids take a suffix so every id on the page stays unique (#1168).
    <Suspense fallback={<RequestReportFormInner {...props} prefill={null} idSuffix={FALLBACK_ID_SUFFIX} />}>
      <RequestReportFormWithParams {...props} />
    </Suspense>
  );
}

function RequestReportFormWithParams(props: RequestReportFormProps) {
  const params = useSearchParams();
  const prefill = readPrefill(params, props.defaultSrc ?? DEFAULT_SRC, props.defaultReportType ?? "national");
  // Keyed on the query so a same-page link that changes `?report=` or the bank reloads the
  // form with that option selected (useState reads the prefill only on first render).
  return <RequestReportFormInner key={params.toString()} {...props} prefill={prefill} />;
}

function RequestReportFormInner({
  contactEmail,
  defaultSrc = DEFAULT_SRC,
  defaultReportType = "national",
  title,
  prefill,
  idSuffix = "",
}: RequestReportFormProps & { prefill: Prefill | null; idSuffix?: string }) {
  const fieldId = (base: string) => base + idSuffix;
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationStatus>("unknown");
  const [institutionLocked, setInstitutionLocked] = useState(
    Boolean(prefill?.institutionName),
  );
  const [reportType, setReportType] = useState<ReportType>(prefill?.reportType ?? defaultReportType);
  const [freeReport, setFreeReport] = useState<BenchmarkScope | null>(null);
  const [pickedInstitution, setPickedInstitution] = useState<PickedInstitution | null>(null);
  const [reportState, setReportState] = useState("");
  // A reader who already confirmed (signed cookie from their confirm link) isn't asked again.
  const [knownReader, setKnownReader] = useState<string | null>(null);
  const [useOtherEmail, setUseOtherEmail] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(READER_ENDPOINT, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { email?: string | null } | null) => {
        if (!cancelled && typeof body?.email === "string") setKnownReader(body.email);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const readerEmail = knownReader && !useOtherEmail ? knownReader : null;

  const src = prefill?.src ?? defaultSrc;
  const lockedInstitutionId = institutionLocked ? prefill?.institutionId ?? null : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    if (reportType !== "institution") {
      await submitFreeReport(formData);
      return;
    }
    const payload = {
      name: String(formData.get("name") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      company: String(formData.get("institution") ?? "").trim(),
      role: String(formData.get("role") ?? "").trim() || null,
      state: String(formData.get("state") ?? "").trim() || null,
      competitors: String(formData.get("competitors") ?? "").trim() || null,
      use_case: REPORT_USE_CASE,
      source: REPORT_SOURCE,
      institutionId: lockedInstitutionId ?? pickedInstitution?.id ?? null,
      src,
      firstTouch: readFirstTouch(),
      [LEAD_HONEYPOT_FIELD]: honeypotValue(event.currentTarget),
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
      trackEvent("request_report", { src, report: "institution" });
      setConfirmation(toConfirmationStatus(body));
      setStatus("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : GENERIC_ERROR);
      setStatus("error");
    }
  }

  async function submitFreeReport(formData: FormData) {
    const district = Number(formData.get("district"));
    const scope: BenchmarkScope =
      reportType === "district" ? { kind: "district", district } : { kind: "national" };
    const payload = {
      // No email for a known reader: the server reads it from their signed cookie.
      email: readerEmail ? undefined : String(formData.get("email") ?? "").trim(),
      source: reportType === "district" ? DISTRICT_REPORT_SOURCE : NATIONAL_REPORT_SOURCE,
      district: reportType === "district" ? district : undefined,
      src,
      firstTouch: readFirstTouch(),
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
      trackEvent("request_report", { src, report: reportType });
      setConfirmation(toConfirmationStatus(body));
      setFreeReport(scope);
      setStatus("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : GENERIC_ERROR);
      setStatus("error");
    }
  }

  if (status === "success" && freeReport) {
    return <FreeReportSuccess scope={freeReport} confirmation={confirmation} requestHref={institutionReportHref(prefill)} />;
  }
  if (status === "success") {
    return <RequestReportSuccess contactEmail={contactEmail} confirmation={confirmation} />;
  }

  const institution = reportType === "institution";

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-2xl border border-border bg-surface-0 p-5 shadow-fi-2 sm:p-6"
      aria-label="Request a fee report"
    >
      {title && <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[22px]">{title}</h2>}
      <HoneypotField />
      {status === "error" && errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errorMessage}
        </div>
      )}

      <fieldset aria-describedby={fieldId("report-type-detail")}>
        <legend className={LABEL_CLASS}>Which report?</legend>
        {/* One row of equal choices; the price sits on each, so none reads as switched off. */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-paper p-1 ring-1 ring-border">
          {REPORT_TYPES.map((option) => {
            const on = reportType === option.value;
            return (
              <label
                key={option.value}
                className={
                  "relative flex cursor-pointer flex-col items-center rounded-lg px-1.5 py-2 text-center transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink " +
                  (on ? "bg-ink text-on-ink shadow-fi-1" : "text-ink hover:bg-surface-0")
                }
              >
                <input
                  type="radio"
                  name="report-type"
                  value={option.value}
                  checked={on}
                  onChange={() => setReportType(option.value)}
                  className="sr-only"
                />
                <span className="text-[13px] font-semibold leading-tight">{option.title}</span>
                <span className={"mt-0.5 text-[11px] font-medium " + (on ? "text-on-ink/75" : "text-ink-muted")}>
                  {option.paid ? REPORT_OFFER.priceLabel : "Free"}
                </span>
              </label>
            );
          })}
        </div>
        <p id={fieldId("report-type-detail")} className="mt-2 text-[13px] text-ink-muted">
          {REPORT_TYPES.find((o) => o.value === reportType)?.detail}{" "}
          <Link href={OWN_INSTITUTION_HREF} className="font-medium text-ink underline underline-offset-2">
            Look up your own fees free
          </Link>
          .
        </p>
      </fieldset>

      {reportType === "district" && (
        <div>
          <label htmlFor={fieldId("report-district")} className={LABEL_CLASS}>
            Fed district
          </label>
          <select
            id={fieldId("report-district")}
            name="district"
            required
            defaultValue={prefill?.district ?? ""}
            className={INPUT_CLASS}
          >
            <option value="" disabled>
              Choose a district
            </option>
            {Object.entries(DISTRICT_NAMES).map(([id, name]) => (
              <option key={id} value={id}>
                {id} · {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!institution && readerEmail && (
        <div className="rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink">
          <p>
            Sending to <span className="font-medium">{readerEmail}</span>.{" "}
            <button
              type="button"
              onClick={() => setUseOtherEmail(true)}
              className="text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              Use a different email
            </button>
          </p>
          <p className="mt-1 text-xs text-ink-soft">{KNOWN_READER_NOTE}</p>
        </div>
      )}

      {!institution && !readerEmail && (
        <div>
          <label htmlFor={fieldId("report-email-free")} className={LABEL_CLASS}>
            Email
          </label>
          <input
            id={fieldId("report-email-free")}
            name="email"
            type="email"
            required
            autoComplete="email"
            aria-describedby={fieldId("report-email-free-note")}
            className={INPUT_CLASS}
          />
          <p id={fieldId("report-email-free-note")} className="mt-1 text-xs text-ink-soft">
            {FREE_EMAIL_NOTE}
          </p>
        </div>
      )}

      {institution && (
        <>
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <label htmlFor={fieldId("report-institution")} className={`${LABEL_CLASS} mb-0`}>
              Institution
            </label>
            {institutionLocked && (
              <button
                type="button"
                onClick={() => setInstitutionLocked(false)}
                className="text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                Change
              </button>
            )}
          </div>
          <InstitutionCombobox
            id={fieldId("report-institution")}
            name="institution"
            readOnly={institutionLocked}
            defaultValue={prefill?.institutionName ?? ""}
            className={INPUT_CLASS}
            onPick={(picked) => {
              setPickedInstitution(picked);
              if (picked?.stateCode && !reportState) setReportState(picked.stateCode);
            }}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={fieldId("report-name")} className={LABEL_CLASS}>
              Name
            </label>
            <input
              id={fieldId("report-name")}
              name="name"
              type="text"
              required
              autoComplete="name"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor={fieldId("report-email")} className={LABEL_CLASS}>
              Work email
            </label>
            <input
              id={fieldId("report-email")}
              name="email"
              type="email"
              required
              autoComplete="email"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div>
          <label htmlFor={fieldId("report-role")} className={LABEL_CLASS}>
            Role <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input
            id={fieldId("report-role")}
            name="role"
            type="text"
            autoComplete="organization-title"
            placeholder="VP Retail Banking"
            className={INPUT_CLASS}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          <div>
            <label htmlFor={fieldId("report-state")} className={LABEL_CLASS}>
              State <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <select
              id={fieldId("report-state")}
              name="state"
              value={reportState}
              onChange={(event) => setReportState(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">Select</option>
              {STATE_CODES.map((code) => (
                <option key={code} value={code}>
                  {STATE_NAMES[code]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={fieldId("report-competitors")} className={LABEL_CLASS}>
              Competitors to include <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <input
              id={fieldId("report-competitors")}
              name="competitors"
              type="text"
              maxLength={300}
              placeholder="e.g. JPMorgan Chase, Amplify Credit Union"
              className={INPUT_CLASS}
            />
          </div>
        </div>
        </>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="min-h-11 w-full rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "submitting"
          ? "Sending…"
          : institution
            ? "Request your institution report"
            : "Get the free report"}
      </button>
      <p className="text-xs leading-relaxed text-ink-muted">
        {institution
          ? "Paid. We reply within one business day with scope and price; you pay once you agree."
          : "Free. It opens right away, and the link comes by email."}{" "}
        By sending you agree to the{" "}
        <Link href="/terms" className="underline">Terms</Link> and{" "}
        <Link href="/privacy" className="underline">Privacy Policy</Link>.
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
      className="rounded-lg border border-border bg-surface-0 p-6 text-sm text-ink"
    >
      <p className="font-semibold">{SUCCESS_HEADLINE}</p>
      <p className="mt-2 text-ink-soft">{SUCCESS_PROMISE}</p>
      <p className="mt-2 text-ink-soft">
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
      <p className="mt-2 text-ink-soft">
        Questions in the meantime? Email{" "}
        <a href={`mailto:${contactEmail}`} className="font-medium underline underline-offset-2">
          {contactEmail}
        </a>
        .
      </p>
    </div>
  );
}

/** The paid-report link after a free report, keeping the bank the reader arrived with. */
export function institutionReportHref(prefill: Pick<Prefill, "institutionId" | "institutionName" | "src"> | null): string {
  if (!prefill?.institutionId || !prefill.institutionName) return INSTITUTION_REPORT_HREF;
  const params = new URLSearchParams({
    report: "institution",
    institution: String(prefill.institutionId),
    name: prefill.institutionName,
    src: prefill.src,
  });
  return `/reports?${params.toString()}#request`;
}

function FreeReportSuccess({
  scope,
  confirmation,
  requestHref,
}: {
  scope: BenchmarkScope;
  confirmation: ConfirmationStatus;
  requestHref: string;
}) {
  return (
    <div
      role="status"
      className="rounded-lg border border-border bg-surface-0 p-6 text-sm text-ink"
    >
      <p className="font-semibold">{FREE_SUCCESS_HEADLINE}</p>
      <p className="mt-2 text-ink-soft">{confirmation === "sent" ? FREE_EMAIL_SENT : FREE_EMAIL_MISSING}</p>
      <Link
        href={benchmarkReportPath(scope)}
        className="mt-4 inline-flex rounded-md bg-brick px-4 py-2.5 text-sm font-semibold text-white hover:bg-brick-ink"
      >
        Open your report
      </Link>
      <p className="mt-4 text-ink-soft">
        Want your own institution against named competitors?{" "}
        <Link href={requestHref} className="font-medium underline underline-offset-2">
          Request your institution report
        </Link>
        .
      </p>
    </div>
  );
}
