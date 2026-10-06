import { sql } from "@/lib/data-store/connection";
import {
  checkFeeCategory,
  CATEGORY_GUARD_VERSION,
  GUARDED_CATEGORIES,
  type CategoryGuardCode,
} from "@/lib/fee-category-guard";
import { categoryGuardFlag } from "@/lib/agents/hamilton/publish";

type SqlTag = typeof sql;

export const CATEGORY_GUARD_DEFAULT_LIMIT = 2_000;
export const CATEGORY_GUARD_MAX_LIMIT = 5_000;
const WRITE_CHUNK = 500;

interface LivePublishedRow {
  fee_published_id: number | string;
  lineage_ref: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  conditions: string | null;
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

async function selectLiveGuardedFees(db: SqlTag, institutionId?: number): Promise<LivePublishedRow[]> {
  const keys = [...GUARDED_CATEGORIES];
  // The raw row's conditions carry a rate the name leaves out ("2.00% of transaction").
  if (institutionId) {
    return db<LivePublishedRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fp.canonical_fee_key, fp.fee_name,
             fp.amount, fr.conditions
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
           fp.amount, fr.conditions
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
 * Rows are soft-deleted (rolled_back_at), never edited or deleted, and their verified
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
  const byCode: RunHamiltonCategoryGuardResult["byCode"] = {};
  const byCategory: RunHamiltonCategoryGuardResult["byCategory"] = {};
  for (const row of rows) {
    const verdict = checkFeeCategory(row.canonical_fee_key, row.fee_name, row);
    if (verdict.ok) continue;
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

  let rolledBackFees = 0;
  let rejectedVerifiedFees = 0;
  if (!dryRun) {
    const toRollBack = failures.slice(0, limit);
    for (let start = 0; start < toRollBack.length; start += WRITE_CHUNK) {
      const chunk = toRollBack.slice(start, start + WRITE_CHUNK);
      rolledBackFees += await rollBackChunk(db, rollbackBatchId, chunk);
      rejectedVerifiedFees += await rejectVerifiedChunk(db, chunk);
    }
  }

  return {
    scannedFees: rows.length,
    failingFees: failures.length,
    rolledBackFees,
    rejectedVerifiedFees,
    limit,
    dryRun,
    rollbackBatchId,
    guardVersion: CATEGORY_GUARD_VERSION,
    byCode,
    byCategory,
    failures,
  };
}
