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
 * - "off": a daily dry run over a sample of documents. It counts the decisions by audience and
 *   by evidence source, and writes nothing but its step on the run ledger.
 * - "live": the same read writes each decision to the verified row (`darwin:` evidence, which the
 *   trigger keeps) and touches the live published row so it inherits it. The old value is
 *   recorded first, one `audience_relabeled` row per fee in `pipeline_feedback`.
 * - "rollback": every fee those rows name that still carries the relabel's evidence goes back to
 *   `unknown` with its old evidence, and the trigger copies the raw row's audience back.
 *
 * Each step reads one bounded batch and reports where the next resumes; the tick queues batches
 * until none remain. Live and rollback need migration 20270110000047 and refuse to run before it.
 */
/**
 * "dry_run_full" (#1059 gate before live): the same cursor chain as live, one bounded batch per
 * tick over every document, writing nothing but each batch's counts; the last batch adds the
 * chain's totals (`dryRunFullTotals`). Live waits until those totals pass.
 */
export type AudienceRelabelMode = "off" | "dry_run_full" | "live" | "rollback";
export const AUDIENCE_RELABEL_MODE: AudienceRelabelMode = "dry_run_full";
/**
 * v2 (#1626): the fee-name reading changed (product words, exceptions and two-sided lists), so the
 * full dry run's key chain and totals start again from the first document under v2.
 */
export const AUDIENCE_RELABEL_VERSION = 2;
export const AUDIENCE_RELABEL_SOURCE = "darwin.audience_relabel";
export const AUDIENCE_RELABEL_KIND = "audience_relabeled";
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
  /** Where the next step resumes (document id, or verified id for a rollback); null when sampled or empty. */
  nextAfterId: number | null;
  /** Documents (or recorded fees) still to read after this step. */
  remaining: number;
  done: boolean;
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

/** Documents one step reads: about 300 documents is about 3.7M characters of text and 2,900 fees. */
export const AUDIENCE_RELABEL_DOCUMENTS_PER_STEP = 300;
/** Recorded fees one rollback step restores. */
export const AUDIENCE_RELABEL_ROLLBACK_PER_STEP = 3000;
/** Documents per text load inside a step. */
const DOCUMENT_CHUNK = 100;

export interface AudienceRelabelOptions {
  runId?: number | null;
  dryRun?: boolean;
  institutionId?: number | null;
  mode?: AudienceRelabelMode;
  /** Resume after this document id (live) or verified id (rollback). */
  afterId?: number;
  /** Documents (or recorded fees, for a rollback) this step reads. */
  limit?: number;
  /** Off: read a sample in md5 order of this key (the day) instead of a cursor. */
  sampleKey?: string | null;
}

function emptyResult(mode: AudienceRelabelMode, dryRun: boolean): AudienceRelabelResult {
  return {
    mode, dryRun, documents: 0, fees: 0, byAudience: {}, bySource: {}, relabeled: 0, publishedTouched: 0, restored: 0, samples: [],
    nextAfterId: null, remaining: 0, done: true,
  };
}

/** Migration 20270110000047 keeps a `darwin:` decision on the verified row; before it nothing sticks. */
export async function audienceMigrationReady(db: SqlTag): Promise<boolean> {
  const [row] = await db<Array<{ ready: boolean }>>`
    SELECT position('darwin:' IN pg_get_functiondef('public.inherit_fee_applicability()'::regprocedure)) > 0 AS ready
  `;
  return Boolean(row?.ready);
}

const LIVE_UNKNOWN_SQL = `
  live AS (
    SELECT p.lineage_ref, p.fee_published_id
      FROM published_fee_records p
     WHERE p.fee_published_id IN (SELECT fee_published_id FROM published_fee_catalog
                                  UNION SELECT fee_published_id FROM published_fee_rate_catalog)
  ), unknown_live AS (
    SELECT live.fee_published_id, v.fee_verified_id, v.fee_raw_id, v.institution_id, r.source_document_id, r.source_url,
           r.fee_name, r.amount, r.amount_kind, v.canonical_fee_key, v.audience_evidence
      FROM live
      JOIN verified_fee_observations v ON v.fee_verified_id = live.lineage_ref
      JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
     WHERE v.fee_audience = 'unknown'
       AND r.source_document_id IS NOT NULL
       AND NOT COALESCE(r.outlier_flags, '[]'::jsonb) ? 'audience_correction_required'
  )`;

/** The documents this step reads: the next ones after the cursor, or the day's sample. */
async function stepDocuments(
  db: SqlTag,
  options: { afterId: number; limit: number; sampleKey: string | null; institutionId: number | null },
): Promise<{ ids: number[]; remaining: number }> {
  const rows = await db<Array<{ source_document_id: number | string; remaining: number | string }>>`
    WITH ${db.unsafe(LIVE_UNKNOWN_SQL)}, docs AS (
      SELECT DISTINCT source_document_id
        FROM unknown_live
       WHERE (${options.institutionId}::int IS NULL OR institution_id = ${options.institutionId}::int)
         AND (${options.sampleKey}::text IS NOT NULL OR source_document_id > ${options.afterId})
    )
    SELECT source_document_id, (SELECT COUNT(*) FROM docs) AS remaining
      FROM docs
     ORDER BY CASE WHEN ${options.sampleKey}::text IS NULL THEN NULL ELSE md5(source_document_id::text || ${options.sampleKey}::text) END,
              source_document_id
     LIMIT ${options.limit}
  `;
  const ids = rows.map((row) => Number(row.source_document_id));
  return { ids, remaining: Math.max(0, Number(rows[0]?.remaining ?? 0) - ids.length) };
}

async function candidateRows(db: SqlTag, documentIds: number[], institutionId: number | null): Promise<AudienceRelabelRow[]> {
  return db<AudienceRelabelRow[]>`
    WITH ${db.unsafe(LIVE_UNKNOWN_SQL)}
    SELECT fee_verified_id, fee_raw_id, institution_id, source_document_id, source_url, fee_name, amount, amount_kind,
           canonical_fee_key, audience_evidence, array_agg(fee_published_id ORDER BY fee_published_id) AS fee_published_ids
      FROM unknown_live
     WHERE source_document_id = ANY(${documentIds}::bigint[])
       AND (${institutionId}::int IS NULL OR institution_id = ${institutionId}::int)
     GROUP BY fee_verified_id, fee_raw_id, institution_id, source_document_id, source_url, fee_name, amount, amount_kind,
              canonical_fee_key, audience_evidence
     ORDER BY source_document_id, fee_verified_id
  `;
}

async function touchPublished(db: SqlTag, publishedIds: number[]): Promise<number> {
  if (publishedIds.length === 0) return 0;
  // Touching the audience column fires the trigger, which copies the verified row's audience.
  const touched = await db`
    UPDATE published_fee_records SET fee_audience = fee_audience
     WHERE fee_published_id = ANY(${publishedIds}::bigint[])
    RETURNING fee_published_id
  `;
  return touched.length;
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
  const ids = new Set(updated.map((row) => Number(row.fee_verified_id)));
  const publishedIds = rows.filter((row) => ids.has(Number(row.fee_verified_id))).flatMap((row) => row.fee_published_ids.map(Number));
  return { relabeled: ids.size, publishedTouched: await touchPublished(db, publishedIds) };
}

/**
 * Puts recorded fees still carrying the relabel's evidence back to their old value, a batch at a
 * time in verified-id order. The audience goes back to `unknown` with the old evidence (NULL for
 * every relabelled fee today), so the trigger copies the raw row's audience back, as it did before.
 */
async function rollbackRelabel(db: SqlTag, afterId: number, limit: number): Promise<{ restored: number; publishedTouched: number; nextAfterId: number | null; remaining: number }> {
  const records = await db<Array<{ fee_verified_id: number | string; from_evidence: string | null; to_evidence: string | null; fee_published_ids: unknown; remaining: number | string }>>`
    WITH recorded AS (
      SELECT fee_verified_id, evidence->>'from_evidence' AS from_evidence, evidence->>'to_evidence' AS to_evidence,
             evidence->'fee_published_ids' AS fee_published_ids
        FROM pipeline_feedback
       WHERE kind = ${AUDIENCE_RELABEL_KIND} AND check_name = ${AUDIENCE_RELABEL_SOURCE}
         AND fee_verified_id IS NOT NULL AND fee_verified_id > ${afterId}
    )
    SELECT *, (SELECT COUNT(*) FROM recorded) AS remaining FROM recorded ORDER BY fee_verified_id LIMIT ${limit}
  `;
  if (records.length === 0) return { restored: 0, publishedTouched: 0, nextAfterId: null, remaining: 0 };
  const restored = await db<Array<{ fee_verified_id: number | string }>>`
    UPDATE verified_fee_observations v
       SET fee_audience = 'unknown',
           audience_evidence = d.from_evidence
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
  return {
    restored: restoredIds.size,
    publishedTouched: await touchPublished(db, publishedIds),
    nextAfterId: Number(records.at(-1)!.fee_verified_id),
    remaining: Math.max(0, Number(records[0].remaining) - records.length),
  };
}

/**
 * One bounded batch of the relabel. Off, it reads the day's sample and writes nothing. Live and
 * rollback refuse to run before migration 20270110000047 (they throw, so the step fails visibly).
 */
export async function runAudienceRelabel(db: SqlTag, options: AudienceRelabelOptions = {}): Promise<AudienceRelabelResult> {
  const mode = options.mode ?? AUDIENCE_RELABEL_MODE;
  if ((mode === "live" || mode === "rollback") && !(await audienceMigrationReady(db))) {
    throw new Error("Audience relabel: migration 20270110000047 is not applied; nothing written");
  }
  const dryRun = Boolean(options.dryRun) || mode === "off" || mode === "dry_run_full";
  const result = emptyResult(mode, dryRun);
  const afterId = Math.max(0, Number(options.afterId) || 0);
  if (mode === "rollback") {
    if (dryRun) return result;
    const rolledBack = await rollbackRelabel(db, afterId, Math.max(1, options.limit ?? AUDIENCE_RELABEL_ROLLBACK_PER_STEP));
    return {
      ...result, restored: rolledBack.restored, publishedTouched: rolledBack.publishedTouched,
      nextAfterId: rolledBack.nextAfterId, remaining: rolledBack.remaining, done: rolledBack.remaining === 0,
    };
  }
  const sampleKey = mode === "off" ? options.sampleKey ?? null : null;
  const documents = await stepDocuments(db, {
    afterId, limit: Math.max(1, options.limit ?? AUDIENCE_RELABEL_DOCUMENTS_PER_STEP), sampleKey, institutionId: options.institutionId ?? null,
  });
  result.remaining = documents.remaining;
  result.done = documents.remaining === 0;
  result.nextAfterId = documents.ids.length > 0 && !sampleKey ? Math.max(...documents.ids) : null;
  const canRecord = !dryRun && (await feedbackSchemaReady(db));
  for (let start = 0; start < documents.ids.length; start += DOCUMENT_CHUNK) {
    const chunk = documents.ids.slice(start, start + DOCUMENT_CHUNK);
    const rows = await candidateRows(db, chunk, options.institutionId ?? null);
    if (rows.length === 0) continue;
    const texts = await loadSourceTexts(db, chunk);
    const decisions = rows.map((row) => decideAudience(row, texts.get(Number(row.source_document_id)) ?? null));
    result.documents += chunk.length;
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
  }
  return result;
}

export interface AudienceRelabelTotals {
  batches: number;
  documents: number;
  fees: number;
  byAudience: Record<string, number>;
  bySource: Record<string, number>;
  /** Share of fees per audience, 0-100, one decimal. */
  shares: Record<string, number>;
}

/**
 * The full dry run's totals: every finished batch of the chain (the latest per cursor, so a
 * re-run batch counts once) plus this one. Read-only.
 */
export async function dryRunFullTotals(db: SqlTag, current: AudienceRelabelResult, afterId: number): Promise<AudienceRelabelTotals> {
  const marker = { source: AUDIENCE_RELABEL_SOURCE, mode: "dry_run_full", version: AUDIENCE_RELABEL_VERSION };
  const earlier = await db<Array<{ documents: number | string | null; fees: number | string | null; by_audience: Record<string, number> | null; by_source: Record<string, number> | null }>>`
    SELECT DISTINCT ON (r.params_json->>'after_id')
           (e.detail->>'documents')::int AS documents, (e.detail->>'fees')::int AS fees,
           e.detail->'by_audience' AS by_audience, e.detail->'by_source' AS by_source
      FROM agent_runs r
      JOIN agent_run_events e ON e.agent_run_id = r.id AND e.event_type = 'step.finished' AND e.status = 'completed'
     WHERE r.agent_name = 'darwin'
       AND r.params_json @> ${JSON.stringify(marker)}::jsonb
       AND COALESCE(r.params_json->>'after_id', '0') <> ${String(afterId)}
     ORDER BY r.params_json->>'after_id', e.id DESC
  `;
  const batches = [
    ...earlier.map((row) => ({ documents: Number(row.documents ?? 0), fees: Number(row.fees ?? 0), byAudience: row.by_audience ?? {}, bySource: row.by_source ?? {} })),
    { documents: current.documents, fees: current.fees, byAudience: current.byAudience, bySource: current.bySource },
  ];
  const totals: AudienceRelabelTotals = { batches: batches.length, documents: 0, fees: 0, byAudience: {}, bySource: {}, shares: {} };
  for (const batch of batches) {
    totals.documents += batch.documents;
    totals.fees += batch.fees;
    for (const [key, n] of Object.entries(batch.byAudience)) totals.byAudience[key] = (totals.byAudience[key] ?? 0) + Number(n);
    for (const [key, n] of Object.entries(batch.bySource)) totals.bySource[key] = (totals.bySource[key] ?? 0) + Number(n);
  }
  for (const [key, n] of Object.entries(totals.byAudience)) totals.shares[key] = totals.fees > 0 ? Math.round((n / totals.fees) * 1000) / 10 : 0;
  return totals;
}
