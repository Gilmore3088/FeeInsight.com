import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * POST /api/hamilton/uploads/apply
 *
 * Body: { uploadId, fees?: string[] }. Saves the previewed figures (all fees, or the fee
 * categories listed) to the bank's memory with the upload named as their source.
 *
 * Auth: premium/admin. No provider calls.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { applyUpload } from "@/lib/hamilton/uploads/service";

async function handlePOST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { uploadId?: unknown; fees?: unknown };
  try {
    body = (await request.json()) as { uploadId?: unknown; fees?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const result = await applyUpload(user, body ?? {});
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[hamilton-uploads] apply failed", error);
    return NextResponse.json({ error: "The figures could not be saved just now." }, { status: 500 });
  }
}

export const POST = withApiRoutePolicy("api.hamilton.uploads.apply", "POST", handlePOST);
