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
  // No longer mounted: institution pages save to account-based alerts (FeeAlertControl).
  // Kept so leads already captured from this placement still resolve and get their email.
  institution_alerts: "capture_institution",
  state_benchmark: "capture_state",
  national_index: "capture_national_index",
  sample_report: "capture_report_sample",
  homepage: "capture_homepage",
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

/** Placements whose offer is the sample report PDF (the lead magnet). */
export function deliversSampleReport(placement: LeadCapturePlacement) {
  return placement === "sample_report" || placement === "homepage";
}

export function parseStateCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return VALID_US_CODES.has(code) ? code : null;
}

/** The state a reader most recently chose, from `state=XX` in their lead's use_case. */
export function stateFromUseCase(useCase: string | null | undefined): string | null {
  const matches = [...(useCase ?? "").matchAll(/(?:^|;\s*)state=([A-Z]{2})\b/g)];
  return parseStateCode(matches.at(-1)?.[1]);
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
