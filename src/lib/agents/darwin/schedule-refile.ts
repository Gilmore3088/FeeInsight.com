import type { sql } from "@/lib/data-store/connection";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";

type SqlTag = typeof sql;

export const DARWIN_SCHEDULE_REFILE_STRATEGY = { strategy: "verify.schedule_refile", version: 1 } as const;
export const DARWIN_SCHEDULE_REFILED_FLAG = "darwin_schedule_refiled";
export const DARWIN_SCHEDULE_REFILE_LIMIT = 200;
/** The verified-row flag Hamilton's category guard leaves on a "returned check" it took off NSF. */
export const SCHEDULE_CONTRADICTS_FLAG = "category_guard:schedule_contradicts";

interface TakenOffNsfRow {
  fee_verified_id: number | string;
  fee_raw_id: number | string;
  institution_id: number | string;
  fee_name: string;
  amount: number | string | null;
}

export interface RunDarwinScheduleRefileResult {
  selected: number;
  refiled: number;
  dryRun: boolean;
}

/**
 * A plain "Returned Check Fee" Hamilton's category guard took off NSF because its schedule prices
 * NSF separately and higher (`schedule_contradicts`) is the bank's return deposited item fee. Darwin
 * re-files its verified row there, flagged DARWIN_SCHEDULE_REFILED_FLAG, so it stays in the index
 * under the right category; Hamilton publishes it through its normal checks. Each re-file is logged
 * as a `verify.schedule_refile` attempt with the old and new category; a re-filed row no longer
 * carries the takedown flag, so it is re-filed once.
 */
export async function runDarwinScheduleRefile(options: {
  runId: number;
  stepId?: number | null;
  db: SqlTag;
  dryRun?: boolean;
  institutionId?: number;
  limit?: number;
}): Promise<RunDarwinScheduleRefileResult> {
  const { db } = options;
  const dryRun = Boolean(options.dryRun);
  const institutionId = options.institutionId ?? null;
  const rows = await db<TakenOffNsfRow[]>`
    SELECT fv.fee_verified_id, fv.fee_raw_id, fv.institution_id, fv.fee_name, fv.amount
      FROM verified_fee_observations fv
     WHERE fv.canonical_fee_key = 'nsf'
       AND fv.review_status = 'rejected'
       AND fv.outlier_flags ? ${SCHEDULE_CONTRADICTS_FLAG}
       AND (${institutionId}::bigint IS NULL OR fv.institution_id = ${institutionId}::bigint)
     ORDER BY fv.fee_verified_id
     LIMIT ${options.limit ?? DARWIN_SCHEDULE_REFILE_LIMIT}
  `;
  if (dryRun || rows.length === 0) return { selected: rows.length, refiled: 0, dryRun };

  const learning = await learningSchemaReady(db);
  let refiled = 0;
  for (const row of rows) {
    // The verified row is re-filed in place: its raw fee may hold only one Darwin-verified row,
    // and the NSF copy Hamilton published stays rolled back as the record of the old filing.
    const updated = await db<{ fee_verified_id: number | string }[]>`
      UPDATE verified_fee_observations fv
         SET canonical_fee_key = 'deposited_item_return',
             review_status = 'verified',
             outlier_flags = (fv.outlier_flags - ${SCHEDULE_CONTRADICTS_FLAG}::text) || ${JSON.stringify([DARWIN_SCHEDULE_REFILED_FLAG])}::jsonb
       WHERE fv.fee_verified_id = ${row.fee_verified_id}
         AND fv.canonical_fee_key = 'nsf'
         AND fv.review_status = 'rejected'
      RETURNING fv.fee_verified_id
    `;
    const feeVerifiedId = updated[0]?.fee_verified_id == null ? null : Number(updated[0].fee_verified_id);
    if (feeVerifiedId != null) refiled += 1;
    if (learning) {
      await recordAttempt(db, {
        institutionId: Number(row.institution_id),
        stage: "verify",
        strategy: DARWIN_SCHEDULE_REFILE_STRATEGY.strategy,
        version: DARWIN_SCHEDULE_REFILE_STRATEGY.version,
        fingerprint: `raw:${Number(row.fee_raw_id)}`,
        outcome: feeVerifiedId != null ? "ok" : "unchanged",
        yieldCount: feeVerifiedId != null ? 1 : 0,
        costMicrousd: 0,
        runId: options.runId,
        stepId: options.stepId ?? null,
        foldIntoPlaybook: false,
        detail: {
          fee_raw_id: Number(row.fee_raw_id),
          fee_verified_id: Number(row.fee_verified_id),
          refiled: feeVerifiedId != null,
          fee_name: row.fee_name,
          amount: row.amount == null ? null : Number(row.amount),
          from: "nsf",
          to: "deposited_item_return",
        },
      });
    }
  }
  return { selected: rows.length, refiled, dryRun };
}
