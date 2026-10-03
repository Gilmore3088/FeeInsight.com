/**
 * One-off delivery check for the lead email path, run from /admin/leads. Uses the
 * same API key and From address as real lead emails, so a pass here means signups
 * will get their confirmation.
 */
import { CONTACT_EMAIL } from "@/lib/constants";
import { describeLeadEmailConfig, renderLeadEmailHtml, renderLeadEmailText } from "./lead-notification";
import { sendResendEmail, type EmailDeliveryResult } from "./resend";

export interface LeadEmailTestResult {
  from: string;
  to: string;
  result: EmailDeliveryResult;
}

export async function sendLeadTestEmail(to: string): Promise<LeadEmailTestResult> {
  const config = describeLeadEmailConfig();
  if (!config.apiKeyConfigured) {
    return {
      from: config.from,
      to,
      result: { status: "not_configured", reason: "RESEND_API_KEY is not configured." },
    };
  }
  const content = {
    subject: "Fee Insight lead email test",
    lines: [
      "This is a test from /admin/leads. If you are reading it, signup confirmations will be delivered.",
      "",
      `Sent from: ${config.from}`,
    ],
  };
  const result = await sendResendEmail(
    {
      from: config.from,
      to,
      replyTo: CONTACT_EMAIL,
      subject: content.subject,
      html: renderLeadEmailHtml(content),
      text: renderLeadEmailText(content),
    },
    "the test email",
  );
  return { from: config.from, to, result };
}
