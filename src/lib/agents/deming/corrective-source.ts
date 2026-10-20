import { createHash } from "node:crypto";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { releaseCategoryPattern } from "@/lib/agents/darwin/release-held";

/** A human's validated correction context; never evidence of the original Knox input. */
export const CORRECTIVE_KIND = "corrective_publication_v2";
export const CORRECTIVE_CHECK = "admin.fee_correction.source_context";
export const SOURCE_CODEPOINT_CAP = 200_000;
export const SOURCE_BYTE_CAP = 800_000;
export const CASE_BYTE_CAP = 1_048_576;
export const METADATA_BYTE_CAP = 8192;
export const SOURCE_PHASE_BYTE_CAP = 8 * 1024 * 1024;
export const ARTIFACT_CHUNK_CAP = 2 * 1024 * 1024;

type ObjectValue = Record<string, unknown>;
export function object(value: unknown): value is ObjectValue {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const sourceHash = (value: string): string => createHash("sha256").update(value).digest("hex");
export const evidenceHash = (value: unknown): string => sourceHash(stableJson(value));
export const encodedBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const boundedString = (v: unknown, cap: number): v is string => typeof v === "string" && Buffer.byteLength(v) <= cap && !v.includes("\0");

export interface CorrectiveDocument {
  id: number;
  institutionId: number;
  astId: number;
  astInstitutionId: number;
  status: "completed";
  documentUrl: string;
  contentHash: string;
  /** Stored normalization-to-edition association, not proof of original PDF bytes or extraction. */
  sourceHash: string;
  textHash: string;
  normalizedText: string;
}
export interface CorrectionPayload {
  context: "human_validated_edition";
  originalExtractionBinding: "unknown";
  canonical: ObjectValue;
  feeContext: ObjectValue;
  documents: CorrectiveDocument[];
  origin: ObjectValue;
}
export interface CorrectiveReceipt {
  protocol: 2;
  payload: CorrectionPayload;
  digest: string;
  databaseDigest: string;
}
export interface CorrectiveInput {
  kind: typeof CORRECTIVE_KIND;
  receipt: CorrectiveReceipt;
}
export type CorrectiveVerdict = { evaluated: true; caught: boolean; verdict: "old_refused_corrected_accepted" | "both_accepted" | "corrected_refused" }
  | { evaluated: false; caught: null; verdict: "unavailable" | "unsupported_context" };

/** Structural/body checks only. The consumed database selector verifies both digest and canonical/origin authority. No JSON-string fallback. */
export function validCorrectiveReceipt(value: unknown): value is CorrectiveReceipt {
  try { return receiptShape(value); } catch { return false; }
}
function receiptShape(value: unknown): value is CorrectiveReceipt {
  if (!object(value) || value.protocol !== 2 || !hash(value.digest) || !hash(value.databaseDigest) || !object(value.payload)) return false;
  const p = value.payload;
  if (p.context !== "human_validated_edition" || p.originalExtractionBinding !== "unknown" || !object(p.canonical) || !object(p.feeContext) || !object(p.origin)
      || !Array.isArray(p.documents) || p.documents.length !== 1) return false;
  const c = p.canonical;
  if (![c.id, c.institution_id, c.fee_chain_id, c.fee_published_id, c.previous_fee_published_id, c.source_document_id, c.actor_user_id].every(positiveId)
      || c.action !== "correct" || !positiveId(c.version) || !boundedString(c.actor_name, 200)
      || !boundedString(c.source_excerpt, 4096) || !boundedString(c.source_location, 1024)) return false;
  const d = p.documents[0];
  if (!object(d) || !positiveId(d.id) || !positiveId(d.astId) || d.id !== c.source_document_id || d.institutionId !== c.institution_id
      || d.astInstitutionId !== c.institution_id || d.status !== "completed" || !boundedString(d.documentUrl, 2048)
      || !boundedString(d.contentHash, 256) || !d.contentHash || d.sourceHash !== d.contentHash || !hash(d.textHash) || !boundedString(d.normalizedText, SOURCE_BYTE_CAP)
      || !d.normalizedText || Array.from(d.normalizedText).length > SOURCE_CODEPOINT_CAP || sourceHash(d.normalizedText) !== d.textHash
      || !d.normalizedText.replace(/\s+/g, " ").includes(c.source_excerpt.replace(/\s+/g, " "))) return false;
  const metadata = { ...p, documents: [{ ...d, normalizedText: undefined }] };
  if (encodedBytes(metadata) > METADATA_BYTE_CAP || encodedBytes(value) > CASE_BYTE_CAP || value.digest !== value.databaseDigest) return false;
  return validOrigin(p);
}

/** A provenance check against actual server-produced field projections, not an actor supplied to a fixture. */
export function validOrigin(p: CorrectionPayload | ObjectValue): boolean {
  if (!object(p.canonical) || !object(p.origin)) return false;
  const c = p.canonical;
  const { run: r, step: s, event: e, feedback: f } = p.origin;
  if (![r, s, e, f].every(object)) return false;
  const run = r as ObjectValue, step = s as ObjectValue, event = e as ObjectValue, feedback = f as ObjectValue;
  if (![run.id, step.id, event.id, feedback.id].every(positiveId) || run.agent_name !== "hamilton" || run.run_kind !== "manual_repair"
      || run.status !== "completed" || run.trigger_source !== "admin" || run.triggered_by !== `user:${c.actor_user_id}`
      || step.agent_run_id !== run.id || step.agent_name !== "hamilton" || step.step_key !== "admin.fee_correct" || step.status !== "completed"
      || event.agent_run_id !== run.id || event.step_id !== step.id || event.event_type !== "fee.correct" || event.status !== "completed"
      || feedback.agent_run_id !== run.id || feedback.reported_by !== "human" || feedback.kind !== "admin_correction" || feedback.signal !== "wrong"
      || feedback.check_name !== "admin.fee_correction" || feedback.dedupe_key !== `admin.fee_correction:${c.id}`
      || feedback.institution_id !== c.institution_id || feedback.source_document_id !== c.source_document_id
      || feedback.fee_published_id !== c.previous_fee_published_id || feedback.canonical_fee_key !== c.before_canonical_fee_key
      || feedback.amount !== c.before_amount) return false;
  const before = { canonicalFeeKey: c.before_canonical_fee_key, feeName: c.before_fee_name, amount: c.before_amount, frequency: c.before_frequency, conditions: c.before_conditions };
  const after = { canonicalFeeKey: c.canonical_fee_key, feeName: c.fee_name, amount: c.amount, frequency: c.frequency, conditions: c.conditions };
  const detail = { action: "correct", institution_id: c.institution_id, actor_id: c.actor_user_id, actor: c.actor_name,
    fee_published_id: c.previous_fee_published_id, fee_chain_id: c.fee_chain_id, version: c.version, reason: c.reason, before, after };
  if (stableJson(run.params_json) !== stableJson(detail) || stableJson(step.input_payload) !== stableJson(detail) || stableJson(event.detail) !== stableJson(detail)
      || !object(feedback.evidence)) return false;
  const fdata = feedback.evidence;
  return fdata.action === "correct" && fdata.correction_id === c.id && fdata.fee_chain_id === c.fee_chain_id && fdata.version === c.version
    && fdata.new_fee_published_id === c.fee_published_id && fdata.actor_id === c.actor_user_id && fdata.actor === c.actor_name
    && fdata.reason === c.reason && fdata.source_excerpt === c.source_excerpt && fdata.source_location === c.source_location
    && stableJson(fdata.before) === stableJson(before) && stableJson(fdata.after) === stableJson(after);
}

export function replayCorrective(input: unknown): CorrectiveVerdict {
  if (!object(input) || input.kind !== CORRECTIVE_KIND || !validCorrectiveReceipt(input.receipt)) return { evaluated: false, caught: null, verdict: "unavailable" };
  const { canonical: c, documents: [d] } = input.receipt.payload;
  // This first protocol covers the source's named flat price. Category-only, frequency/conditions or
  // rates changes are other error families; a price checker cannot certify their expected labels.
  if (input.receipt.payload.feeContext.amount_kind !== "flat" || (input.receipt.payload.feeContext.rate_percent != null)
      || c.before_canonical_fee_key !== c.canonical_fee_key || c.before_frequency !== c.frequency || c.before_conditions !== c.conditions
      || typeof c.amount !== "number" || !Number.isFinite(c.amount) || typeof c.before_amount !== "number" || !Number.isFinite(c.before_amount)
      || (c.before_amount === c.amount && c.before_fee_name === c.fee_name)) return { evaluated: false, caught: null, verdict: "unsupported_context" };
  const pattern = releaseCategoryPattern(String(c.canonical_fee_key));
  if (!pattern) return { evaluated: false, caught: null, verdict: "unsupported_context" };
  const old = checkFeeAgainstSource(d.normalizedText, String(c.before_fee_name), c.before_amount, pattern, String(c.canonical_fee_key));
  const corrected = checkFeeAgainstSource(d.normalizedText, String(c.fee_name), c.amount, pattern, String(c.canonical_fee_key));
  return { evaluated: true, caught: !old.ok && corrected.ok, verdict: !corrected.ok ? "corrected_refused" : old.ok ? "both_accepted" : "old_refused_corrected_accepted" };
}

export interface FixtureCase { caseId: number; input: CorrectiveInput; outcome: CorrectiveVerdict }
export interface FixtureArtifact { protocol: 2; chunks: Array<{ protocol: 2; index: number; cases: FixtureCase[] }>; caseCount: number; bytes: number; complete: boolean; digest: string }
/** Actual replay inputs/outcomes only; bounded whole objects, no production-to-CI delivery claim. */
export function fixtureArtifact(cases: FixtureCase[]): FixtureArtifact {
  const chunks: FixtureArtifact["chunks"] = [];
  let bytes = 0, caseCount = 0;
  for (const item of cases) {
    if (!positiveId(item.caseId) || !item.outcome.evaluated || !validCorrectiveReceipt(item.input.receipt) || encodedBytes(item) > CASE_BYTE_CAP) break;
    const last = chunks.at(-1);
    const candidate = last ? { ...last, cases: [...last.cases, item] } : { protocol: 2 as const, index: 0, cases: [item] };
    const addition = encodedBytes(candidate) - (last ? encodedBytes(last) : 0);
    if (bytes + addition > SOURCE_PHASE_BYTE_CAP - 32 * 1024) break;
    if (encodedBytes(candidate) <= ARTIFACT_CHUNK_CAP - 1024) {
      if (last) chunks[chunks.length - 1] = candidate; else chunks.push(candidate);
      bytes += addition;
    } else {
      const next = { protocol: 2 as const, index: chunks.length, cases: [item] };
      if (encodedBytes(next) > ARTIFACT_CHUNK_CAP - 1024 || bytes + encodedBytes(next) > SOURCE_PHASE_BYTE_CAP - 32 * 1024) break;
      chunks.push(next); bytes += encodedBytes(next);
    }
    caseCount++;
  }
  return { protocol: 2, chunks, caseCount, bytes, complete: caseCount === cases.length, digest: evidenceHash(chunks) };
}
