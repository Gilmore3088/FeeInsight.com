import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Resend webhooks (delivered, bounced, complained, opened, ...) stamp the latest delivery
 * event on our own `email_send_log` row. Resend signs with Svix: headers `svix-id`,
 * `svix-timestamp` (unix seconds) and `svix-signature` (space-separated "v1,<base64>"
 * entries); the signature is base64 HMAC-SHA256 of `${id}.${timestamp}.${body}` keyed by
 * the base64 part of the "whsec_" secret.
 */

/** How far a delivery's timestamp may be from now before it is refused as a replay. */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export function resendWebhookSecret(): string | null {
  return (process.env.RESEND_WEBHOOK_SECRET || "").trim() || null;
}

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function verifySvixSignature(body: string, headers: SvixHeaders, secret: string, now: Date = new Date()): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  if (!/^\d+$/.test(timestamp)) return false;
  const sentAt = Number(timestamp);
  if (Math.abs(now.getTime() / 1000 - sentAt) > SVIX_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  if (key.length === 0) return false;
  const expected = Buffer.from(createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64"));

  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export interface ResendEmailEvent {
  type: string;
  providerId: string;
  at: Date;
}

/** The event to record, or null when the payload is not an `email.*` event with an email id. */
export function parseResendEvent(payload: unknown): ResendEmailEvent | null {
  const root = (payload ?? {}) as Record<string, unknown>;
  const type = typeof root.type === "string" ? root.type : "";
  if (!type.startsWith("email.")) return null;
  const data = (root.data ?? {}) as Record<string, unknown>;
  const providerId = typeof data.email_id === "string" ? data.email_id.trim() : "";
  if (!providerId) return null;
  const at = new Date(String(root.created_at ?? ""));
  return { type, providerId, at: Number.isNaN(at.getTime()) ? new Date() : at };
}
