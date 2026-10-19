import { productKey } from "@/lib/fee-product";
import type { ExtractedFeeCandidate } from "./rules";
import { candidateWriteFacts } from "./candidate-facts";

export const MAX_TAKEDOWN_WITNESS_BYTES = 64_000;
/** Optional snapshot transport, not a limit on the existing verdict cohort. */
export const MAX_TAKEDOWN_WITNESS_TRANSFER_BYTES = 1_024_000;
export const MAX_TAKEDOWN_TEXT_CHARS = 250_000;
const HASH = /^[a-f0-9]{64}$/;
const text = (value: unknown) => typeof value === "string" ? productKey(value) : "";
const id = (value: unknown): number | null => {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9]\d*$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Decimal equality without two-decimal rounding or NUMERIC→Number precision loss. */
export function exactAmount(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = String(value).match(/^\+?(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = match[1].replace(/^0+(?=\d)/, ""), decimal = (match[2] ?? "").replace(/0+$/, "");
  return decimal ? `${whole}.${decimal}` : whole;
}

export interface TakedownIdentity {
  institutionId: number;
  category: string;
  name: string;
  amount: string;
  product: string;
  audience: string;
  frequency: string;
  treatment: string;
  conditions: string;
  variant: string;
  kind: "flat";
  ratePercent: string;
  rateMin: string;
  rateMax: string;
  rateBasis: string;
}

export function prospectiveTakedownIdentity(institutionId: number, candidate: ExtractedFeeCandidate): TakedownIdentity | null {
  const facts = candidateWriteFacts(candidate), amount = exactAmount(candidate.amount);
  if (!id(institutionId) || amount === null || !candidate.feeName || candidate.feeName.length > 160
    || !/^[a-z][a-z0-9_]{0,79}$/.test(candidate.canonicalHint)) return null;
  return { institutionId, category:candidate.canonicalHint, name:text(candidate.feeName), amount,
    product:text(facts.lineup?.productName), audience:facts.applicability.feeAudience,
    frequency:text(candidate.frequency), treatment:facts.applicability.feeTreatment,
    conditions:text(facts.sourceConditions), variant:"", kind:"flat", ratePercent:"", rateMin:"", rateMax:"", rateBasis:"" };
}

export const takedownIdentityKey = (identity: TakedownIdentity): string => JSON.stringify([
  identity.institutionId,identity.category,identity.name,identity.amount,identity.product,identity.audience,
  identity.frequency,identity.treatment,identity.conditions,identity.variant,identity.kind,
  identity.ratePercent,identity.rateMin,identity.rateMax,identity.rateBasis,
]);

export interface OriginalTextWitness {
  artifactId: number;
  sourceDocumentId: number;
  institutionId: number;
  hash: string;
}
export interface TakedownWitness {
  version: 1;
  check: "hamilton.limit_guard";
  judgeRunId: number;
  closureBatchId: string;
  publishedId: number;
  verifiedId: number;
  rawId: number;
  identity: TakedownIdentity;
  source: OriginalTextWitness;
  publishedState: string;
  verifiedState: string;
  rawState: string;
}
export type TakedownWitnessHeader = Omit<TakedownWitness, "publishedState" | "verifiedState" | "rawState">;

interface TakedownWitnessInput {
  witness_published_state?: string | null;
  witness_verified_state?: string | null;
  witness_raw_state?: string | null;
  witness_amount?: string | null;
  witness_text_id?: number | string | null;
  witness_document_id?: number | string | null;
  witness_institution_id?: number | string | null;
  witness_text_hash?: string | null;
  witness_text_verified?: boolean | null;
}
export interface TakedownWitnessRow { witness_payload?: unknown }

/** Select with fp/fv/fr aliases, before judgement. Closure is the only expected later publication change. */
export const TAKEDOWN_WITNESS_COLUMNS = `CASE
  WHEN octet_length(snapshot.payload::text) <= ${MAX_TAKEDOWN_WITNESS_BYTES}
  THEN snapshot.payload END AS witness_payload`;

/** An original raw observation's recorded artifact, never the document's latest text. */
export const TAKEDOWN_ORIGINAL_TEXT_JOIN = `LEFT JOIN agent_source_texts original
  ON original.id::text = substring(COALESCE(fr.extraction_note,fr.conditions) from 'Rosetta artifact #([1-9][0-9]{0,15})\\M')
 AND original.text_hash = substring(COALESCE(fr.extraction_note,fr.conditions) from 'text_hash=([a-f0-9]{64});')
 AND original.source_document_id = fr.source_document_id AND original.institution_id = fr.institution_id
 AND original.status = 'completed' AND char_length(original.normalized_text) <= ${MAX_TAKEDOWN_TEXT_CHARS}
 LEFT JOIN LATERAL (
   SELECT CASE WHEN original.id IS NOT NULL THEN jsonb_build_object(
     'witness_published_state',(to_jsonb(fp) - ARRAY['rolled_back_at','rolled_back_reason','rolled_back_by_batch_id'])::text,
     'witness_verified_state',to_jsonb(fv)::text,'witness_raw_state',to_jsonb(fr)::text,
     'witness_amount',fp.amount::text,'witness_text_id',original.id,
     'witness_document_id',original.source_document_id,'witness_institution_id',original.institution_id,
     'witness_text_hash',original.text_hash,
     'witness_text_verified',original.text_hash=encode(sha256(convert_to(original.normalized_text,'UTF8')),'hex')
   ) END AS payload
 ) snapshot ON TRUE`;

function object(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try { const result: unknown = JSON.parse(value); return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string,unknown> : null; }
  catch { return null; }
}

/** Called on the selected row BEFORE limitGuardVerdict. Missing proof is unknown, never inferred. */
export function captureTakedownWitness(selected: TakedownWitnessRow, judgement: { runId: number; batchId: string }): TakedownWitness | null {
  if (!id(judgement.runId) || typeof judgement.batchId!=="string" || !judgement.batchId || judgement.batchId.length>128) return null;
  if (!selected.witness_payload || typeof selected.witness_payload!=="object" || Array.isArray(selected.witness_payload)
    || Buffer.byteLength(JSON.stringify(selected.witness_payload),"utf8")>MAX_TAKEDOWN_WITNESS_BYTES) return null;
  const row=selected.witness_payload as TakedownWitnessInput;
  if ([row.witness_published_state,row.witness_verified_state,row.witness_raw_state]
    .reduce((n,s)=>n+(typeof s==="string"?Buffer.byteLength(s,"utf8"):0),0)>MAX_TAKEDOWN_WITNESS_BYTES) return null;
  const pub=object(row.witness_published_state), verified=object(row.witness_verified_state), raw=object(row.witness_raw_state);
  if (!pub || !verified || !raw || raw.source !== "knox" || pub.quarantined_at != null) return null;
  const publishedId=id(pub.fee_published_id),verifiedId=id(verified.fee_verified_id),rawId=id(raw.fee_raw_id),institutionId=id(pub.institution_id);
  const artifactId=id(row.witness_text_id),sourceDocumentId=id(row.witness_document_id);
  if (!publishedId || !verifiedId || !rawId || !institutionId || !artifactId || !sourceDocumentId
    || id(pub.lineage_ref)!==verifiedId || id(verified.fee_raw_id)!==rawId
    || id(verified.institution_id)!==institutionId || id(raw.institution_id)!==institutionId
    || id(raw.source_document_id)!==sourceDocumentId || id(row.witness_institution_id)!==institutionId
    || typeof row.witness_text_hash!=="string" || !HASH.test(row.witness_text_hash)
    || row.witness_text_verified!==true) return null;
  const note=typeof raw.extraction_note==="string" ? raw.extraction_note : typeof raw.conditions==="string" ? raw.conditions : "";
  const pointers=[...note.matchAll(/Rosetta artifact #([1-9][0-9]{0,15})\b/g)];
  const hashes=[...note.matchAll(/\btext_hash=([a-f0-9]{64});/g)];
  if (pointers.length!==1 || hashes.length!==1 || id(pointers[0][1])!==artifactId || hashes[0][1]!==row.witness_text_hash) return null;
  const amount=exactAmount(row.witness_amount),category=typeof pub.canonical_fee_key==="string" ? pub.canonical_fee_key : "";
  if (amount===null || !/^[a-z][a-z0-9_]{0,79}$/.test(category) || typeof pub.fee_name!=="string"
    || !pub.fee_name || pub.fee_name.length>160 || pub.amount_kind!=="flat") return null;
  const identity:TakedownIdentity={institutionId,category,name:text(pub.fee_name),amount,product:text(raw.product_name),
    audience:text(pub.fee_audience)||"unknown",frequency:text(pub.frequency),treatment:text(raw.fee_treatment)||"unknown",
    conditions:text(raw.conditions),variant:text(pub.variant_type),kind:"flat",
    ratePercent:pub.rate_percent==null?"":String(pub.rate_percent),rateMin:pub.rate_min_amount==null?"":String(pub.rate_min_amount),
    rateMax:pub.rate_max_amount==null?"":String(pub.rate_max_amount),rateBasis:text(pub.rate_basis)};
  const witness:TakedownWitness={version:1,check:"hamilton.limit_guard",judgeRunId:judgement.runId,closureBatchId:judgement.batchId,publishedId,verifiedId,rawId,identity,
    source:{artifactId,sourceDocumentId,institutionId,hash:row.witness_text_hash},
    publishedState:row.witness_published_state!,verifiedState:row.witness_verified_state!,rawState:row.witness_raw_state!};
  return Buffer.byteLength(JSON.stringify(witness),"utf8")<=MAX_TAKEDOWN_WITNESS_BYTES && readTakedownHeader(witness) ? witness : null;
}

/** A bounded index header; the original full receipt is checked again before a hard hold. */
export function readTakedownHeader(value: unknown): TakedownWitnessHeader | null {
  if (!value || typeof value!=="object" || Array.isArray(value)) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(value),"utf8")>MAX_TAKEDOWN_WITNESS_BYTES) return null;
    const w=value as TakedownWitnessHeader;
    if (w.version!==1 || w.check!=="hamilton.limit_guard" || !id(w.judgeRunId)
      || typeof w.closureBatchId!=="string" || !w.closureBatchId || w.closureBatchId.length>128
      || !id(w.publishedId) || !id(w.verifiedId) || !id(w.rawId)
      || !w.identity || !id(w.identity.institutionId) || exactAmount(w.identity.amount)!==w.identity.amount
      || w.identity.kind!=="flat" || !w.source || !id(w.source.artifactId) || !id(w.source.sourceDocumentId)
      || w.source.institutionId!==w.identity.institutionId || typeof w.source.hash!=="string" || !HASH.test(w.source.hash)) return null;
    const fields=[w.identity.category,w.identity.name,w.identity.product,w.identity.audience,w.identity.frequency,w.identity.treatment,
      w.identity.conditions,w.identity.variant,w.identity.ratePercent,w.identity.rateMin,w.identity.rateMax,w.identity.rateBasis];
    if (!fields.every(v=>typeof v==="string") || !/^[a-z][a-z0-9_]{0,79}$/.test(w.identity.category)
      || !w.identity.name || w.identity.name.length>160 || w.identity.product.length>160 || w.identity.conditions.length>8000
      || w.identity.frequency.length>80 || w.identity.variant.length>80 || w.identity.rateBasis.length>160
      || !["consumer","business","both","unknown"].includes(w.identity.audience)
      || !["charged","no_charge","eliminated","unknown"].includes(w.identity.treatment)
      || [w.identity.ratePercent,w.identity.rateMin,w.identity.rateMax].some(v=>v.length>80)) return null;
    return w;
  } catch { return null; }
}

/** Receipt validation, not a post-judgement source join that manufactures missing history. */
export function readTakedownWitness(value: unknown): TakedownWitness | null {
  if (!readTakedownHeader(value)) return null;
  const w=value as TakedownWitness;
  return object(w.publishedState) && object(w.verifiedState) && object(w.rawState) ? w : null;
}
