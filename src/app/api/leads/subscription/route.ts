import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/data-store/connection";
import { syncLeadToMailerLite } from "@/lib/email/mailerlite";
import {
  getSubscriptionTokenSecret,
  isSubscriptionAction,
  normalizeSubscriptionEmail,
  verifySubscriptionToken,
  type SubscriptionAction,
} from "@/lib/email/subscription-token";

interface SubscriptionRequest {
  action: unknown;
  email: unknown;
  token: unknown;
}

/**
 * Accepts JSON from /email-preferences, and RFC 8058 one-click unsubscribe POSTs from
 * mail clients (form body `List-Unsubscribe=One-Click`, parameters in the query).
 */
async function readSubscriptionRequest(request: NextRequest): Promise<SubscriptionRequest> {
  const query = request.nextUrl.searchParams;
  const contentType = request.headers.get("content-type") || "";
  let body: Record<string, unknown> = {};
  if (contentType.includes("application/json")) {
    body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  }
  return {
    action: body.action ?? query.get("action"),
    email: body.email ?? query.get("email"),
    token: body.token ?? query.get("token"),
  };
}

async function applySubscriptionAction(action: SubscriptionAction, email: string) {
  if (action === "confirm") {
    return sql<{ source: string }[]>`
      UPDATE leads SET
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        email_unsubscribed_at = NULL
      WHERE lower(email) = ${email}
      RETURNING source`;
  }
  return sql<{ source: string }[]>`
    UPDATE leads SET email_unsubscribed_at = now()
    WHERE lower(email) = ${email}
    RETURNING source`;
}

async function handlePOST(request: NextRequest) {
  const input = await readSubscriptionRequest(request);
  if (!isSubscriptionAction(input.action) || typeof input.email !== "string" || typeof input.token !== "string") {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }

  const email = normalizeSubscriptionEmail(input.email);
  const secret = getSubscriptionTokenSecret();
  if (!verifySubscriptionToken(input.action, email, input.token, secret)) {
    return NextResponse.json({ error: "This link is invalid or has expired" }, { status: 400 });
  }

  try {
    const rows = await applySubscriptionAction(input.action, email);
    if (rows.length === 0) {
      return NextResponse.json({ error: "No signup found for this address" }, { status: 404 });
    }
    // Only confirmed addresses reach MailerLite; unsubscribes propagate there too.
    const sync = await syncLeadToMailerLite({
      email,
      subscribed: input.action === "confirm",
      source: rows[0]?.source ?? null,
    });
    if (sync.status === "failed") {
      console.error("[api/leads/subscription] MailerLite sync failed", { action: input.action, error: sync.error });
    }
    return NextResponse.json({ success: true, action: input.action });
  } catch (error) {
    console.error("[api/leads/subscription] update failed", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiRoutePolicy("api.leads.subscription", "POST", handlePOST);
