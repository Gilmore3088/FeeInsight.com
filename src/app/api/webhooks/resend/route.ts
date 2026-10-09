import { NextResponse } from "next/server";
import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { recordEmailEvent } from "@/lib/data-store/email-send-log";
import { parseResendEvent, resendWebhookSecret, verifySvixSignature } from "@/lib/email/resend-webhook";

/** Resend → email_send_log: the latest delivery event (delivered, bounced, ...) per sent email. */
async function handlePOST(request: Request) {
  const secret = resendWebhookSecret();
  if (!secret) return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET is not set" }, { status: 503 });
  const body = await request.text();
  const signed = verifySvixSignature(body, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, secret);
  if (!signed) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const event = parseResendEvent(payload);
  if (!event) return NextResponse.json({ received: true, updated: 0 });

  const updated = await recordEmailEvent(event.providerId, event.type, event.at);
  if (updated === 0) {
    // A send from before the log existed, or one already stamped with a newer event.
    console.warn("[webhooks/resend] no log row updated", { type: event.type, providerId: event.providerId });
  }
  return NextResponse.json({ received: true, updated });
}

export const POST = withApiRoutePolicy("api.webhooks.resend", "POST", handlePOST);
