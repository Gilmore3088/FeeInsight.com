import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/data-store/connection";
import { getCurrentUser } from "@/lib/auth";
import { addAlertSubscription, normalizeAlertCategories, removeAlertSubscription } from "@/lib/data-store/alerts";

/**
 * GET /api/alerts
 * List the current user's active alert subscriptions.
 */
async function handleGET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await sql`
      SELECT
        a.id,
        a.institution_id,
        a.fee_categories,
        a.is_active,
        a.last_alerted_at,
        a.created_at,
        ct.institution_name
      FROM institution_fee_alert_subscriptions a
      JOIN institution_sources ct ON ct.id = a.institution_id
      WHERE a.user_id = ${user.id} AND a.is_active = TRUE
      ORDER BY ct.institution_name
    `;

    return NextResponse.json({ subscriptions: [...rows] });
  } catch (err) {
    console.error("[api/alerts] GET failed:", err);
    return NextResponse.json({ error: "Could not load your alerts." }, { status: 500 });
  }
}

/**
 * POST /api/alerts
 * Add an alert subscription for the current user.
 * Body: { institution_id: number, fee_categories?: string[] }
 */
async function handlePOST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { institution_id, fee_categories } = body;

    if (!institution_id || typeof institution_id !== "number") {
      return NextResponse.json(
        { error: "institution_id is required and must be a number" },
        { status: 400 },
      );
    }

    // Verify the crawl target exists
    const [target] = await sql`
      SELECT id FROM institution_sources WHERE id = ${institution_id}
    `;
    if (!target) {
      return NextResponse.json(
        { error: "Institution not found" },
        { status: 404 },
      );
    }

    // Categories must come from the fee taxonomy; saving more adds to what is followed.
    const normalized = normalizeAlertCategories(fee_categories);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const saved = await addAlertSubscription(user.id, institution_id, normalized.categories);
    return NextResponse.json({ id: saved.id, fee_categories: saved.fee_categories }, { status: 201 });
  } catch (err) {
    console.error("[api/alerts] POST failed:", err);
    return NextResponse.json({ error: "Could not save this alert." }, { status: 500 });
  }
}

/** institution_id from `?institution_id=` or a JSON body, so DELETE works without a body. */
async function readInstitutionId(request: NextRequest): Promise<number | null> {
  const fromQuery = request.nextUrl.searchParams.get("institution_id");
  if (fromQuery !== null) {
    const parsed = Number(fromQuery);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  try {
    const body = await request.json();
    return typeof body?.institution_id === "number" && body.institution_id > 0 ? body.institution_id : null;
  } catch {
    return null;
  }
}

/**
 * DELETE /api/alerts
 * Remove (deactivate) an alert subscription.
 * Body: { institution_id: number }
 */
async function handleDELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const institution_id = await readInstitutionId(request);
    if (institution_id === null) {
      return NextResponse.json(
        { error: "institution_id is required and must be a number" },
        { status: 400 },
      );
    }

    if (!(await removeAlertSubscription(user.id, institution_id))) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/alerts] DELETE failed:", err);
    return NextResponse.json({ error: "Could not remove this alert." }, { status: 500 });
  }
}

export const GET = withApiRoutePolicy("api.alerts", "GET", handleGET);
export const POST = withApiRoutePolicy("api.alerts", "POST", handlePOST);
export const DELETE = withApiRoutePolicy("api.alerts", "DELETE", handleDELETE);
