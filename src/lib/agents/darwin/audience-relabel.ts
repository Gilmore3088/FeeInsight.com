import { sql } from "@/lib/data-store/connection";
import { isPercentFee } from "@/lib/percent-fees";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { AUDIENCE_V5_LIVE, DARWIN_AUDIENCE_PREFIX, darwinAudience } from "./audience";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { boxNameRowWords } from "@/lib/custom-report/box-size-name";
import { createHash } from "node:crypto";
import { matchOriginalRawSource } from "./locked-raw-source";
import { ownPriceAudience } from "./own-price-audience";

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
 * chain's totals (`dryRunFullTotals`).
 *
 * Live since James's typed "switch it on" in the Data quality thread, 2026-10-16 16:40 UTC.
 */
export type AudienceRelabelMode = "off" | "dry_run_full" | "live" | "rollback";
/**
 * v5 switch (findings/2026-11-01-audience-regression-box-names-and-backlog.md): off, the v5 chain
 * is a full dry run that writes nothing and leaves its totals and samples on the run ledger; on,
 * the same chain writes. Turned on only after James reads that dry run.
 */
export const AUDIENCE_RELABEL_V5_LIVE: boolean = AUDIENCE_V5_LIVE;
export const AUDIENCE_RELABEL_MODE: AudienceRelabelMode = AUDIENCE_RELABEL_V5_LIVE ? "live" : "dry_run_full";
/**
 * v2 (#1626): the fee-name reading changed (product words, exceptions and two-sided lists), so the
 * full dry run's key chain and totals start again from the first document under v2.
 */
/**
 * v3 (#1059 unknown review, 2026-10-16): the context reading leaves fewer fees unknown (a neutral
 * section heading or schedule title ends the heading climb, a bullet is no heading, a sign-off, a
 * wrapped "business days" and "individual check" name no audience, and a two-audience price cell
 * names the fee's). The live chain starts again from the first document, so the fees still unknown
 * are read again; fees already labelled are not read.
 */
/**
 * v4 (#1687, 2026-10-17): a schedule's own title decides the fees under it ("PERSONAL SCHEDULE OF
 * FEES"; "Consumer Deposit Account" over "Fee Schedule"), so the relabel also re-reads live fees
 * Darwin called `both` only because the schedule prices business items somewhere
 * (`darwin:mixed_schedule_unqualified`). Such a fee changes only to one audience, never back to
 * unknown; its old value is recorded under its own key, so a rollback still reaches the first.
 */
/**
 * v5 (audience regression, 2026-11-01): two holes the v4 chain (done 2026-10-17 23:23 UTC) left.
 * - Fees verified before migration 47 kept `unknown` on the verified row. The chain read only live
 *   ones, so 77,929 verified rows still waiting to publish carry it, and each one Hamilton publishes
 *   goes live unknown (859 of the 2,116 unknown fees published Oct 21 - Nov 1). v5 also reads the
 *   waiting rows, so Darwin's decision is on the verified row before Hamilton publishes it.
 * - Knox v99 renamed bare box sizes "Safe Deposit Box <size>" (#2064) and the audience reader found
 *   no line for that name (1,112 of the 2,116). The reader now finds the box row (`feeLineIndex` in
 *   knox/audience-context.ts), and v5 re-reads the live ones.
 * Each decision uses verification's reader with the fee's own exclusive price clause
 * (`ownPriceClause`), but only on the text Knox read the fee from (`boundToCapture`: same artifact
 * and text hash as the raw row's capture). Where that clause exists and the text is not that one,
 * verification defers; the relabel leaves the fee unknown (`own_clause_unbound`). A fee whose own
 * clause is ambiguous stays unknown, as at verify.
 */
export const AUDIENCE_RELABEL_VERSION = 5;
/** The evidence of a `both` that only says the schedule also prices business items: re-read from v4. */
export const MIXED_SCHEDULE_EVIDENCE = "darwin:mixed_schedule_unqualified:";
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
  /** The verified row's audience now: `unknown`, or `both` from a mixed schedule (v4). */
  fee_audience?: string | null;
  audience_evidence: string | null;
  fee_published_ids: Array<number | string>;
  /** The raw row's capture header (artifact and text hash Knox read), for the own-clause binding. */
  extraction_note?: string | null;
  conditions?: string | null;
}

export interface AudienceDecision {
  feeVerifiedId: number;
  feeAudience: "consumer" | "business" | "both" | "unknown";
  /** The suggestion's source (`section_heading`, `document_title`, ...), `no_text`, or `none`. */
  source: string;
  evidence: string | null;
  /** A renamed box whose decision differs with its box row read (the switch's Knox half). */
  boxRowChanged?: boolean;
}

export interface AudienceRelabelResult {
  mode: AudienceRelabelMode;
  dryRun: boolean;
  documents: number;
  fees: number;
  byAudience: Record<string, number>;
  bySource: Record<string, number>;
  /** Decisions that would write, as `from->to` ("unknown->consumer", "both->consumer"). */
  byChange: Record<string, number>;
  /** The same changes split by scope: fees live today, and verified rows waiting to publish. */
  byChangeLive: Record<string, number>;
  byChangeWaiting: Record<string, number>;
  feesLive: number;
  feesWaiting: number;
  /** Decisions the box row of a renamed box changes, live and waiting. */
  boxRowChangesLive: number;
  boxRowChangesWaiting: number;
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

/** A document's newest completed text, with the artifact facts the own-clause binding needs. */
export interface RelabelSourceText {
  text: string;
  artifactId: number;
  institutionId: number;
  textHash: string | null;
}

const TEXT_HASH = /^[a-f0-9]{64}$/;

/**
 * Whether the text is the one Knox read this fee from: its stored hash is the text's own sha256,
 * and the raw row's capture header names this artifact and hash (`matchOriginalRawSource`, the
 * same binding verification requires before it reads a fee's own exclusive clause). Pure.
 */
export function boundToCapture(row: AudienceRelabelRow, source: RelabelSourceText): boolean {
  if (row.source_document_id == null || !source.textHash || !TEXT_HASH.test(source.textHash)) return false;
  if (createHash("sha256").update(source.text).digest("hex") !== source.textHash) return false;
  return matchOriginalRawSource(
    { institution_id: Number(row.institution_id), source_document_id: Number(row.source_document_id), extraction_note: row.extraction_note ?? null, conditions: row.conditions ?? null } as never,
    { documentId: Number(row.source_document_id), institutionId: source.institutionId, artifactId: source.artifactId, textHash: source.textHash },
  ).kind === "matched";
}

/**
 * Darwin's decision for one fee, from its document's newest text. Pure. A fee whose own price
 * clause names an exclusive audience is decided from that clause only when the text is the one
 * Knox read it from (`boundToCapture`); verification defers such a fee otherwise, so here it stays
 * `unknown` (`own_clause_unbound`). A bare string is text with no artifact facts: never bound.
 * Unbound, the clause Knox kept on the raw row (its capture's excerpt) is read too, as
 * verification does before it defers (verification-audience.ts): a newer text that has dropped
 * the clause never decides a fee whose own captured line named one audience only.
 * The box row of a renamed box (`boxRows`) is always read here, so the dry run counts what the
 * switch would change: `boxRowChanged` marks a decision that differs from the one without it.
 */
export function decideAudience(row: AudienceRelabelRow, source: string | RelabelSourceText | null): AudienceDecision {
  const feeVerifiedId = Number(row.fee_verified_id);
  const text = typeof source === "string" ? source : source?.text ?? null;
  if (!text) return { feeVerifiedId, feeAudience: "unknown", source: "no_text", evidence: null };
  const amount = isPercentFee(row as never) || row.amount == null ? null : Number(row.amount);
  const bound = typeof source !== "string" && source != null && boundToCapture(row, source);
  if (!bound) {
    const retained = excerptOf(row.extraction_note) ?? excerptOf(row.conditions) ?? "";
    if (ownPriceAudience(text, row.fee_name, amount).kind !== "none" || ownPriceAudience(retained, row.fee_name, amount).kind !== "none") {
      return { feeVerifiedId, feeAudience: "unknown", source: "own_clause_unbound", evidence: null };
    }
  }
  const read = (boxRows: boolean) =>
    darwinAudience({ fee_audience: "unknown", source_url: row.source_url, fee_name: row.fee_name }, amount, text, { ownPriceClause: true, boxRows });
  const decision = read(true);
  const boxRowChanged = boxNameRowWords(row.fee_name) != null && (read(false)?.feeAudience ?? "unknown") !== (decision?.feeAudience ?? "unknown");
  if (!decision) return { feeVerifiedId, feeAudience: "unknown", source: "none", evidence: null, boxRowChanged };
  const decidedBy = decision.audienceEvidence.slice(DARWIN_AUDIENCE_PREFIX.length).split(":")[0];
  return { feeVerifiedId, feeAudience: decision.feeAudience, source: decidedBy, evidence: decision.audienceEvidence, boxRowChanged };
}

const fromAudience = (row: AudienceRelabelRow) => row.fee_audience ?? "unknown";

/** The decisions that move a mixed-schedule `both`: a schedule's own title (v4, #1687). */
const TITLE_SOURCES = new Set(["document_title", "schedule_section_title"]);

/**
 * Whether the decision changes the fee: an unknown fee takes any decision; a mixed-schedule `both`
 * takes only one audience read from a schedule's title (v4), never `unknown` again, and never a
 * default read from a newer copy of the text.
 */
export function changesAudience(row: AudienceRelabelRow, decision: AudienceDecision): boolean {
  const from = fromAudience(row);
  if (from === "unknown") return decision.feeAudience !== "unknown";
  return from === "both" && (decision.feeAudience === "consumer" || decision.feeAudience === "business") && TITLE_SOURCES.has(decision.source);
}

/** The old value, recorded before a relabel writes, so a rollback can restore it. */
export function relabelRecord(row: AudienceRelabelRow, decision: AudienceDecision, runId: number | null): FeedbackRow {
  const from = fromAudience(row);
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
      from_audience: from,
      from_evidence: row.audience_evidence,
      to_audience: decision.feeAudience,
      to_evidence: decision.evidence,
      fee_published_ids: row.fee_published_ids.map(Number),
    },
    runId,
    // A fee relabelled from `both` may have been relabelled from `unknown` before: its own key keeps
    // that first record, so a rollback restores the fee's first value.
    dedupeKey: from === "unknown"
      ? `${AUDIENCE_RELABEL_SOURCE}:verified:${decision.feeVerifiedId}`
      : `${AUDIENCE_RELABEL_SOURCE}:v${AUDIENCE_RELABEL_VERSION}:${from}:verified:${decision.feeVerifiedId}`,
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
    mode, dryRun, documents: 0, fees: 0, byAudience: {}, bySource: {}, byChange: {}, byChangeLive: {}, byChangeWaiting: {}, feesLive: 0, feesWaiting: 0, boxRowChangesLive: 0, boxRowChangesWaiting: 0, relabeled: 0, publishedTouched: 0, restored: 0, samples: [],
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
           r.fee_name, r.amount, r.amount_kind, v.canonical_fee_key, v.fee_audience, v.audience_evidence, r.extraction_note, r.conditions
      FROM live
      JOIN verified_fee_observations v ON v.fee_verified_id = live.lineage_ref
      JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
     WHERE (v.fee_audience = 'unknown'
            OR (v.fee_audience = 'both' AND starts_with(v.audience_evidence, '${MIXED_SCHEDULE_EVIDENCE}')))
       AND r.source_document_id IS NOT NULL
       AND NOT COALESCE(r.outlier_flags, '[]'::jsonb) ? 'audience_correction_required'
    -- v5: a verified row still waiting to publish (what Hamilton picks: verified or approved by
    -- Darwin, no live record), so it goes live with Darwin's decision instead of unknown.
    UNION ALL
    SELECT NULL::bigint AS fee_published_id, v.fee_verified_id, v.fee_raw_id, v.institution_id, r.source_document_id, r.source_url,
           r.fee_name, r.amount, r.amount_kind, v.canonical_fee_key, v.fee_audience, v.audience_evidence, r.extraction_note, r.conditions
      FROM verified_fee_observations v
      JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
     WHERE v.fee_audience = 'unknown'
       AND v.review_status IN ('verified', 'approved')
       AND v.outlier_flags ? 'agentic_darwin_verified'
       AND r.source_document_id IS NOT NULL
       AND NOT COALESCE(r.outlier_flags, '[]'::jsonb) ? 'audience_correction_required'
       AND NOT EXISTS (SELECT 1 FROM published_fee_records p WHERE p.lineage_ref = v.fee_verified_id AND p.rolled_back_at IS NULL)
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
           canonical_fee_key, fee_audience, audience_evidence, extraction_note, conditions,
           array_remove(array_agg(fee_published_id ORDER BY fee_published_id), NULL) AS fee_published_ids
      FROM unknown_live
     WHERE source_document_id = ANY(${documentIds}::bigint[])
       AND (${institutionId}::int IS NULL OR institution_id = ${institutionId}::int)
     GROUP BY fee_verified_id, fee_raw_id, institution_id, source_document_id, source_url, fee_name, amount, amount_kind,
              canonical_fee_key, fee_audience, audience_evidence, extraction_note, conditions
     ORDER BY source_document_id, fee_verified_id
  `;
}

/** Each document's newest completed text with its artifact id, owner and stored hash. */
async function loadRelabelTexts(db: SqlTag, documentIds: number[]): Promise<Map<number, RelabelSourceText>> {
  if (documentIds.length === 0) return new Map();
  const rows = await db<Array<{ id: number | string; source_document_id: number | string; institution_id: number | string | null; text_hash: string | null; normalized_text: string }>>`
    SELECT DISTINCT ON (source_document_id) id, source_document_id, institution_id, text_hash, normalized_text
      FROM agent_source_texts
     WHERE source_document_id = ANY(${documentIds}::bigint[])
       AND status = 'completed'
       AND normalized_text IS NOT NULL
     ORDER BY source_document_id, id DESC
  `;
  return new Map(rows.map((row) => [Number(row.source_document_id), {
    text: row.normalized_text, artifactId: Number(row.id), institutionId: Number(row.institution_id), textHash: row.text_hash ?? null,
  }]));
}

/**
 * Touching the audience column fires the trigger, which copies the verified row's audience. The
 * live records are found by lineage at write time, never from the ids read or recorded earlier: a
 * row waiting to publish when it was relabelled may be live by the time it is written or rolled back.
 */
async function touchPublished(db: SqlTag, verifiedIds: number[]): Promise<number> {
  if (verifiedIds.length === 0) return 0;
  const touched = await db`
    UPDATE published_fee_records SET fee_audience = fee_audience
     WHERE lineage_ref = ANY(${verifiedIds}::bigint[])
       AND rolled_back_at IS NULL
    RETURNING fee_published_id
  `;
  return touched.length;
}

async function writeDecisions(db: SqlTag, rows: AudienceRelabelRow[], decisions: AudienceDecision[]): Promise<{ relabeled: number; publishedTouched: number }> {
  const changed = rows.flatMap((row, index) => (changesAudience(row, decisions[index]) ? [{ row, decision: decisions[index] }] : []));
  if (changed.length === 0) return { relabeled: 0, publishedTouched: 0 };
  // Only a row still as it was read: unknown, or the same mixed-schedule `both` evidence.
  const updated = await db<Array<{ fee_verified_id: number | string }>>`
    UPDATE verified_fee_observations v
       SET fee_audience = d.fee_audience,
           audience_evidence = d.audience_evidence
      FROM unnest(${changed.map((c) => c.decision.feeVerifiedId)}::bigint[], ${changed.map((c) => c.decision.feeAudience)}::text[],
                  ${changed.map((c) => c.decision.evidence)}::text[], ${changed.map((c) => fromAudience(c.row))}::text[],
                  ${changed.map((c) => c.row.audience_evidence)}::text[])
           AS d(fee_verified_id, fee_audience, audience_evidence, from_audience, from_evidence)
     WHERE v.fee_verified_id = d.fee_verified_id
       AND v.fee_audience = d.from_audience
       AND (d.from_audience = 'unknown' OR v.audience_evidence = d.from_evidence)
    RETURNING v.fee_verified_id
  `;
  const ids = new Set(updated.map((row) => Number(row.fee_verified_id)));
  return { relabeled: ids.size, publishedTouched: await touchPublished(db, [...ids]) };
}

/**
 * Puts recorded fees still carrying the relabel's evidence back to their old value, a batch at a
 * time in verified-id order. The audience goes back to its first recorded value: `unknown` with the
 * old evidence (NULL for every fee relabelled from unknown), so the trigger copies the raw row's
 * audience back, or a mixed-schedule `both` with its `darwin:` evidence (v4).
 */
async function rollbackRelabel(db: SqlTag, afterId: number, limit: number): Promise<{ restored: number; publishedTouched: number; nextAfterId: number | null; remaining: number }> {
  // A fee relabelled twice (unknown, then `both` to one audience in v4) goes back to its first
  // value, when it still carries the last relabel's evidence.
  const records = await db<Array<{ fee_verified_id: number | string; from_audience: string | null; from_evidence: string | null; to_evidence: string | null; fee_published_ids: unknown; remaining: number | string }>>`
    WITH recorded AS (
      SELECT fee_verified_id,
             (array_agg(COALESCE(evidence->>'from_audience', 'unknown') ORDER BY id))[1] AS from_audience,
             (array_agg(evidence->>'from_evidence' ORDER BY id))[1] AS from_evidence,
             (array_agg(evidence->>'to_evidence' ORDER BY id DESC))[1] AS to_evidence,
             (array_agg(evidence->'fee_published_ids' ORDER BY id DESC))[1] AS fee_published_ids
        FROM pipeline_feedback
       WHERE kind = ${AUDIENCE_RELABEL_KIND} AND check_name = ${AUDIENCE_RELABEL_SOURCE}
         AND fee_verified_id IS NOT NULL AND fee_verified_id > ${afterId}
       GROUP BY fee_verified_id
    )
    SELECT *, (SELECT COUNT(*) FROM recorded) AS remaining FROM recorded ORDER BY fee_verified_id LIMIT ${limit}
  `;
  if (records.length === 0) return { restored: 0, publishedTouched: 0, nextAfterId: null, remaining: 0 };
  const restored = await db<Array<{ fee_verified_id: number | string }>>`
    UPDATE verified_fee_observations v
       SET fee_audience = d.from_audience,
           audience_evidence = d.from_evidence
      FROM unnest(${records.map((r) => Number(r.fee_verified_id))}::bigint[], ${records.map((r) => r.from_audience ?? "unknown")}::text[],
                  ${records.map((r) => r.from_evidence)}::text[], ${records.map((r) => r.to_evidence)}::text[])
           AS d(fee_verified_id, from_audience, from_evidence, to_evidence)
     WHERE v.fee_verified_id = d.fee_verified_id
       AND v.audience_evidence = d.to_evidence
    RETURNING v.fee_verified_id
  `;
  const restoredIds = new Set(restored.map((row) => Number(row.fee_verified_id)));
  return {
    restored: restoredIds.size,
    // By lineage now, not the recorded ids: a fee recorded while waiting may have gone live since.
    publishedTouched: await touchPublished(db, [...restoredIds]),
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
  // One candidate read per step (the shared CTE is the costly part); texts load per chunk.
  const allRows = documents.ids.length > 0 ? await candidateRows(db, documents.ids, options.institutionId ?? null) : [];
  for (let start = 0; start < documents.ids.length; start += DOCUMENT_CHUNK) {
    const chunk = documents.ids.slice(start, start + DOCUMENT_CHUNK);
    const inChunk = new Set(chunk);
    const rows = allRows.filter((row) => inChunk.has(Number(row.source_document_id)));
    if (rows.length === 0) continue;
    const texts = await loadRelabelTexts(db, chunk);
    const decisions = rows.map((row) => decideAudience(row, texts.get(Number(row.source_document_id)) ?? null));
    result.documents += chunk.length;
    result.fees += rows.length;
    decisions.forEach((decision, index) => {
      result.byAudience[decision.feeAudience] = (result.byAudience[decision.feeAudience] ?? 0) + 1;
      result.bySource[decision.source] = (result.bySource[decision.source] ?? 0) + 1;
      const row = rows[index];
      // Live: the fee has a live record now; waiting: a verified row Hamilton has not published.
      const live = row.fee_published_ids.length > 0;
      if (live) result.feesLive += 1;
      else result.feesWaiting += 1;
      if (!changesAudience(row, decision)) return;
      const change = `${fromAudience(row)}->${decision.feeAudience}`;
      result.byChange[change] = (result.byChange[change] ?? 0) + 1;
      const scoped = live ? result.byChangeLive : result.byChangeWaiting;
      scoped[change] = (scoped[change] ?? 0) + 1;
      if (decision.boxRowChanged) {
        if (live) result.boxRowChangesLive += 1;
        else result.boxRowChangesWaiting += 1;
      }
      if (result.samples.length < SAMPLE_SIZE) {
        result.samples.push({
          feeVerifiedId: decision.feeVerifiedId, feeName: row.fee_name, amount: row.amount == null ? null : Number(row.amount),
          canonicalFeeKey: row.canonical_fee_key, audience: decision.feeAudience, evidence: decision.evidence,
        });
      }
    });
    if (canRecord) {
      // The old value first, so every write can be undone.
      const records = rows.flatMap((row, index) => (changesAudience(row, decisions[index]) ? [relabelRecord(row, decisions[index], options.runId ?? null)] : []));
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
  /** v5: fees read, and the changes it would write, split into live fees and waiting rows. */
  feesLive: number;
  feesWaiting: number;
  byChangeLive: Record<string, number>;
  byChangeWaiting: Record<string, number>;
  /** v5: of those changes, the ones the renamed-box row read decides (the switch's Knox half). */
  boxRowChangesLive: number;
  boxRowChangesWaiting: number;
}

type BatchCounts = {
  documents: number; fees: number; byAudience: Record<string, number>; bySource: Record<string, number>;
  feesLive: number; feesWaiting: number; byChangeLive: Record<string, number>; byChangeWaiting: Record<string, number>;
  boxRowChangesLive: number; boxRowChangesWaiting: number;
};

const add = (into: Record<string, number>, from: Record<string, number>) => {
  for (const [key, n] of Object.entries(from)) into[key] = (into[key] ?? 0) + Number(n);
};

/**
 * The full dry run's totals: every finished batch of the chain (the latest per cursor, so a
 * re-run batch counts once) plus this one. Read-only.
 */
export async function dryRunFullTotals(db: SqlTag, current: AudienceRelabelResult, afterId: number): Promise<AudienceRelabelTotals> {
  const marker = { source: AUDIENCE_RELABEL_SOURCE, mode: "dry_run_full", version: AUDIENCE_RELABEL_VERSION };
  const earlier = await db<Array<{
    documents: number | string | null; fees: number | string | null; by_audience: Record<string, number> | null; by_source: Record<string, number> | null;
    fees_live?: number | string | null; fees_waiting?: number | string | null;
    by_change_live?: Record<string, number> | null; by_change_waiting?: Record<string, number> | null;
    box_row_changes_live?: number | string | null; box_row_changes_waiting?: number | string | null;
  }>>`
    SELECT DISTINCT ON (r.params_json->>'after_id')
           (e.detail->>'documents')::int AS documents, (e.detail->>'fees')::int AS fees,
           e.detail->'by_audience' AS by_audience, e.detail->'by_source' AS by_source,
           (e.detail->>'fees_live')::int AS fees_live, (e.detail->>'fees_waiting')::int AS fees_waiting,
           e.detail->'by_change_live' AS by_change_live, e.detail->'by_change_waiting' AS by_change_waiting,
           (e.detail->>'box_row_changes_live')::int AS box_row_changes_live,
           (e.detail->>'box_row_changes_waiting')::int AS box_row_changes_waiting
      FROM agent_runs r
      JOIN agent_run_events e ON e.agent_run_id = r.id AND e.event_type = 'step.finished' AND e.status = 'completed'
     WHERE r.agent_name = 'darwin'
       AND r.params_json @> ${JSON.stringify(marker)}::jsonb
       AND COALESCE(r.params_json->>'after_id', '0') <> ${String(afterId)}
     ORDER BY r.params_json->>'after_id', e.id DESC
  `;
  const batches: BatchCounts[] = [
    ...earlier.map((row) => ({
      documents: Number(row.documents ?? 0), fees: Number(row.fees ?? 0), byAudience: row.by_audience ?? {}, bySource: row.by_source ?? {},
      feesLive: Number(row.fees_live ?? 0), feesWaiting: Number(row.fees_waiting ?? 0),
      byChangeLive: row.by_change_live ?? {}, byChangeWaiting: row.by_change_waiting ?? {},
      boxRowChangesLive: Number(row.box_row_changes_live ?? 0), boxRowChangesWaiting: Number(row.box_row_changes_waiting ?? 0),
    })),
    {
      documents: current.documents, fees: current.fees, byAudience: current.byAudience, bySource: current.bySource,
      feesLive: current.feesLive ?? 0, feesWaiting: current.feesWaiting ?? 0,
      byChangeLive: current.byChangeLive ?? {}, byChangeWaiting: current.byChangeWaiting ?? {},
      boxRowChangesLive: current.boxRowChangesLive ?? 0, boxRowChangesWaiting: current.boxRowChangesWaiting ?? 0,
    },
  ];
  const totals: AudienceRelabelTotals = {
    batches: batches.length, documents: 0, fees: 0, byAudience: {}, bySource: {}, shares: {},
    feesLive: 0, feesWaiting: 0, byChangeLive: {}, byChangeWaiting: {}, boxRowChangesLive: 0, boxRowChangesWaiting: 0,
  };
  for (const batch of batches) {
    totals.documents += batch.documents;
    totals.fees += batch.fees;
    totals.feesLive += batch.feesLive;
    totals.feesWaiting += batch.feesWaiting;
    totals.boxRowChangesLive += batch.boxRowChangesLive;
    totals.boxRowChangesWaiting += batch.boxRowChangesWaiting;
    add(totals.byAudience, batch.byAudience);
    add(totals.bySource, batch.bySource);
    add(totals.byChangeLive, batch.byChangeLive);
    add(totals.byChangeWaiting, batch.byChangeWaiting);
  }
  for (const [key, n] of Object.entries(totals.byAudience)) totals.shares[key] = totals.fees > 0 ? Math.round((n / totals.fees) * 1000) / 10 : 0;
  return totals;
}

const sumOf = (changes: Record<string, number>) => Object.values(changes).reduce((sum, n) => sum + Number(n), 0);

/** One line for the ledger: what the dry run would change on LIVE fees, apart from waiting rows. */
export function totalsMessage(totals: AudienceRelabelTotals): string {
  const live = sumOf(totals.byChangeLive);
  const waiting = sumOf(totals.byChangeWaiting);
  return `Full dry run done: ${totals.fees.toLocaleString()} fees verified as unknown or mixed-schedule both on ` +
    `${totals.documents.toLocaleString()} documents in ${totals.batches} batches ` +
    `(${totals.feesLive.toLocaleString()} live, ${totals.feesWaiting.toLocaleString()} waiting to publish). ` +
    `Would change ${live.toLocaleString()} live fees (${totals.boxRowChangesLive.toLocaleString()} by a renamed box's own row) ` +
    `and ${waiting.toLocaleString()} waiting rows (${totals.boxRowChangesWaiting.toLocaleString()} by a box row). ` +
    `Decisions: ${Object.entries(totals.shares).map(([audience, share]) => `${audience} ${share}%`).join(", ")}.`;
}
