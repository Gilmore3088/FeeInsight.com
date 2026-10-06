/**
 * The email a new Pro subscriber gets once Stripe confirms checkout. Sent after the
 * webhook's transaction commits, once per checkout (Stripe events are deduplicated),
 * and never throws: a failed send is logged, James is alerted, and the subscription stands.
 */
import { CONTACT_EMAIL, HAMILTON_CANONICAL, SITE_NAME, SITE_URL } from "@/lib/constants";
import {
  getLeadNotificationFromAddress,
  renderLeadEmailHtml,
  renderLeadEmailText,
  type LeadEmailContent,
} from "./lead-notification";
import { sendLeadAlert } from "@/lib/leads/lead-alerts";
import { sendResendEmail, type EmailDeliveryResult } from "./resend";

function absolute(path: string) {
  return `${SITE_URL.replace(/\/$/, "")}${path}`;
}

export function buildProWelcomeEmail(name: string | null): LeadEmailContent {
  return {
    subject: `Welcome to ${SITE_NAME} Pro`,
    lines: [
      name ? `Hi ${name},` : "Hello,",
      "",
      `Your ${SITE_NAME} Pro access is active.`,
      "",
      HAMILTON_CANONICAL,
      "",
      `Start in Hamilton: ${absolute("/pro/hamilton")}`,
      "",
      `Your account, billing and invoices: ${absolute("/account")}`,
      "",
      `Questions or something that doesn't look right? Reply to this email or write to ${CONTACT_EMAIL}; a person reads every message.`,
    ],
    cta: { label: "Open Hamilton", href: absolute("/pro/hamilton") },
  };
}

export async function sendProWelcomeEmail(input: { email: string; name: string | null }): Promise<EmailDeliveryResult> {
  const content = buildProWelcomeEmail(input.name);
  try {
    const result = await sendResendEmail(
      {
        from: getLeadNotificationFromAddress(),
        to: input.email,
        replyTo: CONTACT_EMAIL,
        subject: content.subject,
        html: renderLeadEmailHtml(content),
        text: renderLeadEmailText(content),
      },
      "the Pro welcome email",
    );
    if (result.status !== "sent") {
      const reason = result.status === "failed" ? result.error : result.reason;
      console.warn("[pro-welcome] not delivered", { status: result.status, reason });
      await alertWelcomeFailed(input, reason);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[pro-welcome] send failed", message);
    await alertWelcomeFailed(input, message);
    return { status: "failed", error: message };
  }
}

/** No silent failures: a new Pro subscriber without a welcome email is a lead James must answer. */
async function alertWelcomeFailed(input: { email: string; name: string | null }, reason: string) {
  try {
    await sendLeadAlert({
      subject: `Pro welcome email failed: ${input.email}`,
      lines: [
        `${input.name ?? input.email} just subscribed to Pro, but their welcome email did not go out.`,
        "",
        `Reason: ${reason}`,
        "",
        "Their account is active. Reply to them directly.",
      ],
    });
  } catch (error) {
    console.error("[pro-welcome] alert failed", error instanceof Error ? error.message : String(error));
  }
}
