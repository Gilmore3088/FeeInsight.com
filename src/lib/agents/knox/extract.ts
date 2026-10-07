import { createHash } from "crypto";

import { sql } from "@/lib/data-store/connection";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { countOutcomes, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { playbookFromRow } from "@/lib/agents/learning/playbook";
import { chooseStrategy } from "@/lib/agents/learning/router";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { confidenceFor, type ExtractedFeeCandidate, type HeldFeeCandidate } from "@/lib/agents/knox/rules";
import type { RateFeeCandidate } from "@/lib/agents/knox/percent";
import { KNOX_RULES_STRATEGY, runFreeSpecialists, type SpecialistRun } from "@/lib/agents/knox/specialists";
import { applyKnoxLesson, loadKnoxLessons } from "@/lib/agents/knox/lessons";
import { loadTakedownLessons, TAKEN_DOWN_REVIEW_FLAG, takedownLessonFlag, takedownLessonFor } from "@/lib/agents/knox/takedown-lessons";
import { layoutSignature, thinLayouts, type LayoutYield } from "@/lib/agents/knox/layout-signature";
import { calibratedConfidence, calibrationKey, loadKnoxCalibration, PUBLISH_FLOOR } from "@/lib/agents/knox/calibration";
import { knoxFreeSignature, MISSING_FEES_DETAIL, RULES_RECHECK_STRATEGY } from "@/lib/agents/hamilton/rules-recheck";
import { currentCopySchemaReady } from "@/lib/agents/magellan/current-copy";
import { loadMarketLeaderIds } from "@/lib/data-store/market-leaders";
import { recordHamiltonMonitorSignal } from "@/lib/hamilton/monitor-signals";

type SqlTag = typeof sql;

/**
 * The extractor recorded in the attempt log; bump the version when the rules change.
 * Version 2 (rules.ts): `$1500` parses as $1,500, specific categories win over monthly
 * maintenance, a later amount on a line is a fee only when words naming one precede it,
 * waived fees are kept, and $0, range, percentage and unrecognized priced lines are held
 * for review instead of dropped. Version 4: new phrasings, thresholds are never fees,
 * and the pass 2 specialists (specialists.ts) run with the rules on every document.
 */
export const KNOX_EXTRACT_STRATEGY = KNOX_RULES_STRATEGY;
/** Below this share of the institution's usual fee count, an extraction is `low_yield`. */
const LOW_YIELD_RATIO = 0.5;

/**
 * A text Knox found fewer fees than this in is extracted again whenever the rules
 * version moves, so documents already on file are re-reviewed with each improvement.
 * Matches Rosetta's re-read threshold (REREAD_MAX_KNOX_FEES). The raw-row dedupe index
 * (document, fee name, amount) keeps fees found the first time from being inserted twice.
 */
export const KNOX_REEXTRACT_MAX_FEES = 5;
/**
 * Banks at or above this size (thousands of dollars, as `institution_sources.asset_size`
 * stores it: $10B) have the current copy of each page re-read once per rules version,
 * whatever it held before. The rules re-check only reaches documents with live fees, so a
 * large bank's missing overdraft fee would otherwise wait for a new copy of its page.
 */
export const KNOX_REREAD_ASSET_FLOOR = 10_000_000;
/**
 * A current copy last read by a rules version below this is read again once (2026-10-07:
 * 5,474 current copies at 4,265 banks were last read before v26, when Knox missed plural
 * wires, low-balance rows and two-column pages; Space Coast CU had 7 live fees of 22 prices).
 * Raise it only when a rules change is worth reading every page again.
 */
export const KNOX_STALE_READ_BELOW_VERSION = 26;
/**
 * Banks whose pages are read first while the stale backlog lasts, besides each state's market
 * leaders: banks one or two headline fees short of the report rule, whose own schedule shows
 * a priced line for the missing fee (report-ready thread, 2026-10-07), and Space Coast CU.
 */
export const KNOX_PRIORITY_REREAD_IDS: readonly number[] = [
  8109, 243, 337, 757, 1718, 1784, 1841, 2606, 3005, 51, 724, 927, 1779, 2279, 433, 1037, 1195, 278, 563, 565,
  749, 1680, 2334, 2580, 2756, 156, 528, 641, 1068, 1200, 1411, 1104, 3262, 7096, 8078, 6775, 6358, 5058, 7503,
  6788, 5998,
];
export const KNOX_EXTRACT_DEFAULT_LIMIT = 25;
export const KNOX_EXTRACT_MAX_LIMIT = 100;


/** The columns of an `agent_source_texts` row that Knox's writers need. */
export type KnoxTextRow = Pick<
  TextArtifactRow,
  "document_text_id" | "source_document_id" | "institution_id" | "source_url" | "text_hash"
>;

interface TextArtifactRow {
  document_text_id: number | string;
  source_document_id: number | string;
  institution_id: number | string;
  source_url: string | null;
  normalized_text: string;
  text_hash: string | null;
  institution_name?: string | null;
  /** Playbook columns, present once the learning-core migration is applied. */
  format?: string | null;
  best_strategy?: unknown;
  strategy_stats?: unknown;
  do_not_retry?: unknown;
  expected_fee_count?: number | string | null;
}

export type { ExtractedFeeCandidate, HeldFeeCandidate };

export interface KnoxExtractDocumentResult {
  documentTextId: number;
  sourceDocumentId: number;
  institutionId: number;
  sourceUrl: string | null;
  extracted: number;
  inserted: number;
  skipped: number;
  candidates: ExtractedFeeCandidate[];
  /** Rows kept as evidence for review; Darwin does not verify them. */
  held: HeldFeeCandidate[];
  heldInserted: number;
  /** Of heldInserted: free ($0) fees sent to Darwin like priced ones. */
  freeInserted: number;
  attemptOutcome: AttemptOutcome | null;
}

export interface RunKnoxExtractOptions {
  runId: number;
  stepId?: number;
  limit?: number;
  institutionId?: number;
  stateCode?: string;
  dryRun?: boolean;
  db?: SqlTag;
}

export interface RunKnoxExtractResult {
  selectedDocuments: number;
  processedDocuments: number;
  extractedFees: number;
  insertedFees: number;
  /** Free ($0) fees sent to Darwin; not part of insertedFees. */
  freeFees: number;
  skippedFees: number;
  /** $0, range, percentage and unrecognized priced lines held for review, not verified. */
  heldForReview: number;
  /** Unverified rows from a document's older text that a re-extraction replaced. */
  retiredOlderRows: number;
  /** Unverified rows from an older copy of a page whose current copy Knox has read. */
  retiredOlderCopyRows: number;
  /** Texts the router refused because this extractor version already failed on them. */
  skippedKnownInputs: number;
  limit: number;
  dryRun: boolean;
  learning: boolean;
  /** Lessons read from the shared learning store, and fees they re-filed (`lessons.ts`). */
  lessonsLoaded: number;
  lessonRefiles: Record<string, number>;
  /** Confirmed, still-down takedowns read before the run (`takedown-lessons.ts`). */
  takedownLessonsLoaded: number;
  /** Fees written held because they repeat a confirmed takedown, by check. */
  takedownHolds: Record<string, number>;
  /** Strategy/category groups with survival history, and reads calibration puts below Hamilton's floor (`calibration.ts`, shadow). */
  calibrationGroups: number;
  calibratedBelowPublishFloor: number;
  /** Texts by layout signature, with how many read thin (`layout-signature.ts`). */
  layouts: Record<string, LayoutYield>;
  outcomes: Partial<Record<AttemptOutcome, number>>;
  results: KnoxExtractDocumentResult[];
}

function boundedLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return KNOX_EXTRACT_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), KNOX_EXTRACT_MAX_LIMIT);
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

async function selectTextArtifacts(
  db: SqlTag,
  limit: number,
  learning: boolean,
  currentCopy: boolean,
  institutionId?: number,
  stateCode?: string,
  priorityIds: readonly number[] = [],
): Promise<TextArtifactRow[]> {
  const params: Array<number | string> = [limit];
  const filters: string[] = [];
  if (institutionId) {
    params.push(institutionId);
    filters.push(`AND adt.institution_id = $${params.length}`);
  }
  const normalizedState = normalizeStateCode(stateCode);
  if (normalizedState) {
    params.push(normalizedState);
    filters.push(`AND upper(btrim(inst.state_code)) = $${params.length}`);
  }
  if (currentCopy) {
    // One document per page: an older copy of a page Magellan fetched again is history
    // once the current copy has a text, so Knox reads the current copy instead.
    filters.push(`AND NOT EXISTS (
           SELECT 1
             FROM source_documents old_copy
             JOIN agent_source_texts current_text
               ON current_text.source_document_id = old_copy.superseded_by_id
              AND current_text.status = 'completed'
              AND current_text.char_count > 0
            WHERE old_copy.id = adt.source_document_id
              AND old_copy.superseded_by_id IS NOT NULL
         )`);
  }
  let playbookColumns = "";
  let playbookJoin = "";
  // Without the attempt log there is no rules version to compare, so never re-extract.
  let thinTextReextract = "";
  if (learning) {
    // A thin text an older rules version extracted is extracted again; the
    // attempt-log filter below stops a second pass with the same version.
    params.push(KNOX_REEXTRACT_MAX_FEES);
    thinTextReextract = `
           OR (
             SELECT COUNT(*)
               FROM raw_fee_observations thin
              WHERE thin.source = 'knox'
                AND thin.source_document_id = adt.source_document_id
           ) < $${params.length}`;
    // Hamilton's rules re-check found fees today's rules read from this document that
    // are not live (an older version missed them): extract it again.
    const signatureParam = `$${params.push(knoxFreeSignature())}`;
    thinTextReextract += `
           OR EXISTS (
             SELECT 1
               FROM pipeline_attempts recheck
              WHERE recheck.stage = 'publish'
                AND recheck.strategy = '${RULES_RECHECK_STRATEGY.strategy}'
                AND recheck.institution_id = adt.institution_id
                AND recheck.source_document_id = adt.source_document_id
                AND recheck.input_fingerprint = ${signatureParam}
                AND COALESCE((recheck.detail->>'${MISSING_FEES_DETAIL}')::int, 0) > 0
           )`;
    // A large bank's current page is read again once per rules version.
    const assetParam = `$${params.push(KNOX_REREAD_ASSET_FLOOR)}`;
    thinTextReextract += `
           OR (
             COALESCE(inst.asset_size, 0) >= ${assetParam}${currentCopy ? `
             AND NOT EXISTS (
               SELECT 1 FROM source_documents copy
                WHERE copy.id = adt.source_document_id
                  AND copy.superseded_by_id IS NOT NULL
             )` : ""}
           )`;
    // The current copy of a page whose older copy still carries live fees is read again
    // once per rules version, so those fees can move to it. An old rules version, or none,
    // may have read the current copy (2026-10-07: 898 live fees on older copies were
    // missing from their current copy's rows; most current copies were read at v1-v7).
    if (currentCopy) {
      thinTextReextract += `
           OR EXISTS (
             SELECT 1
               FROM source_documents older_copy
               JOIN published_fee_records live_fee
                 ON live_fee.rolled_back_at IS NULL
               JOIN verified_fee_observations live_verified
                 ON live_verified.fee_verified_id = live_fee.lineage_ref
               JOIN raw_fee_observations live_raw
                 ON live_raw.fee_raw_id = live_verified.fee_raw_id
                AND live_raw.source_document_id = older_copy.id
              WHERE older_copy.superseded_by_id = adt.source_document_id
           )`;
    }
    // A current copy last read before KNOX_STALE_READ_BELOW_VERSION is read again once.
    if (currentCopy) {
      const staleParam = `$${params.push(KNOX_STALE_READ_BELOW_VERSION)}`;
      thinTextReextract += `
           OR (
             NOT EXISTS (
               SELECT 1 FROM source_documents copy
                WHERE copy.id = adt.source_document_id
                  AND copy.superseded_by_id IS NOT NULL
             )
             AND NOT EXISTS (
               SELECT 1 FROM pipeline_attempts recent
                WHERE recent.stage = 'extract'
                  AND recent.institution_id = adt.institution_id
                  AND recent.input_fingerprint = adt.text_hash
                  AND recent.strategy = '${KNOX_EXTRACT_STRATEGY.strategy}'
                  AND recent.strategy_version >= ${staleParam}
             )
           )`;
    }
    // Same text + same extractor version = same answer: never extract it twice.
    const strategyParam = `$${params.push(KNOX_EXTRACT_STRATEGY.strategy)}`;
    const versionParam = `$${params.push(KNOX_EXTRACT_STRATEGY.version)}`;
    playbookColumns = `,
             profile.format,
             profile.best_strategy,
             profile.strategy_stats,
             profile.do_not_retry,
             profile.expected_fee_count`;
    playbookJoin = `
        LEFT JOIN institution_source_profiles profile ON profile.institution_id = adt.institution_id`;
    filters.push(`AND NOT EXISTS (
           SELECT 1
             FROM pipeline_attempts pa
            WHERE pa.stage = 'extract'
              AND pa.institution_id = adt.institution_id
              AND pa.input_fingerprint = adt.text_hash
              AND pa.strategy = ${strategyParam}
              AND pa.strategy_version = ${versionParam}
         )`);
  }
  return db.unsafe<TextArtifactRow[]>(
    `
      SELECT adt.id AS document_text_id,
             adt.source_document_id,
             adt.institution_id,
             adt.source_url,
             adt.normalized_text,
             adt.text_hash,
             inst.institution_name${playbookColumns}
        FROM agent_source_texts adt
        JOIN institution_sources inst ON inst.id = adt.institution_id${playbookJoin}
       WHERE adt.status = 'completed'
         AND adt.normalized_text IS NOT NULL
         AND adt.char_count > 0
         ${filters.join("\n         ")}
         AND (NOT EXISTS (
           -- This exact text was already extracted. Rows from an older text of the same
           -- document (before a Rosetta re-read) do not count, so a changed text is
           -- extracted again.
           SELECT 1
             FROM raw_fee_observations fr
            WHERE fr.source = 'knox'
              AND fr.source_document_id = adt.source_document_id
              AND (
                adt.text_hash IS NULL
                OR position(('text_hash=' || adt.text_hash || ';') IN COALESCE(fr.conditions, '')) > 0
              )
         )${thinTextReextract})
         AND NOT EXISTS (
           -- The same text under another document id was already extracted.
           SELECT 1
             FROM agent_source_texts prior
             JOIN raw_fee_observations prior_fr
               ON prior_fr.source = 'knox'
              AND prior_fr.source_document_id = prior.source_document_id
            WHERE adt.text_hash IS NOT NULL
              AND prior.institution_id = adt.institution_id
              AND prior.text_hash = adt.text_hash
              AND prior.id <> adt.id${currentCopy ? `
              -- An older copy's rows never block the page's current copy, or a page whose
              -- text did not change would never be read again.
              AND NOT EXISTS (
                SELECT 1
                  FROM source_documents mine
                  JOIN source_documents theirs ON theirs.id = prior.source_document_id
                 WHERE mine.id = adt.source_document_id
                   AND mine.superseded_by_id IS NULL
                   AND theirs.superseded_by_id IS NOT NULL
              )` : ""}
         )
       ORDER BY ${learning && priorityIds.length > 0 ? `(adt.institution_id = ANY($${params.push(`{${priorityIds.join(",")}}`)}::bigint[])) DESC, ` : ""}${learning ? `(COALESCE(inst.asset_size, 0) >= ${KNOX_REREAD_ASSET_FLOOR}) DESC, ` : ""}adt.updated_at DESC, adt.id DESC
       LIMIT $1
    `,
    params,
  );
}

/**
 * After a re-read, rows Knox took from the document's older text stop going to Darwin:
 * the new text replaces them. Rows Darwin already verified are left as they are.
 */
export async function retireRowsFromOlderText(db: SqlTag, row: KnoxTextRow): Promise<number> {
  if (!row.text_hash) return 0;
  const retired = await db`
    UPDATE raw_fee_observations fr
       SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'needs_darwin_verification')
                           || '["superseded_by_reread"]'::jsonb
     WHERE fr.source = 'knox'
       AND fr.source_document_id = ${Number(row.source_document_id)}
       AND position(${`text_hash=${row.text_hash};`} IN COALESCE(fr.conditions, '')) = 0
       AND fr.outlier_flags ? 'needs_darwin_verification'
       AND NOT EXISTS (
         SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id
       )
    RETURNING fr.fee_raw_id
  `;
  return retired.length;
}

/** Older-copy rows retired per extract step. */
export const OLDER_COPY_RETIRE_LIMIT = 2000;

/**
 * One document per page: when Magellan stores a newer copy of a page, the unverified rows
 * Knox read from an older copy stop going to Darwin, but only once Knox has read the same
 * category from the current copy. The current copy's row then stands for the fee, at the
 * price the bank shows today. A category the current copy does not show is left for
 * Darwin, so a fee the newer read misses is not lost. Rows Darwin already verified are
 * left alone; live fees a newer copy dropped are Hamilton's (`hamilton/newer-copy-retire.ts`).
 */
export async function retireRowsFromOlderCopies(
  db: SqlTag,
  options: { limit?: number } = {},
): Promise<number> {
  if (!(await currentCopySchemaReady(db))) return 0;
  const limit = Math.max(0, Math.min(options.limit ?? OLDER_COPY_RETIRE_LIMIT, OLDER_COPY_RETIRE_LIMIT));
  if (limit === 0) return 0;
  const eligible = db`
    SELECT fr.fee_raw_id
      FROM raw_fee_observations fr
      JOIN source_documents old_copy ON old_copy.id = fr.source_document_id
     WHERE fr.source = 'knox'
       AND old_copy.superseded_by_id IS NOT NULL
       AND fr.outlier_flags ? 'needs_darwin_verification'
       AND NOT EXISTS (
         SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id
       )
       AND EXISTS (
         SELECT 1
           FROM raw_fee_observations cur
          WHERE cur.source = 'knox'
            AND cur.source_document_id = old_copy.superseded_by_id
            AND NOT (COALESCE(cur.outlier_flags, '[]'::jsonb) ?| array['superseded_by_reread', 'superseded_by_newer_copy'])
            AND substring(cur.conditions FROM 'canonical_hint=([a-z_]+)')
                = substring(fr.conditions FROM 'canonical_hint=([a-z_]+)')
       )
     ORDER BY fr.fee_raw_id
     LIMIT ${limit}
  `;
  const retired = await db`
    UPDATE raw_fee_observations fr
       SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'needs_darwin_verification')
                           || '["superseded_by_newer_copy"]'::jsonb
     WHERE fr.fee_raw_id IN (${eligible})
    RETURNING fr.fee_raw_id
  `;
  return retired.length;
}

export async function insertCandidate(
  db: SqlTag,
  options: {
    runId: number;
    row: KnoxTextRow;
    candidate: ExtractedFeeCandidate;
    /** Flags beyond the rule path's, e.g. `knox_paid_extraction`. */
    extraFlags?: string[];
    /** How the fee was read, for the `conditions` audit text. */
    method?: string;
    /** Shadow calibrated confidence (`calibration.ts`), recorded in the audit text only. */
    calibratedConfidence?: number;
    /** The check whose confirmed takedown this fee repeats: written held, not sent to Darwin. */
    takenDownBy?: string | null;
  },
): Promise<boolean> {
  const documentTextId = Number(options.row.document_text_id);
  const sourceDocumentId = Number(options.row.source_document_id);
  const institutionId = Number(options.row.institution_id);
  const agentEventId = stableUuid(
    `knox:${options.runId}:${documentTextId}:${sourceDocumentId}:${options.candidate.canonicalHint}:${options.candidate.feeName}:${options.candidate.amount}`,
  );
  const flags = options.takenDownBy
    ? [TAKEN_DOWN_REVIEW_FLAG, takedownLessonFlag(options.takenDownBy), `canonical_hint:${options.candidate.canonicalHint}`]
    : ["needs_darwin_verification", `canonical_hint:${options.candidate.canonicalHint}`];
  if (options.candidate.waivable) flags.push("waivable");
  if (options.candidate.strategy && options.candidate.strategy !== KNOX_RULES_STRATEGY.strategy) {
    flags.push(`knox_specialist:${options.candidate.strategy}`);
  }
  flags.push(...(options.extraFlags ?? []));
  const conditions =
    `Knox ${options.method ?? "deterministic extraction"} from Rosetta artifact #${documentTextId}. ` +
    `canonical_hint=${options.candidate.canonicalHint}; text_hash=${options.row.text_hash ?? "unknown"}; ` +
    (options.calibratedConfidence === undefined ? "" : `calibrated_confidence=${options.calibratedConfidence.toFixed(2)}; `) +
    `excerpt="${options.candidate.excerpt.slice(0, 180)}"`;
  // The dedupe index is (document, fee name, amount), so a line an older version held
  // as unclassified would block this fee forever. A held row with no category takes the
  // category instead; any other existing row stays as it is.
  const inserted = await db`
    INSERT INTO raw_fee_observations AS fr (
      institution_id,
      source_document_id,
      document_r2_key,
      source_url,
      extraction_confidence,
      agent_event_id,
      fee_name,
      amount,
      frequency,
      conditions,
      outlier_flags,
      source
    )
    VALUES (
      ${institutionId},
      ${sourceDocumentId},
      ${null},
      ${options.row.source_url},
      ${options.candidate.confidence},
      ${agentEventId}::uuid,
      ${options.candidate.feeName},
      ${options.candidate.amount},
      ${options.candidate.frequency},
      ${conditions},
      ${JSON.stringify(flags)}::jsonb,
      'knox'
    )
    ON CONFLICT (source_document_id, lower(fee_name), COALESCE(amount, '-1'::numeric))
      WHERE source = 'knox' AND source_document_id IS NOT NULL
    DO UPDATE SET
      extraction_confidence = EXCLUDED.extraction_confidence,
      agent_event_id = EXCLUDED.agent_event_id,
      frequency = COALESCE(fr.frequency, EXCLUDED.frequency),
      conditions = EXCLUDED.conditions,
      outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'knox_review:unclassified')
                      || EXCLUDED.outlier_flags
                      || '["knox_promoted_from_held"]'::jsonb
     WHERE fr.source = 'knox'
       AND fr.outlier_flags ? 'knox_review:unclassified'
       AND NOT fr.outlier_flags ? 'needs_darwin_verification'
    RETURNING fee_raw_id
  `;
  return inserted.length > 0;
}

/**
 * A row kept for review: the evidence is stored with its shape, but without the
 * `needs_darwin_verification` flag, so Darwin never verifies it as an exact amount.
 */
/**
 * A free fee with a category is a real price ($0) Darwin can verify; the other shapes
 * (ranges, percentages, unclassified lines) wait for review.
 */
export function heldGoesToDarwin(held: HeldFeeCandidate): boolean {
  return held.shape === "zero" && Boolean(held.canonicalHint);
}

export async function insertHeldCandidate(
  db: SqlTag,
  options: {
    runId: number;
    row: KnoxTextRow;
    held: HeldFeeCandidate;
    extraFlags?: string[];
  },
): Promise<boolean> {
  const documentTextId = Number(options.row.document_text_id);
  const sourceDocumentId = Number(options.row.source_document_id);
  const { held } = options;
  const agentEventId = stableUuid(
    `knox:held:${options.runId}:${documentTextId}:${sourceDocumentId}:${held.shape}:${held.feeName}:${held.amount}:${held.percent}`,
  );
  const toDarwin = heldGoesToDarwin(held);
  const flags = [`knox_review:${held.shape}`];
  if (toDarwin) flags.push("needs_darwin_verification");
  if (held.canonicalHint) flags.push(`canonical_hint:${held.canonicalHint}`);
  if (held.amountMax != null) flags.push(`amount_max:${held.amountMax}`);
  if (held.percent != null) flags.push(`percent:${held.percent}`);
  flags.push(...(options.extraFlags ?? []));
  const conditions =
    `${toDarwin ? "Knox read a free fee" : `Knox held for review (${held.shape})`} from Rosetta artifact #${documentTextId}. ` +
    `canonical_hint=${held.canonicalHint ?? "none"}; text_hash=${options.row.text_hash ?? "unknown"}; ` +
    `excerpt="${held.excerpt.slice(0, 180)}"`;
  const inserted = await db`
    INSERT INTO raw_fee_observations (
      institution_id,
      source_document_id,
      document_r2_key,
      source_url,
      extraction_confidence,
      agent_event_id,
      fee_name,
      amount,
      frequency,
      conditions,
      outlier_flags,
      source
    )
    VALUES (
      ${Number(options.row.institution_id)},
      ${sourceDocumentId},
      ${null},
      ${options.row.source_url},
      ${toDarwin ? confidenceFor(held.excerpt) : 0.5},
      ${agentEventId}::uuid,
      ${held.feeName},
      ${held.amount},
      ${held.frequency},
      ${conditions},
      ${JSON.stringify(flags)}::jsonb,
      'knox'
    )
    ON CONFLICT DO NOTHING
    RETURNING fee_raw_id
  `;
  return inserted.length > 0;
}

/** Flag on a raw row that is a percentage fee (`amount_kind` 'percent'). */
export const KNOX_RATE_FEE_FLAG = "knox_rate_fee";

/**
 * A percentage fee that traced to its text and whose category publishes rates: amount NULL,
 * the rate in `rate_percent`, sent to Darwin (migration 20270110000006).
 */
export async function insertRateCandidate(
  db: SqlTag,
  options: { runId: number; row: KnoxTextRow; rate: RateFeeCandidate },
): Promise<boolean> {
  const documentTextId = Number(options.row.document_text_id);
  const sourceDocumentId = Number(options.row.source_document_id);
  const { rate } = options;
  const agentEventId = stableUuid(
    `knox:rate:${options.runId}:${documentTextId}:${sourceDocumentId}:${rate.canonicalHint}:${rate.feeName}:${rate.ratePercent}`,
  );
  const flags = ["needs_darwin_verification", `canonical_hint:${rate.canonicalHint}`, KNOX_RATE_FEE_FLAG];
  const conditions =
    `Knox read a percentage fee from Rosetta artifact #${documentTextId}. ` +
    `canonical_hint=${rate.canonicalHint}; text_hash=${options.row.text_hash ?? "unknown"}; ` +
    `excerpt="${rate.excerpt.slice(0, 180)}"`;
  const inserted = await db`
    INSERT INTO raw_fee_observations (
      institution_id, source_document_id, document_r2_key, source_url, extraction_confidence,
      agent_event_id, fee_name, amount, frequency, conditions, outlier_flags, source,
      amount_kind, rate_percent, rate_min_amount, rate_max_amount, rate_basis
    )
    VALUES (
      ${Number(options.row.institution_id)},
      ${sourceDocumentId},
      ${null},
      ${options.row.source_url},
      ${confidenceFor(rate.excerpt)},
      ${agentEventId}::uuid,
      ${rate.feeName},
      ${null},
      ${rate.frequency},
      ${conditions},
      ${JSON.stringify(flags)}::jsonb,
      'knox',
      'percent',
      ${rate.ratePercent},
      ${rate.rateMinAmount},
      ${rate.rateMaxAmount},
      ${rate.rateBasis}
    )
    ON CONFLICT DO NOTHING
    RETURNING fee_raw_id
  `;
  return inserted.length > 0;
}

function institutionLabel(row: Pick<TextArtifactRow, "institution_id" | "institution_name">): string {
  return row.institution_name?.trim() || `Institution ${row.institution_id}`;
}

function rawObservationCountLabel(count: number): string {
  return `${count} raw observation${count === 1 ? "" : "s"}`;
}

function documentCountLabel(count: number): string {
  return `${count} normalized source document${count === 1 ? "" : "s"}`;
}

async function recordExtractionSignals(
  db: SqlTag,
  runId: number,
  results: KnoxExtractDocumentResult[],
  rowByDocumentTextId: Map<number, TextArtifactRow>,
): Promise<void> {
  const insertedGroups = new Map<number, {
    institutionName: string;
    sourceDocumentIds: number[];
    documentTextIds: number[];
    canonicalFeeKeys: string[];
    insertedObservationCount: number;
  }>();
  const needsReviewGroups = new Map<number, {
    institutionName: string;
    sourceDocumentIds: number[];
    documentTextIds: number[];
    reviewedDocumentCount: number;
  }>();

  results.forEach((result) => {
    const row = rowByDocumentTextId.get(result.documentTextId);
    const institutionName = row ? institutionLabel(row) : `Institution ${result.institutionId}`;

    if (result.inserted > 0) {
      const group = insertedGroups.get(result.institutionId) ?? {
        institutionName,
        sourceDocumentIds: [],
        documentTextIds: [],
        canonicalFeeKeys: [],
        insertedObservationCount: 0,
      };
      group.sourceDocumentIds.push(result.sourceDocumentId);
      group.documentTextIds.push(result.documentTextId);
      group.canonicalFeeKeys.push(...result.candidates.map((candidate) => candidate.canonicalHint));
      group.insertedObservationCount += result.inserted;
      insertedGroups.set(result.institutionId, group);
      return;
    }

    if (result.extracted === 0) {
      const group = needsReviewGroups.get(result.institutionId) ?? {
        institutionName,
        sourceDocumentIds: [],
        documentTextIds: [],
        reviewedDocumentCount: 0,
      };
      group.sourceDocumentIds.push(result.sourceDocumentId);
      group.documentTextIds.push(result.documentTextId);
      group.reviewedDocumentCount += 1;
      needsReviewGroups.set(result.institutionId, group);
    }
  });

  for (const [institutionId, group] of insertedGroups) {
    const count = group.insertedObservationCount;
    await recordHamiltonMonitorSignal(
      {
        institutionId,
        signalType: "knox_extraction_completed",
        severity: "medium",
        title: `${group.institutionName} - ${rawObservationCountLabel(count)} extracted`,
        body:
          `Knox extracted ${rawObservationCountLabel(count)} from Rosetta-normalized source text. ` +
          "Darwin verification is still required before benchmark scoring or public-ready analysis changes.",
        sourceJson: {
          source: "knox_extraction",
          run_id: runId,
          pipeline_stage: "raw_observations_pending_verification",
          source_document_ids: Array.from(new Set(group.sourceDocumentIds)),
          document_text_ids: Array.from(new Set(group.documentTextIds)),
          canonical_fee_keys: Array.from(new Set(group.canonicalFeeKeys)),
          extracted_observation_count: count,
          provider_call_queued: false,
        },
      },
      db,
    ).catch((error) => {
      console.error("recordKnoxExtractionSignal failed:", error);
    });
  }

  for (const [institutionId, group] of needsReviewGroups) {
    const count = group.reviewedDocumentCount;
    await recordHamiltonMonitorSignal(
      {
        institutionId,
        signalType: "knox_extraction_needs_review",
        severity: "medium",
        title: `${group.institutionName} - source text needs manual fee review`,
        body:
          `Knox found no source-grounded fee candidates in ${documentCountLabel(count)}. ` +
          "Review the source quality before relying on institution-specific fee conclusions.",
        sourceJson: {
          source: "knox_extraction",
          run_id: runId,
          pipeline_stage: "extraction_needs_review",
          source_document_ids: Array.from(new Set(group.sourceDocumentIds)),
          document_text_ids: Array.from(new Set(group.documentTextIds)),
          reviewed_document_count: count,
          provider_call_queued: false,
        },
      },
      db,
    ).catch((error) => {
      console.error("recordKnoxExtractionReviewSignal failed:", error);
    });
  }
}

function countHeldShapes(held: HeldFeeCandidate[]): Partial<Record<HeldFeeCandidate["shape"], number>> {
  const counts: Partial<Record<HeldFeeCandidate["shape"], number>> = {};
  for (const row of held) counts[row.shape] = (counts[row.shape] ?? 0) + 1;
  return counts;
}

function specialistDetail(row: TextArtifactRow, run: SpecialistRun): Record<string, unknown> {
  return {
    document_text_id: Number(row.document_text_id),
    pass: run.pass,
    found: run.found,
    added: run.added,
    held_found: run.heldFound,
    self_check_failed: run.selfCheckFailed,
  };
}

function extractionOutcome(extracted: number, expectedFeeCount: number | null): AttemptOutcome {
  if (extracted === 0) return "no_candidates";
  if (expectedFeeCount != null && expectedFeeCount > 0 && extracted < expectedFeeCount * LOW_YIELD_RATIO) {
    return "low_yield";
  }
  return "ok";
}

export async function runKnoxExtract(
  options: RunKnoxExtractOptions,
): Promise<RunKnoxExtractResult> {
  const db = options.db ?? sql;
  const limit = boundedLimit(options.limit);
  const dryRun = Boolean(options.dryRun);
  const learning = !dryRun && (await learningSchemaReady(db));
  // Dry runs stay off the database beyond the text read, like the lessons below.
  const currentCopy = !dryRun && (await currentCopySchemaReady(db));
  // Market leaders and the named priority banks are read first while the stale backlog lasts.
  const priorityIds = learning && currentCopy && !options.institutionId
    ? [...new Set([...KNOX_PRIORITY_REREAD_IDS, ...(await loadMarketLeaderIds(db, { stateCode: options.stateCode ?? null }).catch(() => []))])]
    : [];
  const rows = await selectTextArtifacts(db, limit, learning, currentCopy, options.institutionId, options.stateCode, priorityIds);
  const rowByDocumentTextId = new Map(rows.map((row) => [Number(row.document_text_id), row]));
  const lessons = !dryRun && rows.length > 0 ? await loadKnoxLessons(db) : new Map();
  const lessonRefiles: Record<string, number> = {};
  const takedownLessons = !dryRun && rows.length > 0 ? await loadTakedownLessons(db) : new Map<string, string>();
  const takedownHolds: Record<string, number> = {};
  const calibration = !dryRun && rows.length > 0 ? await loadKnoxCalibration(db) : new Map();
  let calibratedBelowPublishFloor = 0;
  const layoutReads: Array<{ signature: string; priceLines: number; found: number }> = [];

  const results: KnoxExtractDocumentResult[] = [];
  let skippedKnownInputs = 0;
  let retiredOlderRows = 0;
  for (const row of rows) {
    const playbook = playbookFromRow(row);
    const decision = chooseStrategy({
      stage: "extract",
      playbook,
      fingerprint: row.text_hash,
      candidates: [{ ...KNOX_EXTRACT_STRATEGY, costMicrousd: 0 }],
    });
    if (decision.kind === "skip") {
      skippedKnownInputs += 1;
      continue;
    }

    const startedAt = Date.now();
    const free = runFreeSpecialists(row.normalized_text);
    const { held, rates, runs } = free;
    // The learning reader: a name the category guards keep rejecting under the rules'
    // category, and verify under another, is filed under the verified one.
    const lessoned = free.candidates.map((candidate) => applyKnoxLesson(candidate, lessons, Number(row.institution_id)));
    const candidates = lessoned.map((entry) => entry.candidate);
    const lessonFlags = new Map(lessoned.filter((entry) => entry.lessonFlag).map((entry) => [entry.candidate, entry.lessonFlag!]));
    for (const flag of lessonFlags.values()) lessonRefiles[flag] = (lessonRefiles[flag] ?? 0) + 1;
    let inserted = 0;
    let heldInserted = 0;
    let freeInserted = 0;
    if (!dryRun) {
      retiredOlderRows += await retireRowsFromOlderText(db, row);
      for (const candidate of candidates) {
        const lessonFlag = lessonFlags.get(candidate);
        const calibrated = calibratedConfidence(
          candidate.confidence,
          calibration.get(calibrationKey(candidate.strategy ?? KNOX_RULES_STRATEGY.strategy, candidate.canonicalHint)),
        );
        if (calibrated < PUBLISH_FLOOR) calibratedBelowPublishFloor += 1;
        const takenDownBy = takedownLessonFor(candidate, takedownLessons, Number(row.institution_id));
        if (takenDownBy) takedownHolds[takenDownBy] = (takedownHolds[takenDownBy] ?? 0) + 1;
        if (
          await insertCandidate(db, {
            runId: options.runId,
            row,
            candidate,
            extraFlags: lessonFlag ? [lessonFlag] : [],
            calibratedConfidence: calibrated,
            takenDownBy,
          })
        ) inserted += 1;
      }
      for (const rate of rates) {
        if (await insertRateCandidate(db, { runId: options.runId, row, rate })) inserted += 1;
      }
      for (const heldCandidate of held) {
        if (await insertHeldCandidate(db, { runId: options.runId, row, held: heldCandidate })) {
          heldInserted += 1;
          if (heldGoesToDarwin(heldCandidate)) freeInserted += 1;
        }
      }
    }
    const layout = layoutSignature(row.normalized_text);
    layoutReads.push({ ...layout, found: candidates.length });
    const attemptOutcome = extractionOutcome(candidates.length, playbook.expectedFeeCount);
    results.push({
      documentTextId: Number(row.document_text_id),
      sourceDocumentId: Number(row.source_document_id),
      institutionId: Number(row.institution_id),
      sourceUrl: row.source_url,
      extracted: candidates.length,
      inserted: dryRun ? 0 : inserted,
      skipped: dryRun ? candidates.length : candidates.length - inserted,
      candidates,
      held,
      heldInserted: dryRun ? 0 : heldInserted,
      freeInserted: dryRun ? 0 : freeInserted,
      attemptOutcome,
    });
    if (learning) {
      // Each pass 2 specialist is its own strategy in the attempt log. They run beside
      // the rules on the same document, so they do not fold into the playbook; the
      // rules attempt below carries the document's total.
      for (const run of runs.filter((entry) => entry.pass === 2)) {
        await recordAttempt(db, {
          institutionId: Number(row.institution_id),
          sourceDocumentId: Number(row.source_document_id),
          stage: "extract",
          strategy: run.strategy,
          version: run.version,
          fingerprint: row.text_hash,
          outcome: run.found > 0 ? "ok" : "no_candidates",
          yieldCount: run.found,
          costMicrousd: 0,
          durationMs: null,
          runId: options.runId,
          stepId: options.stepId ?? null,
          foldIntoPlaybook: false,
          detail: specialistDetail(row, run),
        });
      }
      await recordAttempt(db, {
        institutionId: Number(row.institution_id),
        sourceDocumentId: Number(row.source_document_id),
        stage: "extract",
        strategy: decision.strategy,
        version: decision.version,
        fingerprint: row.text_hash,
        outcome: attemptOutcome,
        yieldCount: candidates.length,
        costMicrousd: 0,
        durationMs: Date.now() - startedAt,
        runId: options.runId,
        stepId: options.stepId ?? null,
        detail: {
          document_text_id: Number(row.document_text_id),
          inserted,
          held_for_review: held.length,
          held_shapes: countHeldShapes(held),
          rules_found: runs.find((entry) => entry.pass === 1)?.found ?? 0,
          specialists: Object.fromEntries(runs.filter((entry) => entry.pass === 2).map((entry) => [entry.strategy, entry.added])),
          expected_fee_count: playbook.expectedFeeCount,
          layout: layout.signature,
          price_lines: layout.priceLines,
          router: decision.reason,
        },
      });
    }
  }

  if (!dryRun) {
    await recordExtractionSignals(db, options.runId, results, rowByDocumentTextId);
  }
  const retiredOlderCopyRows = currentCopy ? await retireRowsFromOlderCopies(db) : 0;

  return {
    selectedDocuments: rows.length,
    processedDocuments: results.length,
    extractedFees: results.reduce((total, result) => total + result.extracted, 0),
    insertedFees: results.reduce((total, result) => total + result.inserted, 0),
    freeFees: results.reduce((total, result) => total + result.freeInserted, 0),
    skippedFees: results.reduce((total, result) => total + result.skipped, 0),
    heldForReview: results.reduce((total, result) => total + result.held.length, 0),
    retiredOlderRows,
    retiredOlderCopyRows,
    skippedKnownInputs,
    limit,
    dryRun,
    learning,
    lessonsLoaded: lessons.size,
    lessonRefiles,
    takedownLessonsLoaded: takedownLessons.size,
    takedownHolds,
    calibrationGroups: calibration.size,
    calibratedBelowPublishFloor,
    layouts: thinLayouts(layoutReads),
    outcomes: countOutcomes(results.map((result) => result.attemptOutcome)),
    results,
  };
}
