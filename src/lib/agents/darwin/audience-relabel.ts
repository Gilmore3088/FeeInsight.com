import { sql } from "@/lib/data-store/connection";
import { isPercentFee } from "@/lib/percent-fees";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { DARWIN_AUDIENCE_PREFIX, darwinAudience } from "./audience";
import { loadSourceTexts } from "./verify";

type SqlTag = typeof sql;

/**
 * #1059 step 3: Darwin's audience decision for live fees verified before migration
 * 20270110000047 let the verified tier keep it. James approved #1059 on 2026-10-14 (DECISIONS,
 * "Data-quality approvals"): 0 opposite-audience errors on unseen holdouts.
 *
 * Each live fee whose verified row is still `unknown` gets the same decision new verifications
 * get (`darwinAudience`, from Knox's context suggestion on the document's newest text). A fee it
 * cannot decide stays `unknown`. No provider calls.
 *
 * `AUDIENCE_RELABEL_MODE`:
 * - "off": a daily dry run. It reads every candidate and counts the decisions by audience and by
 *   evidence source, and writes nothing but its step on the run ledger.
 * - "live": the same read writes each decision to the verified row (`darwin:` evidence, which the
 *   trigger keeps) and touches the live published row so it inherits it. The old value is
 *   recorded first, one `audience_relabeled` row per fee in `pipeline_feedback`.
 * - "rollback": every fee those rows name that still carries the relabel's evidence goes back to
 *   its old evidence, and the trigger restores the raw row's audience (the old value).
 *
 * Needs migration 20270110000047: before it, the trigger overwrites a `darwin:` decision, so the
 * step reads only.
 */
export type AudienceRelabelMode = "off" | "live" | "rollback";
export const AUDIENCE_RELABEL_MODE: AudienceRelabelMode = "off";
export const AUDIENCE_RELABEL_VERSION = 1;
export const AUDIENCE_RELABEL_SOURCE = "darwin.audience_relabel";
export const AUDIENCE_RELABEL_KIND = "audience_relabeled";
/** Documents read per chunk: each chunk loads that many texts at once. */
const DOCUMENT_CHUNK = 200;
const SAMPLE_SIZE = 25;

export interface AudienceRelabelRow {
  fee_verified_id: number | string;
  fee_raw_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  source_url: string | null;
  fee_name: string;
  amount: number | string | null;
  amount_kind?: string | null;
  canonical_fee_key: string | null;
  audience_evidence: string | null;
  fee_published_ids: Array<number | string>;
}

export interface AudienceDecision {
  feeVerifiedId: number;
  feeAudience: "consumer" | "business" | "both" | "unknown";
  /** The suggestion's source (`section_heading`, `document_title`, ...), `no_text`, or `none`. */
  source: string;
  evidence: string | null;
}

export interface AudienceRelabelResult {
  mode: AudienceRelabelMode;
  dryRun: boolean;
  documents: number;
  fees: number;
  byAudience: Record<string, number>;
  bySource: Record<string, number>;
  relabeled: number;
  publishedTouched: number;
  restored: number;
  samples: Array<{ feeVerifiedId: number; feeName: string; amount: number | null; canonicalFeeKey: string | null; audience: string; evidence: string | null }>;
}

/** Darwin's decision for one live fee, from its document's newest text. Pure. */
export function decideAudience(row: AudienceRelabelRow, text: string | null): AudienceDecision {
  const feeVerifiedId = Number(row.fee_verified_id);
  if (!text) return { feeVerifiedId, feeAudience: "unknown", source: "no_text", evidence: null };
  const amount = isPercentFee(row as never) || row.amount == null ? null : Number(row.amount);
  const decision = darwinAudience({ fee_audience: "unknown", source_url: row.source_url, fee_name: row.fee_name }, amount, text);
  if (!decision) return { feeVerifiedId, feeAudience: "unknown", source: "none", evidence: null };
  const source = decision.audienceEvidence.slice(DARWIN_AUDIENCE_PREFIX.length).split(":")[0];
  return { feeVerifiedId, feeAudience: decision.feeAudience, source, evidence: decision.audienceEvidence };
}

/** The old value, recorded before a relabel writes, so a rollback can restore it. */
export function relabelRecord(row: AudienceRelabelRow, decision: AudienceDecision, runId: number | null): FeedbackRow {
  return {
    aboutStage: "verify",
    aboutStrategy: AUDIENCE_RELABEL_SOURCE,
    aboutVersion: AUDIENCE_RELABEL_VERSION,
    signal: "right",
    kind: AUDIENCE_RELABEL_KIND,
    reportedBy: "darwin",
    checkName: AUDIENCE_RELABEL_SOURCE,
    institutionId: Number(row.institution_id),
    sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
    feeRawId: Number(row.fee_raw_id),
    feeVerifiedId: decision.feeVerifiedId,
    canonicalFeeKey: row.canonical_fee_key,
    amount: row.amount == null ? null : Number(row.amount),
    // A record of what changed, never a lesson.
    weight: 0,
    evidence: {
      from_audience: "unknown",
      from_evidence: row.audience_evidence,
      to_audience: decision.feeAudience,
      to_evidence: decision.evidence,
      fee_published_ids: row.fee_published_ids.map(Number),
    },
    runId,
    dedupeKey: `${AUDIENCE_RELABEL_SOURCE}:verified:${decision.feeVerifiedId}`,
  };
}

function emptyResult(mode: AudienceRelabelMode, dryRun: boolean): AudienceRelabelResult {
  return { mode, dryRun, documents: 0, fees: 0, byAudience: {}, bySource: {}, relabeled: 0, publishedTouched: 0, restored: 0, samples: [] };
}

async function migrationReady(db: SqlTag): Promise<boolean> {
  const [row] = await db<Array<{ ready: boolean }>>`
    SELECT position('darwin:' IN pg_get_functiondef('public.inherit_fee_applicability()'::regprocedure)) > 0 AS ready
  `;
  return Boolean(row?.ready);
}

/** Live fees whose verified row is still unknown, on the next documents after `afterDocumentId`. */
async function candidateRows(db: SqlTag, afterDocumentId: number, institutionId: number | null): Promise<AudienceRelabelRow[]> {
  return db<AudienceRelabelRow[]>`
    WITH live AS (
      SELECT p.lineage_ref, p.fee_published_id
        FROM published_fee_records p
       WHERE p.fee_published_id IN (SELECT fee_published_id FROM published_fee_catalog
                                    UNION SELECT fee_published_id FROM published_fee_rate_catalog)
    ), docs AS (
      SELECT DISTINCT r.source_document_id
        FROM live
        JOIN verified_fee_observations v ON v.fee_verified_id = live.lineage_ref
        JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
       WHERE v.fee_audience = 'unknown'
         AND r.source_document_id > ${afterDocumentId}
         AND (${institutionId}::int IS NULL OR v.institution_id = ${institutionId}::int)
       ORDER BY r.source_document_id
       LIMIT ${DOCUMENT_CHUNK}
    )
    SELECT v.fee_verified_id, v.fee_raw_id, v.institution_id, r.source_document_id, r.source_url,
           r.fee_name, r.amount, r.amount_kind, v.canonical_fee_key, v.audience_evidence,
           array_agg(live.fee_published_id ORDER BY live.fee_published_id) AS fee_published_ids
      FROM live
      JOIN verified_fee_observations v ON v.fee_verified_id = live.lineage_ref
      JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
     WHERE v.fee_audience = 'unknown'
       AND r.source_document_id IN (SELECT source_document_id FROM docs)
       AND NOT COALESCE(r.outlier_flags, '[]'::jsonb) ? 'audience_correction_required'
       AND (${institutionId}::int IS NULL OR v.institution_id = ${institutionId}::int)
     GROUP BY v.fee_verified_id, v.fee_raw_id, v.institution_id, r.source_document_id, r.source_url,
              r.fee_name, r.amount, r.amount_kind, v.canonical_fee_key, v.audience_evidence
     ORDER BY r.source_document_id, v.fee_verified_id
  `;
}

async function writeDecisions(db: SqlTag, rows: AudienceRelabelRow[], decisions: AudienceDecision[]): Promise<{ relabeled: number; publishedTouched: number }> {
  const decided = decisions.filter((decision) => decision.feeAudience !== "unknown");
  if (decided.length === 0) return { relabeled: 0, publishedTouched: 0 };
  const updated = await db<Array<{ fee_verified_id: number | string }>>`
    UPDATE verified_fee_observations v
       SET fee_audience = d.fee_audience,
           audience_evidence = d.audience_evidence
      FROM unnest(${decided.map((d) => d.feeVerifiedId)}::bigint[], ${decided.map((d) => d.feeAudience)}::text[], ${decided.map((d) => d.evidence)}::text[])
           AS d(fee_verified_id, fee_audience, audience_evidence)
     WHERE v.fee_verified_id = d.fee_verified_id
       AND v.fee_audience = 'unknown'
    RETURNING v.fee_verified_id
  `;
  const ids = updated.map((row) => Number(row.fee_verified_id));
  const publishedIds = rows
    .filter((row) => ids.includes(Number(row.fee_verified_id)))
    .flatMap((row) => row.fee_published_ids.map(Number));
  // Touching the audience column fires the trigger, which copies the verified row's decision.
  const touched = publishedIds.length === 0 ? [] : await db`
    UPDATE published_fee_records SET fee_audience = fee_audience
     WHERE fee_published_id = ANY(${publishedIds}::bigint[])
    RETURNING fee_published_id
  `;
  return { relabeled: ids.length, publishedTouched: touched.length };
}

/** Puts every relabelled fee still carrying the relabel's evidence back to its old value. */
async function rollbackRelabel(db: SqlTag): Promise<{ restored: number; publishedTouched: number }> {
  const records = await db<Array<{ fee_verified_id: number | string; from_evidence: string | null; to_evidence: string | null; fee_published_ids: unknown }>>`
    SELECT fee_verified_id, evidence->>'from_evidence' AS from_evidence, evidence->>'to_evidence' AS to_evidence,
           evidence->'fee_published_ids' AS fee_published_ids
      FROM pipeline_feedback
     WHERE kind = ${AUDIENCE_RELABEL_KIND} AND check_name = ${AUDIENCE_RELABEL_SOURCE} AND fee_verified_id IS NOT NULL
  `;
  if (records.length === 0) return { restored: 0, publishedTouched: 0 };
  // Evidence without the darwin: prefix makes the trigger restore the raw row's audience.
  const restored = await db<Array<{ fee_verified_id: number | string }>>`
    UPDATE verified_fee_observations v
       SET audience_evidence = d.from_evidence
      FROM unnest(${records.map((r) => Number(r.fee_verified_id))}::bigint[], ${records.map((r) => r.from_evidence)}::text[], ${records.map((r) => r.to_evidence)}::text[])
           AS d(fee_verified_id, from_evidence, to_evidence)
     WHERE v.fee_verified_id = d.fee_verified_id
       AND v.audience_evidence = d.to_evidence
    RETURNING v.fee_verified_id
  `;
  const restoredIds = new Set(restored.map((row) => Number(row.fee_verified_id)));
  const publishedIds = records
    .filter((record) => restoredIds.has(Number(record.fee_verified_id)))
    .flatMap((record) => (Array.isArray(record.fee_published_ids) ? record.fee_published_ids.map(Number) : []));
  const touched = publishedIds.length === 0 ? [] : await db`
    UPDATE published_fee_records SET fee_audience = fee_audience
     WHERE fee_published_id = ANY(${publishedIds}::bigint[])
    RETURNING fee_published_id
  `;
  return { restored: restoredIds.size, publishedTouched: touched.length };
}

export async function runAudienceRelabel(
  db: SqlTag,
  options: { runId?: number | null; dryRun?: boolean; institutionId?: number | null; mode?: AudienceRelabelMode } = {},
): Promise<AudienceRelabelResult> {
  const mode = options.mode ?? AUDIENCE_RELABEL_MODE;
  const ready = mode === "off" ? true : await migrationReady(db);
  const dryRun = Boolean(options.dryRun) || mode === "off" || !ready;
  const result = emptyResult(mode, dryRun);
  if (mode === "rollback") {
    if (dryRun) return result;
    const rolledBack = await rollbackRelabel(db);
    return { ...result, restored: rolledBack.restored, publishedTouched: rolledBack.publishedTouched };
  }
  const canRecord = !dryRun && (await feedbackSchemaReady(db));
  let after = 0;
  for (;;) {
    const rows = await candidateRows(db, after, options.institutionId ?? null);
    if (rows.length === 0) break;
    const documentIds = [...new Set(rows.map((row) => Number(row.source_document_id)).filter(Number.isFinite))];
    const texts = await loadSourceTexts(db, documentIds);
    const decisions = rows.map((row) => decideAudience(row, row.source_document_id == null ? null : texts.get(Number(row.source_document_id)) ?? null));
    result.documents += documentIds.length;
    result.fees += rows.length;
    decisions.forEach((decision, index) => {
      result.byAudience[decision.feeAudience] = (result.byAudience[decision.feeAudience] ?? 0) + 1;
      result.bySource[decision.source] = (result.bySource[decision.source] ?? 0) + 1;
      if (decision.feeAudience !== "unknown" && result.samples.length < SAMPLE_SIZE) {
        const row = rows[index];
        result.samples.push({
          feeVerifiedId: decision.feeVerifiedId, feeName: row.fee_name, amount: row.amount == null ? null : Number(row.amount),
          canonicalFeeKey: row.canonical_fee_key, audience: decision.feeAudience, evidence: decision.evidence,
        });
      }
    });
    if (canRecord) {
      // The old value first, so every write can be undone.
      const records = rows.flatMap((row, index) => (decisions[index].feeAudience === "unknown" ? [] : [relabelRecord(row, decisions[index], options.runId ?? null)]));
      if (records.length > 0) await recordFeedback(db, records);
      const written = await writeDecisions(db, rows, decisions);
      result.relabeled += written.relabeled;
      result.publishedTouched += written.publishedTouched;
    }
    after = Math.max(...documentIds, after + 1);
  }
  return result;
}
