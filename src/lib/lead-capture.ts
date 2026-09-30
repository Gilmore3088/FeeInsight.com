/**
 * Contextual email capture: one placement per high-intent public surface. Each
 * placement posts to /api/leads with its own `source` so conversion is queryable
 * by placement (`leads.source`), and institution/state context rides on `use_case`
 * as `; key=value` suffixes (the same convention report requests use).
 *
 * Client-safe: no server imports.
 */
import { VALID_US_CODES } from "@/lib/us-states";

export const LEAD_CAPTURE_SOURCES = {
  institution_alerts: "capture_institution",
  state_benchmark: "capture_state",
  national_index: "capture_national_index",
  sample_report: "capture_report_sample",
} as const;

export type LeadCapturePlacement = keyof typeof LEAD_CAPTURE_SOURCES;
export type LeadCaptureSource = (typeof LEAD_CAPTURE_SOURCES)[LeadCapturePlacement];

const SOURCE_TO_PLACEMENT = new Map<string, LeadCapturePlacement>(
  (Object.entries(LEAD_CAPTURE_SOURCES) as [LeadCapturePlacement, LeadCaptureSource][]).map(
    ([placement, source]) => [source, placement],
  ),
);

/** Stored as the lead name when a form collects only an email. */
export const EMAIL_ONLY_LEAD_NAME = "Newsletter signup";
export const NEWSLETTER_SOURCE = "newsletter";

/** Honeypot field name; real visitors never see or fill it. */
export const LEAD_HONEYPOT_FIELD = "website";

export function isLeadCaptureSource(source: string): source is LeadCaptureSource {
  return SOURCE_TO_PLACEMENT.has(source);
}

export function placementForSource(source: string): LeadCapturePlacement | null {
  return SOURCE_TO_PLACEMENT.get(source) ?? null;
}

/** Email-only sources get the placeholder name instead of a 400 for a missing name. */
export function isEmailOnlySource(source: string) {
  return source === NEWSLETTER_SOURCE || isLeadCaptureSource(source);
}

/** Placements whose offer is only for bank/CU staff, so a work email is required. */
export function requiresWorkEmail(source: string) {
  return source === LEAD_CAPTURE_SOURCES.sample_report;
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "comcast.net",
  "att.net",
  "verizon.net",
  "sbcglobal.net",
]);

export function isWorkEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return domain.length > 0 && !PERSONAL_EMAIL_DOMAINS.has(domain);
}

export function parseStateCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return VALID_US_CODES.has(code) ? code : null;
}

/** `placement=...; institution_id=...; state=...` — queryable with LIKE on use_case. */
export function buildCaptureAttribution(
  placement: LeadCapturePlacement,
  institutionId: number | null,
  stateCode: string | null,
): string {
  const parts = [`placement=${placement}`];
  if (institutionId !== null) parts.push(`institution_id=${institutionId}`);
  if (stateCode) parts.push(`state=${stateCode}`);
  return parts.join("; ");
}
