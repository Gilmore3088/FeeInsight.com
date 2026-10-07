/**
 * Client-safe constants for email preference links. Kept apart from
 * subscription-token.ts, which signs with Node's crypto and must stay server-only.
 */
export const EMAIL_PREFERENCES_PATH = "/email-preferences";
export const SUBSCRIPTION_API_PATH = "/api/leads/subscription";
export const FEE_ALERT_UNSUBSCRIBE_ACTION = "fee_alerts_unsubscribe" as const;
export const FEE_ALERT_UNSUBSCRIBE_API_PATH = "/api/alerts/unsubscribe";
/** The Pro Monday digest's own stop link; handled by the same route as fee alerts. */
export const PRO_DIGEST_UNSUBSCRIBE_ACTION = "pro_digest_unsubscribe" as const;
