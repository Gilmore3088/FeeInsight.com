import { createHash } from "node:crypto";
import type { sql } from "@/lib/data-store/connection";
import type { RawFeeRow } from "./verify";

type SqlTag = typeof sql;
export type LockedRawFee = RawFeeRow & { extraction_note: string | null };
export interface SourceReference { documentId: number; institutionId: number }

export interface SourceDocumentSnapshot {
  [column: string]: unknown;
  id: number | string;
  institution_id: number | string;
  document_url: string | null;
  status: string;
  content_hash: string | null;
  superseded_by_id: number | string | null;
  duplicate_of_id: number | string | null;
}
export interface SourceArtifactSnapshot {
  [column: string]: unknown;
  id: number | string;
  source_document_id: number | string;
  institution_id: number | string;
  source_url: string | null;
  source_hash: string | null;
  status: string;
  normalized_text: string | null;
  text_hash: string | null;
}
export interface LockedSourceSnapshot {
  artifactId: number;
  documentId: number;
  institutionId: number;
  textHash: string;
  normalizedText: string;
  sourceUrl: string | null;
  /** Actual locked rows, including status, stream/timestamps and pointers. No date authority. */
  document: SourceDocumentSnapshot;
  artifact: SourceArtifactSnapshot;
}
export type UnboundSource = { kind: "busy" } | { kind: "changed" }
  | { kind: "unavailable"; reason: "invalid_reference" | "conflicting_reference" | "missing_raw" | "no_document"
      | "no_original_hash" | "missing_document" | "source_not_current" | "missing_artifact" | "owner_mismatch"
      | "body_hash_mismatch" | "original_binding_mismatch" | "source_hash_mismatch" };
export type LockedSourcePrefixResult = { kind: "bound"; sources: ReadonlyMap<number, LockedSourceSnapshot> } | UnboundSource;
export type LockedRawSourceResult = {
  kind: "bound";
  currentRaw: LockedRawFee;
  source: LockedSourceSnapshot;
} | UnboundSource;
export type LockedCurrentRawSourceResult = LockedRawSourceResult;

class UnavailableSource extends Error {
  constructor(readonly result: UnboundSource) { super("Raw-owned source is not bound"); }
}
const stop = (result: UnboundSource): never => { throw new UnavailableSource(result); };
const HASH = /^[a-f0-9]{64}$/;

function positiveId(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9]\d*$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Generated header only; a source quotation cannot manufacture the raw's original digest. */
function originalBinding(note: string | null): { artifactId: number; textHash: string } | null {
  if (!note) return null;
  const header = note.split(/\bexcerpt=/, 1)[0];
  const match = /^Knox [^\r\n]{1,180}? from Rosetta artifact #([1-9]\d{0,15})\. canonical_hint=[a-z_]+; text_hash=([a-f0-9]{64});/.exec(header);
  const artifactId = match ? positiveId(match[1]) : null;
  if (!match || artifactId == null || (header.match(/Rosetta artifact #/g)?.length ?? 0) !== 1 ||
      (header.match(/\btext_hash=/g)?.length ?? 0) !== 1) return null;
  return { artifactId, textHash: match[2] };
}

/** Pure final-suffix binding; only a locked source snapshot supplies the current text facts. */
export function matchOriginalRawSource(
  raw: Pick<LockedRawFee, "institution_id" | "source_document_id" | "extraction_note" | "conditions">,
  source: Pick<LockedSourceSnapshot, "documentId" | "institutionId" | "artifactId" | "textHash">,
): { kind: "matched" } | { kind: "unavailable"; reason: "owner_mismatch" | "no_original_hash" | "original_binding_mismatch" } {
  if (positiveId(raw.institution_id) !== source.institutionId || positiveId(raw.source_document_id) !== source.documentId) {
    return { kind: "unavailable", reason: "owner_mismatch" };
  }
  const original = originalBinding(raw.extraction_note ?? raw.conditions);
  if (!original) return { kind: "unavailable", reason: "no_original_hash" };
  return original.artifactId === source.artifactId && original.textHash === source.textHash
    ? { kind: "matched" } : { kind: "unavailable", reason: "original_binding_mismatch" };
}

async function sourceSavepoint<T>(tx: SqlTag, work: (scope: SqlTag) => Promise<T>): Promise<T | UnboundSource> {
  const savepoint = (tx as unknown as { savepoint?: unknown }).savepoint;
  if (typeof savepoint !== "function") throw new TypeError("Raw-owned source binding requires a transaction");
  try {
    return await (savepoint as (work: (scope: SqlTag) => Promise<T>) => Promise<T>).call(tx, work);
  } catch (error) {
    if (error instanceof UnavailableSource) return error.result;
    const code = (error as { code?: string })?.code;
    if (code === "55P03") return { kind: "busy" };
    if (code === "40001") return { kind: "changed" };
    throw error;
  }
}

type ArtifactPointer = Pick<SourceArtifactSnapshot, "id" | "source_document_id" | "institution_id" | "text_hash" | "source_hash" | "status">;

/** One loader: all document locks, then all artifact locks, in ascending identity order. */
async function lockSourcePrefix(scope: SqlTag, refs: readonly SourceReference[]): Promise<ReadonlyMap<number, LockedSourceSnapshot>> {
  if (!Array.isArray(refs)) return stop({ kind: "unavailable", reason: "invalid_reference" });
  const owners = new Map<number, number>();
  for (const ref of refs) {
    const documentId = ref && positiveId(ref.documentId);
    const institutionId = ref && positiveId(ref.institutionId);
    if (!documentId || !institutionId) {
      return stop({ kind: "unavailable", reason: "invalid_reference" });
    }
    if (owners.has(documentId) && owners.get(documentId) !== institutionId) {
      return stop({ kind: "unavailable", reason: "conflicting_reference" });
    }
    owners.set(documentId, institutionId);
  }
  const ids = [...owners.keys()].sort((a, b) => a - b);
  if (!ids.length) return new Map();
  const documents = await scope<SourceDocumentSnapshot[]>`
    SELECT * FROM source_documents WHERE id=ANY(${ids}::bigint[]) ORDER BY id FOR SHARE NOWAIT`;
  if (documents.length !== ids.length) return stop({ kind: "unavailable", reason: "missing_document" });
  const pointers = await scope<ArtifactPointer[]>`
    SELECT id, source_document_id, institution_id, text_hash, source_hash, status
    FROM agent_source_texts WHERE source_document_id=ANY(${ids}::bigint[]) ORDER BY id`;
  if (pointers.length !== ids.length) return stop({ kind: "unavailable", reason: "missing_artifact" });
  if (pointers.some(row => positiveId(row.id) == null)) return stop({ kind: "unavailable", reason: "invalid_reference" });
  const artifacts = await scope<SourceArtifactSnapshot[]>`
    SELECT * FROM agent_source_texts WHERE id=ANY(${pointers.map(row => Number(row.id))}::bigint[])
    ORDER BY id FOR SHARE NOWAIT`;
  if (artifacts.length !== pointers.length) return stop({ kind: "changed" });
  const sources = new Map<number, LockedSourceSnapshot>();
  for (const document of documents) {
    const documentId = Number(document.id);
    const institutionId = owners.get(documentId)!;
    const pointer = pointers.find(row => Number(row.source_document_id) === documentId);
    const artifact = artifacts.find(row => Number(row.source_document_id) === documentId);
    if (!pointer || !artifact || Object.keys(pointer).some(column => pointer[column as keyof ArtifactPointer] !== artifact[column])) {
      return stop({ kind: "changed" });
    }
    if (Number(document.institution_id) !== institutionId || Number(artifact.institution_id) !== institutionId) {
      return stop({ kind: "unavailable", reason: "owner_mismatch" });
    }
    if (document.status !== "success" || document.superseded_by_id != null || document.duplicate_of_id != null ||
        artifact.status !== "completed" || !artifact.normalized_text || !artifact.text_hash) {
      return stop({ kind: "unavailable", reason: "source_not_current" });
    }
    if (!HASH.test(artifact.text_hash) || createHash("sha256").update(artifact.normalized_text).digest("hex") !== artifact.text_hash) {
      return stop({ kind: "unavailable", reason: "body_hash_mismatch" });
    }
    if (!document.content_hash || !HASH.test(document.content_hash) || artifact.source_hash !== document.content_hash) {
      return stop({ kind: "unavailable", reason: "source_hash_mismatch" });
    }
    sources.set(documentId, { artifactId: Number(artifact.id), documentId, institutionId,
      textHash: artifact.text_hash, normalizedText: artifact.normalized_text,
      sourceUrl: document.document_url ?? artifact.source_url, document, artifact });
  }
  return sources;
}

/**
 * Factual source prefix ONLY: no raw, verified or published locks and no fee/date policy.
 * The caller must use an actual transaction. Bound keeps prefix locks until its outer
 * transaction ends. Consumers must wrap their later identity-CAS/write in their OWN
 * savepoint and roll it back on deferral, so an abandoned suffix releases the prefix.
 * Every new row lock is NOWAIT; no waiting source acquisition follows existing fee locks.
 */
export async function withLockedSourcePrefix(tx: SqlTag, refs: readonly SourceReference[]): Promise<LockedSourcePrefixResult> {
  return sourceSavepoint(tx, async scope => ({ kind: "bound" as const, sources: await lockSourcePrefix(scope, refs) }));
}

interface Snapshot extends LockedRawFee { binding_state: string }

/**
 * Factual current-raw suffix, shared by both public wrappers. Original matching is a
 * separate authority requirement; ordinary source facts do not require an old raw digest.
 */
async function lockCurrentRawSource(scope: SqlTag, feeRawId: number): Promise<Extract<LockedRawSourceResult, { kind: "bound" }>> {
  if (positiveId(feeRawId) == null) return stop({ kind: "unavailable", reason: "missing_raw" });
  const [before] = await scope<Snapshot[]>`
    SELECT fr.*, to_jsonb(fr)::text AS binding_state
    FROM raw_fee_observations fr WHERE fr.fee_raw_id=${feeRawId}`;
  if (!before) return stop({ kind: "unavailable", reason: "missing_raw" });
  const documentId = positiveId(before.source_document_id);
  const institutionId = positiveId(before.institution_id);
  if (documentId == null) return stop({ kind: "unavailable", reason: "no_document" });
  if (institutionId == null) return stop({ kind: "unavailable", reason: "owner_mismatch" });
  const source = (await lockSourcePrefix(scope, [{ documentId, institutionId }])).get(documentId)!;
  const [after] = await scope<Snapshot[]>`
    SELECT fr.*, to_jsonb(fr)::text AS binding_state
    FROM raw_fee_observations fr WHERE fr.fee_raw_id=${feeRawId} FOR UPDATE NOWAIT`;
  if (!after || before.binding_state !== after.binding_state) return stop({ kind: "changed" });
  const currentRaw: LockedRawFee & { binding_state?: string } = { ...after };
  delete currentRaw.binding_state;
  return { kind: "bound" as const, currentRaw, source };
}

/**
 * Hold an available factual source through raw CAS and subsequent consumer work, even
 * when the own-clause cue is absent. This closes a negative-cue/source-replacement race.
 * A bound result DOES NOT prove the raw's original digest; a consumer granting new own
 * clause authority must separately require matchOriginalRawSource(...). No date policy.
 */
export async function withLockedCurrentRawSource(tx: SqlTag, feeRawId: number): Promise<LockedCurrentRawSourceResult> {
  return sourceSavepoint(tx, scope => lockCurrentRawSource(scope, feeRawId));
}

/**
 * Require both current facts and the raw's exact original artifact/digest. Busy/changed/
 * unavailable rolls back the savepoint and writes nothing. Only bound keeps doc→artifact
 * →raw locks through caller settlement. No caller row/text/cache or historical witness
 * supplies authority. Consumers decide every nonbound disposition explicitly.
 */
export async function withLockedRawSource(tx: SqlTag, feeRawId: number): Promise<LockedRawSourceResult> {
  return sourceSavepoint(tx, async scope => {
    const current = await lockCurrentRawSource(scope, feeRawId);
    const binding = matchOriginalRawSource(current.currentRaw, current.source);
    if (binding.kind !== "matched") return stop(binding);
    return current;
  });
}
