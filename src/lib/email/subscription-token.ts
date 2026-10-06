/**
 * Signed, stateless links for email confirmation (double opt-in) and unsubscribe.
 * The token is an HMAC of `action:email`, so a link only works for the address it
 * was sent to and cannot be forged or replayed against another address.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { SITE_URL } from "@/lib/constants";

export type SubscriptionAction = "confirm" | "unsubscribe";

export const SUBSCRIPTION_ACTIONS: readonly SubscriptionAction[] = ["confirm", "unsubscribe"];

import {
  EMAIL_PREFERENCES_PATH,
  FEE_ALERT_UNSUBSCRIBE_ACTION,
  FEE_ALERT_UNSUBSCRIBE_API_PATH,
  SUBSCRIPTION_API_PATH,
} from "./subscription-paths";

export { EMAIL_PREFERENCES_PATH, FEE_ALERT_UNSUBSCRIBE_ACTION, FEE_ALERT_UNSUBSCRIBE_API_PATH, SUBSCRIPTION_API_PATH };

export function isSubscriptionAction(value: unknown): value is SubscriptionAction {
  return value === "confirm" || value === "unsubscribe";
}

/** Dedicated secret first; the session cookie secret keeps links working without new config. */
export function getSubscriptionTokenSecret() {
  return (process.env.LEAD_EMAIL_TOKEN_SECRET || process.env.BFI_COOKIE_SECRET || "").trim();
}

export function normalizeSubscriptionEmail(email: string) {
  return email.trim().toLowerCase();
}

function sign(action: string, subject: string, secret: string) {
  return createHmac("sha256", secret).update(`${action}:${subject}`).digest("base64url");
}

function safeEqual(expected: string, token: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signSubscriptionToken(action: SubscriptionAction, email: string, secret: string) {
  return sign(action, normalizeSubscriptionEmail(email), secret);
}

export function verifySubscriptionToken(
  action: SubscriptionAction,
  email: string,
  token: string,
  secret: string,
): boolean {
  if (!secret || !token) return false;
  return safeEqual(signSubscriptionToken(action, email, secret), token);
}

/**
 * Fee-change alerts belong to an account, not a lead, so their unsubscribe link signs the
 * user id together with the address. The action is deliberately not a SubscriptionAction:
 * /api/leads/subscription rejects it, and /api/alerts/unsubscribe accepts only it.
 */

function feeAlertSubject(userId: number, email: string) {
  return `${userId}:${normalizeSubscriptionEmail(email)}`;
}

export function signFeeAlertUnsubscribeToken(userId: number, email: string, secret: string) {
  return sign(FEE_ALERT_UNSUBSCRIBE_ACTION, feeAlertSubject(userId, email), secret);
}

export function verifyFeeAlertUnsubscribeToken(userId: number, email: string, token: string, secret: string): boolean {
  if (!secret || !token || !Number.isInteger(userId) || userId <= 0) return false;
  return safeEqual(signFeeAlertUnsubscribeToken(userId, email, secret), token);
}

/** The page link (a button, so prefetching scanners change nothing) and the RFC 8058 target. */
export function feeAlertUnsubscribeUrls(userId: number, email: string, secret: string): { page: string; oneClick: string } {
  const query = new URLSearchParams({
    action: FEE_ALERT_UNSUBSCRIBE_ACTION,
    uid: String(userId),
    email: normalizeSubscriptionEmail(email),
    token: signFeeAlertUnsubscribeToken(userId, email, secret),
  }).toString();
  return {
    page: `${siteBase()}${EMAIL_PREFERENCES_PATH}?${query}`,
    oneClick: `${siteBase()}${FEE_ALERT_UNSUBSCRIBE_API_PATH}?${query}`,
  };
}

function siteBase() {
  return SITE_URL.replace(/\/$/, "");
}

function linkQuery(action: SubscriptionAction, email: string, secret: string) {
  return new URLSearchParams({
    action,
    email: normalizeSubscriptionEmail(email),
    token: signSubscriptionToken(action, email, secret),
  }).toString();
}

/** Human-facing page: shows a button, so mail scanners that prefetch GETs change nothing. */
export function subscriptionPageUrl(action: SubscriptionAction, email: string, secret: string) {
  return `${siteBase()}${EMAIL_PREFERENCES_PATH}?${linkQuery(action, email, secret)}`;
}

/** RFC 8058 one-click target for the List-Unsubscribe header (mail clients POST here). */
export function oneClickUnsubscribeUrl(email: string, secret: string) {
  return `${siteBase()}${SUBSCRIPTION_API_PATH}?${linkQuery("unsubscribe", email, secret)}`;
}

/**
 * The "known reader" cookie, set when someone confirms their address. It carries the
 * address and an HMAC of it, so a free report form can skip asking for the email again.
 * Server-only (httpOnly): the browser can't read it, and /api/leads/reader checks it.
 */
export const READER_COOKIE = "fi_reader";
export const READER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const READER_ACTION = "reader";

export function signReaderCookie(email: string, secret: string): string {
  const normalized = normalizeSubscriptionEmail(email);
  return `${Buffer.from(normalized).toString("base64url")}.${sign(READER_ACTION, normalized, secret)}`;
}

/** The confirmed address in a reader cookie, or null when it is missing, malformed or forged. */
export function readReaderCookie(value: string | null | undefined, secret: string): string | null {
  if (!value || !secret) return null;
  const [encoded, token] = value.split(".");
  if (!encoded || !token) return null;
  const email = normalizeSubscriptionEmail(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!email.includes("@")) return null;
  return safeEqual(sign(READER_ACTION, email, secret), token) ? email : null;
}
