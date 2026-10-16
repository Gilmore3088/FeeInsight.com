import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { inSavepoint } from "@/lib/agents/savepoint";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { refileCategory } from "@/lib/fee-category-guard";

import { tierPerkZero } from "./tier-perk";
import { DARWIN_VERIFY_STRATEGY, loadSourceTexts, normalizedAmount, postSourceCheck, sourceLineFor, type RawFeeRow } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin's own second look at the rows it verified: every row verified by `verify.rules` is
 * read once more under the checks that follow the source check (`postSourceCheck`: live
 * category, no conditional $0, Hamilton's name rules). A row that fails and is not live is
 * rejected with a flag; one that is live is archived (rolled back with the reason, never
 * deleted) in the same step once `DARWIN_RECHECK_SAME_STEP_TAKEDOWN` is on, and until then is
 * flagged through the shared 12-hour second look. Never a hand UPDATE. Each row is read once per
 * version, recorded as a `verify.recheck` attempt.
 *
 * v1 (2026-10-09): UAT's 20-row check of the not_in_source re-select (#883) found 16 right;
 * three misses were $0 "free if you meet a condition" readings of $2.50-$6.95 fees, one a
 * package list verified into the retired `estatement_fee` type.
 * v2 (2026-10-09): UAT's 10-row takedown check of v1 found 7 right; the misses read a non-member
 * price, a comparison table's other column and another label's figure as the fee's fallback
 * price. The $0 rule now reads the fee's own cell and label (`ownSegment`). v2 also re-reads the
 * rows v1 rejected (flag `darwin_recheck:*`): one that passes now is restored to verified with the
 * flag removed; a live row that passes now has its pending second-look flag cleared.
 * v3 (2026-10-15, #1397): a $0 from one account tier's own schedule, or named for a tier's
 * account, is that tier's perk, not the bank's price (`tierPerkZero`). One large bank's live overdraft,
 * NSF, stop payment and wire fees all read $0 from its Premium Account schedule.
 */
export const DARWIN_RECHECK_STRATEGY = { strategy: "verify.recheck", version: 3 } as const;
export const RECHECK_LIMIT = 200;
/** The shared second look's check name while live failures are only flagged. */
export const DARWIN_RECHECK_CHECK = "darwin.verified_recheck";
/**
 * Default-off switch for archiving a failing live fee in the same step (James, 11:55 UTC
 * 2026-10-09: "stop waiting 12 hours. go"). Off: the live row is flagged `takedown_pending`
 * through the shared second look (the 12-hour path). It turns on by PR once UAT has hand-checked
 * 10 of the rows a dry read says the recheck would take down and found at least 9 right (the
 * takedown spot-check bar).
 */
export const DARWIN_RECHECK_SAME_STEP_TAKEDOWN = false;
export const RECHECK_REJECTED_FLAG_PREFIX = "darwin_recheck";
/**
 * Default-off switch (#1568): also re-read live fees that `verify.rules` verified under an older
 * version. The recheck reads only rows of the current verify version, so a rule added here never
 * reached fees that went live earlier (15 live tier-perk $0s, Oct 16). Off, each step reads a
 * sample of those rows and reports what the recheck would do (`olderLive`), writing nothing; on,
 * they join the recheck and fail or pass like any other row. It turns on by PR once James approves
 * the dry-run count by reason.
 */
export const DARWIN_RECHECK_OLDER_LIVE = false;
/** Older live rows read per step for the shadow report, on every `OLDER_LIVE_SHADOW_EVERY`th run. */
export const OLDER_LIVE_SHADOW_LIMIT = 200;
export const OLDER_LIVE_SHADOW_EVERY = 4;

interface RecheckRow extends RawFeeRow {
  fee_verified_id: number | string;
  review_status: string;
  canonical_fee_key: string;
  verified_amount: number | string | null;
  fee_published_id: number | string | null;
}

export interface VerifiedRecheckResult {
  checked: number;
  passed: number;
  rejected: Array<{ feeVerifiedId: number; code: string }>;
  /** Rows an earlier recheck version rejected that pass now, set back to verified. */
  restored: number[];
  /** Live rows whose pending second-look flag was cleared because they pass now. */
  cleared: number;
  /** Live rows flagged for the 12-hour second look (switch off). */
  flagged: number;
  /** Live rows already flagged and still inside the 12 hours (switch off). */
  waiting: number;
  /** Live records archived (rolled back with the reason) in this step. */
  takenDown: number[];
  /** While `DARWIN_RECHECK_OLDER_LIVE` is off: what the recheck would do to older live rows (#1568). */
  olderLive?: OlderLiveShadow | null;
}

export interface OlderLiveShadow {
  /** Older live rows read this step (a sample read up from a random id). */
  read: number;
  /** Of those, the ones the recheck would fail, by reason code. */
  wouldFail: Record<string, number>;
  samples: Array<{ feePublishedId: number; feeVerifiedId: number; institutionId: number; canonicalFeeKey: string; feeName: string; amount: number | null; code: string }>;
  error?: string;
}

const EMPTY: VerifiedRecheckResult = { checked: 0, passed: 0, rejected: [], restored: [], cleared: 0, flagged: 0, waiting: 0, takenDown: [] };

/**
 * Live verified rows the recheck never selects (#1568): their `verify.rules` attempt is not a
 * `verified` one at the current version, and this recheck version has not read them. A sample (the
 * shadow report) reads up from `from` in id order, so it walks the index and stops at the limit
 * instead of sorting the whole backlog; otherwise newest first.
 */
function selectOlderLiveRows(db: SqlTag, limit: number, from: "random" | "start" | null): Promise<RecheckRow[]> {
  const sample = from != null;
  const randomStart = from === "random";
  return inSavepoint(db, (scope) => scope<RecheckRow[]>`
      SELECT v.fee_verified_id, v.review_status, v.canonical_fee_key, v.amount AS verified_amount,
             r.fee_raw_id, r.institution_id, r.source_url, r.document_r2_key, r.extraction_confidence,
             r.fee_name, r.amount, r.frequency, r.outlier_flags, COALESCE(r.extraction_note, r.conditions) AS conditions, r.source_document_id,
             r.amount_kind, r.rate_percent, live.fee_published_id
        FROM verified_fee_observations v
        JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
        JOIN LATERAL (
          SELECT p.fee_published_id FROM published_fee_records p
           WHERE p.lineage_ref = v.fee_verified_id AND p.rolled_back_at IS NULL AND p.quarantined_at IS NULL
           ORDER BY p.fee_published_id DESC LIMIT 1
        ) live ON true
       WHERE v.review_status IN ('verified', 'approved')
         AND (NOT ${randomStart}::boolean OR v.fee_verified_id >= (SELECT floor(random() * max(fee_verified_id))::bigint FROM verified_fee_observations))
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'raw:' || v.fee_raw_id::text
              AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
              AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
              AND pa.detail->>'decision' = 'verified'
         )
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'verified:' || v.fee_verified_id::text
              AND pa.strategy = ${DARWIN_RECHECK_STRATEGY.strategy}
              AND pa.strategy_version = ${DARWIN_RECHECK_STRATEGY.version}
         )
       ORDER BY CASE WHEN ${sample}::boolean THEN v.fee_verified_id END ASC,
                v.fee_verified_id DESC
       LIMIT ${limit}::int
    `);
}

function selectRows(db: SqlTag, limit: number, reselectCohort: boolean): Promise<RecheckRow[]> {
  return inSavepoint(db, (scope) => scope<RecheckRow[]>`
      SELECT v.fee_verified_id, v.review_status, v.canonical_fee_key, v.amount AS verified_amount,
             r.fee_raw_id, r.institution_id, r.source_url, r.document_r2_key, r.extraction_confidence,
             r.fee_name, r.amount, r.frequency, r.outlier_flags, COALESCE(r.extraction_note, r.conditions) AS conditions, r.source_document_id,
             r.amount_kind, r.rate_percent,
             (SELECT p.fee_published_id FROM published_fee_records p
               WHERE p.lineage_ref = v.fee_verified_id AND p.rolled_back_at IS NULL
               ORDER BY p.fee_published_id DESC LIMIT 1) AS fee_published_id
        FROM verified_fee_observations v
        JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
       WHERE (
           (v.review_status IN ('verified', 'approved') AND EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.input_fingerprint = 'raw:' || v.fee_raw_id::text
                AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
                AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
                AND pa.detail->>'decision' = 'verified'
           ))
           OR (v.review_status = 'rejected' AND EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(COALESCE(v.outlier_flags, '[]'::jsonb)) flag
              WHERE flag LIKE ${`${RECHECK_REJECTED_FLAG_PREFIX}:%`}
           ))
         )
         AND (${!reselectCohort} OR EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'raw:' || v.fee_raw_id::text
              AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
              AND pa.detail->>'reason_code' = 'not_in_source'
         ))
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'verified:' || v.fee_verified_id::text
              AND pa.strategy = ${DARWIN_RECHECK_STRATEGY.strategy}
              AND pa.strategy_version = ${DARWIN_RECHECK_STRATEGY.version}
         )
       ORDER BY v.fee_verified_id DESC
       LIMIT ${limit}::int
    `);
}

/** The recheck's verdict on one row: the checks after the source check, then the tier-perk test. Pure. */
function recheckOf(row: RecheckRow, texts: Map<number, string>) {
  const canonicalFeeKey = refileCategory(row.canonical_fee_key, row.fee_name) ?? row.canonical_fee_key;
  const amount = normalizedAmount(row.verified_amount ?? row.amount);
  const line = sourceLineFor(row, texts, canonicalFeeKey) ?? excerptOf(row.conditions);
  const text = row.source_document_id == null ? null : texts.get(Number(row.source_document_id)) ?? null;
  const check: { code: string; rule?: string } | null = postSourceCheck(canonicalFeeKey, row.fee_name, amount, line)
    ?? (tierPerkZero(amount, row.fee_name, row.source_url, text) ? { code: "tier_perk_zero" } : null);
  return { canonicalFeeKey, amount, line, check };
}

function textsFor(db: SqlTag, rows: RecheckRow[]): Promise<Map<number, string>> {
  return loadSourceTexts(db, Array.from(new Set(rows.flatMap((row) => (row.source_document_id == null ? [] : [Number(row.source_document_id)])))));
}

/** Read-only: what the recheck would do to a sample of older live rows (#1568). Writes nothing. */
export async function olderLiveShadow(db: SqlTag, options: { runId: number; limit?: number }): Promise<OlderLiveShadow> {
  const shadow: OlderLiveShadow = { read: 0, wouldFail: {}, samples: [] };
  try {
    const limit = options.limit ?? OLDER_LIVE_SHADOW_LIMIT;
    let rows = await selectOlderLiveRows(db, limit, "random");
    // A start near the top finds fewer than the limit: wrap round to the lowest ids.
    if (rows.length < limit) {
      const seen = new Set(rows.map((row) => String(row.fee_verified_id)));
      const wrapped = await selectOlderLiveRows(db, limit - rows.length, "start");
      rows = [...rows, ...wrapped.filter((row) => !seen.has(String(row.fee_verified_id)))];
    }
    if (rows.length === 0) return shadow;
    const texts = await textsFor(db, rows);
    for (const row of rows) {
      shadow.read += 1;
      const { canonicalFeeKey, amount, check } = recheckOf(row, texts);
      if (!check) continue;
      shadow.wouldFail[check.code] = (shadow.wouldFail[check.code] ?? 0) + 1;
      if (shadow.samples.length < 20) {
        shadow.samples.push({
          feePublishedId: Number(row.fee_published_id),
          feeVerifiedId: Number(row.fee_verified_id),
          institutionId: Number(row.institution_id),
          canonicalFeeKey,
          feeName: row.fee_name ?? "",
          amount,
          code: check.code,
        });
      }
    }
  } catch (error) {
    return { ...shadow, error: error instanceof Error ? error.message : String(error) };
  }
  return shadow;
}

export async function recheckVerifiedFees(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; limit?: number; now?: Date; sameStepTakedown?: boolean; olderLive?: boolean },
): Promise<VerifiedRecheckResult> {
  const limit = Math.max(1, Math.min(options.limit ?? RECHECK_LIMIT, 1_000));
  const olderLive = options.olderLive ?? DARWIN_RECHECK_OLDER_LIVE;
  options = { ...options, sameStepTakedown: options.sameStepTakedown ?? DARWIN_RECHECK_SAME_STEP_TAKEDOWN };
  const result: VerifiedRecheckResult = { ...EMPTY, rejected: [], restored: [], takenDown: [] };
  // Off: every fourth run reports what reading older live rows would do, and changes nothing for
  // them (#1568). It is a per-step sample; the whole backlog's count is a separate read-only query.
  if (!olderLive && options.runId % OLDER_LIVE_SHADOW_EVERY === 0) result.olderLive = await olderLiveShadow(db, { runId: options.runId });
  let rows: RecheckRow[];
  try {
    // The rows the not_in_source re-select verified (#883, the cohort UAT checked) are read first;
    // once they are done each step reads the newest verified rows.
    rows = await selectRows(db, limit, true);
    if (rows.length === 0) rows = await selectRows(db, limit, false);
    // On: older live rows get their own share of each step, so new rows never starve them (#1568).
    if (olderLive) rows = [...rows, ...(await selectOlderLiveRows(db, Math.ceil(limit / 2), null))];
  } catch (error) {
    console.warn("[darwin] verified recheck read failed", error instanceof Error ? error.message : error);
    return result;
  }
  if (rows.length === 0) return result;

  const texts = await textsFor(db, rows);
  const failing: Array<{
    feePublishedId: number;
    feeVerifiedId: number;
    institutionId: number;
    canonicalFeeKey: string;
    amount: number | null;
    sourceDocumentId: number | null;
    reason: string;
  }> = [];
  const passingLive: number[] = [];
  for (const row of rows) {
    const feeVerifiedId = Number(row.fee_verified_id);
    const { canonicalFeeKey, amount, line, check } = recheckOf(row, texts);
    const publishedId = row.fee_published_id == null ? null : Number(row.fee_published_id);
    const wasRejected = row.review_status === "rejected";
    result.checked += 1;
    const reason = check ? `${RECHECK_REJECTED_FLAG_PREFIX}:${check.code}${check.rule ? `:${check.rule}` : ""}` : "";
    if (wasRejected) {
      // An earlier recheck version rejected this row; a pass under this version restores it.
      if (!check) {
        await db`
          UPDATE verified_fee_observations
             SET review_status = 'verified',
                 outlier_flags = COALESCE((
                   SELECT jsonb_agg(flag) FROM jsonb_array_elements(COALESCE(outlier_flags, '[]'::jsonb)) flag
                    WHERE flag #>> '{}' NOT LIKE ${`${RECHECK_REJECTED_FLAG_PREFIX}:%`}
                 ), '[]'::jsonb)
           WHERE fee_verified_id = ${feeVerifiedId}
             AND review_status = 'rejected'
        `;
        result.restored.push(feeVerifiedId);
      }
    } else if (!check) {
      result.passed += 1;
      if (publishedId != null) passingLive.push(publishedId);
    } else if (publishedId == null) {
      await db`
        UPDATE verified_fee_observations
           SET review_status = 'rejected',
               outlier_flags = CASE
                 WHEN outlier_flags @> ${JSON.stringify([reason])}::jsonb THEN outlier_flags
                 ELSE COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([reason])}::jsonb
               END
         WHERE fee_verified_id = ${feeVerifiedId}
           AND review_status IN ('verified', 'approved')
      `;
      result.rejected.push({ feeVerifiedId, code: check.code });
    } else {
      failing.push({
        feePublishedId: publishedId,
        feeVerifiedId,
        institutionId: Number(row.institution_id),
        canonicalFeeKey,
        amount,
        sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
        reason,
      });
    }
    await recordAttempt(db, {
      institutionId: Number(row.institution_id),
      sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
      stage: "verify",
      strategy: DARWIN_RECHECK_STRATEGY.strategy,
      version: DARWIN_RECHECK_STRATEGY.version,
      fingerprint: `verified:${feeVerifiedId}`,
      outcome: check ? "evidence_mismatch" : "ok",
      yieldCount: check ? 0 : 1,
      costMicrousd: 0,
      durationMs: 0,
      runId: options.runId,
      stepId: options.stepId ?? null,
      foldIntoPlaybook: false,
      detail: {
        fee_verified_id: feeVerifiedId,
        fee_raw_id: Number(row.fee_raw_id),
        fee_published_id: publishedId,
        canonical_fee_key: canonicalFeeKey,
        amount,
        code: check?.code ?? null,
        rule: check?.rule ?? null,
        line: line ? line.slice(0, 300) : null,
        action: wasRejected
          ? (check ? "still_rejected" : "restored")
          : !check ? "passed" : publishedId == null ? "rejected" : options.sameStepTakedown ? "taken_down" : "second_look",
      },
    });
  }

  if (failing.length === 0 && passingLive.length === 0) return result;
  if (!options.sameStepTakedown) {
    // The 12-hour path: flag now, roll back only when a run 12 hours on fails the row again; a
    // live row that passes now has any pending flag from an earlier version cleared.
    const look = await secondLook(db, { check: DARWIN_RECHECK_CHECK, runId: options.runId, failing, passing: passingLive, dryRun: false, now: options.now });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length === 0) return result;
    failing.splice(0, failing.length, ...look.confirmed.map((fee) => failing.find((row) => row.feePublishedId === fee.feePublishedId)!));
  } else if (passingLive.length > 0) {
    const look = await secondLook(db, { check: DARWIN_RECHECK_CHECK, runId: options.runId, failing: [], passing: passingLive, dryRun: false, now: options.now });
    result.cleared = look.cleared;
  }
  if (failing.length === 0) return result;
  // James, 11:55 UTC 2026-10-09 ("stop waiting 12 hours. go"): with the switch on, a live fee the
  // recheck fails comes down in the same step. It is archived (rolled back with the reason), never
  // deleted; the verified row is rejected with the same flag, and every row keeps its attempt.
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-recheck-${options.runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${failing.map((fee) => fee.feePublishedId)}::bigint[], ${failing.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const done = failing.filter((fee) => ids.has(fee.feePublishedId));
      if (done.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? v.flag THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(v.flag)
                 END
            FROM unnest(${done.map((fee) => fee.feeVerifiedId)}::bigint[], ${done.map((fee) => fee.reason)}::text[])
                 AS v(fee_verified_id, flag)
           WHERE fv.fee_verified_id = v.fee_verified_id
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return done.map((fee) => fee.feePublishedId);
    });
    result.takenDown = closed;
    if (closed.length > 0) invalidatePublicReadCache();
  } catch (error) {
    console.error("[darwin] verified recheck takedown failed", error instanceof Error ? error.message : error);
  }
  return result;
}
