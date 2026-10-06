/**
 * Emails behind the Competitive Fee Position Report request form and the contact
 * form. Storage happens first in /api/leads; these only report delivery status.
 */
import { REPORT_OFFER, SITE_URL } from "@/lib/constants";
import { benchmarkReportPath, benchmarkReportTitle, isFedDistrict } from "@/lib/benchmark-report";
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
  /** Set when the data check held the request: the requester hears so at once. */
  held?: { district: number | null };
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

/** The requester's answer when their market is not ready: said plainly, with a free report to use now. */
function heldConfirmation(input: ReportRequestNotificationInput, district: number | null) {
  const scope = district !== null && isFedDistrict(district) ? { kind: "district" as const, district } : { kind: "national" as const };
  const href = `${SITE_URL.replace(/\/$/, "")}${benchmarkReportPath(scope)}`;
  return {
    subject: `About your request for ${input.institution}`,
    eyebrow: "Your request",
    heading: `About your request for ${input.institution}`,
    lines: [
      `Thank you for asking about a ${REPORT_OFFER.name} for ${input.institution}. We checked the fee data we hold today, and too few of the banks and credit unions near ${input.institution} have their fee schedules on file for a fair comparison. So we are not quoting this report yet, and nothing has been charged.`,
      "",
      `What you can use now: the free ${benchmarkReportTitle(scope)} sets the 15 headline fees side by side, and it opens right away.`,
    ],
    cta: { label: `Open the free ${scope.kind === "district" ? `District ${scope.district}` : "National"} report`, href },
    closing: [
      "Reply to this email if you want to know when your market is ready, or to talk through what we can show today.",
      ...emailOptInLines(input.email),
    ],
    signed: true,
  };
}

export async function sendReportRequestNotifications(
  input: ReportRequestNotificationInput,
): Promise<LeadNotificationOutcome> {
  const roleSuffix = input.role ? `, ${input.role}` : "";
  const notificationLines = [
    input.held
      ? `${input.name} requested a ${REPORT_OFFER.name} for ${input.institution}. Its local data is not ready, so they were answered automatically; nothing is owed today.`
      : `${input.name} requested a ${REPORT_OFFER.name} for ${input.institution}. It is priced on request: reply with scope and price within one business day.`,
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
    ...(input.held
      ? ["Set to Held automatically. The requester was told their market is not ready yet and sent their free benchmark report.", ""]
      : []),
    "Reply to this email to reach the requester directly.",
  ];

  return sendLeadNotificationPair({
    requesterEmail: input.email,
    notification: {
      subject: `${input.held ? "Held report request" : "New report request"}: ${input.institution} — ${input.name}, ${input.email}${roleSuffix}`,
      eyebrow: "New report request",
      heading: input.institution,
      status: quoteStatus(input.quoteCheck ?? null),
      lines: notificationLines,
      cta: { label: "Open /admin/leads", href: adminLeadsUrl() },
    },
    confirmation: input.held ? heldConfirmation(input, input.held.district) : {
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
