import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/data-store/connection";
import { syncLeadToMailerLite } from "@/lib/email/mailerlite";
import { parseStateCode, stateFromUseCase } from "@/lib/lead-capture";
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
  /** Optional on confirm: the state whose monthly edition the reader wants. */
  state: unknown;
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
    state: body.state ?? null,
  };
}

async function applySubscriptionAction(action: SubscriptionAction, email: string, state: string | null) {
  if (action === "confirm") {
    // A state chosen on the confirm page rides on use_case like the capture forms' state.
    const stateTag = state ? `state=${state}` : null;
    return sql<{ source: string; use_case: string | null }[]>`
      UPDATE leads SET
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        email_unsubscribed_at = NULL,
        use_case = CASE
          WHEN ${stateTag}::text IS NULL THEN use_case
          -- Request rows (reports, contact) keep their history; only signup rows take the state.
          WHEN EXISTS (
            SELECT 1 FROM unnest(string_to_array(COALESCE(source, ''), ',')) AS part
             WHERE trim(part) ~ '^(report|report_order|enterprise|contact(_[a-z0-9-]+)?)$'
          ) THEN use_case
          WHEN use_case IS NULL OR use_case = '' THEN ${stateTag}
          ELSE use_case || '; ' || ${stateTag}
        END
      WHERE lower(email) = ${email}
      RETURNING source, use_case`;
  }
  return sql<{ source: string; use_case: string | null }[]>`
    UPDATE leads SET email_unsubscribed_at = now()
    WHERE lower(email) = ${email}
    RETURNING source, use_case`;
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
    const rows = await applySubscriptionAction(input.action, email, parseStateCode(input.state));
    if (rows.length === 0) {
      return NextResponse.json({ error: "No signup found for this address" }, { status: 404 });
    }
    // Only confirmed addresses reach MailerLite; unsubscribes propagate there too.
    const sync = await syncLeadToMailerLite({
      email,
      subscribed: input.action === "confirm",
      // Every row's sources, so the highest-intent group wins whichever row Postgres returns first.
      source: rows.map((row) => row.source).filter(Boolean).join(",") || null,
      state: rows.map((row) => stateFromUseCase(row.use_case)).find(Boolean) ?? null,
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
