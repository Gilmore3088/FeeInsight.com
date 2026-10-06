/**
 * Emails for the paid institution report: the quote James chooses to send from
 * /admin/leads, and the pair sent when Stripe confirms the payment (James's alert and
 * the requester's report link). Never throw; each returns its delivery result.
 */
import { CONTACT_EMAIL, REPORT_OFFER } from "@/lib/constants";
import { formatUsd, PAY_LINK_LIFETIME_DAYS } from "@/lib/leads/report-payment";
import { LINK_LIFETIME_DAYS } from "@/lib/custom-report/link";
import {
  adminLeadsUrl,
  getLeadNotificationFromAddress,
  renderLeadEmailHtml,
  renderLeadEmailText,
  sendLeadNotificationPair,
  type LeadEmailContent,
  type LeadNotificationOutcome,
} from "./lead-notification";
import { sendResendEmail, type EmailDeliveryResult } from "./resend";

export interface ReportQuoteEmailInput {
  email: string;
  institution: string;
  cents: number;
  payUrl: string;
}

export function reportQuoteEmail(input: ReportQuoteEmailInput): LeadEmailContent {
  const price = formatUsd(input.cents);
  return {
    subject: `Your quote for the ${input.institution} fee report: ${price}`,
    eyebrow: "Your quote",
    heading: input.institution,
    lines: [
      `Thank you for asking about a ${REPORT_OFFER.name} for ${input.institution}. It sets each of its fees against the banks and credit unions in its own branch counties, from their live published fee schedules, with a source for every figure.`,
      "",
      `Price: ${price}, one time.`,
    ],
    cta: { label: "Review and pay by card", href: input.payUrl },
    steps: {
      title: "How it works",
      items: [
        "Open the link to see what the report covers and its price.",
        "Pay by card on Stripe's secure checkout page. Stripe emails your receipt.",
        "Your private report link opens as soon as the payment goes through, and we email it to you.",
      ],
    },
    closing: [`The pay link works for ${PAY_LINK_LIFETIME_DAYS} days.`, "Reply to this email with any question about the scope."],
    signed: true,
  };
}

export async function sendReportQuoteEmail(input: ReportQuoteEmailInput): Promise<EmailDeliveryResult> {
  const content = reportQuoteEmail(input);
  return sendResendEmail(
    {
      from: getLeadNotificationFromAddress(),
      to: input.email,
      replyTo: CONTACT_EMAIL,
      subject: content.subject,
      html: renderLeadEmailHtml(content),
      text: renderLeadEmailText(content),
    },
    "the quote email",
  );
}

export interface ReportPaidInput {
  leadId: number;
  name: string;
  email: string;
  institution: string;
  cents: number;
  /** Full URL of the private report, or null when CUSTOM_REPORT_LINK_SECRET is not set. */
  reportUrl: string | null;
  checkoutSessionId: string;
}

export function reportPaidEmails(input: ReportPaidInput): { notification: LeadEmailContent; confirmation: LeadEmailContent } {
  const price = formatUsd(input.cents);
  return {
    notification: {
      subject: `Paid: ${input.institution} report, ${price} — ${input.name}`,
      eyebrow: "Report paid",
      heading: input.institution,
      status: { label: `Paid ${price}`, tone: input.reportUrl ? "good" : "warn" },
      lines: [
        input.reportUrl
          ? `${input.name} paid ${price} by card for the ${REPORT_OFFER.name}. They were emailed their private report link.`
          : `${input.name} paid ${price} by card, but no report link could be made (CUSTOM_REPORT_LINK_SECRET is not set). Send the report by hand.`,
        "",
        `Name: ${input.name}`,
        `Email: ${input.email}`,
        `Lead: ${input.leadId}`,
        `Amount: ${price}`,
        `Stripe checkout: ${input.checkoutSessionId}`,
        ...(input.reportUrl ? ["", `Their report: ${input.reportUrl}`] : []),
      ],
      cta: { label: "Open /admin/leads", href: adminLeadsUrl() },
    },
    confirmation: {
      subject: `Your ${input.institution} fee report is ready`,
      eyebrow: "Payment received",
      heading: input.institution,
      lines: input.reportUrl
        ? [
            `Thank you. We received your payment of ${price} for the ${REPORT_OFFER.name} for ${input.institution}. Your report is ready.`,
          ]
        : [
            `Thank you. We received your payment of ${price} for the ${REPORT_OFFER.name} for ${input.institution}. We will email your report link within one business day.`,
          ],
      ...(input.reportUrl ? { cta: { label: "Open your report", href: input.reportUrl } } : {}),
      closing: [
        ...(input.reportUrl
          ? [`The link is private to you and works for ${LINK_LIFETIME_DAYS} days. Its numbers come from live fee data each time you open it, and it prints to PDF.`]
          : []),
        "Stripe emails your receipt separately. Reply to this email with any question.",
      ],
      signed: true,
    },
  };
}

export async function sendReportPaidEmails(input: ReportPaidInput): Promise<LeadNotificationOutcome> {
  return sendLeadNotificationPair({ requesterEmail: input.email, ...reportPaidEmails(input) });
}
