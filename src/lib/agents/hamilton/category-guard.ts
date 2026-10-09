import { sql } from "@/lib/data-store/connection";
import {
  checkFeeCategory,
  CATEGORY_GUARD_VERSION,
  GUARDED_CATEGORIES,
  PLAIN_RETURNED_ITEM,
  refileCategory,
  type CategoryGuardCode,
} from "@/lib/fee-category-guard";
import { isRetiredCategory, splitLiveCategory, FOLD_RULES_VERSION } from "@/lib/fee-fold";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { categoryGuardFlag } from "@/lib/agents/hamilton/publish";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { TAXONOMY_FOLD_CHECK, TAXONOMY_FOLD_KIND } from "@/lib/agents/hamilton/taxonomy-fold";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

export const CATEGORY_GUARD_DEFAULT_LIMIT = 2_000;
export const CATEGORY_GUARD_MAX_LIMIT = 5_000;
export const CATEGORY_GUARD_CHECK = "hamilton.category_guard";
/** Earlier takedowns re-checked per run; a guard fix brings back the fees it now passes. */
export const CATEGORY_GUARD_RESTORE_LIMIT = 500;
const WRITE_CHUNK = 500;

interface LivePublishedRow {
  fee_published_id: number | string;
  lineage_ref: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  conditions: string | null;
  document_nsf_amount: number | string | null;
}

export interface CategoryGuardFailure {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  code: CategoryGuardCode;
  reason: string;
}

export interface RunHamiltonCategoryGuardOptions {
  runId: number;
  limit?: number;
  institutionId?: number;
  dryRun?: boolean;
  db?: SqlTag;
}

export interface RunHamiltonCategoryGuardResult {
  scannedFees: number;
  failingFees: number;
  rolledBackFees: number;
  rejectedVerifiedFees: number;
  /** Failed for the first time: logged for a second look, still live. */
  flaggedFees: number;
  /** Failed again before their second look was due: still live. */
  awaitingSecondLook: number;
  /** Earlier category-guard takedowns today's guard passes, put back live. */
  restoredFees: number;
  /** Of those, the ones put back under the top-50 type a fold split gives them (`SPLIT_CATEGORIES`). */
  refiledFees: number;
  limit: number;
  dryRun: boolean;
  rollbackBatchId: string;
  guardVersion: number;
  byCode: Partial<Record<CategoryGuardCode, number>>;
  byCategory: Record<string, Partial<Record<CategoryGuardCode, number>>>;
  failures: CategoryGuardFailure[];
}

function boundedLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return CATEGORY_GUARD_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), CATEGORY_GUARD_MAX_LIMIT);
}

function normalizedAmount(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

/**
 * The highest NSF or insufficient-funds price read elsewhere on the fee's schedule, for a small
 * returned check filed as NSF only (`checkFeeCategory`'s schedule check); null otherwise. Older
 * reads count too: Knox missed Dean's "Insufficient Funds Fee (Paid or Returned) $35.00", split
 * over two lines, which the earlier reader caught. Each source has its own document index.
 */
function documentNsfAmount(db: SqlTag) {
  // Literal sources, so each subquery can use that source's partial document index.
  return db`(CASE WHEN fp.canonical_fee_key = 'nsf' AND fp.fee_name ~* ${PLAIN_RETURNED_ITEM.source} THEN GREATEST(
      (SELECT MAX(o.amount) FROM raw_fee_observations o
        WHERE o.source = 'knox' AND o.source_document_id = fr.source_document_id AND o.fee_raw_id <> fr.fee_raw_id
          AND o.fee_name ~* '(insufficient|\\mnsf\\M|non[- ]?sufficient)'),
      (SELECT MAX(o.amount) FROM raw_fee_observations o
        WHERE o.source = 'migration_v10' AND o.source_document_id = fr.source_document_id
          AND o.fee_name ~* '(insufficient|\\mnsf\\M|non[- ]?sufficient)')
    ) END) AS document_nsf_amount`;
}

async function selectLiveGuardedFees(db: SqlTag, institutionId?: number): Promise<LivePublishedRow[]> {
  const keys = [...GUARDED_CATEGORIES];
  // The raw row's conditions carry a rate the name leaves out ("2.00% of transaction").
  if (institutionId) {
    return db<LivePublishedRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fp.canonical_fee_key, fp.fee_name,
             fp.amount, fr.conditions, ${documentNsfAmount(db)}
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.canonical_fee_key = ANY(${keys}::text[])
         AND fp.institution_id = ${institutionId}
       ORDER BY fp.fee_published_id ASC
    `;
  }
  return db<LivePublishedRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fp.canonical_fee_key, fp.fee_name,
           fp.amount, fr.conditions, ${documentNsfAmount(db)}
      FROM published_fee_records fp
      LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL
       AND fp.canonical_fee_key = ANY(${keys}::text[])
     ORDER BY fp.fee_published_id ASC
  `;
}

async function rollBackChunk(
  db: SqlTag,
  rollbackBatchId: string,
  failures: CategoryGuardFailure[],
): Promise<number> {
  const ids = failures.map((failure) => failure.feePublishedId);
  const reasons = failures.map((failure) => `category_guard:${failure.code}: ${failure.reason}`);
  const updated = await db`
    UPDATE published_fee_records fp
       SET rolled_back_at = NOW(),
           rolled_back_by_batch_id = ${rollbackBatchId},
           rolled_back_reason = v.reason
      FROM unnest(${ids}::bigint[], ${reasons}::text[]) AS v(fee_published_id, reason)
     WHERE fp.fee_published_id = v.fee_published_id
       AND fp.rolled_back_at IS NULL
    RETURNING fp.fee_published_id
  `;
  return updated.length;
}

async function rejectVerifiedChunk(db: SqlTag, failures: CategoryGuardFailure[]): Promise<number> {
  const ids = failures.map((failure) => failure.feeVerifiedId);
  const flags = failures.map((failure) => categoryGuardFlag(failure.code));
  const updated = await db`
    UPDATE verified_fee_observations fv
       SET review_status = 'rejected',
           outlier_flags = CASE
             WHEN fv.outlier_flags ? v.flag THEN fv.outlier_flags
             ELSE fv.outlier_flags || jsonb_build_array(v.flag)
           END
      FROM unnest(${ids}::bigint[], ${flags}::text[]) AS v(fee_verified_id, flag)
     WHERE fv.fee_verified_id = v.fee_verified_id
       AND fv.review_status IN ('verified', 'approved')
    RETURNING fv.fee_verified_id
  `;
  return updated.length;
}

/**
 * Hamilton repair: roll back live published fee records whose own name
 * contradicts the category they were filed under (src/lib/fee-category-guard.ts).
 *
 * A fee comes down only after a second look (`second-look.ts`): its first failure is
 * logged and it stays live; a later run that fails it again takes it down. Earlier
 * takedowns that today's guard passes come back. Rows are soft-deleted (rolled_back_at),
 * never edited or deleted, and their verified
 * rows are marked rejected so the next publish run does not re-publish them. The run
 * ledger (step detail) and rolled_back_by_batch_id are the audit trail. A dry run
 * reports exactly what a real run would roll back and writes nothing.
 */
export async function runHamiltonCategoryGuard(
  options: RunHamiltonCategoryGuardOptions,
): Promise<RunHamiltonCategoryGuardResult> {
  const db = options.db ?? sql;
  const limit = boundedLimit(options.limit);
  const dryRun = Boolean(options.dryRun);
  const rollbackBatchId = `category-guard-run-${options.runId}`;
  const rows = await selectLiveGuardedFees(db, options.institutionId);

  const failures: CategoryGuardFailure[] = [];
  const passing: number[] = [];
  const byCode: RunHamiltonCategoryGuardResult["byCode"] = {};
  const byCategory: RunHamiltonCategoryGuardResult["byCategory"] = {};
  for (const row of rows) {
    const verdict = checkFeeCategory(row.canonical_fee_key, row.fee_name, row);
    if (verdict.ok) {
      passing.push(Number(row.fee_published_id));
      continue;
    }
    byCode[verdict.code] = (byCode[verdict.code] ?? 0) + 1;
    const category = (byCategory[row.canonical_fee_key] ??= {});
    category[verdict.code] = (category[verdict.code] ?? 0) + 1;
    failures.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: Number(row.lineage_ref),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name,
      amount: normalizedAmount(row.amount),
      code: verdict.code,
      reason: verdict.reason,
    });
  }

  // A takedown is a last resort: only a fee that failed an earlier look too comes down.
  const look = await secondLook(db, {
    check: CATEGORY_GUARD_CHECK,
    runId: options.runId,
    failing: failures.map((failure) => ({ ...failure, reason: `${failure.code}: ${failure.reason}` })),
    passing,
    dryRun,
  });
  const confirmedIds = new Set(look.confirmed.map((fee) => fee.feePublishedId));
  const confirmed = failures.filter((failure) => confirmedIds.has(failure.feePublishedId));

  let rolledBackFees = 0;
  let rejectedVerifiedFees = 0;
  const restore = await restorePassingTakedowns(db, { dryRun, institutionId: options.institutionId, runId: options.runId });
  if (!dryRun) {
    const toRollBack = confirmed.slice(0, limit);
    for (let start = 0; start < toRollBack.length; start += WRITE_CHUNK) {
      const chunk = toRollBack.slice(start, start + WRITE_CHUNK);
      rolledBackFees += await rollBackChunk(db, rollbackBatchId, chunk);
      rejectedVerifiedFees += await rejectVerifiedChunk(db, chunk);
    }
  }

  return {
    scannedFees: rows.length,
    failingFees: confirmed.length,
    rolledBackFees,
    rejectedVerifiedFees,
    flaggedFees: look.flagged,
    awaitingSecondLook: look.waiting,
    restoredFees: restore.restored,
    refiledFees: restore.refiled,
    limit,
    dryRun,
    rollbackBatchId,
    guardVersion: CATEGORY_GUARD_VERSION,
    byCode,
    byCategory,
    failures: confirmed,
  };
}

interface TakenDownRow {
  fee_published_id: number | string;
  lineage_ref: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  conditions: string | null;
  document_nsf_amount: number | string | null;
}

interface Restore {
  row: TakenDownRow;
  /** The category it comes back under: its own, or the one a fold split gives it. */
  to: string;
}

/**
 * Where an earlier takedown comes back, or null when it stays down. Today's guard passing it
 * under its own category brings it back there. A fee the guard took down because its name
 * belongs to another top-50 type comes back under that type when a fold split names it
 * (`splitLiveCategory`) and that type's guard and price range accept it: on Oct 9 guard v57's
 * catch-up took down six "ATM Adjustment" fees ($2 to $6) as non-network ATM fees minutes
 * before fold v14 would have moved them to account research. A guard re-file rule
 * (`refileCategory`) places it the same way. Pure.
 */
export function restoreTarget(row: Pick<TakenDownRow, "canonical_fee_key" | "fee_name" | "amount" | "conditions" | "document_nsf_amount">): string | null {
  if (checkFeeCategory(row.canonical_fee_key, row.fee_name, row).ok) return row.canonical_fee_key;
  // Or the guard's own re-file rule names it: express card replacements kept coming back as
  // card_replacement and going down again (235, 12213, 29782, Oct 6-9); rush_card is their home.
  const to = splitLiveCategory(row.canonical_fee_key, row.fee_name)?.to ?? refileCategory(row.canonical_fee_key, row.fee_name);
  // A retired key is no home: Hamilton never publishes it.
  if (!to || to === row.canonical_fee_key || isRetiredCategory(to)) return null;
  const amount = normalizedAmount(row.amount) ?? 0;
  return checkFeeCategory(to, row.fee_name, row).ok && passesDarwinChecks(to, row.fee_name, amount) ? to : null;
}

/**
 * A guard fix (a new CATEGORY_GUARD_VERSION) can make an earlier takedown wrong. Fees the
 * guard took down that today's guard passes come back live, with their verified row, unless
 * an identical fee is already live. One whose fold split places it comes back re-filed there,
 * published and verified rows alike, and the move is logged to pipeline_feedback as a fold.
 * Bounded per run; a failed read restores nothing.
 */
async function restorePassingTakedowns(
  db: SqlTag,
  options: { dryRun: boolean; institutionId?: number; runId: number },
): Promise<{ restored: number; refiled: number }> {
  const none = { restored: 0, refiled: 0 };
  let rows: TakenDownRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope<TakenDownRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fr.source_document_id, fp.canonical_fee_key,
             fp.fee_name, fp.amount, fr.conditions, ${documentNsfAmount(scope)}
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NOT NULL
         AND fp.rolled_back_reason LIKE 'category_guard:%'
         AND (${options.institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${options.institutionId ?? null}::bigint)
       ORDER BY fp.rolled_back_at DESC
       LIMIT ${CATEGORY_GUARD_RESTORE_LIMIT * 4}
    `);
  } catch (error) {
    console.error("category guard restore read failed:", error);
    return none;
  }
  const passing: Restore[] = [];
  // One re-filed fee per institution, type and price: two copies of one schedule's express card
  // line (350 and 27687 at institution 6042) are one fee.
  const refiledSeen = new Set<string>();
  for (const row of rows) {
    const to = restoreTarget(row);
    if (!to) continue;
    if (to !== row.canonical_fee_key) {
      const key = `${row.institution_id}|${to}|${normalizedAmount(row.amount)}`;
      if (refiledSeen.has(key)) continue;
      refiledSeen.add(key);
    }
    passing.push({ row, to });
    if (passing.length >= CATEGORY_GUARD_RESTORE_LIMIT) break;
  }
  const refiling = passing.filter((restore) => restore.to !== restore.row.canonical_fee_key);
  if (options.dryRun || passing.length === 0) return { restored: passing.length, refiled: refiling.length };
  try {
    return await inSavepoint(db, async (scope) => {
      const restored = await scope<{ fee_published_id: number | string; lineage_ref: number | string; canonical_fee_key: string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NULL,
               rolled_back_by_batch_id = NULL,
               rolled_back_reason = NULL,
               canonical_fee_key = v.to_key
          FROM unnest(${passing.map((restore) => Number(restore.row.fee_published_id))}::bigint[],
                      ${passing.map((restore) => restore.to)}::text[]) AS v(fee_published_id, to_key)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_reason LIKE 'category_guard:%'
           AND NOT EXISTS (
             SELECT 1 FROM published_fee_records live
              WHERE live.rolled_back_at IS NULL
                AND live.institution_id = fp.institution_id
                AND live.canonical_fee_key = v.to_key
                AND live.amount IS NOT DISTINCT FROM fp.amount
                -- Re-filed, any same-priced fee of that type is the same fee under another
                -- name: 235's twin 100126 is already live as rush_card.
                AND (live.fee_name = fp.fee_name OR v.to_key <> fp.canonical_fee_key)
           )
        RETURNING fp.fee_published_id, fp.lineage_ref, fp.canonical_fee_key
      `;
      if (restored.length === 0) return none;
      await scope`
        UPDATE verified_fee_observations fv
           SET review_status = 'verified',
               canonical_fee_key = v.to_key,
               outlier_flags = COALESCE((
                 SELECT jsonb_agg(flag) FROM jsonb_array_elements(fv.outlier_flags) flag
                  WHERE flag #>> '{}' NOT LIKE 'category_guard:%'
               ), '[]'::jsonb)
          FROM unnest(${restored.map((row) => Number(row.lineage_ref))}::bigint[],
                      ${restored.map((row) => row.canonical_fee_key)}::text[]) AS v(fee_verified_id, to_key)
         WHERE fv.fee_verified_id = v.fee_verified_id
           AND fv.review_status = 'rejected'
      `;
      const back = new Set(restored.map((row) => Number(row.fee_published_id)));
      const moved = refiling.filter((restore) => back.has(Number(restore.row.fee_published_id)));
      if (moved.length > 0) await recordFeedback(scope, moved.map((restore) => refileFeedback(restore, options.runId)));
      return { restored: restored.length, refiled: moved.length };
    });
  } catch (error) {
    console.error("category guard restore failed:", error);
    return none;
  }
}

/** The fold's own lesson row for a takedown brought back under its split type. */
function refileFeedback({ row, to }: Restore, runId: number): FeedbackRow {
  const rule = `${row.canonical_fee_key}#${splitLiveCategory(row.canonical_fee_key, row.fee_name)?.to === to ? "split" : "refile"}`;
  return {
    aboutStage: "publish",
    aboutStrategy: TAXONOMY_FOLD_CHECK,
    aboutVersion: FOLD_RULES_VERSION,
    signal: "right",
    kind: TAXONOMY_FOLD_KIND,
    reportedBy: "hamilton",
    checkName: TAXONOMY_FOLD_CHECK,
    institutionId: Number(row.institution_id),
    sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
    feeVerifiedId: Number(row.lineage_ref),
    feePublishedId: Number(row.fee_published_id),
    canonicalFeeKey: to,
    amount: normalizedAmount(row.amount),
    weight: 0,
    evidence: { from: row.canonical_fee_key, to, rule, fee_name: row.fee_name, restored_from: "category_guard" },
    runId,
    dedupeKey: `${TAXONOMY_FOLD_CHECK}:ver:${Number(row.lineage_ref)}`,
  };
}
