import { createHash } from "crypto";

import { sql } from "@/lib/data-store/connection";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { countOutcomes, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { playbookFromRow } from "@/lib/agents/learning/playbook";
import { chooseStrategy } from "@/lib/agents/learning/router";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { confidenceFor, type ExtractedFeeCandidate, type HeldFeeCandidate } from "@/lib/agents/knox/rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists, type SpecialistRun } from "@/lib/agents/knox/specialists";
import { knoxFreeSignature, MISSING_FEES_DETAIL, RULES_RECHECK_STRATEGY } from "@/lib/agents/hamilton/rules-recheck";
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
  /** Texts the router refused because this extractor version already failed on them. */
  skippedKnownInputs: number;
  limit: number;
  dryRun: boolean;
  learning: boolean;
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
  institutionId?: number,
  stateCode?: string,
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
              AND prior.id <> adt.id
         )
       ORDER BY adt.updated_at DESC, adt.id DESC
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
  },
): Promise<boolean> {
  const documentTextId = Number(options.row.document_text_id);
  const sourceDocumentId = Number(options.row.source_document_id);
  const institutionId = Number(options.row.institution_id);
  const agentEventId = stableUuid(
    `knox:${options.runId}:${documentTextId}:${sourceDocumentId}:${options.candidate.canonicalHint}:${options.candidate.feeName}:${options.candidate.amount}`,
  );
  const flags = ["needs_darwin_verification", `canonical_hint:${options.candidate.canonicalHint}`];
  if (options.candidate.waivable) flags.push("waivable");
  if (options.candidate.strategy && options.candidate.strategy !== KNOX_RULES_STRATEGY.strategy) {
    flags.push(`knox_specialist:${options.candidate.strategy}`);
  }
  flags.push(...(options.extraFlags ?? []));
  const conditions =
    `Knox ${options.method ?? "deterministic extraction"} from Rosetta artifact #${documentTextId}. ` +
    `canonical_hint=${options.candidate.canonicalHint}; text_hash=${options.row.text_hash ?? "unknown"}; ` +
    `excerpt="${options.candidate.excerpt.slice(0, 180)}"`;
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
    ON CONFLICT DO NOTHING
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
  const rows = await selectTextArtifacts(db, limit, learning, options.institutionId, options.stateCode);
  const rowByDocumentTextId = new Map(rows.map((row) => [Number(row.document_text_id), row]));

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
    const { candidates, held, runs } = runFreeSpecialists(row.normalized_text);
    let inserted = 0;
    let heldInserted = 0;
    let freeInserted = 0;
    if (!dryRun) {
      retiredOlderRows += await retireRowsFromOlderText(db, row);
      for (const candidate of candidates) {
        if (await insertCandidate(db, { runId: options.runId, row, candidate })) inserted += 1;
      }
      for (const heldCandidate of held) {
        if (await insertHeldCandidate(db, { runId: options.runId, row, held: heldCandidate })) {
          heldInserted += 1;
          if (heldGoesToDarwin(heldCandidate)) freeInserted += 1;
        }
      }
    }
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
          router: decision.reason,
        },
      });
    }
  }

  if (!dryRun) {
    await recordExtractionSignals(db, options.runId, results, rowByDocumentTextId);
  }

  return {
    selectedDocuments: rows.length,
    processedDocuments: results.length,
    extractedFees: results.reduce((total, result) => total + result.extracted, 0),
    insertedFees: results.reduce((total, result) => total + result.inserted, 0),
    freeFees: results.reduce((total, result) => total + result.freeInserted, 0),
    skippedFees: results.reduce((total, result) => total + result.skipped, 0),
    heldForReview: results.reduce((total, result) => total + result.held.length, 0),
    retiredOlderRows,
    skippedKnownInputs,
    limit,
    dryRun,
    learning,
    outcomes: countOutcomes(results.map((result) => result.attemptOutcome)),
    results,
  };
}
