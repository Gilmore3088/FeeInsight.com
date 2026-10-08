/**
 * Email confirmation for accounts: a signed link proves the person holds the inbox, which
 * the account page needs before it shows reports bought with that email. Signup never
 * waits on it: the link is sent after the account exists, and nothing else is gated.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { CONTACT_EMAIL, SITE_NAME, SITE_URL } from "@/lib/constants";
import { sql } from "@/lib/data-store/connection";
import { getSubscriptionTokenSecret } from "./subscription-token";
import {
  getLeadNotificationFromAddress,
  renderLeadEmailHtml,
  renderLeadEmailText,
  type LeadEmailContent,
} from "./lead-notification";
import { sendResendEmail, type EmailDeliveryResult } from "./resend";

export const EMAIL_CONFIRM_PATH = "/confirm-email";
export const EMAIL_CONFIRM_LIFETIME_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^(\d{8})\.([A-Za-z0-9_-]{43})$/;

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function sign(secret: string, userId: number, email: string, issued: string): string {
  return createHmac("sha256", secret).update(`email-confirm:${userId}:${normalize(email)}:${issued}`).digest("base64url");
}

/** `<yyyymmdd>.<signature>` binding the user id, the address and the issue date. Null without a secret. */
export function createEmailConfirmToken(userId: number, email: string, now: Date = new Date(), secret = getSubscriptionTokenSecret()): string | null {
  if (!secret || !Number.isSafeInteger(userId) || userId <= 0 || !email.trim()) return null;
  const issued = ymd(now);
  return `${issued}.${sign(secret, userId, email, issued)}`;
}

export function verifyEmailConfirmToken(
  userId: number,
  email: string,
  token: string,
  now: Date = new Date(),
  secret = getSubscriptionTokenSecret(),
): boolean {
  const match = typeof token === "string" ? TOKEN_PATTERN.exec(token) : null;
  if (!secret || !match || !Number.isSafeInteger(userId) || userId <= 0) return false;
  const issued = match[1];
  const issuedAt = Date.parse(`${issued.slice(0, 4)}-${issued.slice(4, 6)}-${issued.slice(6, 8)}T00:00:00Z`);
  if (Number.isNaN(issuedAt) || issuedAt > now.getTime() + DAY_MS) return false;
  if (now.getTime() > issuedAt + EMAIL_CONFIRM_LIFETIME_DAYS * DAY_MS) return false;
  const expected = Buffer.from(sign(secret, userId, email, issued));
  const given = Buffer.from(match[2]);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function emailConfirmUrl(userId: number, email: string, token: string): string {
  const params = new URLSearchParams({ uid: String(userId), email: normalize(email), t: token });
  return `${SITE_URL.replace(/\/$/, "")}${EMAIL_CONFIRM_PATH}?${params.toString()}`;
}

export function buildEmailConfirmEmail(url: string): LeadEmailContent {
  return {
    subject: `Confirm your ${SITE_NAME} email`,
    lines: [
      "Hello,",
      "",
      `Confirm this is your email so your ${SITE_NAME} account can show the reports you buy and keep your alerts coming to the right inbox.`,
      "",
      url,
      "",
      `If you didn't make an account, ignore this email. Questions: ${CONTACT_EMAIL}.`,
    ],
    cta: { label: "Confirm my email", href: url },
  };
}

/** Sends the confirmation link. Never throws; a failed send is logged and reported. */
export async function sendEmailConfirmation(userId: number, email: string): Promise<EmailDeliveryResult> {
  try {
    const token = createEmailConfirmToken(userId, email);
    if (!token) return { status: "not_configured", reason: "no email token secret" };
    const content = buildEmailConfirmEmail(emailConfirmUrl(userId, email, token));
    const result = await sendResendEmail(
      {
        from: getLeadNotificationFromAddress(),
        to: normalize(email),
        replyTo: CONTACT_EMAIL,
        subject: content.subject,
        html: renderLeadEmailHtml(content),
        text: renderLeadEmailText(content),
      },
      "the email confirmation",
    );
    if (result.status !== "sent") {
      console.warn("[email-confirm] not delivered", {
        status: result.status,
        reason: result.status === "failed" ? result.error : result.reason,
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[email-confirm] send failed", message);
    return { status: "failed", error: message };
  }
}

/** Marks the address confirmed when it still belongs to the account. True when a row matched. */
export async function markEmailConfirmed(userId: number, email: string): Promise<boolean> {
  const rows = await sql<{ id: number }[]>`
    UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
     WHERE id = ${userId} AND lower(email) = ${normalize(email)}
     RETURNING id`;
  return rows.length > 0;
}

/** Whether the account's current email is confirmed. False when unknown. */
export async function isEmailConfirmed(userId: number): Promise<boolean> {
  try {
    const rows = await sql<{ confirmed: string | null }[]>`
      SELECT to_jsonb(u.*) ->> 'email_confirmed_at' AS confirmed FROM users u WHERE u.id = ${userId}`;
    return Boolean(rows[0]?.confirmed);
  } catch {
    return false;
  }
}
