import type { sql } from "@/lib/data-store/connection";
import { DARWIN_REASON_TEXT, DARWIN_VERIFY_STRATEGY, type DarwinReasonCode } from "./verify";
import { DARWIN_RELEASE_ACTS } from "./release-held";

type SqlTag = typeof sql;

/**
 * Darwin's held-fee queue (#1115, step 1): every raw fee Darwin holds, grouped by the reason it
 * is held, with its count, its oldest hold, one example and the way out the code gives it today.
 * Read-only. A hold is a raw Knox row waiting for Darwin with no verified row whose latest
 * current-version verdict is `needs_review`; a row with no current-version verdict yet is
 * "not judged". The way-out text says plainly when a reason has none yet (step 2 of #1115).
 */

export type HoldCause = DarwinReasonCode | "not_judged";

export interface HoldGroup {
  cause: HoldCause | string;
  label: string;
  count: number;
  /** ISO time of the oldest hold in the group. */
  oldest: string | null;
  example: { feeName: string; amount: number | null; institution: string } | null;
  wayOut: string;
  /** False when nothing in the code ever looks at the group again. */
  hasExit: boolean;
}

const RANGE_EXIT = DARWIN_RELEASE_ACTS
  ? "Darwin's release pass checks each fee against the bank's own schedule: a fee it confirms is released; one not stated after two looks is rejected."
  : "Darwin's release pass checks each fee against the bank's own schedule: one not stated after two looks is rejected. Releases are verdicts only while James's 8 Oct pause holds, so a confirmed fee stays held.";

const WAY_OUT: Partial<Record<HoldCause, { text: string; hasExit: boolean }>> = {
  not_judged: { text: "Darwin's next verify step gives it a verdict.", hasExit: true },
  outside_envelope: { text: RANGE_EXIT, hasExit: true },
  peer_outlier: { text: RANGE_EXIT, hasExit: true },
  category_lesson_pending: { text: "Judged again when the category guard's version rises.", hasExit: true },
  conditional_zero: { text: "None yet: nothing looks at it again (#1115 step 2).", hasExit: false },
  insert_failed: { text: "None yet: nothing looks at it again (#1115 step 2).", hasExit: false },
};

export function wayOutFor(cause: string): { text: string; hasExit: boolean } {
  return WAY_OUT[cause as HoldCause] ?? { text: "None recorded for this reason.", hasExit: false };
}

export function labelFor(cause: string): string {
  if (cause === "not_judged") return "Not judged yet";
  return DARWIN_REASON_TEXT[cause as DarwinReasonCode] ?? cause;
}

export function toHoldGroup(row: Record<string, unknown>): HoldGroup {
  const cause = String(row.cause ?? "unknown");
  const oldest = row.oldest ? new Date(row.oldest as string | Date).toISOString() : null;
  const amount = row.example_amount == null ? null : Number(row.example_amount);
  const exit = wayOutFor(cause);
  return {
    cause,
    label: labelFor(cause),
    count: Number(row.count ?? 0),
    oldest,
    example: row.example_name
      ? { feeName: String(row.example_name), amount: Number.isFinite(amount) ? amount : null, institution: String(row.example_institution ?? "") }
      : null,
    wayOut: exit.text,
    hasExit: exit.hasExit,
  };
}

/** One row per cause, largest first. About 3 s on production (2026-10-13, 15,830 open raw rows). */
export async function readHoldGroups(db: SqlTag): Promise<HoldGroup[]> {
  const rows = await db`
    WITH open_rows AS (
      SELECT fr.fee_raw_id, fr.fee_name, fr.amount, fr.institution_id,
             COALESCE(last.created_at, fr.created_at) AS held_at,
             CASE WHEN last.decision IS NULL THEN 'not_judged' ELSE last.reason END AS cause,
             last.decision
        FROM raw_fee_observations fr
        LEFT JOIN LATERAL (
          SELECT pa.detail->>'reason_code' AS reason, pa.detail->>'decision' AS decision, pa.created_at
            FROM pipeline_attempts pa
           WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
             AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
             AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
           ORDER BY pa.created_at DESC
           LIMIT 1
        ) last ON true
       WHERE fr.source = 'knox'
         AND fr.outlier_flags ? 'needs_darwin_verification'
         AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
    ), held AS (
      SELECT * FROM open_rows WHERE decision IS NULL OR decision = 'needs_review'
    ), examples AS (
      SELECT DISTINCT ON (cause) cause, fee_name, amount, institution_id
        FROM held
       ORDER BY cause, held_at ASC, fee_raw_id ASC
    )
    SELECT h.cause, COUNT(*)::int AS count, MIN(h.held_at) AS oldest,
           e.fee_name AS example_name, e.amount AS example_amount, inst.institution_name AS example_institution
      FROM held h
      LEFT JOIN examples e ON e.cause = h.cause
      LEFT JOIN institution_sources inst ON inst.id = e.institution_id
     GROUP BY h.cause, e.fee_name, e.amount, inst.institution_name
     ORDER BY COUNT(*) DESC
  `;
  return rows.map((row) => toHoldGroup(row as Record<string, unknown>));
}
