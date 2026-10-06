/**
 * Emails behind the Competitive Fee Position Report request form and the contact
 * form. Storage happens first in /api/leads; these only report delivery status.
 */
import { REPORT_OFFER } from "@/lib/constants";
import {
  adminLeadsUrl,
  emailOptInLines,
  sendLeadNotificationPair,
  type LeadNotificationOutcome,
} from "./lead-notification";

export type { LeadNotificationOutcome } from "./lead-notification";

export interface ReportRequestNotificationInput {
  name: string;
  email: string;
  institution: string;
  role: string | null;
  institutionId: number | null;
  src: string | null;
  /** Whether we can build this institution's report from live data; James's email only. */
  quoteCheck?: string | null;
}

export interface ContactRequestNotificationInput {
  name: string;
  email: string;
  company: string | null;
  role: string | null;
  message: string | null;
  inquiryType: string | null;
}

const CONTACT_CONFIRMATION_LINE = "We reply within one business day.";

function detailLine(label: string, value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? null : `${label}: ${value}`;
}

/** The quote check's verdict as a tag at the top of James's email. */
function quoteStatus(quoteCheck: string | null) {
  if (!quoteCheck) return undefined;
  if (/not ready to quote/i.test(quoteCheck)) return { label: "Not ready to quote", tone: "warn" as const };
  if (/ready to quote/i.test(quoteCheck)) return { label: "Ready to quote", tone: "good" as const };
  return { label: "Check by hand", tone: "warn" as const };
}

export async function sendReportRequestNotifications(
  input: ReportRequestNotificationInput,
): Promise<LeadNotificationOutcome> {
  const roleSuffix = input.role ? `, ${input.role}` : "";
  const notificationLines = [
    `${input.name} requested a ${REPORT_OFFER.name} for ${input.institution}. It is priced on request: reply with scope and price within one business day.`,
    "",
    ...[
      detailLine("Institution", input.institution),
      detailLine("Institution ID", input.institutionId),
      detailLine("Name", input.name),
      detailLine("Email", input.email),
      detailLine("Role", input.role),
      detailLine("Source", input.src),
    ].filter((line): line is string => line !== null),
    "",
    ...(input.quoteCheck ? [input.quoteCheck, ""] : []),
    "Reply to this email to reach the requester directly.",
  ];

  return sendLeadNotificationPair({
    requesterEmail: input.email,
    notification: {
      subject: `New report request: ${input.institution} — ${input.name}, ${input.email}${roleSuffix}`,
      eyebrow: "New report request",
      heading: input.institution,
      status: quoteStatus(input.quoteCheck ?? null),
      lines: notificationLines,
      cta: { label: "Open /admin/leads", href: adminLeadsUrl() },
    },
    confirmation: {
      subject: `We received your request for ${input.institution}`,
      eyebrow: "Your request",
      heading: `We received your request for ${input.institution}`,
      lines: [
        `Thank you for asking about a ${REPORT_OFFER.name} for ${input.institution}. The institution report is paid, so nothing is built or charged until you agree to its scope and price.`,
      ],
      steps: {
        title: "What happens next",
        items: [
          `We check the fee data we hold for ${input.institution} and its local competitors.`,
          "We reply within one business day with the report's scope and price.",
          "You pay by card once you agree to the quote. Nothing is charged before that.",
        ],
      },
      closing: ["Reply to this email with questions.", ...emailOptInLines(input.email)],
      signed: true,
    },
  });
}

export async function sendContactRequestNotifications(
  input: ContactRequestNotificationInput,
): Promise<LeadNotificationOutcome> {
  const who = input.company ? `${input.company} — ${input.name}` : input.name;
  const inquiry = input.inquiryType ? ` (${input.inquiryType})` : "";
  const notificationLines = [
    `${input.name} sent a message through the contact form.`,
    "",
    ...[
      detailLine("Company", input.company),
      detailLine("Name", input.name),
      detailLine("Email", input.email),
      detailLine("Role", input.role),
      detailLine("Inquiry", input.inquiryType),
    ].filter((line): line is string => line !== null),
    "",
    input.message ? `Message:\n${input.message}` : "No message body was provided.",
  ];

  return sendLeadNotificationPair({
    requesterEmail: input.email,
    notification: {
      subject: `New contact request${inquiry}: ${who}, ${input.email}`,
      eyebrow: input.inquiryType ? `New message · ${input.inquiryType}` : "New message",
      heading: who,
      lines: notificationLines,
      cta: { label: "Open /admin/leads", href: adminLeadsUrl() },
    },
    confirmation: {
      subject: "We received your message",
      eyebrow: "Your message",
      lines: [
        `We received your message. ${CONTACT_CONFIRMATION_LINE}`,
        "",
        "Reply to this email if you want to add anything.",
      ],
      signed: true,
    },
  });
}
