/**
 * Emails behind the contextual capture placements (institution, state, national
 * index, sample report). The requester gets a double-opt-in confirmation that
 * also delivers the offer they asked for; the inbox behind CONTACT_EMAIL gets a
 * heads-up. Storage happens first in /api/leads; this only reports delivery.
 */
import { CONTACT_EMAIL, REPORT_OFFER, SITE_NAME, SITE_URL } from "@/lib/constants";
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
import { REPORT_SHOWCASE } from "@/lib/report-showcase";

export const SAMPLE_REPORT_PDF_PATH = REPORT_SHOWCASE.pdfHref;
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

/** Readers with a state also get that state's monthly edition (the marketing agent's state_edition). */
function stateEditionLine(stateCode: string | null): string {
  const name = stateCode ? STATE_NAMES[stateCode] ?? stateCode : null;
  return name
    ? `Each month you'll also get the ${name} edition by email, once enough ${name} institutions publish their fees.`
    : "";
}

/** What the reader receives, said briefly; each entry is its own paragraph. */
function deliveryLines(input: LeadCaptureNotificationInput): string[] {
  if (deliversSampleReport(input.placement)) {
    return [`Open the sample report: ${absolute(REPORT_SHOWCASE.sampleHref)}`];
  }
  switch (input.placement) {
    case "institution_alerts":
      return [
        `Fee-change alerts go to free accounts. Create one and follow this institution to get an email when its published fee schedule changes: ${absolute(input.institutionId !== null ? `/register?from=${encodeURIComponent(`/institution/${input.institutionId}`)}` : "/register")}`,
        input.institutionId !== null ? `Current profile: ${absolute(`/institution/${input.institutionId}`)}` : "",
      ];
    case "state_benchmark": {
      const name = input.stateCode ? STATE_NAMES[input.stateCode] ?? input.stateCode : "your state";
      return [
        input.stateCode
          ? `The ${name} benchmark puts the state's fee medians next to the national ones and updates as new fee schedules are verified. Open the ${name} benchmark: ${absolute(`/research/state/${input.stateCode}`)}`
          : "",
        stateEditionLine(input.stateCode),
      ];
    }
    case "national_index":
      return [
        `You'll get new national medians and one table worth bringing to a pricing meeting, no more than once a month. Open the current index: ${absolute("/research/national-fee-index")}`,
        stateEditionLine(input.stateCode),
      ];
  }
}

/**
 * The double opt-in email: the confirm button comes first, then a short note on what the
 * reader receives. It sells nothing; the lifecycle emails that follow confirmation do that.
 */
export function buildCaptureConfirmation(
  input: LeadCaptureNotificationInput,
  links: { confirmUrl: string | null; unsubscribeUrl: string | null },
): LeadEmailContent {
  const offer = describeCaptureOffer(input);
  const closing = [
    ...deliveryLines(input).filter(Boolean).flatMap((line) => [line, ""]),
    links.confirmUrl
      ? "Didn't sign up? Ignore this email and you won't hear from us again."
      : "Didn't sign up? Reply to this email and we'll remove you.",
  ];
  if (links.unsubscribeUrl) closing.push("", `Unsubscribe: ${links.unsubscribeUrl}`);
  // Confirming does not switch on fee-change alerts (those need a free account), so that
  // placement asks the reader to follow the institution instead of promising alerts.
  const alerts = input.placement === "institution_alerts";
  const followed = input.institutionName ?? "this institution";
  const ask = alerts
    ? `Confirm your address to follow ${followed} on ${SITE_NAME}. Alerts when its fee schedule changes need a free account (link below).`
    : `Confirm your address to get ${offer} from ${SITE_NAME}.`;
  return {
    subject: alerts ? `Confirm your email to follow ${followed}` : `Confirm your email for ${offer}`,
    heading: "Confirm your email",
    lines: [links.confirmUrl ? ask : `Thanks for signing up for ${offer} from ${SITE_NAME}.`],
    cta: links.confirmUrl ? { label: "Confirm my email", href: links.confirmUrl } : undefined,
    closing,
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
  if (!getResendApiKey()) {
    const result: EmailDeliveryResult = {
      status: "not_configured",
      reason: "RESEND_API_KEY is not configured.",
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
