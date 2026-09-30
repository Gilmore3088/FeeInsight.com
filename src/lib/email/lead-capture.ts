/**
 * Emails behind the contextual capture placements (institution, state, national
 * index, sample report). The requester gets a double-opt-in confirmation that
 * also delivers the offer they asked for; the inbox behind CONTACT_EMAIL gets a
 * heads-up. Storage happens first in /api/leads; this only reports delivery.
 */
import { CONTACT_EMAIL, REPORT_OFFER, REPORT_OFFER_LINE, SITE_NAME, SITE_URL } from "@/lib/constants";
import { deliversSampleReport, type LeadCapturePlacement } from "@/lib/lead-capture";
import { STATE_NAMES } from "@/lib/us-states";
import {
  adminLeadsUrl,
  getLeadNotificationFromAddress,
  renderLeadEmailHtml,
  renderLeadEmailText,
  type LeadEmailContent,
  type LeadNotificationOutcome,
} from "./lead-notification";
import { getResendApiKey, sendResendEmail, type EmailDeliveryResult } from "./resend";
import {
  getSubscriptionTokenSecret,
  oneClickUnsubscribeUrl,
  subscriptionPageUrl,
} from "./subscription-token";

export const SAMPLE_REPORT_PDF_PATH = "/reports/sample-competitive-fee-position.pdf";
export const REPORT_REQUEST_PATH = "/for-institutions#report";

export interface LeadCaptureNotificationInput {
  email: string;
  placement: LeadCapturePlacement;
  institutionId: number | null;
  institutionName: string | null;
  stateCode: string | null;
}

function absolute(path: string) {
  return `${SITE_URL.replace(/\/$/, "")}${path}`;
}

/** What the visitor signed up for, in the words the placement offered it. */
export function describeCaptureOffer(input: LeadCaptureNotificationInput): string {
  if (deliversSampleReport(input.placement)) return `the sample ${REPORT_OFFER.name}`;
  const stateName = input.stateCode ? STATE_NAMES[input.stateCode] ?? input.stateCode : null;
  switch (input.placement) {
    case "institution_alerts":
      return `fee-change alerts for ${input.institutionName ?? "this institution"}`;
    case "state_benchmark":
      return `the ${stateName ?? "state"} fee benchmark`;
    case "national_index":
      return "the national fee index update";
  }
}

function deliveryLines(input: LeadCaptureNotificationInput): string[] {
  if (deliversSampleReport(input.placement)) {
    return [
      "Here is the sample report (PDF), prepared for a real ~$400M community bank with the client anonymized:",
      absolute(SAMPLE_REPORT_PDF_PATH),
    ];
  }
  switch (input.placement) {
    case "institution_alerts":
      return [
        "We'll email you when a verified change to this institution's published fee schedule lands in the index.",
        input.institutionId !== null ? `Current profile: ${absolute(`/institution/${input.institutionId}`)}` : "",
      ];
    case "state_benchmark":
      return [
        "We'll send the benchmark each time the state medians are refreshed.",
        input.stateCode ? `Current benchmark: ${absolute(`/research/state/${input.stateCode}`)}` : "",
      ];
    case "national_index":
      return [
        "New national medians, notable fee changes, and one chart — about once a month.",
        `Current index: ${absolute("/research/national-fee-index")}`,
      ];
  }
}

export function buildCaptureConfirmation(
  input: LeadCaptureNotificationInput,
  links: { confirmUrl: string | null; unsubscribeUrl: string | null },
): LeadEmailContent {
  const offer = describeCaptureOffer(input);
  const lines = [
    `Thanks for signing up for ${offer} from ${SITE_NAME}.`,
    "",
    ...deliveryLines(input).filter(Boolean),
    "",
    links.confirmUrl
      ? "Confirm your address with the button below so we can keep sending updates. If you didn't sign up, ignore this email and you won't hear from us again."
      : "If you didn't sign up, reply to this email and we'll remove you.",
    "",
    `Want this for your own institution and market? ${REPORT_OFFER_LINE}: ${absolute(REPORT_REQUEST_PATH)}`,
  ];
  if (links.unsubscribeUrl) lines.push("", `Unsubscribe: ${links.unsubscribeUrl}`);
  return {
    subject: `Confirm: ${offer}`,
    lines,
    cta: links.confirmUrl ? { label: "Confirm my email", href: links.confirmUrl } : undefined,
  };
}

function notificationContent(input: LeadCaptureNotificationInput): LeadEmailContent {
  const detail = [
    `Placement: ${input.placement}`,
    input.institutionId !== null
      ? `Institution: ${input.institutionName ?? "unnamed"} (${input.institutionId})`
      : null,
    input.stateCode ? `State: ${input.stateCode}` : null,
    `Email: ${input.email}`,
  ].filter((line): line is string => line !== null);
  return {
    subject: `New email capture (${input.placement}): ${input.email}`,
    lines: [`${input.email} signed up for ${describeCaptureOffer(input)}.`, "", ...detail],
    cta: { label: "Open /admin/leads", href: adminLeadsUrl() },
  };
}

/** Never throws; mirrors sendLeadNotificationPair's not_configured handling. */
export async function sendLeadCaptureNotifications(
  input: LeadCaptureNotificationInput,
): Promise<LeadNotificationOutcome> {
  const from = getLeadNotificationFromAddress();
  if (!getResendApiKey() || !from) {
    const result: EmailDeliveryResult = {
      status: "not_configured",
      reason: !getResendApiKey()
        ? "RESEND_API_KEY is not configured."
        : "No lead notification From address is configured.",
    };
    return { notification: result, confirmation: result };
  }

  const secret = getSubscriptionTokenSecret();
  const confirmUrl = secret ? subscriptionPageUrl("confirm", input.email, secret) : null;
  const unsubscribeUrl = secret ? subscriptionPageUrl("unsubscribe", input.email, secret) : null;
  const confirmation = buildCaptureConfirmation(input, { confirmUrl, unsubscribeUrl });
  const notification = notificationContent(input);

  const listHeaders: Record<string, string> = secret
    ? {
        "List-Unsubscribe": `<${oneClickUnsubscribeUrl(input.email, secret)}>, <mailto:${CONTACT_EMAIL}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : { "List-Unsubscribe": `<mailto:${CONTACT_EMAIL}?subject=unsubscribe>` };

  const [notificationResult, confirmationResult] = await Promise.all([
    sendResendEmail(
      {
        from,
        to: CONTACT_EMAIL,
        replyTo: input.email,
        subject: notification.subject,
        html: renderLeadEmailHtml(notification),
        text: renderLeadEmailText(notification),
      },
      "the capture notification",
    ),
    sendResendEmail(
      {
        from,
        to: input.email,
        replyTo: CONTACT_EMAIL,
        subject: confirmation.subject,
        html: renderLeadEmailHtml(confirmation),
        text: renderLeadEmailText(confirmation),
        headers: listHeaders,
      },
      "the capture confirmation",
    ),
  ]);

  return { notification: notificationResult, confirmation: confirmationResult };
}
