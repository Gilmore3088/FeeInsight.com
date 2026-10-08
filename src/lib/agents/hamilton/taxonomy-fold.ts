import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import {
  FOLD_RULES_VERSION,
  RETIRED_CATEGORIES,
  RETIRED_CATEGORY_KEYS,
  foldContext,
  foldRetiredCategory,
} from "@/lib/fee-fold";

type SqlTag = typeof sql;

/**
 * Hamilton's top-50 fold (James, Oct 8 2026). Every live fee, and every verified fee not yet
 * published, under one of the fifteen retired categories is re-filed under one of the 50 by
 * its own wording and, for a bare name, the schedule section above it (`fee-fold.ts`). A fee
 * moves only when the new category's guard and price range accept it. A fee with no home
 * among the 50 is taken down only after a second look, with its reason; nothing is deleted.
 * Each move is logged in `pipeline_feedback` (kind `category_fold`, check
 * `hamilton.taxonomy_fold`), and verified rows keep their old key in classification history.
 */
export const TAXONOMY_FOLD_CHECK = "hamilton.taxonomy_fold";
export const TAXONOMY_FOLD_KIND = "category_fold";
export const TAXONOMY_FOLD_REASON_PREFIX = "taxonomy_fold:";
/** Fees folded per publish step; the fifteen categories held about 1,000 live fees on Oct 8. */
export const TAXONOMY_FOLD_LIMIT = 2_000;
/**
 * Whether a live fee with no home is archived once its second look confirms it. Off until James
 * decides on the list of no-home fees (Oct 8: "Show me the list"); until then they are only
 * flagged and stay live.
 */
export const TAXONOMY_FOLD_ARCHIVE_NO_HOME = false;
const WRITE_CHUNK = 500;

interface FoldRow {
  fee_published_id: number | string | null;
  fee_verified_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  fee_name: string | null;
  amount: number | string | null;
}

export interface FoldMove {
  feePublishedId: number | null;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  from: string;
  to: string;
  rule: string;
  feeName: string;
  amount: number | null;
}

export interface FoldNoHome {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  reason: string;
}

export interface FoldPlan {
  moves: FoldMove[];
  /** Live fees with no home among the 50 (second look before any takedown). */
  noHome: FoldNoHome[];
  /** Verified, unpublished fees with no home: left as they are, never published. */
  unplacedVerified: number;
}

function amountOf(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Retired keys with a rule that reads the schedule section, so a bare name needs the text. */
const CONTEXT_KEYS = new Set(
  Object.entries(RETIRED_CATEGORIES)
    .filter(([, retired]) => retired.rules.some((rule) => rule.context))
    .map(([key]) => key),
);

/** True when the fee's name alone does not place it but its section might. Pure. */
export function needsContext(key: string, feeName: string | null): boolean {
  return CONTEXT_KEYS.has(key) && foldRetiredCategory(key, feeName)?.to == null;
}

/**
 * Where each fee goes. `texts` holds the newest stored text of each source document a bare
 * name needs. Pure.
 */
export function planFold(rows: FoldRow[], texts: Map<number, string>): FoldPlan {
  const plan: FoldPlan = { moves: [], noHome: [], unplacedVerified: 0 };
  for (const row of rows) {
    const name = row.fee_name ?? "";
    const documentId = row.source_document_id == null ? null : Number(row.source_document_id);
    const text = documentId == null ? null : texts.get(documentId) ?? null;
    const context = needsContext(row.canonical_fee_key, name) ? foldContext(text, name) : null;
    const fold = foldRetiredCategory(row.canonical_fee_key, name, context);
    if (!fold) continue;
    const amount = amountOf(row.amount);
    const accepted = fold.to != null && passesDarwinChecks(fold.to, name, amount ?? 0);
    if (fold.to && accepted) {
      plan.moves.push({
        feePublishedId: row.fee_published_id == null ? null : Number(row.fee_published_id),
        feeVerifiedId: Number(row.fee_verified_id),
        institutionId: Number(row.institution_id),
        sourceDocumentId: documentId,
        from: row.canonical_fee_key,
        to: fold.to,
        rule: fold.rule,
        feeName: name,
        amount,
      });
      continue;
    }
    if (row.fee_published_id == null) {
      plan.unplacedVerified += 1;
      continue;
    }
    plan.noHome.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: documentId,
      canonicalFeeKey: row.canonical_fee_key,
      feeName: name,
      amount,
      reason: fold.to
        ? `no_home: ${fold.rule} places it under ${fold.to}, whose guard or price range does not accept it`
        : `no_home: ${fold.rule} finds no home among the top 50`,
    });
  }
  return plan;
}

async function selectRetiredRows(db: SqlTag, institutionId?: number): Promise<FoldRow[]> {
  const keys = [...RETIRED_CATEGORY_KEYS];
  return db<FoldRow[]>`
    SELECT * FROM (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id,
             fr.source_document_id, fp.canonical_fee_key, fp.fee_name, fp.amount
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.canonical_fee_key = ANY(${keys}::text[])
         AND (${institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${institutionId ?? null}::bigint)
      UNION ALL
      SELECT NULL, fv.fee_verified_id, fv.institution_id, fr.source_document_id, fv.canonical_fee_key,
             fv.fee_name, fv.amount
        FROM verified_fee_observations fv
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fv.canonical_fee_key = ANY(${keys}::text[])
         AND fv.review_status IN ('verified', 'approved')
         AND (${institutionId ?? null}::bigint IS NULL OR fv.institution_id = ${institutionId ?? null}::bigint)
         AND NOT EXISTS (
           SELECT 1 FROM published_fee_records fp
            WHERE fp.lineage_ref = fv.fee_verified_id AND fp.rolled_back_at IS NULL
         )
    ) retired
    ORDER BY fee_published_id NULLS LAST, fee_verified_id
    LIMIT ${TAXONOMY_FOLD_LIMIT}
  `;
}

async function loadTexts(db: SqlTag, documentIds: number[]): Promise<Map<number, string>> {
  if (documentIds.length === 0) return new Map();
  const rows = await db<{ source_document_id: number | string; normalized_text: string }[]>`
    SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
      FROM agent_source_texts
     WHERE source_document_id = ANY(${documentIds}::bigint[])
       AND normalized_text IS NOT NULL
     ORDER BY source_document_id, created_at DESC
  `;
  return new Map(rows.map((row) => [Number(row.source_document_id), row.normalized_text]));
}

async function applyMoves(db: SqlTag, moves: FoldMove[]): Promise<{ published: number; verified: number }> {
  let published = 0;
  let verified = 0;
  for (let start = 0; start < moves.length; start += WRITE_CHUNK) {
    const chunk = moves.slice(start, start + WRITE_CHUNK);
    const live = chunk.filter((move) => move.feePublishedId != null);
    if (live.length > 0) {
      const updated = await db`
        UPDATE published_fee_records fp
           SET canonical_fee_key = v.to_key
          FROM unnest(${live.map((move) => move.feePublishedId!)}::bigint[], ${live.map((move) => move.from)}::text[],
                      ${live.map((move) => move.to)}::text[]) AS v(fee_published_id, from_key, to_key)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.canonical_fee_key = v.from_key
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      published += updated.length;
    }
    const updated = await db`
      UPDATE verified_fee_observations fv
         SET canonical_fee_key = v.to_key,
             fee_category = v.to_key
        FROM unnest(${chunk.map((move) => move.feeVerifiedId)}::bigint[], ${chunk.map((move) => move.from)}::text[],
                    ${chunk.map((move) => move.to)}::text[]) AS v(fee_verified_id, from_key, to_key)
       WHERE fv.fee_verified_id = v.fee_verified_id
         AND fv.canonical_fee_key = v.from_key
      RETURNING fv.fee_verified_id
    `;
    verified += updated.length;
  }
  return { published, verified };
}

function moveFeedback(move: FoldMove, runId: number): FeedbackRow {
  return {
    aboutStage: "publish",
    aboutStrategy: TAXONOMY_FOLD_CHECK,
    aboutVersion: FOLD_RULES_VERSION,
    // A fold is a taxonomy decision, not a judgement of Knox's read.
    signal: "right",
    kind: TAXONOMY_FOLD_KIND,
    reportedBy: "hamilton",
    checkName: TAXONOMY_FOLD_CHECK,
    institutionId: move.institutionId,
    sourceDocumentId: move.sourceDocumentId,
    feeVerifiedId: move.feeVerifiedId,
    feePublishedId: move.feePublishedId,
    canonicalFeeKey: move.to,
    amount: move.amount,
    weight: 0,
    evidence: { from: move.from, to: move.to, rule: move.rule, fee_name: move.feeName },
    runId,
    dedupeKey: `${TAXONOMY_FOLD_CHECK}:ver:${move.feeVerifiedId}`,
  };
}

async function rollBackNoHome(db: SqlTag, batchId: string, fees: FoldNoHome[]): Promise<number> {
  let rolledBack = 0;
  for (let start = 0; start < fees.length; start += WRITE_CHUNK) {
    const chunk = fees.slice(start, start + WRITE_CHUNK);
    const updated = await db`
      UPDATE published_fee_records fp
         SET rolled_back_at = NOW(),
             rolled_back_by_batch_id = ${batchId},
             rolled_back_reason = v.reason
        FROM unnest(${chunk.map((fee) => fee.feePublishedId)}::bigint[],
                    ${chunk.map((fee) => `${TAXONOMY_FOLD_REASON_PREFIX}${fee.reason}`)}::text[]) AS v(fee_published_id, reason)
       WHERE fp.fee_published_id = v.fee_published_id
         AND fp.rolled_back_at IS NULL
      RETURNING fp.fee_published_id
    `;
    rolledBack += updated.length;
  }
  return rolledBack;
}

export interface TaxonomyFoldResult {
  scanned: number;
  /** Fees re-filed (live and verified-only), by retired key and destination. */
  moved: number;
  movedLive: number;
  byRoute: Record<string, number>;
  /** Live fees with no home: first look logged this run, still live. */
  noHomeFlagged: number;
  noHomeWaiting: number;
  /** Live fees with no home taken down after their second look. */
  noHomeRolledBack: number;
  /** Past their second look but kept live while `TAXONOMY_FOLD_ARCHIVE_NO_HOME` is off. */
  noHomeHeld: number;
  unplacedVerified: number;
  feedbackRows: number;
  dryRun: boolean;
  rulesVersion: number;
  /** A sample of the takedowns, for the step's detail. */
  noHomeSample: Array<Pick<FoldNoHome, "feePublishedId" | "canonicalFeeKey" | "feeName" | "amount" | "reason">>;
}

/** Runs the fold. A dry run reports what it would move and take down and writes nothing. */
export async function foldRetiredCategories(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number },
): Promise<TaxonomyFoldResult> {
  const empty: TaxonomyFoldResult = {
    scanned: 0,
    moved: 0,
    movedLive: 0,
    byRoute: {},
    noHomeFlagged: 0,
    noHomeWaiting: 0,
    noHomeRolledBack: 0,
    noHomeHeld: 0,
    unplacedVerified: 0,
    feedbackRows: 0,
    dryRun: options.dryRun,
    rulesVersion: FOLD_RULES_VERSION,
    noHomeSample: [],
  };
  let rows: FoldRow[];
  let texts: Map<number, string>;
  try {
    rows = await inSavepoint(db, (scope) => selectRetiredRows(scope, options.institutionId));
    const documents = [
      ...new Set(
        rows
          .filter((row) => row.source_document_id != null && needsContext(row.canonical_fee_key, row.fee_name))
          .map((row) => Number(row.source_document_id)),
      ),
    ];
    texts = await inSavepoint(db, (scope) => loadTexts(scope, documents));
  } catch (error) {
    console.error("taxonomy fold read failed:", error);
    return empty;
  }
  if (rows.length === 0) return empty;

  const plan = planFold(rows, texts);
  const byRoute: Record<string, number> = {};
  for (const move of plan.moves) byRoute[`${move.from}->${move.to}`] = (byRoute[`${move.from}->${move.to}`] ?? 0) + 1;
  for (const fee of plan.noHome) byRoute[`${fee.canonicalFeeKey}->none`] = (byRoute[`${fee.canonicalFeeKey}->none`] ?? 0) + 1;

  const look = await secondLook(db, {
    check: TAXONOMY_FOLD_CHECK,
    runId: options.runId,
    failing: plan.noHome,
    dryRun: options.dryRun,
  });
  const result: TaxonomyFoldResult = {
    ...empty,
    scanned: rows.length,
    moved: plan.moves.length,
    movedLive: plan.moves.filter((move) => move.feePublishedId != null).length,
    byRoute,
    noHomeFlagged: look.flagged,
    noHomeWaiting: look.waiting,
    unplacedVerified: plan.unplacedVerified,
    noHomeSample: plan.noHome.slice(0, 25).map(({ feePublishedId, canonicalFeeKey, feeName, amount, reason }) => ({
      feePublishedId,
      canonicalFeeKey,
      feeName,
      amount,
      reason,
    })),
  };
  if (!TAXONOMY_FOLD_ARCHIVE_NO_HOME) result.noHomeHeld = look.confirmed.length;
  if (options.dryRun) {
    result.noHomeRolledBack = TAXONOMY_FOLD_ARCHIVE_NO_HOME ? look.confirmed.length : 0;
    return result;
  }

  const applied = await inSavepoint(db, (scope) => applyMoves(scope, plan.moves));
  result.movedLive = applied.published;
  if (plan.moves.length > 0 && (await feedbackSchemaReady(db))) {
    result.feedbackRows = await inSavepoint(db, (scope) =>
      recordFeedback(scope, plan.moves.map((move) => moveFeedback(move, options.runId))),
    );
  }
  if (TAXONOMY_FOLD_ARCHIVE_NO_HOME) {
    result.noHomeRolledBack = await inSavepoint(db, (scope) =>
      rollBackNoHome(scope, `taxonomy-fold-run-${options.runId}`, look.confirmed),
    );
  }
  if (applied.published > 0 || result.noHomeRolledBack > 0) invalidatePublicReadCache();
  return result;
}
