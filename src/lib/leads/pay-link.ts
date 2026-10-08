import { createHmac, timingSafeEqual } from "node:crypto";
import { PAY_LINK_LIFETIME_DAYS } from "./report-payment";

/**
 * Private pay link for a quoted institution report: /pay/report/<lead id>-<yyyymmdd>-<signature>.
 * The link names the request only: the price is read from leads.quote_amount_cents when
 * checkout starts, never from the link. Signed with CUSTOM_REPORT_LINK_SECRET, like the
 * private report links; no secret, no links.
 */
const TOKEN_PATTERN = /^(\d{1,12})-(\d{8})-([0-9a-f]{24})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function secret(): string | null {
  return process.env.CUSTOM_REPORT_LINK_SECRET || null;
}

function sign(key: string, leadId: number, issued: string): string {
  return createHmac("sha256", key).update(`report-pay:${leadId}:${issued}`).digest("hex").slice(0, 24);
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

export function createPayToken(leadId: number, now: Date = new Date()): string | null {
  const key = secret();
  if (!key || !Number.isSafeInteger(leadId) || leadId <= 0) return null;
  const issued = ymd(now);
  return `${leadId}-${issued}-${sign(key, leadId, issued)}`;
}

export function verifyPayToken(token: string, now: Date = new Date()): { leadId: number; expiresOn: Date } | null {
  const key = secret();
  const match = typeof token === "string" ? TOKEN_PATTERN.exec(token) : null;
  if (!key || !match) return null;
  const leadId = Number(match[1]);
  const issuedOn = new Date(`${match[2].slice(0, 4)}-${match[2].slice(4, 6)}-${match[2].slice(6, 8)}T00:00:00Z`);
  if (!Number.isSafeInteger(leadId) || Number.isNaN(issuedOn.getTime())) return null;
  if (issuedOn.getTime() > now.getTime() + DAY_MS) return null;
  const expected = Buffer.from(sign(key, leadId, match[2]));
  const given = Buffer.from(match[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresOn = new Date(issuedOn.getTime() + PAY_LINK_LIFETIME_DAYS * DAY_MS);
  if (now.getTime() > expiresOn.getTime()) return null;
  return { leadId, expiresOn };
}

export function payPath(token: string): string {
  return `/pay/report/${token}`;
}


/** True for a genuine pay link that has run out, so the page can say so instead of a 404. */
export function isExpiredPayToken(token: string, now: Date = new Date()): boolean {
  if (verifyPayToken(token, now)) return false;
  const match = typeof token === "string" ? TOKEN_PATTERN.exec(token) : null;
  if (!match) return false;
  const issuedOn = new Date(`${match[2].slice(0, 4)}-${match[2].slice(4, 6)}-${match[2].slice(6, 8)}T00:00:00Z`);
  return !Number.isNaN(issuedOn.getTime()) && verifyPayToken(token, issuedOn) !== null;
}
