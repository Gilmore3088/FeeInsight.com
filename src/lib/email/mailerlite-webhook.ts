import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * MailerLite webhooks: an unsubscribe made inside MailerLite (a campaign or automation
 * footer) is written back to `leads`, so the site and MailerLite agree on who is
 * subscribed. MailerLite signs each delivery with the webhook's secret:
 * header `Signature` = hex HMAC-SHA256 of the raw body.
 */

export function mailerLiteWebhookSecret(): string | null {
  return (process.env.MAILERLITE_WEBHOOK_SECRET || "").trim() || null;
}

export function verifyMailerLiteSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const given = signature.trim().toLowerCase();
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const UNSUBSCRIBE_EVENTS = new Set(["subscriber.unsubscribed", "subscriber.bounced", "subscriber.spam_reported"]);

/**
 * Emails to mark unsubscribed. Accepts a single event or a batch (`events`), and reads the
 * address from the event or its `subscriber`/`data` object, since the shape has varied.
 * A subscriber payload whose status is unsubscribed, bounced or junk counts too.
 */
export function unsubscribedEmails(payload: unknown): string[] {
  const root = (payload ?? {}) as Record<string, unknown>;
  const events = Array.isArray(root.events) ? root.events : [root];
  const emails: string[] = [];
  for (const raw of events) {
    const event = (raw ?? {}) as Record<string, unknown>;
    const inner = ((event.subscriber ?? event.data ?? event) as Record<string, unknown>) ?? {};
    const type = String(event.type ?? event.event ?? root.type ?? root.event ?? "");
    const status = String(inner.status ?? "");
    const email = typeof inner.email === "string" ? inner.email : typeof event.email === "string" ? event.email : null;
    if (!email) continue;
    if (UNSUBSCRIBE_EVENTS.has(type) || ["unsubscribed", "bounced", "junk"].includes(status)) {
      emails.push(email.trim().toLowerCase());
    }
  }
  return [...new Set(emails)];
}
