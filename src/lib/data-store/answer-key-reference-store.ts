import { createHash } from "node:crypto";
import { z } from "zod";
import { sql } from "./connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import {
  ANSWER_KEY_ELIGIBILITY_EVENT, ANSWER_KEY_ELIGIBILITY_MAX_AGE_MS, ANSWER_KEY_ELIGIBILITY_PROTOCOL,
  referenceKeyFingerprint, referenceSourceFingerprint,
  type ReferenceEligibilityReceipt, type ReferenceKeySnapshot, type ReferenceScoreCohort, type ReferenceSourceIdentity,
} from "./answer-key-eligibility";

type SqlTag = typeof sql;
export interface ReferenceInput { key: ReferenceKeySnapshot; sources: ReferenceSourceIdentity[]; rawState: unknown }
export interface ReferenceDecision {
  input: ReferenceInput;
  receipt: ReferenceEligibilityReceipt | null;
  eventId: number | null;
  status: "eligible" | "rejected" | "unknown";
  reason: string;
}
export interface ReferenceEligibilitySnapshot {
  protocol: number;
  revision: string;
  keys: ReferenceDecision[];
  cohort: ReferenceScoreCohort;
  readError: boolean;
}

// The same statement constructs both the observed state and the INSERT's final guard.
// No extension/digest/DDL is needed. JSONB equality checks every expected fee and source
// identity in one statement snapshot; a concurrent later edit invalidates the next read.
const INPUT_SQL = `
  SELECT ak.id, ak.institution_id, inst.institution_name, inst.website_url, inst.fee_schedule_url,
         ak.document_url, ak.document_type, ak.content_hash, ak.status, ak.confirmed_by, ak.confirmed_at,
         fees.rows AS fees, sources.rows AS sources,
         jsonb_build_object('key', to_jsonb(ak), 'institution',
           jsonb_build_object('id', inst.id, 'name', inst.institution_name, 'website', inst.website_url,
             'fee_schedule', inst.fee_schedule_url), 'fees', fees.rows, 'sources', sources.rows) AS raw_state
    FROM answer_key_institutions ak
    JOIN institution_sources inst ON inst.id = ak.institution_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.id), '[]'::jsonb) AS rows
        FROM answer_key_fees f WHERE f.answer_key_institution_id = ak.id AND f.status = 'confirmed'
    ) fees
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', d.id, 'document_url', d.document_url, 'content_hash', d.content_hash, 'status', d.status,
        'superseded_by_id', d.superseded_by_id, 'duplicate_of_id', d.duplicate_of_id,
        'text_id', t.id, 'text_hash', t.text_hash, 'text_status', t.status, 'document_kind', t.document_kind
      ) ORDER BY d.id), '[]'::jsonb) AS rows
      FROM source_documents d
      LEFT JOIN LATERAL (
        SELECT id, text_hash, status, document_kind FROM agent_source_texts
         WHERE source_document_id = d.id ORDER BY updated_at DESC, id DESC LIMIT 1
      ) t ON TRUE
      WHERE d.institution_id = ak.institution_id
    ) sources
   WHERE ak.status = 'confirmed'
`;

const iso = (value: unknown): string | null => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
const num = (value: unknown): number | null => value == null ? null : Number(value);
type Row = Record<string, unknown>;
function mapInput(row: Row): ReferenceInput {
  return {
    rawState: row.raw_state,
    key: {
      answerKeyId: Number(row.id), institutionId: Number(row.institution_id), institutionName: String(row.institution_name),
      websiteUrl: row.website_url as string | null, institutionFeeScheduleUrl: row.fee_schedule_url as string | null,
      documentUrl: String(row.document_url), documentType: String(row.document_type), contentHash: row.content_hash as string | null,
      status: String(row.status), confirmedBy: row.confirmed_by as string | null, confirmedAt: iso(row.confirmed_at),
      fees: (row.fees as Row[]).map((fee) => ({
        id: Number(fee.id), canonicalKey: String(fee.canonical_key), amount: num(fee.amount), amountKind: String(fee.amount_kind),
        frequency: fee.frequency as string | null, conditions: fee.conditions as string | null, sourceLine: fee.source_line as string | null,
        uncertain: fee.uncertain === true, status: String(fee.status), confirmedBy: fee.confirmed_by as string | null, confirmedAt: iso(fee.confirmed_at),
      })),
    },
    sources: (row.sources as Row[]).map((source) => ({
      id: Number(source.id), documentUrl: source.document_url as string | null, contentHash: source.content_hash as string | null,
      status: String(source.status), supersededById: num(source.superseded_by_id), duplicateOfId: num(source.duplicate_of_id),
      textId: num(source.text_id), textHash: source.text_hash as string | null, textStatus: source.text_status as string | null,
      documentKind: source.document_kind as string | null,
    })),
  };
}

export async function loadReferenceInputs(db: SqlTag = sql): Promise<ReferenceInput[]> {
  return (await db.unsafe<Row[]>(`${INPUT_SQL} ORDER BY ak.id`)).map(mapInput);
}

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reason = z.string().min(1).max(100);
const fact = z.object({ status: z.enum(["pass", "fail", "unknown"]), reasons: z.array(reason).max(20) });
const receiptShape = z.object({
  protocol: z.literal(ANSWER_KEY_ELIGIBILITY_PROTOCOL), answerKeyId: z.number().int().positive(), institutionId: z.number().int().positive(),
  keyFingerprint: hash, sourceInventoryFingerprint: hash, checkedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  status: z.enum(["eligible", "rejected", "unknown"]),
  facts: z.object({ consumer: fact, current: fact, priced: fact }), reasons: z.array(reason).max(60),
  observations: z.array(z.object({
    requestedUrl: z.string().max(2_000), finalUrl: z.string().max(2_000), contentHash: hash,
    contentType: z.string().max(500).nullable(), etag: z.string().max(500).nullable(), lastModified: z.string().max(500).nullable(),
    checkedAt: z.iso.datetime(), effectiveDate: z.string().nullable(), sourceDocumentId: z.number().int().positive().nullable(),
    sourceTextId: z.number().int().positive().nullable(), textHash: hash.nullable(), status: z.number().int(),
    links: z.array(z.string().max(2_000)).max(160), excerpt: z.string().max(500),
  })).max(6),
  discovery: z.object({ entryUrls: z.array(z.string().max(2_000)).max(6), examinedUrls: z.array(z.string().max(2_000)).max(6),
    candidateUrls: z.array(z.string().max(2_000)).max(160), completeWithinProtocol: z.boolean(),
    linkedFromOfficialSite: z.boolean(), limitReason: z.string().max(100).nullable(),
    skippedHubCount: z.number().int().nonnegative().optional() }),
});

interface EventRow { step_valid: boolean; id: number | string; agent_run_id: number | string; detail: unknown; created_at: Date | string }
function decide(input: ReferenceInput, event: EventRow | undefined, now: Date): ReferenceDecision {
  const excluded = (reason: string, receipt: ReferenceEligibilityReceipt | null = null): ReferenceDecision => ({ input, receipt, eventId: event ? Number(event.id) : null, status: "unknown", reason });
  if (!event) return excluded("eligibility_missing");
  const parsed = receiptShape.safeParse(event.detail);
  if (event.step_valid !== true || !parsed.success || !Number.isSafeInteger(Number(event.id)) || Number(event.id) <= 0
    || !Number.isSafeInteger(Number(event.agent_run_id)) || Number(event.agent_run_id) <= 0) return excluded("eligibility_malformed");
  const receipt = parsed.data;
  if (receipt.answerKeyId !== input.key.answerKeyId || receipt.institutionId !== input.key.institutionId
    || receipt.keyFingerprint !== referenceKeyFingerprint(input.key)
    || receipt.sourceInventoryFingerprint !== referenceSourceFingerprint(input.sources)) return excluded("eligibility_identity_changed", receipt);
  const at = Date.parse(receipt.checkedAt), expires = Date.parse(receipt.expiresAt), created = new Date(event.created_at).getTime();
  if (!Number.isFinite(created) || at > now.getTime() || created > now.getTime() || at > created + 1_000
    || expires <= now.getTime() || expires <= at || expires - at > ANSWER_KEY_ELIGIBILITY_MAX_AGE_MS
    || now.getTime() - at > ANSWER_KEY_ELIGIBILITY_MAX_AGE_MS) return excluded("eligibility_stale", receipt);
  if (receipt.status === "eligible" && (!Object.values(receipt.facts).every((value) => value.status === "pass")
    || !receipt.discovery.completeWithinProtocol || !receipt.discovery.linkedFromOfficialSite || receipt.discovery.limitReason)) {
    return excluded("eligibility_malformed", receipt);
  }
  if (receipt.status === "eligible" && !input.key.fees.some((fee) => fee.status === "confirmed" && fee.canonicalKey !== "unmapped")) {
    return excluded("eligibility_no_expected_fees", receipt);
  }
  return { input, receipt, eventId: Number(event.id), status: receipt.status,
    reason: receipt.status === "eligible" ? "eligible" : receipt.reasons.filter((value) => !value.startsWith("consumer_reference") && !value.startsWith("priced_fee") && !value.startsWith("current_within"))[0] ?? "eligibility_unknown" };
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function referenceSnapshot(inputs: ReferenceInput[], events: EventRow[], now = new Date(), readError = false): ReferenceEligibilitySnapshot {
  const latest = new Map<number, EventRow>();
  let unidentifiedTombstone = false;
  // Callers supply newest first. Malformed latest entries are tombstones, never skipped.
  for (const event of events) {
    const id = event.detail && typeof event.detail === "object" ? Number((event.detail as Row).answerKeyId) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) { unidentifiedTombstone = true; continue; }
    if (!latest.has(id)) latest.set(id, event);
  }
  const keys = inputs.map((input) => decide(input, latest.get(input.key.answerKeyId), now));
  if (readError || unidentifiedTombstone) for (const key of keys) { key.status = "unknown"; key.reason = readError ? "eligibility_read_failed" : "eligibility_unidentified_tombstone"; }
  const eligible = keys.filter((key) => key.status === "eligible");
  const feeCount = (list: ReferenceDecision[]) => list.reduce((total, row) => total + row.input.key.fees.filter((fee) => fee.canonicalKey !== "unmapped").length, 0);
  const byReason: Record<string, number> = {};
  for (const key of keys.filter((key) => key.status !== "eligible")) byReason[key.reason] = (byReason[key.reason] ?? 0) + 1;
  const cohort: ReferenceScoreCohort = {
    readError,
    protocol: ANSWER_KEY_ELIGIBILITY_PROTOCOL, state: feeCount(eligible) > 0 ? "measured" : "no_measurement", checkedAt: now.toISOString(),
    frameFingerprint: digest(keys.map((key) => referenceKeyFingerprint(key.input.key)).sort()),
    cohortFingerprint: digest(eligible.map((key) => referenceKeyFingerprint(key.input.key)).sort()),
    confirmedBanks: keys.length, eligibleBanks: eligible.length, excludedBanks: keys.length - eligible.length,
    confirmedFees: feeCount(keys), eligibleFees: feeCount(eligible), excludedFees: feeCount(keys) - feeCount(eligible),
    receiptIds: eligible.map((key) => key.eventId!), byReason,
  };
  return { protocol: ANSWER_KEY_ELIGIBILITY_PROTOCOL, keys, cohort, readError,
    revision: digest(keys.map((key) => [key.input.key.answerKeyId, referenceKeyFingerprint(key.input.key), referenceSourceFingerprint(key.input.sources), key.eventId, key.status, key.reason])) };
}

export async function readReferenceEligibility(db: SqlTag = sql, now = new Date()): Promise<ReferenceEligibilitySnapshot> {
  let inputs: ReferenceInput[] = [];
  try {
    return await inSavepoint(db, async (scope) => {
      inputs = await loadReferenceInputs(scope);
      const events = await scope<EventRow[]>`
        SELECT e.id, e.agent_run_id, e.detail, e.created_at, (s.id IS NOT NULL) AS step_valid FROM agent_run_events e
         LEFT JOIN agent_run_steps s ON s.id=e.step_id AND s.agent_run_id=e.agent_run_id AND s.step_key='score-answer-key'
         WHERE e.event_type = ${ANSWER_KEY_ELIGIBILITY_EVENT}
           AND e.created_at >= ${new Date(now.getTime() - ANSWER_KEY_ELIGIBILITY_MAX_AGE_MS).toISOString()}::timestamptz
         ORDER BY e.created_at DESC, e.id DESC LIMIT 10000
      `;
      return referenceSnapshot(inputs, events, now);
    });
  } catch { return referenceSnapshot(inputs, [], now, true); }
}

/** Atomic final state guard: no stale fetch can become a trusted receipt. */
export async function persistReferenceReceipt(db: SqlTag, input: ReferenceInput, receipt: ReferenceEligibilityReceipt,
  runId: number, stepId: number): Promise<number | null> {
  if (!Number.isSafeInteger(runId) || runId <= 0 || !Number.isSafeInteger(stepId) || stepId <= 0) return null;
  const parsed = receiptShape.safeParse(receipt);
  if (!parsed.success || parsed.data.keyFingerprint !== referenceKeyFingerprint(input.key)
    || parsed.data.sourceInventoryFingerprint !== referenceSourceFingerprint(input.sources)) return null;
  const rows = await inSavepoint(db, (scope) => scope.unsafe<{ id: number | string }[]>(`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail, created_at)
    SELECT $1, $2, $3, 'info', 'Checked answer-key document eligibility', $4::jsonb, clock_timestamp()
     WHERE EXISTS (SELECT 1 FROM (${INPUT_SQL} AND ak.id = $5) current
                    WHERE current.raw_state = $6::jsonb)
       AND EXISTS (SELECT 1 FROM agent_run_steps WHERE id = $2 AND agent_run_id = $1 AND step_key = 'score-answer-key')
    RETURNING id
  `, [runId, stepId, ANSWER_KEY_ELIGIBILITY_EVENT, JSON.stringify(receipt), input.key.answerKeyId, JSON.stringify(input.rawState)]));
  return rows[0] ? Number(rows[0].id) : null;
}

export const eligibleReferences = (snapshot: ReferenceEligibilitySnapshot): ReferenceDecision[] => snapshot.keys.filter((key) => key.status === "eligible");

const count = z.number().int().nonnegative();
const cohortShape = z.object({
  readError: z.boolean().default(false),
  protocol: z.literal(ANSWER_KEY_ELIGIBILITY_PROTOCOL), state: z.enum(["measured", "no_measurement"]), checkedAt: z.iso.datetime(),
  frameFingerprint: hash, cohortFingerprint: hash, confirmedBanks: count, eligibleBanks: count, excludedBanks: count,
  confirmedFees: count, eligibleFees: count, excludedFees: count, receiptIds: z.array(z.number().int().positive()).max(10_000),
  byReason: z.record(z.string(), count),
}).refine((value) => value.confirmedBanks === value.eligibleBanks + value.excludedBanks
  && value.confirmedFees === value.eligibleFees + value.excludedFees
  && (value.state !== "measured" || (!value.readError && value.eligibleBanks > 0 && value.eligibleFees > 0)));

export function referenceScoreCohort(value: unknown): ReferenceScoreCohort | null {
  const parsed = cohortShape.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function sameReferenceCohort(a: ReferenceScoreCohort | null, b: ReferenceScoreCohort | null): boolean {
  return a != null && b != null && !a.readError && !b.readError && a.protocol === b.protocol && a.cohortFingerprint === b.cohortFingerprint
    && a.frameFingerprint === b.frameFingerprint && a.eligibleBanks === b.eligibleBanks && a.eligibleFees === b.eligibleFees;
}

export function referenceFeeFingerprint(key: ReferenceKeySnapshot, feeId: number): string {
  const fee = key.fees.find((row) => row.id === feeId);
  return digest([referenceKeyFingerprint(key), fee ?? null]);
}

/** Original eligible receipts may age out; current eligibility still gates their exact key snapshot. */
export async function loadReferenceOrigins(db: SqlTag, ids: number[]): Promise<Map<number, ReferenceEligibilityReceipt>> {
  const unique = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 10_000);
  const origins = new Map<number, ReferenceEligibilityReceipt>();
  if (unique.length === 0) return origins;
  const rows = await inSavepoint(db, (scope) => scope<Array<{ id: number | string; detail: unknown }>>`
    SELECT e.id, e.detail FROM agent_run_events e
    JOIN agent_run_steps s ON s.id=e.step_id AND s.agent_run_id=e.agent_run_id AND s.step_key='score-answer-key'
    WHERE e.id=ANY(${unique}::bigint[]) AND e.event_type=${ANSWER_KEY_ELIGIBILITY_EVENT}
  `);
  for (const row of rows) {
    const parsed = receiptShape.safeParse(row.detail);
    if (parsed.success && parsed.data.status === "eligible" && Object.values(parsed.data.facts).every((fact) => fact.status === "pass")
      && parsed.data.discovery.completeWithinProtocol && parsed.data.discovery.linkedFromOfficialSite && !parsed.data.discovery.limitReason) {
      origins.set(Number(row.id), parsed.data);
    }
  }
  return origins;
}

/** Parameterized current payload plus immutable original receipt; unbound history is excluded. */
export function eligibleReferenceFeedbackSql(db: SqlTag, alias: string, snapshot: ReferenceEligibilitySnapshot) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid internal feedback alias");
  const bound = eligibleReferences(snapshot).flatMap(({ input: { key } }) => key.fees.filter((fee) => fee.canonicalKey !== "unmapped").map((fee) => ({
    key_id: key.answerKeyId, institution_id: key.institutionId, fee_id: fee.id,
    key_fingerprint: referenceKeyFingerprint(key), fee_fingerprint: referenceFeeFingerprint(key, fee.id),
    canonical_key: fee.canonicalKey, amount: fee.amount, amount_kind: fee.amountKind,
    source_url: key.documentUrl, source_line: fee.sourceLine, weight: fee.uncertain ? 0.5 : 1,
  })));
  const statement = `(${alias}.kind <> 'answer_key' OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS reference(
      key_id bigint, institution_id bigint, fee_id bigint, key_fingerprint text, fee_fingerprint text,
      canonical_key text, amount numeric, amount_kind text, source_url text, source_line text, weight numeric)
    JOIN agent_run_events origin ON origin.id = CASE WHEN ${alias}.evidence->>'reference_event_id' ~ '^[1-9][0-9]{0,17}$'
      THEN (${alias}.evidence->>'reference_event_id')::bigint ELSE NULL END
    JOIN agent_run_steps origin_step ON origin_step.id = origin.step_id
      AND origin_step.agent_run_id = origin.agent_run_id AND origin_step.step_key = 'score-answer-key'
    WHERE ${alias}.evidence->'reference_protocol' = '1'::jsonb
      AND ${alias}.evidence->>'answer_key_fee_id' = reference.fee_id::text
      AND ${alias}.evidence->>'reference_key_fingerprint' = reference.key_fingerprint
      AND ${alias}.evidence->>'reference_fee_fingerprint' = reference.fee_fingerprint
      AND ${alias}.institution_id = reference.institution_id
      AND ${alias}.canonical_fee_key = reference.canonical_key
      AND ${alias}.amount IS NOT DISTINCT FROM reference.amount
      AND ${alias}.source_url = reference.source_url
      AND ${alias}.evidence->>'source_line' = reference.source_line
      AND ${alias}.evidence->>'amount_kind' = reference.amount_kind
      AND (${alias}.evidence->>'fee_name' IS NULL OR ${alias}.evidence->>'fee_name' = reference.source_line)
      AND ${alias}.weight = reference.weight AND ${alias}.signal = 'right'
      AND ${alias}.about_stage = 'extract' AND ${alias}.check_name = 'answer_key'
      AND origin.event_type = 'answer_key.eligibility'
      AND origin.detail->'protocol' = '1'::jsonb
      AND origin.detail->'answerKeyId' = to_jsonb(reference.key_id)
      AND origin.detail->'institutionId' = to_jsonb(reference.institution_id)
      AND origin.detail->>'keyFingerprint' = reference.key_fingerprint
      AND origin.detail->>'status' = 'eligible'
      AND origin.detail #>> '{facts,consumer,status}' = 'pass'
      AND origin.detail #>> '{facts,current,status}' = 'pass'
      AND origin.detail #>> '{facts,priced,status}' = 'pass'
      AND origin.detail #> '{discovery,completeWithinProtocol}' = 'true'::jsonb
      AND origin.detail #> '{discovery,linkedFromOfficialSite}' = 'true'::jsonb
      AND origin.detail #> '{discovery,limitReason}' = 'null'::jsonb
  ))`;
  const [before, after] = statement.split("$1");
  // A nested unsafe query with positional parameters loses them in postgres.js.
  // Keep the fixed internal SQL fragments separate and bind JSON with the parent tag.
  return db`${db.unsafe(before)}${JSON.stringify(bound)}${db.unsafe(after)}`;
}
