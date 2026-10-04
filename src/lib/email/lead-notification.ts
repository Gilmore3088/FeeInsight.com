/**
 * Shared plumbing for lead-driven notifications (report requests, contact form):
 * one message to the inbox behind CONTACT_EMAIL, one auto-reply to the requester.
 * Never throws; every branch resolves to a delivery result so the lead is stored
 * regardless of email health.
 */
import { CONTACT_EMAIL, SITE_NAME, SITE_URL } from "@/lib/constants";
import {
  escapeHtml,
  getResendApiKey,
  sendResendEmail,
  type EmailDeliveryResult,
} from "./resend";

export interface LeadNotificationOutcome {
  /** Internal heads-up delivered to CONTACT_EMAIL. */
  notification: EmailDeliveryResult;
  /** Auto-reply delivered to the person who submitted the form. */
  confirmation: EmailDeliveryResult;
}

export interface LeadEmailContent {
  subject: string;
  /** Plain-text lines; blank strings become paragraph breaks. */
  lines: string[];
  /** Optional call-to-action link rendered as a button in the HTML body. */
  cta?: { label: string; href: string };
}

const FROM_ENV_VARS = [
  "REPORT_REQUEST_EMAIL_FROM",
  "WORKSPACE_INVITE_EMAIL_FROM",
  "TRANSACTIONAL_EMAIL_FROM",
  "EMAIL_FROM",
] as const;

/** Used when no From env var is set, so only RESEND_API_KEY is required to send. */
export const DEFAULT_LEAD_FROM = `${SITE_NAME} <${CONTACT_EMAIL}>`;

const BARE_EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const NAME_THEN_BARE_EMAIL = /^(.*\S)\s+([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/;

/**
 * Resend accepts "email@domain" or "Name <email@domain>". A value typed as
 * "Fee Insight hello@domain" (brackets forgotten) is repaired instead of rejected.
 */
export function normalizeFromAddress(value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, "").trim();
  if (!trimmed || trimmed.includes("<") || BARE_EMAIL.test(trimmed)) return trimmed;
  const match = NAME_THEN_BARE_EMAIL.exec(trimmed);
  return match ? `${match[1]} <${match[2]}>` : trimmed;
}

export interface LeadEmailConfig {
  apiKeyConfigured: boolean;
  from: string;
  /** Env var the From address came from, or "default". */
  fromSource: (typeof FROM_ENV_VARS)[number] | "default";
}

export function describeLeadEmailConfig(): LeadEmailConfig {
  for (const name of FROM_ENV_VARS) {
    const value = (process.env[name] || "").trim();
    if (value) {
      return { apiKeyConfigured: Boolean(getResendApiKey()), from: normalizeFromAddress(value), fromSource: name };
    }
  }
  return { apiKeyConfigured: Boolean(getResendApiKey()), from: DEFAULT_LEAD_FROM, fromSource: "default" };
}

export function getLeadNotificationFromAddress() {
  return describeLeadEmailConfig().from;
}

export function adminLeadsUrl() {
  return `${SITE_URL.replace(/\/$/, "")}/admin/leads`;
}

export function renderLeadEmailHtml(content: LeadEmailContent) {
  const paragraphs = content.lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin: 0 0 16px; font-size: 15px; color: #1A1815;">${escapeHtml(block).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");
  const cta = content.cta
    ? `<p style="margin: 8px 0 22px;"><a href="${escapeHtml(content.cta.href)}" style="background: #C44B2E; color: #ffffff; padding: 11px 18px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px; display: inline-block;">${escapeHtml(content.cta.label)}</a></p>`
    : "";
  return `
    <div style="background: #FAF7F2; padding: 32px 16px; font-family: Georgia, 'Times New Roman', serif; color: #1A1815; line-height: 1.55;">
      <div style="max-width: 560px; margin: 0 auto; background: #FDFBF8; border: 1px solid #E0D7C9; border-radius: 8px; padding: 28px 28px 24px;">
        <p style="margin: 0 0 20px; font-size: 20px; font-weight: 500; letter-spacing: -0.01em; color: #1A1815;">${escapeHtml(content.subject)}</p>
        ${paragraphs}
        ${cta}
        <p style="margin: 0; padding-top: 16px; border-top: 1px solid #E0D7C9; color: #7A7062; font-size: 13px;">
          Fee Insight — ${escapeHtml(CONTACT_EMAIL)}
        </p>
      </div>
    </div>
  `;
}

export function renderLeadEmailText(content: LeadEmailContent) {
  const body = content.lines.join("\n");
  return content.cta ? `${body}\n\n${content.cta.label}: ${content.cta.href}` : body;
}

/**
 * Sends the internal notification and the requester auto-reply. Both share the
 * same not_configured guard so a missing From address is reported once per message.
 */
export async function sendLeadNotificationPair(input: {
  requesterEmail: string;
  notification: LeadEmailContent;
  confirmation: LeadEmailContent;
}): Promise<LeadNotificationOutcome> {
  const from = getLeadNotificationFromAddress();
  if (!getResendApiKey()) {
    const result: EmailDeliveryResult = {
      status: "not_configured",
      reason: "RESEND_API_KEY is not configured.",
    };
    return { notification: result, confirmation: result };
  }

  const [notification, confirmation] = await Promise.all([
    sendResendEmail(
      {
        from,
        to: CONTACT_EMAIL,
        replyTo: input.requesterEmail,
        subject: input.notification.subject,
        html: renderLeadEmailHtml(input.notification),
        text: renderLeadEmailText(input.notification),
      },
      "the lead notification",
    ),
    sendResendEmail(
      {
        from,
        to: input.requesterEmail,
        replyTo: CONTACT_EMAIL,
        subject: input.confirmation.subject,
        html: renderLeadEmailHtml(input.confirmation),
        text: renderLeadEmailText(input.confirmation),
      },
      "the confirmation email",
    ),
  ]);

  return { notification, confirmation };
}
