import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * POST /api/hamilton/uploads
 *
 * Multipart form: `file` (CSV or XLSX, up to 2 MB) and `institutionId`. Reads the bank's
 * fee income, item counts, waivers and affected accounts, and returns what was read
 * (the preview) with an uploadId. Nothing is used until the reader applies it
 * (POST /api/hamilton/uploads/apply). The file itself is not stored.
 *
 * Auth: premium/admin. No provider calls.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { MAX_UPLOAD_BYTES } from "@/lib/hamilton/uploads/parse";
import { receiveUpload } from "@/lib/hamilton/uploads/service";

async function handlePOST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as a form upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a CSV or XLSX file." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "The file is over 2 MB." }, { status: 413 });
  try {
    const result = await receiveUpload(user, {
      institutionId: form.get("institutionId"),
      fileName: file.name || "upload",
      contentType: file.type || null,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[hamilton-uploads] failed", error);
    return NextResponse.json({ error: "The upload could not be read just now." }, { status: 500 });
  }
}

export const POST = withApiRoutePolicy("api.hamilton.uploads", "POST", handlePOST);
