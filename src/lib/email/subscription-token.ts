/**
 * Signed, stateless links for email confirmation (double opt-in) and unsubscribe.
 * The token is an HMAC of `action:email`, so a link only works for the address it
 * was sent to and cannot be forged or replayed against another address.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { SITE_URL } from "@/lib/constants";

export type SubscriptionAction = "confirm" | "unsubscribe";

export const SUBSCRIPTION_ACTIONS: readonly SubscriptionAction[] = ["confirm", "unsubscribe"];

export const EMAIL_PREFERENCES_PATH = "/email-preferences";
export const SUBSCRIPTION_API_PATH = "/api/leads/subscription";

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

export function signSubscriptionToken(action: SubscriptionAction, email: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`${action}:${normalizeSubscriptionEmail(email)}`)
    .digest("base64url");
}

export function verifySubscriptionToken(
  action: SubscriptionAction,
  email: string,
  token: string,
  secret: string,
): boolean {
  if (!secret || !token) return false;
  const expected = Buffer.from(signSubscriptionToken(action, email, secret));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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
