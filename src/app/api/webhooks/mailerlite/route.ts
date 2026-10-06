import { NextResponse } from "next/server";
import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { sql } from "@/lib/data-store/connection";
import { mailerLiteWebhookSecret, unsubscribedEmails, verifyMailerLiteSignature } from "@/lib/email/mailerlite-webhook";

/** MailerLite → leads: unsubscribes (and bounces, spam reports) made inside MailerLite. */
async function handlePOST(request: Request) {
  const secret = mailerLiteWebhookSecret();
  if (!secret) return NextResponse.json({ error: "MAILERLITE_WEBHOOK_SECRET is not set" }, { status: 503 });
  const body = await request.text();
  if (!verifyMailerLiteSignature(body, request.headers.get("signature"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const emails = unsubscribedEmails(payload);
  if (!emails.length) {
    // Logged so an unexpected payload shape shows up instead of silently doing nothing.
    console.warn("[webhooks/mailerlite] no unsubscribe in delivery", { keys: Object.keys((payload ?? {}) as object) });
    return NextResponse.json({ received: true, updated: 0 });
  }
  const rows = await sql`
    UPDATE leads SET email_unsubscribed_at = COALESCE(email_unsubscribed_at, now())
    WHERE lower(email) = ANY(${emails})
    RETURNING id`;
  return NextResponse.json({ received: true, updated: rows.length });
}

export const POST = withApiRoutePolicy("api.webhooks.mailerlite", "POST", handlePOST);
