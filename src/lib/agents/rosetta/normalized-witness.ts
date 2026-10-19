/** Server-side storage and diagnostic resolution only; no fee-judgment consumer imports this module. */
import { createHash } from "node:crypto";
import type { sql } from "@/lib/data-store/connection";
type Db = typeof sql;
export interface TextArtifactSnapshot {
  id: number | string;
  source_document_id: number | string;
  institution_id: number | string;
  normalized_text: string | null;
  text_hash: string | null;
  source_hash: string | null;
  source_url: string | null;
  document_type: string | null;
  reader?: string | null;
  agent_run_id: number | string | null;
  status: string;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}
export type WitnessCapture = "captured" | "already_retained" | "no_text" | "unavailable_hash_mismatch";
export interface WitnessRetention {
  status: "active" | "unavailable_schema";
  incumbent?: WitnessCapture;
  incoming?: WitnessCapture;
}
/** Explicit transaction on a root client, real savepoint on an existing ledger transaction. */
export async function atomicTextWrite<T>(db: Db, work: (scope: Db) => Promise<T>): Promise<T> {
  const savepoint = (db as unknown as {
    savepoint?: (work: (scope: Db) => Promise<T>) => Promise<T>;
  }).savepoint;
  if (savepoint)
    return savepoint.call(db, work);
  return db.begin((scope) => work(scope as unknown as Db)) as Promise<T>;
}
/** Check only the additive capability; missing schema does not advertise durable history. */
export async function normalizedWitnessSchemaReady(db: Db): Promise<boolean> {
  const [row] = await db `SELECT to_regclass('public.agent_source_text_witnesses') IS NOT NULL AS normalized_witness_ready`;
  return row?.normalized_witness_ready === true;
}
export function exactTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
/** Call only with the current artifact locked in the same write transaction. */
export async function captureNormalizedWitness(db: Db, row: TextArtifactSnapshot, kind: "incumbent" | "incoming"): Promise<WitnessCapture> {
  if (!row.normalized_text)
    return "no_text";
  if (!row.text_hash || exactTextHash(row.normalized_text) !== row.text_hash)
    return "unavailable_hash_mismatch";
  const inserted = await db `
  INSERT INTO agent_source_text_witnesses
   (artifact_id, text_hash, source_document_id, institution_id, normalized_text,
    source_hash, source_url, document_type, reader, observed_agent_run_id,
    observed_artifact_status, observed_artifact_created_at, observed_artifact_updated_at, capture_kind)
  VALUES (${Number(row.id)}, ${row.text_hash}, ${Number(row.source_document_id)}, ${Number(row.institution_id)}, ${row.normalized_text},
   ${row.source_hash}, ${row.source_url}, ${row.document_type}, ${row.reader ?? null}, ${row.agent_run_id == null ? null : Number(row.agent_run_id)},
   ${row.status}, ${row.created_at}, ${row.updated_at}, ${kind})
  ON CONFLICT (artifact_id, text_hash) DO NOTHING
  RETURNING artifact_id
 `;
  if (inserted.length > 0)
    return "captured";
  // Dedup never turns a corrupt or differently-owned retained row into proof.
  const [existing] = await db `
  SELECT source_document_id, institution_id, normalized_text FROM agent_source_text_witnesses
   WHERE artifact_id = ${Number(row.id)} AND text_hash = ${row.text_hash}
 `;
  if (!existing || Number(existing.source_document_id) !== Number(row.source_document_id)
    || Number(existing.institution_id) !== Number(row.institution_id) || existing.normalized_text !== row.normalized_text) {
    throw new Error("Retained normalized witness conflicts with the exact artifact owner or bytes");
  }
  return "already_retained";
}
export interface WitnessRequest {
  artifactId: number;
  textHash: string;
  sourceDocumentId: number;
  institutionId: number;
}
export type WitnessResolution = {
  status: "available_current" | "available_history";
  text: string;
  textHash: string;
  artifactId: number;
  sourceDocumentId: number;
  institutionId: number;
  resolvedAt: string;
  capturedAt: string | null;
  originalReadAt: null;
  capturedMetadata: Record<string, unknown> | null;
} | {
  status: "unavailable";
  reason: "invalid_request" | "owner_mismatch" | "hash_mismatch" | "not_retained" | "history_schema_unavailable";
  resolvedAt: string;
  originalReadAt: null;
};
/** Exact recorded bytes, never a fallback by price, name, current applicability or later timestamp. */
export async function resolveNormalizedWitness(db: Db, request: WitnessRequest): Promise<WitnessResolution> {
  const resolvedAt = new Date().toISOString();
  const unavailable = (reason: Extract<WitnessResolution, {
    status: "unavailable";
  }>["reason"]): WitnessResolution => ({ status: "unavailable", reason, resolvedAt, originalReadAt: null });
  if (![request.artifactId, request.sourceDocumentId, request.institutionId].every((id) => Number.isSafeInteger(id) && id > 0)
    || !/^[a-f0-9]{64}$/.test(request.textHash))
    return unavailable("invalid_request");
  const [current] = await db `SELECT * FROM agent_source_texts WHERE id = ${request.artifactId}`;
  const ownerMatches = (row: Record<string, unknown>) => Number(row.source_document_id) === request.sourceDocumentId && Number(row.institution_id) === request.institutionId;
  const available = (status: "available_current" | "available_history", text: string, capturedAt: unknown, capturedMetadata: Record<string, unknown> | null): WitnessResolution => ({ status, text, textHash: request.textHash,
    artifactId: request.artifactId, sourceDocumentId: request.sourceDocumentId, institutionId: request.institutionId,
    resolvedAt, capturedAt: capturedAt == null ? null : new Date(capturedAt as string).toISOString(), originalReadAt: null, capturedMetadata });
  if (current && ownerMatches(current) && current.text_hash === request.textHash && current.normalized_text != null
    && exactTextHash(current.normalized_text) === request.textHash) {
    return available("available_current", current.normalized_text, null, null);
  }
  if (!(await normalizedWitnessSchemaReady(db)))
    return unavailable("history_schema_unavailable");
  const [history] = await db `
  SELECT * FROM agent_source_text_witnesses
   WHERE artifact_id = ${request.artifactId} AND text_hash = ${request.textHash}
 `;
  if (history) {
    if (!ownerMatches(history))
      return unavailable("owner_mismatch");
    if (exactTextHash(history.normalized_text) !== request.textHash)
      return unavailable("hash_mismatch");
    const metadata = Object.fromEntries(Object.entries(history).filter(([field]) => !["normalized_text", "captured_at"].includes(field)));
    return available("available_history", history.normalized_text, history.captured_at, metadata);
  }
  if (current && !ownerMatches(current))
    return unavailable("owner_mismatch");
  if (current?.text_hash === request.textHash)
    return unavailable("hash_mismatch");
  return unavailable("not_retained");
}
/** Preserve completed-at-capture status before the one status-only triage write. */
export async function preserveStatusChange<T>(db: Db, artifactId: number, write: (scope: Db) => PromiseLike<T>): Promise<{
  value: T;
  retention: WitnessRetention;
}> {
  if (!(await normalizedWitnessSchemaReady(db)))
    return { value: await write(db), retention: { status: "unavailable_schema" } };
  return atomicTextWrite(db, async (scope) => {
    const [incumbent] = await scope<TextArtifactSnapshot[]> `SELECT * FROM agent_source_texts WHERE id=${artifactId} FOR UPDATE`;
    const capture = incumbent ? await captureNormalizedWitness(scope, incumbent, "incumbent") : "no_text";
    return { value: await write(scope), retention: { status: "active", incumbent: capture } };
  });
}
