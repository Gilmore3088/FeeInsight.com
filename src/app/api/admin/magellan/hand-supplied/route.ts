import { NextRequest, NextResponse } from "next/server";

import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { importHuntLinks, loadHandSuppliedDocument } from "@/lib/agents/magellan/hand-supplied";
import { parseHuntCsv, suppliedFileNameFor } from "@/lib/agents/magellan/hand-supplied-files";
import { setInstitutionFeeUrl } from "@/lib/institution-commands";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// A scan gets Rosetta's free OCR in the same request.
export const maxDuration = 300;

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/**
 * Hand-supplied fee schedules (`/admin/magellan/hand-supplied`). One request per file, so a
 * batch of hundreds never meets the request size limit:
 *   kind=file: one PDF named `<institution_id>__<short-name>__consumer.pdf`, with its source
 *     address (`source_url`, the CSV's found_url) and the CSV's effective_date and notes. From an
 *     institution's admin page it carries `institution_id` instead of the naming rule, and
 *     `make_fee_link=1` also makes its source address that institution's fee link;
 *   kind=csv: the browser hunt's CSV and the names of the files already loaded; its FOUND rows
 *     with no file become hand-found links.
 * Admins only (edit permission). Every load is a run in the ledger; nothing is fetched from the bank.
 */
async function handlePOST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "edit")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send a form" }, { status: 400 });
  const suppliedBy = user.username || user.email || `user ${user.id}`;

  if (text(form, "kind") === "file") {
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
    // From an institution's own admin page the file keeps whatever name the browser gave it.
    const institutionId = Number(text(form, "institution_id"));
    const fromInstitutionPage = Number.isSafeInteger(institutionId) && institutionId > 0;
    const result = await loadHandSuppliedDocument({
      fileName: fromInstitutionPage ? suppliedFileNameFor(institutionId, file.name) : file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      sourceUrl: text(form, "source_url") || null,
      effectiveDate: text(form, "effective_date") || null,
      notes: text(form, "notes") || null,
      suppliedBy,
    });
    // "Make this the fee link": only once the copy is stored, so a refused file changes nothing.
    if (fromInstitutionPage && text(form, "make_fee_link") === "1" && result.outcome !== "refused") {
      const linked = await setInstitutionFeeUrl(institutionId, text(form, "source_url"));
      return NextResponse.json({ ...result, feeLinkUpdated: linked.success, feeLinkError: linked.success ? null : linked.error ?? null });
    }
    return NextResponse.json(result);
  }

  if (text(form, "kind") === "csv") {
    const parsed = parseHuntCsv(text(form, "csv"));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    let uploaded: string[] = [];
    try {
      const value = JSON.parse(text(form, "uploaded") || "[]");
      uploaded = Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
    } catch {
      return NextResponse.json({ error: "uploaded must be a JSON list of file names" }, { status: 400 });
    }
    const result = await importHuntLinks({ rows: parsed.rows, uploadedFileNames: uploaded, suppliedBy });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "kind must be file or csv" }, { status: 400 });
}

export const POST = withApiRoutePolicy("api.admin.magellan.hand_supplied", "POST", handlePOST);
