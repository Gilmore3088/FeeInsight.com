import {
  sendContactRequestNotifications,
  sendReportRequestNotifications,
  type LeadNotificationOutcome,
} from "@/lib/email/report-request";
import { sendLeadCaptureNotifications } from "@/lib/email/lead-capture";
import type { EmailDeliveryStatus } from "@/lib/email/resend";
import { handleLeadDeliveryOutcome } from "@/lib/leads/lead-alerts";
import { NEWSLETTER_SOURCE, placementForSource, type LeadCapturePlacement } from "@/lib/lead-capture";

export const REPORT_SOURCE = "report";
const CONTACT_SOURCE_PATTERN = /^contact(?:_([a-z0-9-]+))?$/;
const ENTERPRISE_SOURCE = "enterprise";

const MAX_INSTITUTION_ID = 2_147_483_647;
const SRC_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

export interface StoredLead {
  /** The row this submission created; null when it filled gaps on an existing lead. */
  leadId?: number | null;
  name: string;
  email: string;
  company: string | null;
  role: string | null;
  useCase: string | null;
  source: string;
  institutionId: number | null;
  src: string | null;
  /** Capture placements only: state context and the institution name for email copy. */
  stateCode?: string | null;
  institutionName?: string | null;
}

/** Status shape returned to the client so it can soften the success copy. */
export interface LeadNotificationStatus {
  notification: EmailDeliveryStatus;
  confirmation: EmailDeliveryStatus;
}

export function parseInstitutionId(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric)) return null;
  return numeric > 0 && numeric <= MAX_INSTITUTION_ID ? numeric : null;
}

export function parseSrc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SRC_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * The leads table has no institution_id / src columns; report requests carry them
 * as `; key=value` suffixes on use_case so /admin/leads can still read them.
 */
export function buildReportUseCase(
  useCase: string | null,
  institutionId: number | null,
  src: string | null,
): string | null {
  const parts = [useCase];
  if (institutionId !== null) parts.push(`institution_id=${institutionId}`);
  if (src) parts.push(`src=${src}`);
  const joined = parts.filter((part): part is string => Boolean(part)).join("; ");
  return joined.length > 0 ? joined : null;
}

export function contactInquiryType(source: string): string | null {
  const match = CONTACT_SOURCE_PATTERN.exec(source);
  return match ? (match[1] ?? null) : null;
}

/** The footer newsletter box offers the same thing as the national index placement. */
function captureOfferFor(source: string): LeadCapturePlacement | null {
  return source === NEWSLETTER_SOURCE ? "national_index" : placementForSource(source);
}

export function shouldNotify(source: string) {
  return (
    source === REPORT_SOURCE ||
    captureOfferFor(source) !== null ||
    source === ENTERPRISE_SOURCE ||
    CONTACT_SOURCE_PATTERN.test(source)
  );
}

function deliveryReason(result: LeadNotificationOutcome["notification"]) {
  if (result.status === "not_configured") return result.reason;
  if (result.status === "failed") return result.error;
  return null;
}

/**
 * The lead is stored either way; an email that did not go out is logged with its reason
 * (e.g. "RESEND_API_KEY is not configured.") and handed to the lead loop, which alerts
 * James or marks the lead email_failed so the hourly lead watch alerts on it.
 */
async function handleUndelivered(lead: StoredLead, outcome: LeadNotificationOutcome) {
  const notification = deliveryReason(outcome.notification);
  const confirmation = deliveryReason(outcome.confirmation);
  if (!notification && !confirmation) return;
  console.warn("[api/leads] lead email not delivered", { source: lead.source, notification, confirmation });
  try {
    await handleLeadDeliveryOutcome({ ...lead, id: lead.leadId ?? null }, outcome);
  } catch (error) {
    console.error("[api/leads] failed-email alert failed", {
      source: lead.source,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function toStatus(outcome: LeadNotificationOutcome): LeadNotificationStatus {
  return {
    notification: outcome.notification.status,
    confirmation: outcome.confirmation.status,
  };
}

/** Never throws: any unexpected error is reported as a failed delivery. */
export async function notifyForLead(lead: StoredLead): Promise<LeadNotificationStatus | null> {
  if (!shouldNotify(lead.source)) return null;
  try {
    const placement = captureOfferFor(lead.source);
    if (placement) {
      const outcome = await sendLeadCaptureNotifications({
        email: lead.email,
        placement,
        institutionId: lead.institutionId,
        institutionName: lead.institutionName ?? null,
        stateCode: lead.stateCode ?? null,
      });
      await handleUndelivered(lead, outcome);
      return toStatus(outcome);
    }
    if (lead.source === REPORT_SOURCE) {
      const outcome = await sendReportRequestNotifications({
        name: lead.name,
        email: lead.email,
        institution: lead.company ?? "an unnamed institution",
        role: lead.role,
        institutionId: lead.institutionId,
        src: lead.src,
      });
      await handleUndelivered(lead, outcome);
      return toStatus(outcome);
    }
    const outcome = await sendContactRequestNotifications({
      name: lead.name,
      email: lead.email,
      company: lead.company,
      role: lead.role,
      message: lead.useCase,
      inquiryType:
        lead.source === ENTERPRISE_SOURCE ? ENTERPRISE_SOURCE : contactInquiryType(lead.source),
    });
    await handleUndelivered(lead, outcome);
    return toStatus(outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/leads] notification failed", { source: lead.source, error: message });
    const failed = { status: "failed", error: message } as const;
    await handleUndelivered(lead, { notification: failed, confirmation: failed });
    return { notification: "failed", confirmation: "failed" };
  }
}
