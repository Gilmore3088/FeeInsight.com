import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Private links for automatic reports: /market-report/<id>-<yyyymmdd>-<signature>.
 * The signature (HMAC-SHA256 with CUSTOM_REPORT_LINK_SECRET) makes the link unguessable;
 * a link resolves for LINK_LIFETIME_DAYS after it was issued. No secret, no links.
 */
export const LINK_LIFETIME_DAYS = 90;
const TOKEN_PATTERN = /^(\d{1,10})-(\d{8})-([0-9a-f]{24})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function secret(): string | null {
  return process.env.CUSTOM_REPORT_LINK_SECRET || null;
}

export function isReportLinkConfigured(): boolean {
  return secret() !== null;
}

function sign(key: string, institutionId: number, issued: string): string {
  return createHmac("sha256", key).update(`custom-report:${institutionId}:${issued}`).digest("hex").slice(0, 24);
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function parseYmd(value: string): Date | null {
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function createReportToken(institutionId: number, now: Date = new Date()): string | null {
  const key = secret();
  if (!key || !Number.isInteger(institutionId) || institutionId <= 0) return null;
  const issued = ymd(now);
  return `${institutionId}-${issued}-${sign(key, institutionId, issued)}`;
}

export interface VerifiedReportToken {
  institutionId: number;
  issuedOn: Date;
  expiresOn: Date;
}

export function verifyReportToken(token: string, now: Date = new Date()): VerifiedReportToken | null {
  const key = secret();
  const match = typeof token === "string" ? TOKEN_PATTERN.exec(token) : null;
  if (!key || !match) return null;
  const institutionId = Number(match[1]);
  const issuedOn = parseYmd(match[2]);
  if (!issuedOn || issuedOn.getTime() > now.getTime() + DAY_MS) return null;
  const expected = Buffer.from(sign(key, institutionId, match[2]));
  const given = Buffer.from(match[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresOn = new Date(issuedOn.getTime() + LINK_LIFETIME_DAYS * DAY_MS);
  if (now.getTime() > expiresOn.getTime()) return null;
  return { institutionId, issuedOn, expiresOn };
}

export function reportPath(token: string): string {
  return `/market-report/${token}`;
}
