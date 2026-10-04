import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getDocumentVault, isVaultKey } from "@/lib/agents/document-vault";
import { sql } from "@/lib/data-store/connection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** "View our copy": redirects an admin to a 1-hour presigned link for a stored source document. */
async function handleGET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "operate")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const documentId = Number(id);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }
  const [row] = await sql`SELECT document_r2_key FROM source_documents WHERE id = ${documentId}`;
  const key = row?.document_r2_key == null ? null : String(row.document_r2_key);
  if (!isVaultKey(key)) {
    return NextResponse.json({ error: "No stored copy for this document" }, { status: 404 });
  }
  const vault = getDocumentVault();
  if (!vault.configured) {
    return NextResponse.json({ error: "Document vault is not configured" }, { status: 503 });
  }
  return NextResponse.redirect(await vault.presign(key), 302);
}

export const GET = withApiRoutePolicy("api.admin.documents", "GET", handleGET);
