import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/data-store/connection";
import {
  FEE_ALERT_UNSUBSCRIBE_ACTION,
  PRO_DIGEST_UNSUBSCRIBE_ACTION,
  getSubscriptionTokenSecret,
  isAccountUnsubscribeAction,
  normalizeSubscriptionEmail,
  verifyFeeAlertUnsubscribeToken,
} from "@/lib/email/subscription-token";

/**
 * Stops every fee-change alert for one account (saved institutions and the Pro watchlist),
 * or, with the digest action, the Pro Monday digest. Accepts JSON from /email-preferences
 * and RFC 8058 one-click POSTs from mail clients (parameters in the query string). The
 * token signs the action, user id and address together, so a link only works for the
 * account and the email it was sent with.
 */
async function readInput(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  let body: Record<string, unknown> = {};
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  }
  return {
    action: body.action ?? query.get("action") ?? FEE_ALERT_UNSUBSCRIBE_ACTION,
    uid: Number(body.uid ?? query.get("uid")),
    email: body.email ?? query.get("email"),
    token: body.token ?? query.get("token"),
  };
}

async function handlePOST(request: NextRequest) {
  const input = await readInput(request);
  if (
    !isAccountUnsubscribeAction(input.action) ||
    !Number.isInteger(input.uid) ||
    typeof input.email !== "string" ||
    typeof input.token !== "string"
  ) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }

  const email = normalizeSubscriptionEmail(input.email);
  if (!verifyFeeAlertUnsubscribeToken(input.uid, email, input.token, getSubscriptionTokenSecret(), input.action)) {
    return NextResponse.json({ error: "This link is invalid or has expired" }, { status: 400 });
  }

  if (input.action === PRO_DIGEST_UNSUBSCRIBE_ACTION) {
    try {
      const rows = await sql<{ id: number }[]>`
        UPDATE users SET pro_digest_off_at = COALESCE(pro_digest_off_at, NOW())
        WHERE id = ${input.uid} AND lower(email) = ${email}
        RETURNING id
      `;
      return NextResponse.json({ success: true, stopped: rows.length });
    } catch (error) {
      console.error("[api/alerts/unsubscribe] digest stop failed", error instanceof Error ? error.message : String(error));
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  try {
    const rows = await sql<{ id: number }[]>`
      UPDATE institution_fee_alert_subscriptions sub
      SET is_active = FALSE
      FROM users u
      WHERE u.id = sub.user_id
        AND sub.user_id = ${input.uid}
        AND lower(u.email) = ${email}
        AND sub.is_active = TRUE
      RETURNING sub.id
    `;
    // The same link stops watchlist alerts, which arrive in the same email.
    await sql`
      UPDATE users SET watchlist_alerts_off_at = COALESCE(watchlist_alerts_off_at, NOW())
      WHERE id = ${input.uid} AND lower(email) = ${email}
    `.catch((error: unknown) => {
      console.error("[api/alerts/unsubscribe] watchlist stop failed", error instanceof Error ? error.message : String(error));
    });
    return NextResponse.json({ success: true, deactivated: rows.length });
  } catch (error) {
    console.error("[api/alerts/unsubscribe] update failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiRoutePolicy("api.alerts.unsubscribe", "POST", handlePOST);
