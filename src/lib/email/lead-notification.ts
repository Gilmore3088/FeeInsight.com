/**
 * Shared plumbing for lead-driven notifications (report requests, contact form):
 * one message to the inbox behind CONTACT_EMAIL, one auto-reply to the requester.
 * Never throws; every branch resolves to a delivery result so the lead is stored
 * regardless of email health.
 */
import { CONTACT_EMAIL, PRODUCT_NAME, SITE_DOMAIN, SITE_NAME, SITE_URL } from "@/lib/constants";
import {
  escapeHtml,
  getResendApiKey,
  sendResendEmail,
  type EmailDeliveryResult,
} from "./resend";
import { getSubscriptionTokenSecret, subscriptionPageUrl } from "./subscription-token";

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

const EMAIL_INK = "#1A1815";
const EMAIL_MUTED = "#7A7062";
const EMAIL_RULE = "#E0D7C9";
const EMAIL_ACCENT = "#C44B2E";
const EMAIL_SERIF = "Georgia, 'Times New Roman', serif";
const EMAIL_SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;
const TRAILING_LINK = /^([\s\S]*?):\s*(https?:\/\/\S+)$/;
const DETAIL_LINE = /^([A-Z][A-Za-z ]{0,24}):\s+(.+)$/;

/** Escapes text and turns bare URLs into links. */
function linkify(text: string): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    html += escapeHtml(text.slice(last, index));
    html += `<a href="${escapeHtml(match[0])}" style="color: ${EMAIL_ACCENT}; text-decoration: underline; word-break: break-all;">${escapeHtml(match[0])}</a>`;
    last = index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

/** "Name: value" lines (two or more) read as a details table, as in James's request emails. */
function renderDetails(lines: string[]): string | null {
  if (lines.length < 2) return null;
  const rows = lines.map((line) => DETAIL_LINE.exec(line));
  if (rows.some((row) => row === null)) return null;
  const cells = rows
    .map(
      (row) =>
        `<tr><td style="padding: 6px 12px 6px 0; vertical-align: top; white-space: nowrap; font-family: ${EMAIL_SANS}; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: ${EMAIL_MUTED};">${escapeHtml(row![1])}</td>` +
        `<td style="padding: 6px 0; vertical-align: top; font-size: 15px; color: ${EMAIL_INK};">${linkify(row![2])}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 18px; border-top: 1px solid ${EMAIL_RULE}; border-bottom: 1px solid ${EMAIL_RULE};">${cells}</table>`;
}

/**
 * A block ending in "...: <url>" reads better as its words plus a link named for its last
 * sentence ("Confirm your address: https://..." becomes a "Confirm your address" link).
 */
function renderTrailingLink(block: string): string | null {
  if (block.includes("\n")) return null;
  const match = TRAILING_LINK.exec(block);
  if (!match) return null;
  const words = match[1].trim();
  const sentenceBreak = Math.max(words.lastIndexOf(". "), words.lastIndexOf("? "), words.lastIndexOf("! "));
  const lead = sentenceBreak >= 0 ? words.slice(0, sentenceBreak + 1) : "";
  const label = sentenceBreak >= 0 ? words.slice(sentenceBreak + 2) : words;
  const link = `<a href="${escapeHtml(match[2])}" style="color: ${EMAIL_ACCENT}; font-weight: 600; text-decoration: underline;">${escapeHtml(label)}</a>`;
  return `<p style="margin: 0 0 16px; font-size: 15px; color: ${EMAIL_INK};">${lead ? `${escapeHtml(lead)} ` : ""}${link}</p>`;
}

function renderBlock(block: string): string {
  return (
    renderDetails(block.split("\n")) ??
    renderTrailingLink(block) ??
    `<p style="margin: 0 0 16px; font-size: 15px; color: ${EMAIL_INK};">${linkify(block).replace(/\n/g, "<br />")}</p>`
  );
}

export function renderLeadEmailHtml(content: LeadEmailContent) {
  const blocks = content.lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const preheader = blocks[0]?.split("\n")[0] ?? "";
  const cta = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 6px 0 22px;"><tr><td style="background: ${EMAIL_ACCENT}; border-radius: 6px;"><a href="${escapeHtml(content.cta.href)}" style="display: inline-block; padding: 12px 20px; font-family: ${EMAIL_SANS}; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none;">${escapeHtml(content.cta.label)}</a></td></tr></table>`
    : "";
  const site = SITE_URL.replace(/\/$/, "");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(content.subject)}</title>
  </head>
  <body style="margin: 0; padding: 0; background: #FAF7F2;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #FAF7F2;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 560px; font-family: ${EMAIL_SERIF}; color: ${EMAIL_INK}; line-height: 1.55;">
            <tr>
              <td style="padding: 0 4px 14px;">
                <a href="${escapeHtml(site)}" style="font-family: ${EMAIL_SERIF}; font-size: 19px; font-weight: 600; letter-spacing: -0.01em; color: ${EMAIL_INK}; text-decoration: none;">${escapeHtml(SITE_NAME)}</a>
                <span style="font-family: ${EMAIL_SANS}; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: ${EMAIL_MUTED};">&nbsp;&nbsp;${escapeHtml(PRODUCT_NAME)}</span>
              </td>
            </tr>
            <tr>
              <td style="background: #FFFFFF; border: 1px solid ${EMAIL_RULE}; border-top: 3px solid ${EMAIL_ACCENT}; border-radius: 8px; padding: 30px 30px 14px;">
                <h1 style="margin: 0 0 20px; font-family: ${EMAIL_SERIF}; font-size: 22px; font-weight: 500; line-height: 1.3; letter-spacing: -0.01em; color: ${EMAIL_INK};">${escapeHtml(content.subject)}</h1>
                ${blocks.map(renderBlock).join("\n                ")}
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 4px 0; font-family: ${EMAIL_SANS}; font-size: 12px; line-height: 1.6; color: ${EMAIL_MUTED};">
                ${escapeHtml(SITE_NAME)}, home of the ${escapeHtml(PRODUCT_NAME)}. Live fee schedules from U.S. banks and credit unions.<br />
                <a href="${escapeHtml(site)}" style="color: ${EMAIL_MUTED}; text-decoration: underline;">${escapeHtml(SITE_DOMAIN)}</a> &middot; <a href="mailto:${escapeHtml(CONTACT_EMAIL)}" style="color: ${EMAIL_MUTED}; text-decoration: underline;">${escapeHtml(CONTACT_EMAIL)}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderLeadEmailText(content: LeadEmailContent) {
  const body = content.lines.join("\n");
  return content.cta ? `${body}\n\n${content.cta.label}: ${content.cta.href}` : body;
}

/**
 * Sends the internal notification and the requester auto-reply. Both share the
 * same not_configured guard so a missing From address is reported once per message.
 */
/**
 * Opt-in lines for a request confirmation. A request is not consent to email, so the
 * requester joins the email list (and MailerLite) only after clicking this confirm link.
 */
export function emailOptInLines(email: string): string[] {
  const secret = getSubscriptionTokenSecret();
  if (!secret) return [];
  return ["", `Want ${SITE_NAME}'s fee updates by email? Confirm your address: ${subscriptionPageUrl("confirm", email, secret)}`];
}

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
