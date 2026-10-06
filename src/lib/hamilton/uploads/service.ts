/**
 * Upload flow for the bank's own numbers: read the file, show what was read (the
 * preview), and only on the reader's say-so save the figures to memory. The file itself
 * is never stored; the preview is kept on the upload row so it can be applied later.
 */

import { recordProRequest } from "@/lib/agents/run-store";
import { createUpload, getUpload, saveMemoryFact, setUploadStatus, workspaceSchemaReady } from "@/lib/data-store/hamilton-workspace";
import { resolveHamiltonInstitutionContext } from "../workspace-context";
import { mapUploadTable, uploadFacts, type UploadPreview } from "./map";
import { readUploadTable } from "./parse";

export interface UploadResult {
  status: number;
  body: { uploadId: string; preview: UploadPreview } | { uploadId: string; saved: number; fees: string[] } | { error: string };
}

interface Uploader {
  id: number;
  display_name?: string | null;
  username?: string | null;
}

async function institutionFor(userId: number, instId: unknown): Promise<number | null> {
  const resolved = await resolveHamiltonInstitutionContext({
    userId,
    instId: typeof instId === "string" || typeof instId === "number" ? instId : null,
    persistUrlSelection: false,
  });
  return resolved.institution ? Number(resolved.institution.id) : null;
}

export async function receiveUpload(
  user: Uploader,
  input: { institutionId: unknown; fileName: string; contentType: string | null; bytes: Buffer },
): Promise<UploadResult> {
  const institutionId = await institutionFor(user.id, input.institutionId);
  if (!institutionId) return { status: 400, body: { error: "Choose an institution first." } };
  if (!(await workspaceSchemaReady())) return { status: 503, body: { error: "Uploads are not set up yet." } };
  let preview: UploadPreview;
  try {
    preview = mapUploadTable(readUploadTable(input.fileName, input.bytes));
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : "The file could not be read." } };
  }
  const upload = await createUpload({
    userId: user.id,
    institutionId,
    fileName: input.fileName.slice(0, 200),
    contentType: input.contentType,
    byteSize: input.bytes.length,
    preview,
    status: preview.problem ? "rejected" : "mapped",
  });
  await recordProRequest({
    operation: "upload",
    title: "Hamilton upload read",
    status: "completed",
    summary: preview.problem ?? `Read ${preview.rowsRead} rows; ${preview.fees.length} fees matched, ${preview.unmatched.length} labels unmatched.`,
    userId: user.id,
    institutionId,
    detail: { upload_id: upload.id, fees: preview.fees.map((f) => f.feeCategory) },
  });
  return { status: 200, body: { uploadId: upload.id, preview } };
}

/** Saves the previewed figures (all fees, or the ones the reader kept) to memory. */
export async function applyUpload(user: Uploader, input: { uploadId?: unknown; fees?: unknown }): Promise<UploadResult> {
  if (typeof input.uploadId !== "string") return { status: 400, body: { error: "Which upload?" } };
  if (!(await workspaceSchemaReady())) return { status: 503, body: { error: "Uploads are not set up yet." } };
  const upload = await getUpload<UploadPreview>(user.id, input.uploadId);
  if (!upload) return { status: 404, body: { error: "That upload was not found." } };
  if (upload.status !== "mapped") return { status: 409, body: { error: `That upload is ${upload.status}.` } };
  const only = Array.isArray(input.fees) ? input.fees.filter((f): f is string => typeof f === "string") : undefined;
  const facts = uploadFacts(upload.preview, only);
  if (facts.length === 0) return { status: 400, body: { error: "Nothing in that upload to save." } };
  const givenBy = `${user.display_name || user.username || `user:${user.id}`} (upload: ${upload.fileName})`;
  for (const fact of facts) {
    await saveMemoryFact({ userId: user.id, institutionId: upload.institutionId, fieldKey: fact.fieldKey, value: fact.value, givenBy, source: "upload", uploadId: upload.id });
  }
  await setUploadStatus(upload.id, "applied");
  const fees = [...new Set(facts.map((f) => f.fieldKey.split(".")[1]))];
  await recordProRequest({
    operation: "upload",
    title: "Hamilton upload applied",
    status: "completed",
    summary: `Saved ${facts.length} figures for ${fees.length} fees from ${upload.fileName}.`,
    userId: user.id,
    institutionId: upload.institutionId,
    detail: { upload_id: upload.id, fees },
  });
  return { status: 200, body: { uploadId: upload.id, saved: facts.length, fees } };
}
