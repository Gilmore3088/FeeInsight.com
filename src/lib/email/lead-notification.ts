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
import { RD } from "@/lib/report-design/tokens";

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
  /** Small label above the heading, e.g. "Your request". */
  eyebrow?: string;
  /** Heading shown in the email; the subject is used when absent. */
  heading?: string;
  /** Status shown as a coloured tag under the heading (James's emails). */
  status?: { label: string; tone: "good" | "warn" };
  /** Numbered "what happens next" steps after the body. */
  steps?: { title?: string; items: string[] };
  /** Lines shown after the steps and button, e.g. "Reply with questions" and the opt-in link. */
  closing?: string[];
  /** Signed by James (requester-facing emails). */
  signed?: boolean;
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

/** Email-safe inline colours, from the shared report look (src/lib/report-design/tokens.ts). */
const C = {
  ink: RD.ink,
  ink2: RD.ink2,
  text2: RD.inkSoft,
  muted: RD.muted,
  paper: RD.paper,
  cream: RD.cream,
  sand: RD.sand,
  terra: RD.terra,
  terraSoft: RD.terraSoft,
  good: RD.good,
  goodSoft: "#EEF2E8",
  line: RD.rule2,
};
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace";
const PARAGRAPH = `margin:0 0 16px;font-family:${SERIF};font-size:17px;line-height:1.6;color:${C.ink2};`;
const LINK = `color:${C.terra};text-decoration:underline;`;

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;
const TRAILING_LINK = /^([\s\S]*?):\s*(https?:\/\/\S+)$/;
const DETAIL_LINE = /^([A-Z][A-Za-z ]{0,24}):\s+(.+)$/;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Escapes text and turns bare URLs into links. */
function linkify(text: string): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    html += escapeHtml(text.slice(last, index));
    html += `<a href="${escapeHtml(match[0])}" style="${LINK}word-break:break-all;">${escapeHtml(match[0])}</a>`;
    last = index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

function detailValue(value: string): string {
  return EMAIL_VALUE.test(value)
    ? `<a href="mailto:${escapeHtml(value)}" style="${LINK}">${escapeHtml(value)}</a>`
    : linkify(value);
}

/** Two or more "Name: value" lines read as a details table. */
function renderDetails(lines: string[]): string | null {
  if (lines.length < 2) return null;
  const rows = lines.map((line) => DETAIL_LINE.exec(line));
  if (rows.some((row) => row === null)) return null;
  const cells = rows
    .map(
      (row) =>
        `<tr><td valign="top" width="34%" style="padding:10px 12px 10px 0;border-bottom:1px solid ${C.line};font-family:${MONO};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.text2};">${escapeHtml(row![1])}</td>` +
        `<td valign="top" style="padding:10px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:15px;line-height:1.45;color:${C.ink};">${detailValue(row![2])}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 24px;border-top:2px solid ${C.ink};border-collapse:collapse;">${cells}</table>`;
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
  const link = `<a href="${escapeHtml(match[2])}" style="${LINK}">${escapeHtml(label)}</a>`;
  return `<p style="${PARAGRAPH}">${lead ? `${escapeHtml(lead)} ` : ""}${link}.</p>`;
}

function renderBlock(block: string): string {
  return (
    renderDetails(block.split("\n")) ??
    renderTrailingLink(block) ??
    `<p style="${PARAGRAPH}">${linkify(block).replace(/\n/g, "<br />")}</p>`
  );
}

function renderStatus(status: NonNullable<LeadEmailContent["status"]>): string {
  const [background, color] = status.tone === "good" ? [C.goodSoft, C.good] : [C.terraSoft, C.terra];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;"><tr><td style="background:${background};border-left:3px solid ${color};padding:7px 12px;font-family:${MONO};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${color};">${escapeHtml(status.label)}</td></tr></table>`;
}

function renderSteps(steps: NonNullable<LeadEmailContent["steps"]>): string {
  const title = steps.title
    ? `<p style="margin:0 0 12px;font-family:${MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.terra};">${escapeHtml(steps.title)}</p>`
    : "";
  const rows = steps.items
    .map(
      (item, index) =>
        `<tr><td valign="top" style="width:28px;padding:0 0 10px;font-family:${MONO};font-size:13px;line-height:1.55;color:${C.terra};">${index + 1}.</td><td style="padding:0 0 10px;font-family:${SERIF};font-size:16px;line-height:1.55;color:${C.ink2};">${linkify(item)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 18px;"><tr><td style="background:${C.cream};border-left:4px solid ${C.terra};padding:16px 18px 6px;">${title}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table></td></tr></table>`;
}

/** Headings never leave one word alone on the last line (CLAUDE.md), even in clients without text-wrap. */
function keepLastWordsTogether(html: string): string {
  const index = html.lastIndexOf(" ");
  return index > 0 ? `${html.slice(0, index)}&nbsp;${html.slice(index + 1)}` : html;
}

function toBlocks(lines: string[] | undefined): string[] {
  return (lines ?? [])
    .join("\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function renderLeadEmailHtml(content: LeadEmailContent) {
  const blocks = toBlocks(content.lines);
  const closing = toBlocks(content.closing);
  const preheader = blocks[0]?.split("\n")[0] ?? "";
  const site = SITE_URL.replace(/\/$/, "");
  const eyebrow = content.eyebrow
    ? `<p style="margin:0 0 8px;font-family:${MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.terra};">${escapeHtml(content.eyebrow)}</p>`
    : "";
  const cta = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="background:${C.terra};border-radius:3px;"><a href="${escapeHtml(content.cta.href)}" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${escapeHtml(content.cta.label)} &rarr;</a></td></tr></table>`
    : "";
  const signature = content.signed
    ? `<p style="${PARAGRAPH}margin-top:22px;">James Gilmore<br /><span style="font-family:${SANS};font-size:13px;color:${C.text2};">Founder, ${escapeHtml(SITE_NAME)}</span></p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.sand};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.sand};">${escapeHtml(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.sand};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:${C.paper};">
<tr><td style="padding:22px 32px 16px;border-bottom:2px solid ${C.ink};"><a href="${escapeHtml(site)}" style="font-family:${SERIF};font-size:20px;color:${C.ink};text-decoration:none;">${escapeHtml(SITE_NAME)}</a></td></tr>
<tr><td style="padding:30px 32px 10px;">
${eyebrow}
<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:28px;line-height:1.2;font-weight:normal;color:${C.ink};text-wrap:balance;">${keepLastWordsTogether(escapeHtml(content.heading ?? content.subject))}</h1>
${content.status ? renderStatus(content.status) : ""}
${blocks.map(renderBlock).join("\n")}
${content.steps ? renderSteps(content.steps) : ""}
${cta}
${closing.map(renderBlock).join("\n")}
${signature}
</td></tr>
<tr><td style="padding:20px 32px 26px;background:${C.cream};border-top:1px solid ${C.line};">
<p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};"><strong style="color:${C.ink2};">${escapeHtml(SITE_NAME)}</strong> publishes the ${escapeHtml(PRODUCT_NAME)}, built from U.S. banks' and credit unions' own published fee schedules.</p>
<p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};">Questions? Just reply, or write to <a href="mailto:${escapeHtml(CONTACT_EMAIL)}" style="color:${C.text2};">${escapeHtml(CONTACT_EMAIL)}</a> &middot; <a href="${escapeHtml(site)}" style="color:${C.text2};">${escapeHtml(SITE_DOMAIN)}</a></p>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

export function renderLeadEmailText(content: LeadEmailContent) {
  const steps = content.steps
    ? [
        "",
        ...(content.steps.title ? [content.steps.title] : []),
        ...content.steps.items.map((item, index) => `${index + 1}. ${item}`),
      ]
    : [];
  const status = content.status ? [content.status.label, ""] : [];
  const signature = content.signed ? ["", "James Gilmore", `Founder, ${SITE_NAME}`] : [];
  const cta = content.cta ? ["", `${content.cta.label}: ${content.cta.href}`] : [];
  const closing = content.closing?.length ? ["", ...content.closing] : [];
  return [...status, ...content.lines, ...steps, ...cta, ...closing, ...signature].join("\n");
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
