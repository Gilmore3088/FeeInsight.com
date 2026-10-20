import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Private links for automatic reports, signed (HMAC-SHA256 with CUSTOM_REPORT_LINK_SECRET) so
 * they are unguessable. A link resolves for LINK_LIFETIME_DAYS after it was issued. No secret,
 * no links.
 *
 * - Purchase link: /market-report/<id>-<yyyymmdd>-p<purchaseId>-<signature>. It names the paid
 *   request (leads row) it was issued for, so a refund closes that buyer's link alone
 *   (link-access.ts checks the payment is still live). Every link sent to a buyer is one of these
 *   (James, 2026-10-20; #2000).
 * - Bank link: /market-report/<id>-<yyyymmdd>-<signature>. One link per bank and day, kept for
 *   James's pre-quote preview and for links already sent, which keep working until they expire.
 */
export const LINK_LIFETIME_DAYS = 90;
const TOKEN_PATTERN = /^(\d{1,10})-(\d{8})-(?:p(\d{1,12})-)?([0-9a-f]{24})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function secret(): string | null {
  return process.env.CUSTOM_REPORT_LINK_SECRET || null;
}

function isPositiveId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

// The purchase payload starts with a word, the bank payload with a digit, so one signature can
// never pass for the other kind of link.
function sign(key: string, institutionId: number, issued: string, purchaseId: number | null): string {
  const payload = purchaseId === null
    ? `custom-report:${institutionId}:${issued}`
    : `custom-report:purchase:${purchaseId}:${institutionId}:${issued}`;
  return createHmac("sha256", key).update(payload).digest("hex").slice(0, 24);
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function parseYmd(value: string): Date | null {
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A bank link: only for James's pre-quote preview. Links for buyers use createPurchaseReportToken. */
export function createReportToken(institutionId: number, now: Date = new Date()): string | null {
  const key = secret();
  if (!key || !isPositiveId(institutionId)) return null;
  const issued = ymd(now);
  return `${institutionId}-${issued}-${sign(key, institutionId, issued, null)}`;
}

/** A buyer's link, tied to the paid request (leads.id) it was issued for. */
export function createPurchaseReportToken(institutionId: number, purchaseId: number, now: Date = new Date()): string | null {
  const key = secret();
  if (!key || !isPositiveId(institutionId) || !isPositiveId(purchaseId)) return null;
  const issued = ymd(now);
  return `${institutionId}-${issued}-p${purchaseId}-${sign(key, institutionId, issued, purchaseId)}`;
}

export interface VerifiedReportToken {
  institutionId: number;
  /** The paid request the link was issued for; null for a bank link. */
  purchaseId: number | null;
  issuedOn: Date;
  expiresOn: Date;
}

export function verifyReportToken(token: string, now: Date = new Date()): VerifiedReportToken | null {
  const key = secret();
  const match = typeof token === "string" ? TOKEN_PATTERN.exec(token) : null;
  if (!key || !match) return null;
  const institutionId = Number(match[1]);
  const purchaseId = match[3] === undefined ? null : Number(match[3]);
  if (purchaseId !== null && !isPositiveId(purchaseId)) return null;
  const issuedOn = parseYmd(match[2]);
  if (!issuedOn || issuedOn.getTime() > now.getTime() + DAY_MS) return null;
  const expected = Buffer.from(sign(key, institutionId, match[2], purchaseId));
  const given = Buffer.from(match[4]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresOn = new Date(issuedOn.getTime() + LINK_LIFETIME_DAYS * DAY_MS);
  if (now.getTime() > expiresOn.getTime()) return null;
  return { institutionId, purchaseId, issuedOn, expiresOn };
}

export function reportPath(token: string): string {
  return `/market-report/${token}`;
}
