/**
 * The password-reset email. Never throws: a failed send is logged and the request page
 * still shows its usual message, so it never reveals whether an account exists.
 */
import { CONTACT_EMAIL, SITE_NAME, SITE_URL } from "@/lib/constants";
import {
  getLeadNotificationFromAddress,
  renderLeadEmailHtml,
  renderLeadEmailText,
  type LeadEmailContent,
} from "./lead-notification";
import { sendResendEmail, type EmailDeliveryResult } from "./resend";

export function passwordResetUrl(token: string): string {
  return `${SITE_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
}

export function buildPasswordResetEmail(token: string): LeadEmailContent {
  const url = passwordResetUrl(token);
  return {
    subject: `Reset your ${SITE_NAME} password`,
    lines: [
      "Hello,",
      "",
      `Someone asked to reset the password on your ${SITE_NAME} account. Use the link below within the next hour to choose a new one.`,
      "",
      url,
      "",
      `If you didn't ask for this, ignore this email; your password stays the same. Questions: ${CONTACT_EMAIL}.`,
    ],
    cta: { label: "Choose a new password", href: url },
  };
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<EmailDeliveryResult> {
  const content = buildPasswordResetEmail(token);
  try {
    const result = await sendResendEmail(
      {
        from: getLeadNotificationFromAddress(),
        to: email,
        replyTo: CONTACT_EMAIL,
        subject: content.subject,
        html: renderLeadEmailHtml(content),
        text: renderLeadEmailText(content),
      },
      "the password reset email",
    );
    if (result.status !== "sent") {
      console.warn("[password-reset] not delivered", {
        status: result.status,
        reason: result.status === "failed" ? result.error : result.reason,
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[password-reset] send failed", message);
    return { status: "failed", error: message };
  }
}
